const express        = require('express');
const router         = express.Router();
const axios          = require('axios');
const pool           = require('../db/db');
const redis          = require('redis');
const { broadcast }  = require('../notifications/notifications');
const { requireRole } = require('../auth/auth');
const { runSeed }    = require('../db/db');

const IS_DEMO    = process.env.DEMO_MODE === 'true';
const RISK_URL   = process.env.RISK_URL || 'http://risk:8020';

// ── Redis ────────────────────────────────────────────────────────────────────

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

const WARD_CACHE_TTL    = 86400;
const MARKERS_CACHE_TTL = 30;
const RISK_CACHE_TTL    = 60; // 60s — risk scores update with each DBSCAN run

// ── GET /gis/wards ────────────────────────────────────────────────────────────

router.get('/wards', async (req, res) => {
  try {
    const cached = await redisClient.get('cache:ward_boundaries').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT id, name, city_id,
              ST_AsGeoJSON(boundary)::json AS geometry
       FROM wards
       ORDER BY id`
    );

    const geojson = {
      type: 'FeatureCollection',
      features: rows.map(row => ({
        type: 'Feature',
        properties: { id: row.id, name: row.name, city_id: row.city_id },
        geometry: row.geometry,
      })),
    };

    await redisClient.setEx('cache:ward_boundaries', WARD_CACHE_TTL, JSON.stringify(geojson))
      .catch(() => null);

    return res.json(geojson);
  } catch (err) {
    console.error('GET /gis/wards error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /gis/complaints/map ───────────────────────────────────────────────────

router.get('/complaints/map', async (req, res) => {
  try {
    const cached = await redisClient.get('cache:complaint_markers').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT
         id, category, status, source, officer_verified, priority, ward_id,
         ST_Y(location::geometry) AS lat,
         ST_X(location::geometry) AS lng
       FROM complaints
       WHERE status != 'closed'
       ORDER BY created_at DESC`
    );

    const markers = rows.map(row => ({
      id:               row.id,
      category:         row.category,
      status:           row.status,
      source:           row.source,
      officer_verified: row.officer_verified,
      priority:         row.priority,
      ward_id:          row.ward_id,
      lat:              parseFloat(row.lat),
      lng:              parseFloat(row.lng),
      marker_type: (row.source === 'production' || row.officer_verified)
        ? 'solid' : 'hollow',
    }));

    const payload = { markers };
    await redisClient.setEx('cache:complaint_markers', MARKERS_CACHE_TTL, JSON.stringify(payload))
      .catch(() => null);

    return res.json(payload);
  } catch (err) {
    console.error('GET /gis/complaints/map error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /gis/risk-heatmap (Integration 3) ────────────────────────────────────
// Fetches ML-generated risk zones from risk:8020/risk/zones
// and maps them to the GeoJSON FeatureCollection format expected by the frontend.
// Falls back to Postgres ward risk_score if the risk service is unavailable.

router.get('/risk-heatmap', async (req, res) => {
  try {
    // Check cache first
    const cached = await redisClient.get('cache:risk_heatmap').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    let geojson;

    try {
      // ── Primary: ML risk service ──────────────────────────────────────
      const { data } = await axios.get(`${RISK_URL}/risk/zones`, { timeout: 5000 });
      const zones = data?.zones ?? [];

      // Build a lookup map: ward_id → risk zone data
      const zoneMap = {};
      for (const zone of zones) {
        zoneMap[zone.ward_id] = zone;
      }

      // Fetch ward geometries from Postgres to attach to each zone
      const { rows } = await pool.query(
        `SELECT id, name, city_id, ST_AsGeoJSON(boundary)::json AS geometry
         FROM wards ORDER BY id`
      );

      geojson = {
        type: 'FeatureCollection',
        features: rows.map(row => {
          const zone      = zoneMap[row.id];
          const riskScore = zone ? zone.risk_score / 100 : 0; // normalise 0–100 → 0–1
          const riskLevel = zone?.risk_level?.toLowerCase() ?? 'low';

          return {
            type: 'Feature',
            properties: {
              id:         row.id,
              name:       row.name,
              city_id:    row.city_id,
              risk_level: riskScore,
              risk_label: zone?.risk_level ?? null,
              risk_tier:
                riskScore >= 0.75 ? 'critical' :
                riskScore >= 0.6  ? 'high'     :
                riskScore >= 0.35 ? 'medium'   : 'low',
              // Extra ML fields for tooltip
              centroid_lat: zone?.centroid_lat ?? null,
              centroid_lng: zone?.centroid_lng ?? null,
              radius_m:     zone?.radius_m     ?? null,
            },
            geometry: row.geometry,
          };
        }),
      };

      console.log(`Risk heatmap: ${zones.length} ML zones mapped to ${rows.length} wards`);

    } catch (mlErr) {
      // ── Fallback: Postgres ward risk_score ────────────────────────────
      console.warn('Risk service unavailable, falling back to Postgres:', mlErr.message);

      const { rows } = await pool.query(
        `SELECT w.id, w.name, w.city_id,
                ST_AsGeoJSON(w.boundary)::json AS geometry,
                COALESCE(w.risk_score, 0) AS risk_level,
                w.risk_label
         FROM wards w ORDER BY w.id`
      );

      geojson = {
        type: 'FeatureCollection',
        features: rows.map(row => ({
          type: 'Feature',
          properties: {
            id:         row.id,
            name:       row.name,
            city_id:    row.city_id,
            risk_level: parseFloat(row.risk_level),
            risk_label: row.risk_label || null,
            risk_tier:
              row.risk_level >= 0.75 ? 'critical' :
              row.risk_level >= 0.6  ? 'high'     :
              row.risk_level >= 0.35 ? 'medium'   : 'low',
          },
          geometry: row.geometry,
        })),
      };
    }

    // Cache for 60s
    await redisClient.setEx('cache:risk_heatmap', RISK_CACHE_TTL, JSON.stringify(geojson))
      .catch(() => null);

    return res.json(geojson);
  } catch (err) {
    console.error('GET /gis/risk-heatmap error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /admin/demo/reset ──────────────────────────────────────────────────

router.delete('/admin/demo/reset',
  requireRole('commissioner'),
  async (req, res) => {
    if (!IS_DEMO) return res.status(404).json({ error: 'Not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM complaints WHERE source = 'demo_sandbox'");
      const seedCount = await runSeed(client);
      await client.query('COMMIT');

      await redisClient.del('cache:complaint_markers').catch(() => null);
      await redisClient.del('cache:risk_heatmap').catch(() => null);

      broadcast({ type: 'demo.reset' });

      return res.json({ reset: true, seed_count: seedCount });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Demo reset error', err);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;