-- Label Studio Database Bootstrap (Postgres 17 on CrunchyBridge)
-- Purpose: Prepare an isolated, production‑ready database for Label Studio
-- Strategy: Keep LS app tables managed by Label Studio’s own migrations.
--           This script creates roles, schema, extensions, grants, and sane DB defaults.
-- Idempotent: Safe to run multiple times.

-- =========================
-- 1) Optional: Create app roles
--    - labelfish_owner: app owner (used by the LS application)
--    - labelfish_rw:    service accounts with read/write (optional)
--    - labelfish_ro:    read‑only (analytics/debug)
-- =========================
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'labelfish_owner') THEN
    CREATE ROLE labelfish_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'labelfish_rw') THEN
    CREATE ROLE labelfish_rw LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'labelfish_ro') THEN
    CREATE ROLE labelfish_ro LOGIN;
  END IF;
END $$;

-- =========================
-- 2) Extensions commonly used by Django/LS and for indexing/text search
-- =========================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), cryptography utils
CREATE EXTENSION IF NOT EXISTS citext;     -- case‑insensitive text
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram similarity indexes
CREATE EXTENSION IF NOT EXISTS btree_gist; -- composite indexes / constraints support

-- =========================
-- 3) Dedicated schema for LS app objects
--    Keep LS isolated from staging/curated schemas.
-- =========================
CREATE SCHEMA IF NOT EXISTS labelfish AUTHORIZATION labelfish_owner;

-- Avoid accidental object creation in public
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Schema usage
GRANT USAGE ON SCHEMA labelfish TO labelfish_rw, labelfish_ro;
GRANT CREATE ON SCHEMA labelfish TO labelfish_owner;

-- Default privileges for future objects created by the owner in this schema
ALTER DEFAULT PRIVILEGES FOR ROLE labelfish_owner IN SCHEMA labelfish
  GRANT USAGE, SELECT ON SEQUENCES TO labelfish_rw, labelfish_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE labelfish_owner IN SCHEMA labelfish
  GRANT SELECT ON TABLES TO labelfish_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE labelfish_owner IN SCHEMA labelfish
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO labelfish_rw;

-- Optional: if LS runs as labelfish_owner only, these grants are for future analytics users.

-- =========================
-- 4) Sensible database/session defaults (apply to current database)
-- =========================
DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = labelfish, public', current_database());
  EXECUTE format('ALTER DATABASE %I SET timezone = ''UTC''', current_database());
  EXECUTE format('ALTER DATABASE %I SET statement_timeout = ''30s''', current_database());
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = ''60s''', current_database());
  EXECUTE format('ALTER DATABASE %I SET lock_timeout = ''15s''', current_database());
END $$;

-- =========================
-- 5) (Optional) Helper indices to consider after LS migrations run
--    Uncomment and apply once LS has created its tables.
-- =========================
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_project_is_labeled
--   ON labelfish.task (project_id, is_labeled, created_at DESC);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_annotations_task
--   ON labelfish.annotation (task_id, created_at DESC);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_data_trgm
--   ON labelfish.task USING GIN ((data::text) gin_trgm_ops);

-- =========================
-- Notes:
-- - Run this on the target database (e.g., "labelfish").
-- - Let Label Studio manage its own tables via migrations.
-- - Ensure the LS connection uses this DB (and picks up search_path):
--   DATABASE_URL=postgresql://labelfish_owner:***@<host>:5432/labelfish
-- - If setting search_path via connection string, append:
--   ?options=-c%20search_path%3Dlabelfish,public

