-- =============================================================================
-- LABELFISH DATABASE SCHEMA
-- =============================================================================
-- Database for Label Studio operational storage
-- CrunchyBridge PostgreSQL 17.5 on Ebisu cluster
--
-- This schema is idempotent and can be re-run safely.
-- Database must be created manually before running this:
--   cb psql <cluster-id> --role postgres -- -c "CREATE DATABASE labelfish;"
-- =============================================================================

-- Create owner role if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'labelfish_owner') THEN
    CREATE ROLE labelfish_owner WITH LOGIN;
  END IF;
END
$$;

-- Grant database ownership
GRANT ALL PRIVILEGES ON DATABASE labelfish TO labelfish_owner;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO labelfish_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO labelfish_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO labelfish_owner;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For text search
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- For composite indexes

-- Grant schema ownership
GRANT ALL ON SCHEMA public TO labelfish_owner;

-- Note: Label Studio will create its own tables via Django migrations
-- This schema only sets up the role, permissions, and extensions
