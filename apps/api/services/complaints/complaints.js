 
const express  = require('express');
const router   = express.Router();
const { requireRole } = require('../auth/auth');
const pool     = require('../db/db');
const { broadcast }  = require('../notifications/notifications');
const amqplib  = require('amqplib');
 
// ── Constants ────────────────────────────────────────────────────────────────
 
const DEMO_MODE = process.env.DEMO_MODE === 'true';
 
const DEMO_BBOX = {
  lat_min: 28.595, lat_max: 28.625,
  lng_min: 77.195, lng_max: 77.225,
};
 
// SLA deadlines in seconds per priority level
const SLA_SECONDS = { 1: 86400, 2: 172800, 3: 259200, 4: 432000, 5: 864000 };
 
const VALID_STATUSES = ['pending', 'assigned', 'in_progress', 'escalated', 'resolved', 'closed'];
 
// Full multi-issue detection lookup table (all 10 categories)
const DETECTION_TABLE = {
  'CAT-01': [
    { category: 'CAT-04', label: 'waste_accumulation',       confidence: 0.71, dept: 'SANITATION' },
    { category: 'CAT-02', label: 'waterlogging_risk',         confidence: 0.58, dept: 'DRAINAGE'   },
  ],
  'CAT-02': [
    { category: 'CAT-02', label: 'flooding_risk',             confidence: 0.74, dept: 'DRAINAGE'   },
    { category: 'CAT-04', label: 'foul_odour_sanitation',     confidence: 0.63, dept: 'SANITATION' },
  ],
  'CAT-03': [
    { category: 'CAT-03', label: 'safety_crime_risk',         confidence: 0.69, dept: 'ELECTRICAL' },
    { category: 'CAT-03', label: 'electrical_infra_age',      confidence: 0.52, dept: 'ELECTRICAL' },
  ],
  'CAT-04': [
    { category: 'CAT-04', label: 'health_hazard',             confidence: 0.81, dept: 'SANITATION' },
    { category: 'CAT-05', label: 'groundwater_contamination', confidence: 0.55, dept: 'WATER'      },
  ],
  'CAT-05': [
    { category: 'CAT-05', label: 'pipeline_burst_prediction', confidence: 0.77, dept: 'WATER'      },
    { category: 'CAT-01', label: 'road_damage_risk',          confidence: 0.49, dept: 'ROADS'      },
  ],
  'CAT-06': [
    { category: 'CAT-06', label: 'accessibility_barrier',     confidence: 0.72, dept: 'PARKS'      },
    { category: 'CAT-02', label: 'rainwater_pooling',         confidence: 0.61, dept: 'DRAINAGE'   },
  ],
  'CAT-07': [
    { category: 'CAT-07', label: 'traffic_disruption',        confidence: 0.66, dept: 'ROADS'      },
    { category: 'CAT-07', label: 'pedestrian_safety',         confidence: 0.58, dept: 'ROADS'      },
  ],
  'CAT-08': [
    { category: 'CAT-08', label: 'public_health_hazard',      confidence: 0.60, dept: 'SANITATION' },
    { category: 'CAT-08', label: 'regulatory_violation',      confidence: 0.55, dept: 'GENERAL'    },
  ],
  'CAT-09': [
    { category: 'CAT-09', label: 'public_safety_risk',        confidence: 0.73, dept: 'GENERAL'    },
    { category: 'CAT-09', label: 'road_accident_potential',   confidence: 0.61, dept: 'ROADS'      },
  ],
  'CAT-10': [], // catch-all — no secondary detection
};
 
// ── Helpers ──────────────────────────────────────────────────────────────────
 
// Derive ward_id from complaint coordinates using PostGIS
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
 
// Compute SLA deadline timestamp from priority
function computeSLADeadline(priority) {
  const seconds = SLA_SECONDS[priority] || SLA_SECONDS[3];
  return new Date(Date.now() + seconds * 1000);
}
 
// Publish complaint.submitted event to RabbitMQ
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
    // Queue failure must never block the HTTP response
    console.error('RabbitMQ publish error', err.message);
  }
}
 
