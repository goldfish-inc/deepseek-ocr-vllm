-- V6: Add Typed Columns to curated.vessel_info (NER Target Fields)
-- Created: 2025-09-30
-- Depends on: V1__staging_baseline.sql
-- Purpose: Resolve labels.json dbMapping misalignment - add typed columns for frequently queried fields

-- =============================================================================
-- PROBLEM
-- =============================================================================
-- labels.json maps to typed fields like:
--   VESSEL_TYPE → curated.vessel_info.vessel_type
--   BUILD_YEAR → curated.vessel_info.build_year
--
-- But V1 migration created vessel_info as pure EAV (Entity-Attribute-Value):
--   CREATE TABLE curated.vessel_info (
--     vessel_id bigint,
--     key text,
--     value text,
--     ...
--   );
--
-- This migration adds typed columns for structured fields while preserving
-- the EAV pattern for ad-hoc metadata.

-- =============================================================================
-- ADD TYPED COLUMNS (Frequently Queried Fields)
-- =============================================================================

ALTER TABLE curated.vessel_info
  -- Vessel specifications
  ADD COLUMN IF NOT EXISTS vessel_type text,
  ADD COLUMN IF NOT EXISTS build_year int,
  ADD COLUMN IF NOT EXISTS hull_material text,
  ADD COLUMN IF NOT EXISTS vessel_engine_type text,
  ADD COLUMN IF NOT EXISTS vessel_fuel_type text,
  ADD COLUMN IF NOT EXISTS freezer_type text,

  -- Registration & marking
  ADD COLUMN IF NOT EXISTS flag_registered_date date,
  ADD COLUMN IF NOT EXISTS external_marking text,

  -- Intelligence & risk
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS risk_score numeric(5,2);

