const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const { requireRole } = require('../auth/auth');
const pool     = require('../db/db');
const { broadcast }  = require('../notifications/notifications');
const amqplib  = require('amqplib');

// ── Constants ────────────────────────────────────────────────────────────────

const DEMO_MODE = process.env.DEMO_MODE === 'true';
const CLASSIFIER_URL = process.env.CLASSIFIER_URL || 'http://classifier:8000';

const DEMO_BBOX = {
  lat_min: 28.595, lat_max: 28.625,
  lng_min: 77.195, lng_max: 77.225,
};

const SLA_SECONDS = { 1: 86400, 2: 172800, 3: 259200, 4: 432000, 5: 864000 };
const VALID_STATUSES = ['pending', 'assigned', 'in_progress', 'escalated', 'resolved', 'closed'];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveWardId(lng, lat) {
  const { rows } = await pool.query(
    `SELECT id FROM wards
     WHERE ST_Within(
       ST_SetSRID(ST_MakePoint($1, $2), 4326),
       boundary
     )
     LIMIT 1`,
    [lng, lat]
  );
  return rows[0]?.id || null;
}

function computeSLADeadline(priority) {
  const seconds = SLA_SECONDS[priority] || SLA_SECONDS[3];
  return new Date(Date.now() + seconds * 1000);
}

async function publishToQueue(payload) {
  try {
    const conn    = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await conn.createChannel();
    await channel.assertQueue('complaint.submitted', { durable: true });
    channel.sendToQueue(
      'complaint.submitted',
      Buffer.from(JSON.stringify(payload)),
      { persistent: true }
    );
    await channel.close();
    await conn.close();
  } catch (err) {
    console.error('RabbitMQ publish error', err.message);
  }
}

async function createSecondaryTasks(complaintId, secondaryIssues, slaPriority) {
  if (!secondaryIssues || !secondaryIssues.length) return;
  const deadline = computeSLADeadline(slaPriority + 1);
  for (const issue of secondaryIssues) {
    await pool.query(
      `INSERT INTO tasks
         (id, complaint_id, detected_category, confidence, is_primary, status, sla_deadline, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, false, 'open', $4, now())`,
      [complaintId, issue.category, issue.confidence, deadline]
    );
  }
}

// ── Integration 2: Call classifier:8000 and extract secondary_issues ─────────
// Returns { priority, secondaryIssues } from the ML classifier.
// Falls back gracefully if the classifier is unavailable.

async function classifyComplaint({ description, latitude, longitude, category }) {
  try {
    const { data } = await axios.post(
      `${CLASSIFIER_URL}/api/v1/analyze`,
      {
        text_description:      description || '',
        latitude:              latitude,
        longitude:             longitude,
        user_selected_category: category,
      },
      { timeout: 8000 }
    );

    // data.analysis is null when classifier returns a duplicate short-circuit
    const analysis = data?.analysis;
    if (!analysis) return { priority: 3, secondaryIssues: [] };

    const priority        = analysis.primary_issue?.priority_score ?? 3;
    const secondaryIssues = (analysis.secondary_issues ?? []).map(issue => ({
      category:   issue.category,
      confidence: issue.confidence,
      label:      issue.risk_description,
    }));

    return { priority, secondaryIssues };
  } catch (err) {
    // Non-fatal — classifier down should not block complaint submission
    console.error('Classifier call failed, using defaults:', err.message);
    return { priority: 3, secondaryIssues: [] };
  }
}

// ── POST /complaints ──────────────────────────────────────────────────────────

