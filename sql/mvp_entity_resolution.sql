-- MVP Entity Resolution: public.vessels → curated.vessels
-- Merges duplicate vessel records by IMO/MMSI into canonical entities
-- For MVP parquet data only (not production CSV ingestion pipeline)

\set ON_ERROR_STOP on

BEGIN;

-- Function to process MVP parquet data into curated vessels
CREATE OR REPLACE FUNCTION curated.process_mvp_vessels()
RETURNS TABLE(
  vessels_created bigint,
  duplicates_merged bigint,
  total_raw_records bigint
)
LANGUAGE plpgsql AS $$
DECLARE
  v_created bigint := 0;
  v_total bigint;
  v_existing_count bigint;
BEGIN
  -- Count total raw records
  SELECT COUNT(*) INTO v_total FROM public.vessels;

  -- Check if already processed
  SELECT COUNT(*) INTO v_existing_count FROM curated.vessels;
  IF v_existing_count > 0 THEN
    RAISE NOTICE 'curated.vessels already has % records. Truncating before processing.', v_existing_count;
    TRUNCATE curated.vessels CASCADE;
  END IF;

  RAISE NOTICE 'Processing % raw vessel records...', v_total;

  -- Use a single INSERT with CTEs to handle all deduplication logic
  WITH
  -- Find MMSIs that appear with multiple different IMOs (collision)
  mmsi_collisions AS (
    SELECT mmsi
    FROM public.vessels
    WHERE imo IS NOT NULL AND imo <> ''
      AND mmsi IS NOT NULL AND mmsi <> '' AND mmsi <> 'NONE'
    GROUP BY mmsi
    HAVING COUNT(DISTINCT imo) > 1
  ),
  -- Find IRCS that appear with multiple different IMOs (collision)
  ircs_collisions AS (
    SELECT ircs
    FROM public.vessels
    WHERE imo IS NOT NULL AND imo <> ''
      AND ircs IS NOT NULL AND ircs <> '' AND ircs <> 'NONE'
    GROUP BY ircs
    HAVING COUNT(DISTINCT imo) > 1
  ),
  -- Step 1: Deduplicate by IMO (primary identifier)
  -- Set MMSI/IRCS to NULL if they have collisions across IMOs
  imo_vessels AS (
    SELECT DISTINCT ON (imo)
      imo,
      CASE WHEN vessel_name IS NOT NULL AND vessel_name <> '' THEN vessel_name ELSE NULL END as vessel_name,
      CASE
        WHEN mmsi IS NOT NULL AND mmsi <> '' AND mmsi <> 'NONE'
         AND mmsi NOT IN (SELECT mmsi FROM mmsi_collisions)
        THEN mmsi
        ELSE NULL
      END as mmsi,
      CASE
        WHEN ircs IS NOT NULL AND ircs <> '' AND ircs <> 'NONE'
         AND ircs NOT IN (SELECT ircs FROM ircs_collisions)
        THEN ircs
        ELSE NULL
      END as ircs,
      CASE WHEN vessel_flag IS NOT NULL AND vessel_flag <> '' THEN vessel_flag ELSE NULL END as flag_code
    FROM public.vessels
    WHERE imo IS NOT NULL AND imo <> ''
    ORDER BY imo, vessel_name NULLS LAST
  ),
  -- Step 2: Deduplicate by MMSI for vessels without IMO
  mmsi_vessels AS (
    SELECT DISTINCT ON (mmsi)
      NULL::text as imo,
      CASE WHEN vessel_name IS NOT NULL AND vessel_name <> '' THEN vessel_name ELSE NULL END as vessel_name,
      mmsi,
      CASE
        WHEN ircs IS NOT NULL AND ircs <> '' AND ircs <> 'NONE'
         AND ircs NOT IN (SELECT ircs FROM ircs_collisions)
        THEN ircs
        ELSE NULL
      END as ircs,
      CASE WHEN vessel_flag IS NOT NULL AND vessel_flag <> '' THEN vessel_flag ELSE NULL END as flag_code
    FROM public.vessels
    WHERE (imo IS NULL OR imo = '')
      AND mmsi IS NOT NULL AND mmsi <> '' AND mmsi <> 'NONE'
    ORDER BY mmsi, vessel_name NULLS LAST
  ),
  -- Union both sets
  all_vessels AS (
    SELECT * FROM imo_vessels
    UNION ALL
    SELECT * FROM mmsi_vessels
  )
  INSERT INTO curated.vessels (
    imo,
    vessel_name,
    mmsi,
    ircs,
    flag_code,
    status,
    created_at,
    updated_at
  )
  SELECT
    imo,
    vessel_name,
    mmsi,
    ircs,
    flag_code,
    'active',
    NOW(),
    NOW()
  FROM all_vessels;

  -- Get count of created vessels
  GET DIAGNOSTICS v_created = ROW_COUNT;

  RAISE NOTICE 'Entity resolution complete: % vessels created from % raw records (% merged)',
    v_created, v_total, (v_total - v_created);

  RETURN QUERY SELECT v_created, (v_total - v_created)::bigint, v_total;
END;
$$;

COMMENT ON FUNCTION curated.process_mvp_vessels() IS
  'MVP entity resolution: merges public.vessels into curated.vessels by IMO/MMSI. Handles MMSI/IRCS collisions across IMOs by setting to NULL.';

COMMIT;

-- Run the entity resolution
SELECT * FROM curated.process_mvp_vessels();

-- Show results
SELECT
  'Canonical Vessels Created' as metric,
  COUNT(*)::text as count
FROM curated.vessels
UNION ALL
SELECT
  'Raw Records in public.vessels',
  COUNT(*)::text
FROM public.vessels
UNION ALL
SELECT
  'Reduction Factor',
  ROUND(
    (SELECT COUNT(*)::numeric FROM public.vessels) /
    NULLIF((SELECT COUNT(*)::numeric FROM curated.vessels), 0),
    2
  )::text || 'x'
UNION ALL
SELECT
  'Vessels with IMO',
  COUNT(*)::text
FROM curated.vessels
WHERE imo IS NOT NULL
UNION ALL
SELECT
  'Vessels with MMSI',
  COUNT(*)::text
FROM curated.vessels
WHERE mmsi IS NOT NULL
UNION ALL
SELECT
  'Vessels with IRCS',
  COUNT(*)::text
FROM curated.vessels
WHERE ircs IS NOT NULL
UNION ALL
SELECT
  'Vessels with Name',
  COUNT(*)::text
FROM curated.vessels
WHERE vessel_name IS NOT NULL;
