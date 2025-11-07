-- EBISU Quality Assertions (core + history pattern)
-- Validates ebisu.vessels and ebisu.vessel_reported_history data quality
-- Exit non-zero if any assertion fails

\set ON_ERROR_STOP on

BEGIN;

-- 1) Required tables exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ebisu' AND table_name='vessels') THEN
    RAISE EXCEPTION 'Missing table ebisu.vessels';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ebisu' AND table_name='vessel_reported_history') THEN
    RAISE EXCEPTION 'Missing table ebisu.vessel_reported_history';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ebisu' AND table_name='original_sources_vessels') THEN
    RAISE EXCEPTION 'Missing table ebisu.original_sources_vessels';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='stage' AND table_name='load_batches') THEN
    RAISE EXCEPTION 'Missing table stage.load_batches';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ebisu' AND table_name='load_collisions') THEN
    RAISE EXCEPTION 'Missing table ebisu.load_collisions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='ebisu' AND table_name='collision_reviews') THEN
    RAISE EXCEPTION 'Missing table ebisu.collision_reviews';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='ui_collision_review_queue') THEN
    RAISE EXCEPTION 'Missing view public.ui_collision_review_queue';
  END IF;
END$$;

-- 2) ebisu.vessels has at least one record
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ebisu.vessels;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'ebisu.vessels is empty';
  END IF;
  RAISE NOTICE 'ebisu.vessels: % records', v_count;
END$$;

-- 3) Vessel names not mostly empty (threshold: <= 60% empty)
DO $$
DECLARE
  v_total int;
  v_empty int;
  v_pct numeric;
BEGIN
  SELECT COUNT(*), SUM((COALESCE(vessel_name, '') = '')::int)
  INTO v_total, v_empty
  FROM ebisu.vessels;

  v_pct := (v_empty::numeric / NULLIF(v_total, 0)) * 100;

  IF v_pct > 60 THEN
    RAISE EXCEPTION 'Too many empty vessel names: %.1f%% (threshold: 60%%)', v_pct;
  END IF;

  RAISE NOTICE 'Vessel name quality: %.1f%% empty (threshold: 60%%)', v_pct;
END$$;

-- 4) IMO uniqueness maintained (unique index enforces this, but verify no duplicates)
DO $$
DECLARE
  v_dup_count int;
BEGIN
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT imo
    FROM ebisu.vessels
    WHERE imo IS NOT NULL AND imo <> ''
    GROUP BY imo
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Duplicate IMO numbers found: % IMOs with duplicates', v_dup_count;
  END IF;

  RAISE NOTICE 'IMO uniqueness: OK (no duplicates)';
END$$;

-- 5) Basic IMO format validation (7 digits, starts with valid range)
DO $$
DECLARE
  v_invalid int;
BEGIN
  SELECT COUNT(*) INTO v_invalid
  FROM ebisu.vessels
  WHERE imo IS NOT NULL
    AND imo <> ''
    AND NOT (imo ~ '^\d{7}$');

  IF v_invalid > 0 THEN
    RAISE WARNING 'Invalid IMO format detected: % records (expected 7 digits)', v_invalid;
  ELSE
    RAISE NOTICE 'IMO format validation: OK';
  END IF;
END$$;

-- 6) Basic MMSI format validation (9 digits)
DO $$
DECLARE
  v_invalid int;
BEGIN
  SELECT COUNT(*) INTO v_invalid
  FROM ebisu.vessels
  WHERE mmsi IS NOT NULL
    AND mmsi <> ''
    AND NOT (mmsi ~ '^\d{9}$');

  IF v_invalid > 0 THEN
    RAISE WARNING 'Invalid MMSI format detected: % records (expected 9 digits)', v_invalid;
  ELSE
    RAISE NOTICE 'MMSI format validation: OK';
  END IF;
END$$;

-- 7) History table FK integrity (all vessel_uuid in history must exist in vessels)
DO $$
DECLARE
  v_orphaned int;
BEGIN
  SELECT COUNT(*) INTO v_orphaned
  FROM ebisu.vessel_reported_history h
  LEFT JOIN ebisu.vessels v ON h.vessel_uuid = v.vessel_uuid
  WHERE v.vessel_uuid IS NULL;

  IF v_orphaned > 0 THEN
    RAISE EXCEPTION 'Orphaned history records found: % records without matching vessels', v_orphaned;
  END IF;

  RAISE NOTICE 'History FK integrity: OK';
END$$;

