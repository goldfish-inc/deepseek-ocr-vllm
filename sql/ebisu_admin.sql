-- EBISU admin objects: collision review queue (tables, view, helper functions)
\set ON_ERROR_STOP on

BEGIN;

CREATE SCHEMA IF NOT EXISTS ebisu;

-- Enum types for review status and resolution
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'review_status_enum' AND n.nspname = 'ebisu'
  ) THEN
    CREATE TYPE ebisu.review_status_enum AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'review_resolution_enum' AND n.nspname = 'ebisu'
  ) THEN
    CREATE TYPE ebisu.review_resolution_enum AS ENUM ('CHOOSE_EXISTING', 'REASSIGN_ID', 'MERGE_ENTITIES', 'DATA_ERROR');
  END IF;
END $$;

-- Generic updated_at trigger helper (idempotent)
CREATE OR REPLACE FUNCTION ebisu.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

-- Review table: one row per conflicting identifier (id_type,id_value)
CREATE TABLE IF NOT EXISTS ebisu.collision_reviews (
  review_id       bigserial PRIMARY KEY,
  id_type         text NOT NULL,  -- 'imo' | 'mmsi' (matches ebisu.load_collisions.id_type)
  id_value        text NOT NULL,
  status          ebisu.review_status_enum NOT NULL DEFAULT 'NEW',
  resolution      ebisu.review_resolution_enum,
  reviewer        text,
  resolution_notes text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collision_reviews_id_unique UNIQUE (id_type, id_value)
);

DROP TRIGGER IF EXISTS trg_collision_reviews_updated_at ON ebisu.collision_reviews;
CREATE TRIGGER trg_collision_reviews_updated_at
BEFORE INSERT OR UPDATE ON ebisu.collision_reviews
FOR EACH ROW EXECUTE FUNCTION ebisu.set_updated_at();

-- Helpful index for grouping collisions in the admin queue
CREATE INDEX IF NOT EXISTS ebisu_load_collisions_id_idx
  ON ebisu.load_collisions (id_type, id_value);

-- Admin queue view: groups collisions by (id_type,id_value) and decorates with latest review info
CREATE OR REPLACE VIEW public.ui_collision_review_queue AS
WITH grouped AS (
  SELECT
    lc.id_type,
    lc.id_value,
    COUNT(*) AS collisions_count,
    MIN(lc.detected_at) AS first_detected,
    MAX(lc.detected_at) AS last_detected
  FROM ebisu.load_collisions lc
  GROUP BY lc.id_type, lc.id_value
)
SELECT
  -- Synthetic key for UI/GraphQL
  (g.id_type || ':' || g.id_value) AS queue_id,
  g.id_type,
  g.id_value,
  g.collisions_count,
  g.first_detected,
  g.last_detected,
  -- All involved vessels across the collision set for this identifier
  ARRAY(
    SELECT DISTINCT u FROM (
      SELECT lc2.vessel_uuid AS u
      FROM ebisu.load_collisions lc2
      WHERE lc2.id_type = g.id_type AND lc2.id_value = g.id_value
      UNION
      SELECT lc3.other_vessel_uuid AS u
      FROM ebisu.load_collisions lc3
      WHERE lc3.id_type = g.id_type AND lc3.id_value = g.id_value
    ) s
  ) AS vessel_uuids,
  COALESCE(r.status, 'NEW'::ebisu.review_status_enum) AS status,
  r.resolution,
  r.reviewer,
  r.resolution_notes,
  r.updated_at AS last_reviewed_at
FROM grouped g
LEFT JOIN ebisu.collision_reviews r
  ON r.id_type = g.id_type AND r.id_value = g.id_value;

COMMENT ON VIEW public.ui_collision_review_queue IS E'@primaryKey queue_id\nCollision review queue grouped by (id_type,id_value) with review status';

-- Helper to resolve a collision group and return updated queue row
CREATE OR REPLACE FUNCTION public.resolve_collision(
  p_id_type text,
  p_id_value text,
  p_resolution ebisu.review_resolution_enum,
  p_reviewer text,
  p_notes text DEFAULT NULL
) RETURNS public.ui_collision_review_queue
LANGUAGE sql VOLATILE AS $$
  INSERT INTO ebisu.collision_reviews (id_type, id_value, status, resolution, reviewer, resolution_notes)
  VALUES (p_id_type, p_id_value, 'RESOLVED', p_resolution, p_reviewer, p_notes)
  ON CONFLICT (id_type, id_value) DO UPDATE
    SET status = 'RESOLVED', resolution = excluded.resolution, reviewer = excluded.reviewer, resolution_notes = excluded.resolution_notes, updated_at = now();

  SELECT * FROM public.ui_collision_review_queue
  WHERE id_type = p_id_type AND id_value = p_id_value;
$$;

COMMENT ON FUNCTION public.resolve_collision(text, text, ebisu.review_resolution_enum, text, text) IS E'@simpleCollections only';

