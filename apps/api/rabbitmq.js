// apps/api/services/rabbitmq.js
// RabbitMQ connection + channel manager for ResolveX backend


const amqplib = require('amqplib');

// ── Queue definitions ─────────────────────────────────────────────────────────
// Every queue declared here with durable:true so messages survive RabbitMQ
// restarts. prefetch(10) on consumer channels prevents a slow consumer from
// starving the queue.

const QUEUES = {
  SUBMITTED:  'complaint.submitted',   // Complaint Svc → Classification Engine
  CLASSIFIED: 'complaint.classified',  // Classification Engine → Routing Engine
  TASK_CREATED: 'task.created',        // Routing Engine → Notification Svc
  STATUS_UPDATED: 'status.updated',    // Officer action → Notification Svc
  SLA_ESCALATION: 'sla.escalation',    // SLA cron → Notification Svc
};

// ── Singleton state ───────────────────────────────────────────────────────────

let connection    = null;
let publishChannel = null;
let reconnectTimer = null;
let isConnecting  = false;

// ── connect() ─────────────────────────────────────────────────────────────────

async function connect() {
  if (isConnecting) return;
  isConnecting = true;

  const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

  try {
    connection = await amqplib.connect(rabbitUrl);
    isConnecting = false;
    console.log('RabbitMQ connected');

    // On unexpected close — reconnect with backoff
    connection.on('close', () => {
      console.warn('RabbitMQ connection closed, reconnecting in 5s...');
      connection     = null;
      publishChannel = null;
      reconnectTimer = setTimeout(connect, 5000);
    });

    connection.on('error', (err) => {
      console.error('RabbitMQ connection error', err.message);
      // 'close' event fires after 'error' — reconnect handled there
    });

    // Set up shared publish channel and assert all queues
    publishChannel = await connection.createChannel();

    for (const queue of Object.values(QUEUES)) {
      await publishChannel.assertQueue(queue, {
        durable:    true,  // survive RabbitMQ restart
        arguments: {
          'x-message-ttl': 86400000, // drop unprocessed messages after 24h
        },
      });
    }

    console.log('RabbitMQ queues asserted:', Object.values(QUEUES).join(', '));

  } catch (err) {
    isConnecting = false;
    console.error('RabbitMQ connect failed, retrying in 5s...', err.message);
    reconnectTimer = setTimeout(connect, 5000);
  }
}

// ── publish() ─────────────────────────────────────────────────────────────────
// Publish a message to a named queue. persistent:true ensures the message
// survives a RabbitMQ broker restart (requires durable queue, set above).

async function publish(queueName, payload) {
  if (!publishChannel) {
    console.warn(`RabbitMQ not ready, dropping message to ${queueName}`);
    return false;
  }

  try {
    const buffer = Buffer.from(JSON.stringify(payload));
    return publishChannel.sendToQueue(queueName, buffer, {
      persistent:   true,       // message survives broker restart
      contentType:  'application/json',
      timestamp:    Date.now(),
    });
  } catch (err) {
    console.error(`RabbitMQ publish error to ${queueName}`, err.message);
    return false;
  }
}

// ── createConsumer() ──────────────────────────────────────────────────────────
// Creates a dedicated consumer channel for a queue.
// prefetch(10) means the broker sends at most 10 unacknowledged messages at
// once — prevents a slow consumer from being overwhelmed under spike load.
// handler(msg) must call msg.ack() or msg.nack() — if it throws, the message
// is nack'd and requeued once (requeue: true).

async function createConsumer(queueName, handler) {
  if (!connection) {
    throw new Error('RabbitMQ not connected. Call connect() first.');
  }

  const channel = await connection.createChannel();
  await channel.assertQueue(queueName, { durable: true });
  await channel.prefetch(10);

  await channel.consume(queueName, async (msg) => {
    if (!msg) return; // consumer cancelled

    let payload;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      // Malformed message — reject without requeue (don't loop forever)
      channel.nack(msg, false, false);
      return;
    }

    try {
      await handler(payload);
      channel.ack(msg);
    } catch (err) {
      console.error(`Consumer error on ${queueName}`, err.message);
      // Requeue once — if it fails again the message goes to dead-letter
      channel.nack(msg, false, true);
    }
  });

  console.log(`Consumer started on queue: ${queueName}`);
  return channel;
}

// ── getConnection() ───────────────────────────────────────────────────────────

function getConnection() {
  return connection;
}

// ── close() — for graceful shutdown ──────────────────────────────────────────

async function close() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try {
    if (publishChannel) await publishChannel.close();
    if (connection)     await connection.close();
  } catch (err) {
    console.error('RabbitMQ close error', err.message);
  }
  connection     = null;
  publishChannel = null;
}

// Handle process exit gracefully
process.on('SIGINT',  () => close().then(() => process.exit(0)));
process.on('SIGTERM', () => close().then(() => process.exit(0)));

module.exports = { connect, publish, createConsumer, getConnection, close, QUEUES };
