const express       = require('express');
const router        = express.Router();
const axios         = require('axios');
const pool          = require('../db/db');
const cron          = require('node-cron');
const { getConnection, publish, createConsumer, QUEUES } = require('../../rabbitmq');
const { broadcast } = require('../notifications/notifications');

const CLASSIFIER_URL = process.env.CLASSIFIER_URL || 'http://classifier:8000';

// ── SLA tier map (seconds) ────────────────────────────────────────────────────

const SLA_SECONDS = { 1: 86400, 2: 172800, 3: 259200, 4: 432000, 5: 864000 };

function slaDeadline(priority) {
  const seconds = SLA_SECONDS[priority] || SLA_SECONDS[3];
  return new Date(Date.now() + seconds * 1000);
}

// ── Integration 1: Call classifier:8000 instead of local classify() ──────────
// Sends complaint text + location to the ML service.
// Returns { category, priority } — falls back to passed-in category + priority 3
// if the classifier is unavailable so routing never blocks.

async function classifyViaML({ description, category, latitude, longitude }) {
  try {
    const { data } = await axios.post(
      `${CLASSIFIER_URL}/api/v1/analyze`,
      {
        text_description:       description || '',
        latitude:               latitude   || 0,
        longitude:              longitude  || 0,
        user_selected_category: category,
      },
      { timeout: 8000 }
    );

    const analysis = data?.analysis;
    if (!analysis) return { category, priority: 3 };

    return {
      category: analysis.primary_issue?.category  || category,
      priority: analysis.primary_issue?.priority_score || 3,
    };
  } catch (err) {
    console.error('Classifier unavailable, using defaults:', err.message);
    return { category, priority: 3 };
  }
}

// ── Routing engine ────────────────────────────────────────────────────────────

async function startRoutingEngine() {
  await createConsumer(QUEUES.CLASSIFIED, async (event) => {
    const { complaint_id, category, description, location } = event;
    const latitude  = location?.latitude  || 0;
    const longitude = location?.longitude || 0;

    // ── Step 1: ML classification (Integration 1) ─────────────────────────
    const { category: mlCategory, priority } = await classifyViaML({
      description, category, latitude, longitude,
    });

    // ── Step 2: Look up department by ML-returned category ────────────────
    const { rows: deptRows } = await pool.query(
      'SELECT id FROM departments WHERE code = $1 LIMIT 1',
      [mlCategory]
    );

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
      console.error(`No department found for category ${mlCategory}, complaint ${complaint_id}`);
      return;
    }

    // ── Step 3: Find least-loaded officer ────────────────────────────────
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

    // ── Step 4: Insert Task ───────────────────────────────────────────────
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

    // ── Step 5: Update complaint ──────────────────────────────────────────
    await pool.query(
      `UPDATE complaints
       SET dept_id = $1, assigned_to = $2, status = 'assigned',
           sla_deadline = $3, priority = $4, updated_at = now()
       WHERE id = $5`,
      [deptId, assignedTo, deadline, priority, complaint_id]
    );

    // ── Step 6: Audit trail ───────────────────────────────────────────────
    await pool.query(
      `INSERT INTO complaint_history
         (id, complaint_id, actor_id, action, old_status, new_status, note, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'assigned', 'pending', 'assigned', $3, now())`,
      [complaint_id, assignedTo, `ML routed to dept ${deptId} (category: ${mlCategory}, priority: ${priority})`]
    );

    // ── Step 7: Publish task.created ──────────────────────────────────────
    await publish(QUEUES.TASK_CREATED, {
      task_id:      task.id,
      complaint_id,
      officer_id:   assignedTo,
      dept_id:      deptId,
      sla_deadline: deadline,
    });

    // ── Step 8: WebSocket broadcast ───────────────────────────────────────
    broadcast({
      type:         'complaint.status_updated',
      complaint_id,
      new_status:   'assigned',
      dept_id:      deptId,
    });

    console.log(`Routed complaint ${complaint_id} → dept ${deptId} (ML category: ${mlCategory}, priority: ${priority}), officer ${assignedTo}`);
  });

  console.log('Routing engine started');
}

// ── SLA escalation cron ───────────────────────────────────────────────────────

cron.schedule('*/15 * * * *', async () => {
  try {
    const { rows: warningTasks } = await pool.query(
      `SELECT t.id, t.dept_id, t.assigned_to, t.complaint_id
       FROM tasks t
       WHERE t.status NOT IN ('resolved', 'closed', 'escalated')
         AND t.escalation_notified = false
         AND now() > t.created_at + (t.sla_deadline - t.created_at) * 0.8`,
    );

    await Promise.all(warningTasks.map(async (task) => {
      await publish(QUEUES.SLA_ESCALATION, {
        type:         'sla.escalation',
        task_id:      task.id,
        complaint_id: task.complaint_id,
        dept_id:      task.dept_id,
        officer_id:   task.assigned_to,
        pct_consumed: 80,
      });

      broadcast({
        type:    'sla.escalation',
        task_id: task.id,
        dept_id: task.dept_id,
      });

      await pool.query(
        'UPDATE tasks SET escalation_notified = true WHERE id = $1',
        [task.id]
      );
    }));

    const { rows: overdueTasks } = await pool.query(
      `UPDATE tasks
       SET status = 'escalated', updated_at = now()
       WHERE status IN ('open', 'in_progress')
         AND now() > sla_deadline
       RETURNING id, dept_id, complaint_id`,
    );

    await Promise.all(overdueTasks.map(async (task) => {
      await pool.query(
        `UPDATE complaints SET status = 'escalated', updated_at = now()
         WHERE id = $1`,
        [task.complaint_id]
      );

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

(async () => {
  try {
    await startRoutingEngine();
  } catch (err) {
    console.error('Failed to start routing engine:', err.message);
  }
})();

module.exports = router;