-- 8) Source FK integrity (all source_id in history must exist in original_sources_vessels)
DO $$
DECLARE
  v_orphaned int;
BEGIN
  SELECT COUNT(*) INTO v_orphaned
  FROM ebisu.vessel_reported_history h
  LEFT JOIN ebisu.original_sources_vessels s ON h.source_id = s.source_id
  WHERE s.source_id IS NULL;

  IF v_orphaned > 0 THEN
    RAISE EXCEPTION 'Orphaned history records found: % records without matching sources', v_orphaned;
  END IF;

  RAISE NOTICE 'Source FK integrity (history): OK';
END$$;

-- 9) Provenance tracking: vessel_sources FK integrity
DO $$
DECLARE
  v_orphaned_vessels int;
  v_orphaned_sources int;
BEGIN
  -- Check vessel FK
  SELECT COUNT(*) INTO v_orphaned_vessels
  FROM ebisu.vessel_sources vs
  LEFT JOIN ebisu.vessels v ON vs.vessel_uuid = v.vessel_uuid
  WHERE v.vessel_uuid IS NULL;

  IF v_orphaned_vessels > 0 THEN
    RAISE EXCEPTION 'Orphaned vessel_sources records: % records without matching vessels', v_orphaned_vessels;
  END IF;

  -- Check source FK
  SELECT COUNT(*) INTO v_orphaned_sources
  FROM ebisu.vessel_sources vs
  LEFT JOIN ebisu.original_sources_vessels s ON vs.source_id = s.source_id
  WHERE s.source_id IS NULL;

  IF v_orphaned_sources > 0 THEN
    RAISE EXCEPTION 'Orphaned vessel_sources records: % records without matching sources', v_orphaned_sources;
  END IF;

  RAISE NOTICE 'Provenance FK integrity (vessel_sources): OK';
END$$;

-- 10) Provenance tracking: vessel_source_identifiers FK integrity
DO $$
DECLARE
  v_orphaned_vessels int;
  v_orphaned_sources int;
  v_total int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM ebisu.vessel_source_identifiers;

  -- Check vessel FK
  SELECT COUNT(*) INTO v_orphaned_vessels
  FROM ebisu.vessel_source_identifiers vsi
  LEFT JOIN ebisu.vessels v ON vsi.vessel_uuid = v.vessel_uuid
  WHERE v.vessel_uuid IS NULL;

  IF v_orphaned_vessels > 0 THEN
    RAISE EXCEPTION 'Orphaned vessel_source_identifiers records: % records without matching vessels', v_orphaned_vessels;
  END IF;

  -- Check source FK
  SELECT COUNT(*) INTO v_orphaned_sources
  FROM ebisu.vessel_source_identifiers vsi
  LEFT JOIN ebisu.original_sources_vessels s ON vsi.source_id = s.source_id
  WHERE s.source_id IS NULL;

  IF v_orphaned_sources > 0 THEN
    RAISE EXCEPTION 'Orphaned vessel_source_identifiers records: % records without matching sources', v_orphaned_sources;
  END IF;

  RAISE NOTICE 'Provenance FK integrity (vessel_source_identifiers): OK (% records)', v_total;
END$$;

-- Summary
DO $$
DECLARE
  v_vessel_count int;
  v_history_count int;
  v_source_count int;
  v_batch_count int;
  v_vessel_sources_count int;
  v_identifiers_count int;
BEGIN
  SELECT COUNT(*) INTO v_vessel_count FROM ebisu.vessels;
  SELECT COUNT(*) INTO v_history_count FROM ebisu.vessel_reported_history;
  SELECT COUNT(*) INTO v_source_count FROM ebisu.original_sources_vessels;
  SELECT COUNT(*) INTO v_batch_count FROM stage.load_batches;
  SELECT COUNT(*) INTO v_vessel_sources_count FROM ebisu.vessel_sources;
  SELECT COUNT(*) INTO v_identifiers_count FROM ebisu.vessel_source_identifiers;

  RAISE NOTICE '=== EBISU Quality Summary ===';
  RAISE NOTICE 'Vessels: %', v_vessel_count;
  RAISE NOTICE 'History records: %', v_history_count;
  RAISE NOTICE 'Sources: %', v_source_count;
  RAISE NOTICE 'Batches processed: %', v_batch_count;
  RAISE NOTICE 'Vessel-source relationships: %', v_vessel_sources_count;
  RAISE NOTICE 'Source identifiers: %', v_identifiers_count;
  RAISE NOTICE '=============================';
END$$;

COMMIT;
