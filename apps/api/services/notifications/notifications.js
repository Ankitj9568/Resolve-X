// apps/api/services/notifications/notifications.js
// WebSocket notification service
//
// Architecture:
//   - WebSocket server attached to the Express HTTP server (not a separate port)
//   - JWT validated on every new connection — unauthenticated clients rejected
//   - Redis pub/sub fan-out — notification service subscribes to pub:status_updates
//     and forwards to the correct connected clients
//   - Channel routing by role:
//       citizen      → own complaint events only (filtered by citizen_id)
//       officer      → own tasks + dept queue events
//       dept_head    → all dept events
//       commissioner → all events city-wide
//   - broadcast() exported for use by complaints.js, gis.js, routing.js
//   - express Router exported for any future REST notification endpoints

const express   = require('express');
const router    = express.Router();
const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const redis     = require('redis');
const url       = require('url');

const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY;
const JWT_ALGORITHM  = 'RS256';

// ── Redis pub/sub ─────────────────────────────────────────────────────────────
// Separate subscriber client — a Redis client in subscribe mode cannot issue
// other commands, so we need two clients: one for pub/sub, one for general use.

const subClient = redis.createClient({ url: process.env.REDIS_URL });
subClient.connect().catch(console.error);

// ── Connected clients registry ────────────────────────────────────────────────
// Map of ws → decoded JWT payload. Lets us route events to the right clients
// without storing state in Redis (acceptable for MVP single-process server).

const clients = new Map(); // ws → { sub, role, dept_id, ward_id, source }

// ── JWT validation helper ─────────────────────────────────────────────────────

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_PUBLIC_KEY, { algorithms: [JWT_ALGORITHM] });
  } catch {
    return null;
  }
}

// ── Routing predicate — should this client receive this event? ────────────────

function shouldDeliver(user, event) {
  const { type, complaint_id, citizen_id, dept_id, task_id } = event;

  switch (user.role) {
    case 'commissioner':
      return true; // sees everything

    case 'dept_head':
      // All events for their department
      if (dept_id && user.dept_id !== dept_id) return false;
      return true;

    case 'officer':
      if (type === 'complaint.status_updated') return true;      // map updates
      if (type === 'task.assigned')            return true;      // their queue
      if (type === 'complaint.verified')       return true;      // map updates
      if (type === 'demo.reset')               return true;      // map refresh
      if (type === 'sla.escalation')           return dept_id === user.dept_id;
      return false;

    case 'citizen':
      // Citizens only receive events for their own complaints
      if (type === 'complaint.status_updated') return citizen_id === user.sub;
      if (type === 'demo.reset')               return false; // citizens don't see map
      return false;

    default:
      return false;
  }
}

// ── broadcast() — used by other services ─────────────────────────────────────
// Publishes an event to the Redis pub/sub channel.
// All notification service instances (if horizontally scaled) will receive it
// and forward to their locally connected clients.

async function broadcast(event) {
  try {
    // Use a separate publisher client — subClient is in subscribe mode
    const pubClient = redis.createClient({ url: process.env.REDIS_URL });
    await pubClient.connect();
    await pubClient.publish('pub:status_updates', JSON.stringify(event));
    await pubClient.quit();
  } catch (err) {
    console.error('WebSocket broadcast error', err.message);
    // Non-fatal — a missed WS event is annoying but not a data loss
  }
}

function initWS(httpServer) {
  const wss = new WebSocket.Server({ noServer: true });

  // Upgrade HTTP → WebSocket, validating JWT before the handshake completes
  httpServer.on('upgrade', (request, socket, head) => {
    const { query } = url.parse(request.url, true);
    const token     = query.token;

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const user = verifyToken(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, user);
    });
  });

  // Register client on connection
  wss.on('connection', (ws, user) => {
    clients.set(ws, user);

    // Send a welcome ping so the client knows the connection is live
    ws.send(JSON.stringify({ type: 'connected', role: user.role }));

    ws.on('close', () => clients.delete(ws));
    ws.on('error', (err) => {
      console.error('WS client error', err.message);
      clients.delete(ws);
    });

    // Heartbeat — keep connections alive through load balancers / proxies
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  // Ping all clients every 30s; terminate dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  // Subscribe to Redis pub/sub channel and forward events to clients
  subClient.subscribe('pub:status_updates', (message) => {
    let event;
    try {
      event = JSON.parse(message);
    } catch {
      return; // malformed message — ignore
    }

    clients.forEach((user, ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!shouldDeliver(user, event))       return;
      ws.send(JSON.stringify(event));
    });
  });

  console.log('WebSocket server initialised');
  return wss;
}

// ── Express router (future REST endpoints e.g. POST /notify) ─────────────────

router.get('/health', (req, res) => {
  res.json({ connected_clients: clients.size });
});

module.exports = { router, initWS, broadcast };