-- Acknowledge a collision group (kept unresolved but tracked)
CREATE OR REPLACE FUNCTION public.ack_collision(
  p_id_type text,
  p_id_value text,
  p_reviewer text,
  p_notes text DEFAULT NULL
) RETURNS public.ui_collision_review_queue
LANGUAGE sql VOLATILE AS $$
  INSERT INTO ebisu.collision_reviews (id_type, id_value, status, reviewer, resolution_notes)
  VALUES (p_id_type, p_id_value, 'ACKNOWLEDGED', p_reviewer, p_notes)
  ON CONFLICT (id_type, id_value) DO UPDATE
    SET status = 'ACKNOWLEDGED', reviewer = excluded.reviewer, resolution_notes = excluded.resolution_notes, updated_at = now();

  SELECT * FROM public.ui_collision_review_queue
  WHERE id_type = p_id_type AND id_value = p_id_value;
$$;

COMMENT ON FUNCTION public.ack_collision(text, text, text, text) IS E'@simpleCollections only';

-- Dismiss a collision group (resolved without data change; default DATA_ERROR)
CREATE OR REPLACE FUNCTION public.dismiss_collision(
  p_id_type text,
  p_id_value text,
  p_reviewer text,
  p_notes text DEFAULT NULL,
  p_resolution ebisu.review_resolution_enum DEFAULT 'DATA_ERROR'
) RETURNS public.ui_collision_review_queue
LANGUAGE sql VOLATILE AS $$
  INSERT INTO ebisu.collision_reviews (id_type, id_value, status, resolution, reviewer, resolution_notes)
  VALUES (p_id_type, p_id_value, 'DISMISSED', p_resolution, p_reviewer, p_notes)
  ON CONFLICT (id_type, id_value) DO UPDATE
    SET status = 'DISMISSED', resolution = p_resolution, reviewer = excluded.reviewer, resolution_notes = excluded.resolution_notes, updated_at = now();

  SELECT * FROM public.ui_collision_review_queue
  WHERE id_type = p_id_type AND id_value = p_id_value;
$$;

COMMENT ON FUNCTION public.dismiss_collision(text, text, text, text, ebisu.review_resolution_enum) IS E'@simpleCollections only';

-- Reopen a collision group (back to NEW; clears resolution)
CREATE OR REPLACE FUNCTION public.reopen_collision(
  p_id_type text,
  p_id_value text,
  p_reviewer text,
  p_notes text DEFAULT NULL
) RETURNS public.ui_collision_review_queue
LANGUAGE sql VOLATILE AS $$
  INSERT INTO ebisu.collision_reviews (id_type, id_value, status, resolution, reviewer, resolution_notes)
  VALUES (p_id_type, p_id_value, 'NEW', NULL, p_reviewer, p_notes)
  ON CONFLICT (id_type, id_value) DO UPDATE
    SET status = 'NEW', resolution = NULL, reviewer = excluded.reviewer, resolution_notes = excluded.resolution_notes, updated_at = now();

  SELECT * FROM public.ui_collision_review_queue
  WHERE id_type = p_id_type AND id_value = p_id_value;
$$;

COMMENT ON FUNCTION public.reopen_collision(text, text, text, text) IS E'@simpleCollections only';

-- Convenience selectors
CREATE OR REPLACE FUNCTION public.top_unresolved_collisions(limit_n int DEFAULT 5)
RETURNS SETOF public.ui_collision_review_queue
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.ui_collision_review_queue
  WHERE status IN ('NEW'::ebisu.review_status_enum, 'ACKNOWLEDGED'::ebisu.review_status_enum)
  ORDER BY collisions_count DESC, last_detected DESC
  LIMIT limit_n
$$;

COMMENT ON FUNCTION public.top_unresolved_collisions(int) IS E'@simpleCollections only';

CREATE OR REPLACE FUNCTION public.collisions_for_vessel(p_vessel_uuid uuid)
RETURNS SETOF public.ui_collision_review_queue
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.ui_collision_review_queue
  WHERE p_vessel_uuid = ANY(vessel_uuids)
  ORDER BY last_detected DESC
$$;

COMMENT ON FUNCTION public.collisions_for_vessel(uuid) IS E'@simpleCollections only';

CREATE OR REPLACE FUNCTION public.collisions_since(p_since timestamptz, unresolved_only boolean DEFAULT true)
RETURNS SETOF public.ui_collision_review_queue
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.ui_collision_review_queue
  WHERE last_detected >= p_since
    AND (unresolved_only IS FALSE OR status IN ('NEW'::ebisu.review_status_enum, 'ACKNOWLEDGED'::ebisu.review_status_enum))
  ORDER BY last_detected DESC
$$;

COMMENT ON FUNCTION public.collisions_since(timestamptz, boolean) IS E'@simpleCollections only';

-- Helpful lookup indexes for per-vessel queries
CREATE INDEX IF NOT EXISTS ebisu_load_collisions_vessel_idx ON ebisu.load_collisions (vessel_uuid);
CREATE INDEX IF NOT EXISTS ebisu_load_collisions_other_vessel_idx ON ebisu.load_collisions (other_vessel_uuid);

COMMIT;
