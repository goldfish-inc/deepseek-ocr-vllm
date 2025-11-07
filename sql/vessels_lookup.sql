-- EBISU Vessel Lookup Functions and Views
-- Maps ebisu.vessels (current state) and ebisu.vessel_reported_history to UI-friendly GraphQL schema
-- Compatible with existing PostGraphile queries for backwards compatibility

-- Enable extensions for search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Performance: trigram index for fuzzy name search on ebisu.vessels
CREATE INDEX IF NOT EXISTS ebisu_vessels_vname_trgm_idx
ON ebisu.vessels USING gin (vessel_name gin_trgm_ops);

-- UI View: public.ui_vessels (maps ebisu.vessels to legacy UI shape)
-- This view provides backwards compatibility with existing queries that expect public.vessels
CREATE OR REPLACE VIEW public.ui_vessels AS
SELECT
  v.vessel_uuid::text AS entity_id,
  v.vessel_name,
  v.imo,
  v.mmsi,
  v.ircs,
  v.vessel_flag,
  v.national_registry,
  v.eu_cfr,
  v.created_at,
  v.updated_at
FROM ebisu.vessels v;

-- Smart comment for PostGraphile
COMMENT ON VIEW public.ui_vessels IS E'@primaryKey entity_id\nCurrent vessel state from ebisu.vessels';

-- RPC: fuzzy name search with accent-insensitive matching and trigram ordering
CREATE OR REPLACE FUNCTION public.search_vessels(q text, limit_n int DEFAULT 50)
RETURNS SETOF public.ui_vessels
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT *
  FROM public.ui_vessels
  WHERE unaccent(vessel_name) ILIKE unaccent('%' || q || '%')
  ORDER BY similarity(vessel_name, q) DESC
  LIMIT limit_n
$$;

COMMENT ON FUNCTION public.search_vessels(text, int) IS E'@simpleCollections only';

-- UI View: vessel intelligence report (aggregates history into current state summary)
CREATE OR REPLACE VIEW public.ui_vessel_report AS
SELECT
  v.vessel_uuid::text AS entity_id,
  v.vessel_name AS current_name,
  v.imo AS current_imo,
  v.mmsi AS current_mmsi,
  v.ircs AS current_ircs,

  -- Aggregate historical name changes
  COALESCE(
    (SELECT array_agg(DISTINCT h.identifier_value)
     FROM ebisu.vessel_reported_history h
     WHERE h.vessel_uuid = v.vessel_uuid
       AND h.reported_history_type = 'VESSEL_NAME_CHANGE'
       AND h.identifier_value IS NOT NULL
    ), ARRAY[]::text[]
  ) || ARRAY[v.vessel_name]::text[] AS names,

  -- Aggregate historical IMO changes
  COALESCE(
    (SELECT array_agg(DISTINCT h.identifier_value)
     FROM ebisu.vessel_reported_history h
     WHERE h.vessel_uuid = v.vessel_uuid
       AND h.reported_history_type = 'IMO_CHANGE'
       AND h.identifier_value IS NOT NULL
    ), ARRAY[]::text[]
  ) || ARRAY[v.imo]::text[] AS imos,

  -- Aggregate historical MMSI changes
  COALESCE(
    (SELECT array_agg(DISTINCT h.identifier_value)
     FROM ebisu.vessel_reported_history h
     WHERE h.vessel_uuid = v.vessel_uuid
       AND h.reported_history_type = 'MMSI_CHANGE'
       AND h.identifier_value IS NOT NULL
    ), ARRAY[]::text[]
  ) || ARRAY[v.mmsi]::text[] AS mmsis,

  -- Source tracking (from history records)
  COALESCE(
    (SELECT array_agg(DISTINCT s.source_shortname)
     FROM ebisu.vessel_reported_history h
     JOIN ebisu.original_sources_vessels s ON h.source_id = s.source_id
     WHERE h.vessel_uuid = v.vessel_uuid
    ), ARRAY[]::text[]
  ) AS rfmos,

  -- History change counts
  (SELECT COUNT(*) FROM ebisu.vessel_reported_history h WHERE h.vessel_uuid = v.vessel_uuid) AS history_count,
  (SELECT COUNT(*) FROM ebisu.vessel_reported_history h WHERE h.vessel_uuid = v.vessel_uuid AND h.reported_history_type = 'VESSEL_NAME_CHANGE') AS name_change_count,
  (SELECT COUNT(*) FROM ebisu.vessel_reported_history h WHERE h.vessel_uuid = v.vessel_uuid AND h.reported_history_type = 'IMO_CHANGE') AS imo_change_count,
  (SELECT COUNT(*) FROM ebisu.vessel_reported_history h WHERE h.vessel_uuid = v.vessel_uuid AND h.reported_history_type = 'MMSI_CHANGE') AS mmsi_change_count,

  -- Conflict flags
  (SELECT COUNT(DISTINCT h.identifier_value) FROM ebisu.vessel_reported_history h WHERE h.vessel_uuid = v.vessel_uuid AND h.reported_history_type = 'MMSI_CHANGE') > 1 AS has_mmsi_conflict,
  (SELECT COUNT(DISTINCT h.identifier_value) FROM ebisu.vessel_reported_history h WHERE h.vessel_uuid = v.vessel_uuid AND h.reported_history_type = 'IMO_CHANGE') > 1 AS has_imo_conflict,

  v.created_at,
  v.updated_at
FROM ebisu.vessels v;

COMMENT ON VIEW public.ui_vessel_report IS E'@primaryKey entity_id\nVessel intelligence report with historical tracking';

-- RPC: return intelligence report for a specific entity_id
CREATE OR REPLACE FUNCTION public.vessel_report(p_entity_id text)
RETURNS public.ui_vessel_report
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.ui_vessel_report WHERE entity_id = p_entity_id
$$;

COMMENT ON FUNCTION public.vessel_report(text) IS E'@simpleCollections only';

-- Legacy UI views (preserved for compatibility)
CREATE OR REPLACE VIEW public.ui_entity_summary AS
SELECT
  entity_id,
  imos,
  mmsis,
  names,
  history_count AS row_count
FROM public.ui_vessel_report;

CREATE OR REPLACE VIEW public.ui_vessel_conflicts AS
SELECT
  current_imo AS imo,
  mmsis,
  array_length(mmsis, 1) AS mmsi_count
FROM public.ui_vessel_report
WHERE array_length(mmsis, 1) > 1
  AND current_imo IS NOT NULL;
