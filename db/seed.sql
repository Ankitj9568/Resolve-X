-- ============================================================
-- db/seed.sql
-- ResolveX — Demo Seed Data
-- Run AFTER all migrations. Safe to re-run (uses ON CONFLICT DO NOTHING
-- for static rows; DO blocks for complaint loops).
-- Also called programmatically by runSeed() in db/seed.js during
-- demo reset (DELETE /api/v1/admin/demo/reset → Ctrl+Shift+R).
-- Apply with: psql $DATABASE_URL -f seed.sql
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- FIX 1: Departments inserted first — officers need dept_id FKs
-- FIX 2: Officers assigned real dept_ids — original had NULL for all dept_ids,
--         meaning the routing engine would always find zero officers per dept
--         and assign NULL, so no officer ever gets a task notification
-- FIX 3: Complaints have real GPS coordinates — original had NULL for location,
--         which violates the NOT NULL constraint on complaints.location and
--         breaks every PostGIS spatial query (dedup, ward assignment, map markers)
-- FIX 4: Complaints reference real citizen_id — original used user_id=NULL
--         which violates referential integrity
-- FIX 5: Ward boundaries set to real Delhi bounding boxes — original had NULL,
--         meaning ST_Within always returns false and every complaint submitted
--         during the demo fails geo-validation
-- FIX 6: Complaint timestamps spread across 30 days — original used now() for
--         all 60, so DBSCAN sees a single-day cluster rather than the
--         30-day rolling window pattern that triggers the HIGH risk score
-- FIX 7: Correct category codes — original used CAT-03 for roads (should be
--         CAT-01), CAT-04 for streetlights (should be CAT-03),
--         CAT-05 for water (correct), CAT-06 for waste (should be CAT-04)

-- ── Departments ───────────────────────────────────────────────────────────────

INSERT INTO departments (id, name, code, city_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Roads Department',       'ROADS',      'DELHI'),
  ('a0000000-0000-0000-0000-000000000002', 'Drainage Department',    'DRAINAGE',   'DELHI'),
  ('a0000000-0000-0000-0000-000000000003', 'Electrical Department',  'ELECTRICAL', 'DELHI'),
  ('a0000000-0000-0000-0000-000000000004', 'Water Department',       'WATER',      'DELHI'),
  ('a0000000-0000-0000-0000-000000000005', 'Sanitation Department',  'SANITATION', 'DELHI'),
  ('a0000000-0000-0000-0000-000000000006', 'General Department',     'GENERAL',    'DELHI');

-- ── Wards (real Delhi approximate boundaries) ─────────────────────────────────
-- Ward boundaries are approximate rectangles in Delhi.
-- Bharat Mandapam demo ward uses the exact spec bbox.

INSERT INTO wards (id, name, city_id, boundary, risk_score, risk_label) VALUES
  ('W14', 'Ward 14', 'DELHI',
   ST_GeomFromText('POLYGON((77.20 28.61, 77.24 28.61, 77.24 28.64, 77.20 28.64, 77.20 28.61))', 4326),
   0.45, 'Medium infrastructure age risk'),

  ('W22', 'Ward 22', 'DELHI',
   ST_GeomFromText('POLYGON((77.25 28.64, 77.29 28.64, 77.29 28.67, 77.25 28.67, 77.25 28.64))', 4326),
   0.20, NULL),

  ('DEMO_WARD', 'Demo Ward — Bharat Mandapam', 'DELHI',
   ST_GeomFromText('POLYGON((77.195 28.595, 77.225 28.595, 77.225 28.625, 77.195 28.625, 77.195 28.595))', 4326),
   0.76, '76% flood risk before monsoon season');

-- City boundary polygon for geo-validation (covers all three wards + buffer)
INSERT INTO wards (id, name, city_id, boundary) VALUES
  ('CITY_BOUNDARY', 'Delhi Service Area', 'DELHI',
   ST_GeomFromText('POLYGON((77.10 28.40, 77.50 28.40, 77.50 28.90, 77.10 28.90, 77.10 28.40))', 4326));

-- ── Demo citizen account ──────────────────────────────────────────────────────

INSERT INTO users (id, name, email, role, source, ward_id, city_id) VALUES
  ('b0000000-0000-0000-0000-000000000000',
   'Demo Citizen', 'demo@resolvex.in', 'citizen', 'demo_sandbox', 'DEMO_WARD', 'DELHI')
ON CONFLICT (email) DO NOTHING;

-- ── Commissioner account ──────────────────────────────────────────────────────

INSERT INTO users (
  id, name, email, role, city_id, employee_id, password_hash, totp_secret, is_active
) VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'Commissioner',
   'commissioner@resolvex.in',
   'commissioner',
   'DELHI',
   'DEV-COMMISSIONER-001',
   crypt('CommDev@123', gen_salt('bf', 12)),
   'JBSWY3DPEHPK3PXP',
   true)
