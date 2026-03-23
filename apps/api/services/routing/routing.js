
const express       = require('express');
const router        = express.Router();
const pool          = require('../db/db');
const cron          = require('node-cron');
const { getConnection, publish, createConsumer, QUEUES } = require('../../rabbitmq');
const { broadcast } = require('../notifications/notifications');
const { classify }  = require('../classifier/classifier');

// ── SLA tier map (seconds) ────────────────────────────────────────────────────

const SLA_SECONDS = { 1: 86400, 2: 172800, 3: 259200, 4: 432000, 5: 864000 };

function slaDeadline(priority) {
  const seconds = SLA_SECONDS[priority] || SLA_SECONDS[3];
  return new Date(Date.now() + seconds * 1000);
}

// ── Routing engine ────────────────────────────────────────────────────────────
// Consumes complaint.classified events from RabbitMQ.
// For each event:
//   1. Look up dept_id from category → departments table
//   2. Find the least-loaded officer in that dept (fewest open tasks)
//   3. Insert a Task record with SLA deadline
//   4. Update complaint with dept_id and assigned_to
//   5. Publish task.created so notification service alerts the officer

async function startRoutingEngine() {
  await createConsumer(QUEUES.CLASSIFIED, async (event) => {
    const { complaint_id, category, description } = event;
    const classified = classify(description || '', category);
    const priority   = classified.priority;

    // ── Step 1: Look up department by category code ───────────────────────
    const { rows: deptRows } = await pool.query(
      'SELECT id FROM departments WHERE code = $1 LIMIT 1',
      [category]
    );

    // CAT-10 (Other) and unmatched categories fall back to General dept
    let deptId;
    if (deptRows.length) {
      deptId = deptRows[0].id;
    } else {
      const { rows: generalRows } = await pool.query(
        "SELECT id FROM departments WHERE code = 'GENERAL' LIMIT 1"
      );
      deptId = generalRows[0]?.id;
    }

    if (!deptId) {
      console.error(`No department found for category ${category}, complaint ${complaint_id}`);
      return; // consumer will ack — don't requeue indefinitely for missing dept
    }

    // ── Step 2: Find least-loaded officer in dept ─────────────────────────
    // Least-loaded = officer with the fewest open (non-resolved) tasks.
    // LEFT JOIN ensures officers with zero tasks are included.
    const { rows: officerRows } = await pool.query(
      `SELECT u.id, COUNT(t.id) AS open_tasks
       FROM users u
       LEFT JOIN tasks t
         ON t.assigned_to = u.id
         AND t.status NOT IN ('resolved', 'closed')
       WHERE u.dept_id = $1
         AND u.role IN ('officer', 'dept_head')
         AND u.is_active = true
       GROUP BY u.id
       ORDER BY open_tasks ASC
       LIMIT 1`,
      [deptId]
    );

    const assignedTo = officerRows[0]?.id || null;
    const deadline   = slaDeadline(priority);

    // ── Step 3: Insert primary Task record ────────────────────────────────
    const { rows: [task] } = await pool.query(
      `INSERT INTO tasks
         (id, complaint_id, dept_id, assigned_to, is_primary,
          status, sla_deadline, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, true,
          'open', $4, now(), now())
       RETURNING id`,
      [complaint_id, deptId, assignedTo, deadline]
    );

    // ── Step 4: Update complaint with dept + officer assignment ───────────
    await pool.query(
      `UPDATE complaints
       SET dept_id = $1, assigned_to = $2, status = 'assigned',
           sla_deadline = $3, updated_at = now()
       WHERE id = $4`,
      [deptId, assignedTo, deadline, complaint_id]
    );

    // ── Step 5: Audit trail ───────────────────────────────────────────────
    await pool.query(
      `INSERT INTO complaint_history
         (id, complaint_id, actor_id, action, old_status, new_status, note, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'assigned', 'pending', 'assigned', $3, now())`,
      [complaint_id, assignedTo, `Routed to dept ${deptId}`]
    );

    // ── Step 6: Publish task.created → notification service ───────────────
    await publish(QUEUES.TASK_CREATED, {
      task_id:      task.id,
      complaint_id,
      officer_id:   assignedTo,
      dept_id:      deptId,
      sla_deadline: deadline,
    });

    // ── Step 7: WebSocket broadcast for live dashboard update ─────────────
    broadcast({
      type:         'complaint.status_updated',
      complaint_id,
      new_status:   'assigned',
      dept_id:      deptId,
    });

    console.log(`Routed complaint ${complaint_id} → dept ${deptId}, officer ${assignedTo}`);
  });

  console.log('Routing engine started');
}