-- Add constraints
ALTER TABLE curated.vessel_info
  ADD CONSTRAINT chk_vessel_info_risk_level
    CHECK (risk_level IS NULL OR risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT chk_vessel_info_risk_score
    CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  ADD CONSTRAINT chk_vessel_info_build_year
    CHECK (build_year IS NULL OR (build_year >= 1800 AND build_year <= EXTRACT(YEAR FROM CURRENT_DATE) + 5));

-- Create indices for frequently queried fields
CREATE INDEX IF NOT EXISTS ix_vessel_info_vessel_type ON curated.vessel_info(vessel_type) WHERE vessel_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_vessel_info_risk_level ON curated.vessel_info(risk_level) WHERE risk_level IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_vessel_info_build_year ON curated.vessel_info(build_year) WHERE build_year IS NOT NULL;

COMMENT ON COLUMN curated.vessel_info.vessel_type IS 'Vessel type (FISHING, CARRIER, SUPPORT, RESEARCH, etc.). Extracted from NER VESSEL_TYPE label.';
COMMENT ON COLUMN curated.vessel_info.build_year IS 'Year vessel was built. Extracted from NER BUILD_YEAR label. Range: 1800-present+5.';
COMMENT ON COLUMN curated.vessel_info.risk_level IS 'Risk assessment level (LOW/MEDIUM/HIGH/CRITICAL). Extracted from NER RISK_LEVEL label.';
COMMENT ON COLUMN curated.vessel_info.risk_score IS 'Numerical risk score (0-100). Extracted from NER RISK_SCORE label.';
COMMENT ON COLUMN curated.vessel_info.external_marking IS 'External vessel markings/identifiers. Extracted from NER EXTERNAL_MARKING label.';

-- =============================================================================
-- HYBRID EAV + TYPED PATTERN
-- =============================================================================

-- The table now supports BOTH patterns:
--
-- 1. TYPED COLUMNS (for structured, frequently queried fields):
--    INSERT INTO curated.vessel_info (vessel_id, vessel_type, build_year, risk_level)
--    VALUES (123, 'FISHING', 2015, 'MEDIUM');
--
-- 2. EAV (for ad-hoc metadata):
--    INSERT INTO curated.vessel_info (vessel_id, key, value)
--    VALUES (123, 'previous_name', 'OLD VESSEL NAME');
--
-- This allows:
-- - Fast queries on typed fields (indexed, constraints)
-- - Flexible storage of ad-hoc metadata (EAV)
-- - No schema changes needed for new metadata types

-- =============================================================================
-- MIGRATION HELPER: EAV → Typed Columns
-- =============================================================================

-- If you have existing EAV data to migrate, use this function:
CREATE OR REPLACE FUNCTION curated.migrate_vessel_info_eav_to_typed()
RETURNS TABLE(vessel_id bigint, migrated_fields text[]) AS $$
BEGIN
  -- Migrate vessel_type
  UPDATE curated.vessel_info vi
  SET vessel_type = eav.value
  FROM curated.vessel_info eav
  WHERE vi.vessel_id = eav.vessel_id
    AND eav.key = 'vessel_type'
    AND vi.vessel_type IS NULL;

  -- Migrate build_year
  UPDATE curated.vessel_info vi
  SET build_year = eav.value::int
  FROM curated.vessel_info eav
  WHERE vi.vessel_id = eav.vessel_id
    AND eav.key = 'build_year'
    AND eav.value ~ '^\d{4}$'  -- Only migrate valid years
    AND vi.build_year IS NULL;

  -- Migrate risk_level
  UPDATE curated.vessel_info vi
  SET risk_level = UPPER(eav.value)
  FROM curated.vessel_info eav
  WHERE vi.vessel_id = eav.vessel_id
    AND eav.key = 'risk_level'
    AND UPPER(eav.value) IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    AND vi.risk_level IS NULL;

  -- Return summary
  RETURN QUERY
  SELECT
    vi.vessel_id,
    ARRAY_AGG(DISTINCT
      CASE
        WHEN vi.vessel_type IS NOT NULL THEN 'vessel_type'
        WHEN vi.build_year IS NOT NULL THEN 'build_year'
        WHEN vi.risk_level IS NOT NULL THEN 'risk_level'
      END
    ) FILTER (WHERE
      vi.vessel_type IS NOT NULL OR
      vi.build_year IS NOT NULL OR
      vi.risk_level IS NOT NULL
    ) AS migrated_fields
  FROM curated.vessel_info vi
  GROUP BY vi.vessel_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION curated.migrate_vessel_info_eav_to_typed IS 'One-time migration helper to move existing EAV data to typed columns. Safe to run multiple times (only migrates NULL typed fields).';

-- =============================================================================
-- UPDATED VIEW: Include Typed Fields
-- =============================================================================

-- Extend v_vessels_current_state to include typed vessel_info fields
DROP VIEW IF EXISTS curated.v_vessels_current_state;
CREATE OR REPLACE VIEW curated.v_vessels_current_state AS
SELECT
  v.vessel_id,
  v.vessel_uuid,
  v.imo,
  v.mmsi,
  v.ircs,
  v.name AS vessel_name,
  v.vessel_name_other,
  v.eu_cfr,

  -- Current flag
  fh.flag_country_id AS current_flag_id,
  c.alpha2 AS current_flag_alpha2,
  c.name AS current_flag_name,
  c.is_flag_of_convenience,
  fh.valid_from AS flag_since,

  -- Vessel specifications (typed columns)
  vi.vessel_type,
  vi.build_year,
  vi.hull_material,
  vi.external_marking,
  vi.risk_level,
  vi.risk_score,

  -- Active authorizations count
  (SELECT COUNT(*) FROM curated.vessel_authorizations va
   WHERE va.vessel_id = v.vessel_id AND va.status = 'ACTIVE') AS active_authorizations,

  -- Active sanctions count
  (SELECT COUNT(*) FROM curated.vessel_sanctions vs
   WHERE vs.vessel_id = v.vessel_id AND vs.lifted_date IS NULL) AS active_sanctions,

  -- Beneficial owner (current)
  (SELECT o.name FROM curated.vessel_associates vass
   JOIN curated.entity_organizations o ON vass.organization_id = o.org_id
   WHERE vass.vessel_id = v.vessel_id
     AND vass.associate_type = 'BENEFICIAL_OWNER'
     AND vass.valid_to IS NULL
   LIMIT 1) AS beneficial_owner,

  -- Operator (current)
  (SELECT o.name FROM curated.vessel_associates vass
   JOIN curated.entity_organizations o ON vass.organization_id = o.org_id
   WHERE vass.vessel_id = v.vessel_id
     AND vass.associate_type = 'OPERATOR'
     AND vass.valid_to IS NULL
   LIMIT 1) AS operator,

  v.updated_at
FROM curated.vessels v
LEFT JOIN curated.vessel_flag_history fh ON v.vessel_id = fh.vessel_id AND fh.valid_to IS NULL
LEFT JOIN curated.country_iso c ON fh.flag_country_id = c.id
LEFT JOIN curated.vessel_info vi ON v.vessel_id = vi.vessel_id;

COMMENT ON VIEW curated.v_vessels_current_state IS 'Current vessel state with typed vessel_info fields. Aggregates latest values from temporal tables and typed metadata.';

-- =============================================================================
-- USAGE EXAMPLES
-- =============================================================================

-- Example 1: Insert vessel with typed fields (NER extraction)
-- INSERT INTO curated.vessel_info (vessel_id, vessel_type, build_year, risk_level, risk_score)
-- VALUES (123, 'FISHING', 2015, 'MEDIUM', 45.5);

-- Example 2: Insert ad-hoc metadata (EAV)
-- INSERT INTO curated.vessel_info (vessel_id, key, value)
-- VALUES (123, 'previous_owner', 'Previous Company Name');

-- Example 3: Query typed fields (fast, indexed)
-- SELECT vessel_id, vessel_type, build_year, risk_level
-- FROM curated.vessel_info
-- WHERE vessel_type = 'FISHING' AND build_year >= 2010 AND risk_level IN ('HIGH', 'CRITICAL');

-- Example 4: Query EAV fields
-- SELECT vessel_id, key, value
-- FROM curated.vessel_info
-- WHERE key = 'previous_owner';

-- =============================================================================
-- COMPLETION
-- =============================================================================

COMMENT ON TABLE curated.vessel_info IS 'Hybrid vessel metadata storage: Typed columns for structured fields (vessel_type, build_year, risk_level) + EAV (key/value) for ad-hoc metadata. Enables fast queries on typed fields while maintaining flexibility.';
