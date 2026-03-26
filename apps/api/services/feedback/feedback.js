const express = require('express');
const router = express.Router();

const { requireRole } = require('../auth/auth');
const pool = require('../db/db');

router.post('/', requireRole('citizen'), async (req, res) => {
  try {
    const { complaint_id: complaintId, rating, comment } = req.body;
    const citizenId = req.user.sub;

    if (!complaintId || !rating) {
      return res.status(400).json({ error: 'complaint_id and rating are required' });
    }

    const parsedRating = Number(rating);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }

    const { rows: complaintRows } = await pool.query(
      `SELECT id, status
       FROM complaints
       WHERE id = $1 AND citizen_id = $2`,
      [complaintId, citizenId]
    );

    if (!complaintRows.length) {
      return res.status(404).json({ error: 'Complaint not found or access denied' });
    }

    const complaint = complaintRows[0];
    if (!['resolved', 'closed'].includes(complaint.status)) {
      return res.status(400).json({ error: 'Feedback can only be submitted for resolved complaints' });
    }

    const { rows: existing } = await pool.query(
      'SELECT id FROM feedback WHERE complaint_id = $1 AND citizen_id = $2 LIMIT 1',
      [complaintId, citizenId]
    );

    if (existing.length) {
      await pool.query(
        `UPDATE feedback
         SET rating = $1, comment = $2, created_at = now()
         WHERE id = $3`,
        [parsedRating, comment || null, existing[0].id]
      );
      return res.json({ success: true, updated: true });
    }

    await pool.query(
      `INSERT INTO feedback (id, complaint_id, citizen_id, rating, comment, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
      [complaintId, citizenId, parsedRating, comment || null]
    );

    return res.json({ success: true, updated: false });
  } catch (err) {
    console.error('Feedback submit error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
