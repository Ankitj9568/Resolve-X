

const express        = require('express');
const router         = express.Router();
const pool           = require('../db/db');
const redis          = require('redis');
const { broadcast }  = require('../notifications/notifications');
const { requireRole } = require('../auth/auth');
const { runSeed }    = require('../db/db');

const IS_DEMO = process.env.DEMO_MODE === 'true';

// ── Redis ────────────────────────────────────────────────────────────────────

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

const WARD_CACHE_TTL    = 86400; // 24 hours — ward boundaries rarely change
const MARKERS_CACHE_TTL = 30;    // 30 seconds — complaint map updates frequently

// ── GET /gis/wards ────────────────────────────────────────────────────────────
// Returns all ward boundaries as a valid GeoJSON FeatureCollection.
// Leaflet's L.geoJSON() requires geometry to be a parsed GeoJSON object —
// PostGIS binary (the default) will break it silently.

router.get('/wards', async (req, res) => {
  try {
    // Check Redis cache first
    const cached = await redisClient.get('cache:ward_boundaries').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    // ST_AsGeoJSON converts PostGIS geometry → GeoJSON string per feature
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

    // Cache for 24h
    await redisClient.setEx('cache:ward_boundaries', WARD_CACHE_TTL, JSON.stringify(geojson))
      .catch(() => null); // cache failure must not break the response

    return res.json(geojson);
  } catch (err) {
    console.error('GET /gis/wards error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /gis/complaints/map ───────────────────────────────────────────────────
// Returns all complaint markers with lat/lng and computed marker_type.
// Leaflet needs plain numbers for lat/lng, not a PostGIS geometry object.
// marker_type drives solid vs hollow rendering on the frontend.

router.get('/complaints/map', async (req, res) => {
  try {
    // Check Redis cache
    const cached = await redisClient.get('cache:complaint_markers').catch(() => null);
    if (cached) return res.json(JSON.parse(cached));

    const { rows } = await pool.query(
      `SELECT
         id,
         category,
         status,
         source,
         officer_verified,
         priority,
         ward_id,
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
      // Computed field — drives Leaflet marker rendering
      // solid:  confirmed trusted data
      // hollow: visitor-filed, pending verification
      marker_type: (row.source === 'production' || row.officer_verified)
        ? 'solid'
        : 'hollow',
    }));

    const payload = { markers };

    // Cache for 30s
    await redisClient.setEx('cache:complaint_markers', MARKERS_CACHE_TTL, JSON.stringify(payload))
      .catch(() => null);

    return res.json(payload);
  } catch (err) {
    console.error('GET /gis/complaints/map error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /gis/risk-heatmap ─────────────────────────────────────────────────────
// Returns ward-level risk scores as GeoJSON for the heatmap overlay.
// risk_level is 0.0–1.0; threshold >= 0.6 = HIGH risk (monsoon scenario).
// FIXED: removed Math.random() fallback — non-deterministic output breaks
// reproducible demos. Defaults to 0 (unknown/no risk) when no score exists.

router.get('/risk-heatmap', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         w.id,
         w.name,
         w.city_id,
         ST_AsGeoJSON(w.boundary)::json AS geometry,
         COALESCE(w.risk_score, 0)      AS risk_level,
         w.risk_label
       FROM wards w
       ORDER BY w.id`
    );

    const geojson = {
      type: 'FeatureCollection',
      features: rows.map(row => ({
        type: 'Feature',
        properties: {
          id:         row.id,
          name:       row.name,
          city_id:    row.city_id,
          risk_level: parseFloat(row.risk_level),
          risk_label: row.risk_label || null,
          // Categorical risk tier for map colouring
          risk_tier:
            row.risk_level >= 0.75 ? 'critical' :
            row.risk_level >= 0.6  ? 'high'     :
            row.risk_level >= 0.35 ? 'medium'   : 'low',
        },
        geometry: row.geometry,
      })),
    };

    return res.json(geojson);
  } catch (err) {
    console.error('GET /gis/risk-heatmap error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /admin/demo/reset ──────────────────────────────────────────────────
// Wipes all sandbox complaints, restores the 60-complaint seed,
// and broadcasts demo.reset to all connected WebSocket clients.
//
// FIXED:
//   - Added auth guard (commissioner role required)
//   - Added ENV=demo guard (returns 404 in production)
//   - Added seed restore step
//   - Added seed_count to response
//   - Clears the complaint markers Redis cache after reset

router.delete('/admin/demo/reset',
  requireRole('commissioner'),
  async (req, res) => {
    if (!IS_DEMO) return res.status(404).json({ error: 'Not found' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step 1: Delete all sandbox complaints (CASCADE removes tasks)
      await client.query(
        "DELETE FROM complaints WHERE source = 'demo_sandbox'"
      );

      // Step 2: Restore base seed data
      const seedCount = await runSeed(client);

      await client.query('COMMIT');

      // Step 3: Invalidate markers cache so next map load gets fresh data
      await redisClient.del('cache:complaint_markers').catch(() => null);

      // Step 4: Broadcast to all connected clients — map.refresh() fires on FE
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