// Create secondary Task records for detected issues
async function createSecondaryTasks(complaintId, secondaryIssues, slaPriority) {
  if (!secondaryIssues.length) return;
  const deadline = computeSLADeadline(slaPriority + 1); // secondary = lower priority
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
 
// ── POST /complaints ──────────────────────────────────────────────────────────
 
router.post('/', requireRole('citizen'), async (req, res) => {
  const {
    category,
    subcategory,
    description,
    longitude,
    latitude,
    file_urls: fileUrlsRaw,
  } = req.body;
  const citizenId = req.user.sub;
  const source    = req.user.source || 'production';
  const fileUrls  = Array.isArray(fileUrlsRaw)
    ? fileUrlsRaw.filter((url) => typeof url === 'string' && url.trim() !== '').slice(0, 3)
    : [];
 
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
    // Fallback: if no CITY_BOUNDARY row exists, use bbox check
    const withinCity = geoRow?.valid ?? (
      latitude  >= 28.4 && latitude  <= 28.9 &&
      longitude >= 76.8 && longitude <= 77.5
    );
    if (!withinCity) {
      return res.status(400).json({ error: 'Location outside service area' });
    }
 
    // ── Step 2: Demo geo-fence (DEMO_MODE only) ───────────────────────────
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
 
    // ── Step 4: Duplicate check (50m radius, 48h, same category, not closed)
    // Cast to ::geography so ST_DWithin measures in metres, not degrees
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
 
    // ── Step 5: Compute priority + SLA ───────────────────────────────────
    const priority    = 3; // default; classification engine will override via queue
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
 
    // ── Step 7: Multi-issue detection ─────────────────────────────────────
    const secondaryIssues = DETECTION_TABLE[category] || [];
    await createSecondaryTasks(complaint.id, secondaryIssues, priority);
 
    // ── Step 8: Insert primary audit log entry ────────────────────────────
    await pool.query(
      `INSERT INTO complaint_history
         (id, complaint_id, actor_id, action, new_status, created_at)
       VALUES
         (gen_random_uuid(), $1, $2, 'submitted', 'pending', now())`,
      [complaint.id, citizenId]
    );
 
    // ── Step 9: Publish to RabbitMQ (non-blocking) ────────────────────────
    publishToQueue({
      complaint_id: complaint.id,
      category,
      subcategory,
      description,
      file_urls: fileUrls,
      image_url: fileUrls[0] || null,
      location:    { longitude, latitude },
      ward_id:     wardId,
      source,
    });
 
    // ── Step 10: Respond ──────────────────────────────────────────────────
    return res.status(201).json({
      complaint_id:    complaint.id,
      sla_deadline:    complaint.sla_deadline,
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
 
      // Citizens can only see their own complaints
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
  requireRole('officer', 'dept_head', 'commissioner'),
  async (req, res) => {
    try {
      const { status, page = 1, limit = 50 } = req.query;
      const offset = (page - 1) * limit;
      const params = [];
      const conditions = [];
 
      // RBAC scoping — officers only see their dept's complaints
      if (req.user.role === 'officer' || req.user.role === 'dept_head') {
        conditions.push(`dept_id = $${params.length + 1}`);
        params.push(req.user.dept_id);
      }
      // commissioner: no filter
 
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
      // Fetch current status for audit trail
      const { rows: [current] } = await pool.query(
        'SELECT status FROM complaints WHERE id = $1',
        [req.params.id]
      );
      if (!current) return res.status(404).json({ error: 'Not found' });
 
      // Update complaint status
      await pool.query(
        'UPDATE complaints SET status = $1, updated_at = now() WHERE id = $2',
        [status, req.params.id]
      );
 
      // Audit trail — always write history on status change
      await pool.query(
        `INSERT INTO complaint_history
           (id, complaint_id, actor_id, action, old_status, new_status, note, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'status_updated', $3, $4, $5, now())`,
        [req.params.id, req.user.sub, current.status, status, note || null]
      );
 
      // Broadcast WebSocket event for real-time dashboard + citizen tracking update
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
 
      // Set officer_verified = true
      await pool.query(
        'UPDATE complaints SET officer_verified = true, updated_at = now() WHERE id = $1',
        [req.params.id]
      );
 
      // Audit trail
      await pool.query(
        `INSERT INTO complaint_history
           (id, complaint_id, actor_id, action, note, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 'officer_verified', 'Officer field verification', now())`,
        [req.params.id, req.user.sub]
      );
 
      // Broadcast WebSocket event — triggers hollow → solid marker on map
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