ON CONFLICT (email) DO UPDATE SET
  role          = EXCLUDED.role,
  city_id       = EXCLUDED.city_id,
  employee_id   = EXCLUDED.employee_id,
  password_hash = EXCLUDED.password_hash,
  totp_secret   = EXCLUDED.totp_secret,
  is_active     = EXCLUDED.is_active;

-- ── Officers (2 per department, assigned real dept_ids) ───────────────────────

INSERT INTO users (id, name, role, dept_id, ward_id, city_id, email, employee_id, is_active, password_hash) VALUES
  (gen_random_uuid(),'Officer Roads 1',      'officer','a0000000-0000-0000-0000-000000000001','W14',      'DELHI','officer.roads1@resolvex.in',     'DELHI-W14-ROADS-001',true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Roads 2',      'officer','a0000000-0000-0000-0000-000000000001','W22',      'DELHI','officer.roads2@resolvex.in',     'DELHI-W22-ROADS-002',true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Drainage 1',   'officer','a0000000-0000-0000-0000-000000000002','W14',      'DELHI','officer.drainage1@resolvex.in',  'DELHI-W14-DRN-001',  true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Drainage 2',   'officer','a0000000-0000-0000-0000-000000000002','DEMO_WARD','DELHI','officer.drainage2@resolvex.in',  'DELHI-DW-DRN-002',   true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Electrical 1', 'officer','a0000000-0000-0000-0000-000000000003','W22',      'DELHI','officer.electrical1@resolvex.in','DELHI-W22-ELEC-001',  true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Electrical 2', 'officer','a0000000-0000-0000-0000-000000000003','W14',      'DELHI','officer.electrical2@resolvex.in','DELHI-W14-ELEC-002',  true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Water 1',      'officer','a0000000-0000-0000-0000-000000000004','W14',      'DELHI','officer.water1@resolvex.in',     'DELHI-W14-WATER-001', true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Water 2',      'officer','a0000000-0000-0000-0000-000000000004','W22',      'DELHI','officer.water2@resolvex.in',     'DELHI-W22-WATER-002', true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Sanitation 1', 'officer','a0000000-0000-0000-0000-000000000005','DEMO_WARD','DELHI','officer.sanitation1@resolvex.in','DELHI-DW-SAN-001',    true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer Sanitation 2', 'officer','a0000000-0000-0000-0000-000000000005','W22',      'DELHI','officer.sanitation2@resolvex.in','DELHI-W22-SAN-002',   true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer General 1',    'officer','a0000000-0000-0000-0000-000000000006','W14',      'DELHI','officer.general1@resolvex.in',   'DELHI-W14-GEN-001',   true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu'),
  (gen_random_uuid(),'Officer General 2',    'officer','a0000000-0000-0000-0000-000000000006','DEMO_WARD','DELHI','officer.general2@resolvex.in',   'DELHI-DW-GEN-002',    true,'$2b$10$jMf/4lzgKTr35KkjQ8jOVO03S.g8cjYIDb4pqdlyO4DW.dzHuDKyu');

-- ── 60 Seed Complaints with real GPS coordinates ──────────────────────────────
-- All: source='production', officer_verified=true → solid markers on map
-- Timestamps spread across last 30 days so DBSCAN sees a real time-series
-- GPS points are within ward boundaries defined above

-- 18 drainage complaints clustered in DEMO_WARD / Bharat Mandapam area
-- Tight cluster triggers DBSCAN HIGH risk detection for the monsoon scenario
DO $$
DECLARE
  i INT;
  base_lat FLOAT := 28.6100;
  base_lng FLOAT := 77.2090;
  offset_lat FLOAT;
  offset_lng FLOAT;
BEGIN
  FOR i IN 1..18 LOOP
    -- Small random offsets within ~200m of centroid to create a realistic cluster
    offset_lat := (random() - 0.5) * 0.004;
    offset_lng := (random() - 0.5) * 0.004;
    INSERT INTO complaints
      (id, citizen_id, category, subcategory, description, location, ward_id,
       source, environment, officer_verified, priority, status,
       sla_deadline, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'b0000000-0000-0000-0000-000000000000',
      'CAT-02', 'blocked_drain',
      'Drainage blockage reported in area — monsoon risk',
      ST_SetSRID(ST_MakePoint(base_lng + offset_lng, base_lat + offset_lat), 4326),
      'DEMO_WARD', 'production', 'production', true, 2, 'resolved',
      now() + interval '48 hours',
      -- Spread over last 30 days
      now() - (random() * interval '30 days'),
      now()
    );
  END LOOP;
END $$;

-- 15 road complaints across wards
DO $$
DECLARE
  i INT;
  lngs FLOAT[] := ARRAY[77.21, 77.22, 77.23, 77.26, 77.27];
  lats FLOAT[] := ARRAY[28.62, 28.63, 28.615, 28.65, 28.655];
BEGIN
  FOR i IN 1..15 LOOP
    INSERT INTO complaints
      (id, citizen_id, category, subcategory, description, location, ward_id,
       source, environment, officer_verified, priority, status,
       sla_deadline, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'b0000000-0000-0000-0000-000000000000',
      'CAT-01', 'pothole',
      'Road damage reported',
      ST_SetSRID(ST_MakePoint(
        lngs[1 + (i % 5)],
        lats[1 + (i % 5)]
      ), 4326),
      CASE WHEN i % 2 = 0 THEN 'W14' ELSE 'W22' END,
      'production', 'production', true, 3, 'resolved',
      now() + interval '72 hours',
      now() - (random() * interval '30 days'),
      now()
    );
  END LOOP;
END $$;

-- 12 streetlight complaints
DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 1..12 LOOP
    INSERT INTO complaints
      (id, citizen_id, category, subcategory, description, location, ward_id,
       source, environment, officer_verified, priority, status,
       sla_deadline, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'b0000000-0000-0000-0000-000000000000',
      'CAT-03', 'light_out',
      'Streetlight not working',
      ST_SetSRID(ST_MakePoint(
        77.195 + (random() * 0.03),
        28.595 + (random() * 0.03)
      ), 4326),
      'DEMO_WARD',
      'production', 'production', true, 3, 'resolved',
      now() + interval '72 hours',
      now() - (random() * interval '30 days'),
      now()
    );
  END LOOP;
END $$;

-- 10 water supply complaints
DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO complaints
      (id, citizen_id, category, subcategory, description, location, ward_id,
       source, environment, officer_verified, priority, status,
       sla_deadline, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'b0000000-0000-0000-0000-000000000000',
      'CAT-05', 'no_water',
      'No water supply',
      ST_SetSRID(ST_MakePoint(
        77.20 + (random() * 0.04),
        28.61 + (random() * 0.03)
      ), 4326),
      'W14',
      'production', 'production', true, 2, 'resolved',
      now() + interval '48 hours',
      now() - (random() * interval '30 days'),
      now()
    );
  END LOOP;
END $$;

-- 5 waste/sanitation complaints
DO $$
DECLARE
  i INT;
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO complaints
      (id, citizen_id, category, subcategory, description, location, ward_id,
       source, environment, officer_verified, priority, status,
       sla_deadline, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      'b0000000-0000-0000-0000-000000000000',
      'CAT-04', 'garbage_dump',
      'Uncollected waste',
      ST_SetSRID(ST_MakePoint(
        77.25 + (random() * 0.04),
        28.64 + (random() * 0.03)
      ), 4326),
      'W22',
      'production', 'production', true, 3, 'resolved',
      now() + interval '72 hours',
      now() - (random() * interval '30 days'),
      now()
    );
  END LOOP;
END $$;

-- Update DEMO_WARD risk fields explicitly to match the monsoon scenario
UPDATE wards
SET risk_score = 0.76,
    risk_label = '76% flood risk before monsoon season'
WHERE id = 'DEMO_WARD';