// ── SLA escalation cron ───────────────────────────────────────────────────────
// Runs every 15 minutes.
// Two separate passes:
//   Pass A — tasks at >= 80% SLA consumed: publish warning event
//   Pass B — tasks at >= 100% SLA consumed: set status = escalated
//
// FIX: original used "sla_deadline < now() * 0.8" which is invalid SQL.
// Correct approach: compute what time 80% of the SLA window elapsed, i.e.
//   created_at + (sla_deadline - created_at) * 0.8
// Any task where now() is past that point has consumed 80%+ of its SLA.

cron.schedule('*/15 * * * *', async () => {
  try {
    // ── Pass A: 80% SLA consumed → escalation warning ────────────────────
    const { rows: warningTasks } = await pool.query(
      `SELECT t.id, t.dept_id, t.assigned_to, t.complaint_id
       FROM tasks t
       WHERE t.status NOT IN ('resolved', 'closed', 'escalated')
         AND t.escalation_notified = false
         AND now() > t.created_at + (t.sla_deadline - t.created_at) * 0.8`,
    );

    await Promise.all(warningTasks.map(async (task) => {
      // Publish to queue so notification service dispatches to officer + dept_head
      await publish(QUEUES.SLA_ESCALATION, {
        type:         'sla.escalation',
        task_id:      task.id,
        complaint_id: task.complaint_id,
        dept_id:      task.dept_id,
        officer_id:   task.assigned_to,
        pct_consumed: 80,
      });

      // WebSocket push for immediate dashboard badge update
      broadcast({
        type:    'sla.escalation',
        task_id: task.id,
        dept_id: task.dept_id,
      });

      // Mark notified so we don't re-send on the next cron tick
      await pool.query(
        'UPDATE tasks SET escalation_notified = true WHERE id = $1',
        [task.id]
      );
    }));

    // ── Pass B: 100% SLA consumed → auto-escalate status ─────────────────
    const { rows: overdueTasks } = await pool.query(
      `UPDATE tasks
       SET status = 'escalated', updated_at = now()
       WHERE status IN ('open', 'in_progress')
         AND now() > sla_deadline
       RETURNING id, dept_id, complaint_id`,
    );

    await Promise.all(overdueTasks.map(async (task) => {
      // Update parent complaint status to match
      await pool.query(
        `UPDATE complaints SET status = 'escalated', updated_at = now()
         WHERE id = $1`,
        [task.complaint_id]
      );

      // Audit trail
      await pool.query(
        `INSERT INTO complaint_history
           (id, complaint_id, actor_id, action, old_status, new_status, note, created_at)
         VALUES
           (gen_random_uuid(), $1, NULL, 'auto_escalated', 'in_progress', 'escalated',
            'SLA deadline exceeded', now())`,
        [task.complaint_id]
      );

      broadcast({
        type:         'complaint.status_updated',
        complaint_id: task.complaint_id,
        new_status:   'escalated',
        dept_id:      task.dept_id,
      });
    }));

    if (warningTasks.length || overdueTasks.length) {
      console.log(`SLA cron: ${warningTasks.length} warnings, ${overdueTasks.length} escalated`);
    }

  } catch (err) {
    console.error('SLA cron error:', err.message);
  }
});

// ── Start routing engine on module load ───────────────────────────────────────
// Wrapped in an IIFE so top-level await is not needed (Node < 14.8 compat).

(async () => {
  try {
    await startRoutingEngine();
  } catch (err) {
    console.error('Failed to start routing engine:', err.message);
    // Do not crash the process — RabbitMQ may not be ready yet.
    // The fixed rabbitmq.js connect() will retry; restart routing engine
    // by listening to the reconnect event if needed.
  }
})();

module.exports = router;