router.post('/', requireRole('citizen'), async (req, res) => {
  const { category, subcategory, description, longitude, latitude } = req.body;
  const citizenId = req.user.sub;
  const source    = req.user.source || 'production';

  if (!category || longitude == null || latitude == null) {
    return res.status(400).json({ error: 'category, longitude and latitude are required' });
  }

  try {
    // ── Step 1: City boundary geo-validation ──────────────────────────────
    const { rows: [geoRow] } = await pool.query(
      `SELECT ST_Within(
         ST_SetSRID(ST_MakePoint($1, $2), 4326),
         boundary
       ) AS valid
       FROM wards WHERE id = 'CITY_BOUNDARY' LIMIT 1`,
      [longitude, latitude]
    );
    const withinCity = geoRow?.valid ?? (
      latitude  >= 28.4 && latitude  <= 28.9 &&
      longitude >= 76.8 && longitude <= 77.5
    );
    if (!withinCity) {
      return res.status(400).json({ error: 'Location outside service area' });
    }

    // ── Step 2: Demo geo-fence ────────────────────────────────────────────
    if (DEMO_MODE) {
      const inFence = (
        latitude  >= DEMO_BBOX.lat_min && latitude  <= DEMO_BBOX.lat_max &&
        longitude >= DEMO_BBOX.lng_min && longitude <= DEMO_BBOX.lng_max
      );
      if (!inFence) {
        return res.status(400).json({ error: 'Location must be within demo ward' });
      }
    }

    // ── Step 3: Ward assignment via PostGIS ───────────────────────────────
    const wardId = await resolveWardId(longitude, latitude);

    // ── Step 4: Duplicate check ───────────────────────────────────────────
    const { rows: dedupRows } = await pool.query(
      `SELECT id FROM complaints
       WHERE category = $1
         AND status   != 'closed'
         AND created_at > now() - interval '48 hours'
         AND ST_DWithin(
               location::geography,
               ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
               50
             )
       LIMIT 1`,
      [category, longitude, latitude]
    );
    if (dedupRows.length) {
      return res.status(200).json({
        duplicate:             true,
        existing_complaint_id: dedupRows[0].id,
      });
    }

    // ── Step 5: ML Classification (Integration 2) ─────────────────────────
    // Call classifier:8000 to get AI-derived priority + secondary issues.
    // Falls back to priority=3, secondaryIssues=[] if classifier is down.
    const { priority, secondaryIssues } = await classifyComplaint({
      description, latitude, longitude, category,
    });

    const slaDeadline = computeSLADeadline(priority);

    // ── Step 6: Insert complaint ──────────────────────────────────────────
    const { rows: [complaint] } = await pool.query(
      `INSERT INTO complaints
         (id, citizen_id, category, subcategory, description, location,
          ward_id, status, priority, source, environment,
          officer_verified, sla_deadline, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4,
          ST_SetSRID(ST_MakePoint($5, $6), 4326),
          $7, 'pending', $8, $9, $10,
          false, $11, now(), now())
       RETURNING id, sla_deadline`,
      [
        citizenId, category, subcategory || null, description || null,
        longitude, latitude,
        wardId, priority, source,
        DEMO_MODE ? 'sandbox' : 'production',
        slaDeadline,
      ]
    );

    // ── Step 7: Multi-issue detection (Integration 2 continued) ──────────
    // Use ML-returned secondary_issues (not the static lookup table).
    await createSecondaryTasks(complaint.id, secondaryIssues, priority);

    // ── Step 8: Audit log ─────────────────────────────────────────────────
    await pool.query(
      `INSERT INTO complaint_history
         (id, complaint_id, actor_id, action, new_status, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'submitted', 'pending', now())`,
      [complaint.id, citizenId]
    );

    // ── Step 9: Publish to RabbitMQ ───────────────────────────────────────
    publishToQueue({
      complaint_id: complaint.id,
      category,
      subcategory,
      description,
      location:    { longitude, latitude },
      ward_id:     wardId,
      source,
    });

    // ── Step 10: Respond ──────────────────────────────────────────────────
    return res.status(201).json({
      complaint_id:     complaint.id,
      sla_deadline:     complaint.sla_deadline,
      secondary_issues: secondaryIssues,
    });

  } catch (err) {
    console.error('Complaint submit error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /complaints/:id ───────────────────────────────────────────────────────

router.get('/:id',
  requireRole('citizen', 'officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    try {
      let query  = 'SELECT * FROM complaints WHERE id = $1';
      const params = [req.params.id];

      if (req.user.role === 'citizen') {
        query += ' AND citizen_id = $2';
        params.push(req.user.sub);
      }

      const { rows } = await pool.query(query, params);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });

      const { rows: history } = await pool.query(
        `SELECT * FROM complaint_history
         WHERE complaint_id = $1
         ORDER BY created_at ASC`,
        [req.params.id]
      );

      return res.json({ ...rows[0], history });
    } catch (err) {
      console.error('GET complaint error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /complaints ───────────────────────────────────────────────────────────

router.get('/',
  requireRole('citizen', 'officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    try {
      const { status, page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;
      const params = [];
      const conditions = [];

      if (req.user.role === 'citizen') {
        conditions.push(`citizen_id = $${params.length + 1}`);
        params.push(req.user.sub);
      } else if (req.user.role === 'officer' || req.user.role === 'dept_head') {
        conditions.push(`dept_id = $${params.length + 1}`);
        params.push(req.user.dept_id);
      }

      if (status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(status);
      }

      const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(limit, offset);

      const { rows } = await pool.query(
        `SELECT * FROM complaints
         ${where}
         ORDER BY sla_deadline ASC NULLS LAST
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return res.json({ complaints: rows, page: Number(page), limit: Number(limit) });
    } catch (err) {
      console.error('List complaints error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── PATCH /complaints/:id/status ──────────────────────────────────────────────

router.patch('/:id/status',
  requireRole('officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    const { status, note } = req.body;

    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    try {
      const { rows: [current] } = await pool.query(
        'SELECT status FROM complaints WHERE id = $1',
        [req.params.id]
      );
      if (!current) return res.status(404).json({ error: 'Not found' });

      await pool.query(
        'UPDATE complaints SET status = $1, updated_at = now() WHERE id = $2',
        [status, req.params.id]
      );

      await pool.query(
        `INSERT INTO complaint_history
           (id, complaint_id, actor_id, action, old_status, new_status, note, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'status_updated', $3, $4, $5, now())`,
        [req.params.id, req.user.sub, current.status, status, note || null]
      );

      broadcast({
        type:         'complaint.status_updated',
        complaint_id: req.params.id,
        new_status:   status,
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('Status update error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── GET /complaints/:id/history ───────────────────────────────────────────────

router.get('/:id/history',
  requireRole('officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM complaint_history
         WHERE complaint_id = $1
         ORDER BY created_at ASC`,
        [req.params.id]
      );
      return res.json({ history: rows });
    } catch (err) {
      console.error('History fetch error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /complaints/:id/verify ───────────────────────────────────────────────

router.post('/:id/verify',
  requireRole('officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    try {
      const { rows: [current] } = await pool.query(
        'SELECT officer_verified FROM complaints WHERE id = $1',
        [req.params.id]
      );
      if (!current) return res.status(404).json({ error: 'Not found' });
      if (current.officer_verified) {
        return res.status(200).json({ verified: true, message: 'Already verified' });
      }

      await pool.query(
        'UPDATE complaints SET officer_verified = true, updated_at = now() WHERE id = $1',
        [req.params.id]
      );

      await pool.query(
        `INSERT INTO complaint_history
           (id, complaint_id, actor_id, action, note, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'officer_verified', 'Officer field verification', now())`,
        [req.params.id, req.user.sub]
      );

      broadcast({
        type:         'complaint.verified',
        complaint_id: req.params.id,
      });

      return res.json({ verified: true });
    } catch (err) {
      console.error('Verify error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;