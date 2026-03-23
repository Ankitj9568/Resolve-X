
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";



CREATE TABLE users (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100),
  phone            VARCHAR(20)  UNIQUE,
  email            VARCHAR(255) UNIQUE,
  role             VARCHAR(20)  NOT NULL
                   CHECK (role IN ('citizen','officer','dept_head','commissioner')),
  dept_id          UUID,                        -- FK added in 003
  ward_id          VARCHAR(20),
  city_id          VARCHAR(20)  DEFAULT 'DEMO',
  employee_id      VARCHAR(50)  UNIQUE,         -- staff only
  password_hash    VARCHAR(255),                -- staff only
  totp_secret      VARCHAR(255),                -- staff only
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  source           VARCHAR(20)  NOT NULL DEFAULT 'production',
  reputation_score INT          NOT NULL DEFAULT 50,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ============================================================
-- 003_create_departments.sql
-- ============================================================
-- FIX: Missing code column — routing engine looks up dept by code
--      (e.g. 'DRN', 'ROADS') not by name. Without code the routing engine
--      always falls back to GENERAL for every complaint.
-- Also adds FK from users.dept_id now that departments exists.

CREATE TABLE departments (
  id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name    VARCHAR(100) NOT NULL,
  code    VARCHAR(20)  NOT NULL UNIQUE,   -- e.g. 'DRN','ROADS','ELEC','WATER','SANITATION','GENERAL'
  city_id VARCHAR(20)  NOT NULL
);

ALTER TABLE users
  ADD CONSTRAINT fk_users_dept
  FOREIGN KEY (dept_id) REFERENCES departments(id);


-- ============================================================
-- 004_create_wards.sql
-- ============================================================
-- FIX: Added risk_score + risk_label columns — gis.js /risk-heatmap
--      queries these. Without them the heatmap query throws
--      "column risk_score does not exist".

CREATE TABLE wards (
  id         VARCHAR(20)  PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  city_id    VARCHAR(20)  NOT NULL,
  boundary   GEOMETRY(POLYGON, 4326),
  risk_score DECIMAL(3,2) DEFAULT 0.00,  -- 0.0–1.0
  risk_label TEXT
);

CREATE INDEX idx_wards_boundary ON wards USING GIST(boundary);




CREATE TABLE complaints (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id       UUID         REFERENCES users(id),
  category         VARCHAR(20)  NOT NULL,
  subcategory      VARCHAR(100),
  description      TEXT,
  location         GEOMETRY(POINT, 4326) NOT NULL,
  ward_id          VARCHAR(20)  REFERENCES wards(id),
  dept_id          UUID         REFERENCES departments(id),
  assigned_to      UUID         REFERENCES users(id),
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','assigned','in_progress','escalated','resolved','closed')),
  priority         INT          NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  source           VARCHAR(20)  NOT NULL DEFAULT 'production',
  environment      VARCHAR(20)  NOT NULL DEFAULT 'production',
  officer_verified BOOLEAN      NOT NULL DEFAULT false,
  sla_deadline     TIMESTAMPTZ,
  trust_weight     DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  risk_score       FLOAT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_complaints_location    ON complaints USING GIST(location);
CREATE INDEX idx_complaints_source      ON complaints(source);
CREATE INDEX idx_complaints_status      ON complaints(status);
CREATE INDEX idx_complaints_created_at  ON complaints(created_at DESC);
CREATE INDEX idx_complaints_citizen_id  ON complaints(citizen_id);
CREATE INDEX idx_complaints_dept_id     ON complaints(dept_id);


-- ============================================================
-- 006_create_complaint_media.sql
-- ============================================================
-- FIX 1: mime_type column renamed to media_type — schema spec and media.js
--         both use media_type VARCHAR CHECK('image','video').
--         mime_type stores the full MIME string which fails the CHECK.
-- FIX 2: Added FK with CASCADE — orphaned media rows should be deleted
--         when a complaint is deleted (e.g. demo reset)
-- FIX 3: Added CHECK constraint on media_type

CREATE TABLE complaint_media (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID         NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  file_url     TEXT         NOT NULL,
  media_type   VARCHAR(20)  NOT NULL CHECK (media_type IN ('image','video')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);


-- ============================================================
-- 007_create_tasks.sql
-- ============================================================
-- FIX 1: officer_id renamed to assigned_to — routing.js, complaints.js,
--         and the spec all use assigned_to. officer_id causes column-not-found
--         on every task insert and officer queue query.
-- FIX 2: Missing is_primary column — multi-issue detection creates secondary
--         tasks; routing engine and dashboard need to distinguish them
-- FIX 3: Missing detected_category + confidence columns — secondary tasks
--         store the AI-detected category and confidence score
-- FIX 4: Missing escalation_notified column — SLA cron writes this to avoid
--         re-sending 80% warnings on every tick (migration 011 added it
--         separately before; include here so order is clean)
-- FIX 5: FK constraints with CASCADE
-- FIX 6: status CHECK constraint
-- FIX 7: Index on sla_deadline for cron query performance

CREATE TABLE tasks (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id         UUID         NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  dept_id              UUID         REFERENCES departments(id),
  assigned_to          UUID         REFERENCES users(id),
  is_primary           BOOLEAN      NOT NULL DEFAULT true,
  detected_category    VARCHAR(20),
  confidence           FLOAT,
  status               VARCHAR(20)  NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','in_progress','rejected','resolved','closed','escalated')),
  sla_deadline         TIMESTAMPTZ,
  escalation_notified  BOOLEAN      NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_complaint_id   ON tasks(complaint_id);
CREATE INDEX idx_tasks_assigned_to    ON tasks(assigned_to);
CREATE INDEX idx_tasks_sla_deadline   ON tasks(sla_deadline) WHERE status NOT IN ('resolved','closed','escalated');


-- ============================================================
-- 008_create_complaint_history.sql
-- ============================================================
-- FIX 1: Columns renamed to match what complaints.js actually inserts:
--         changed_by → actor_id, added action, old_status, new_status
--         Without these columns every audit INSERT in complaints.js fails.
-- FIX 2: FK with CASCADE

CREATE TABLE complaint_history (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID         NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  actor_id     UUID         REFERENCES users(id),
  action       VARCHAR(50)  NOT NULL,
  old_status   VARCHAR(20),
  new_status   VARCHAR(20),
  note         TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_history_complaint_id ON complaint_history(complaint_id);


-- ============================================================
-- 009_create_feedback.sql
-- ============================================================
-- FIX 1: Missing citizen_id FK — feedback must be linked to the citizen
--         who submitted it
-- FIX 2: Missing rating CHECK — spec says 1–5 stars
-- FIX 3: FK with CASCADE

CREATE TABLE feedback (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID  NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  citizen_id   UUID  REFERENCES users(id),
  rating       INT   CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 010_add_sandbox_fields.sql
-- ============================================================
-- All sandbox fields (source, environment, trust_weight) are now in 005.
-- This migration adds the escalation_notified index that the SLA cron needs,
-- and any remaining fields not covered above.

-- Partial index for SLA cron — only indexes rows the cron actually scans
CREATE INDEX IF NOT EXISTS idx_tasks_sla_escalation
  ON tasks (status, sla_deadline, escalation_notified)
  WHERE status NOT IN ('resolved','closed','escalated');