-- V5: Curated Temporal & Event Tables (Intelligence with Time-Validity)
-- Created: 2025-09-30
-- Depends on: V1__staging_baseline.sql, V4__curated_reference_tables.sql
-- Purpose: Add temporal/evented tables for maritime intelligence with valid_from/valid_to

-- =============================================================================
-- UPGRADE VESSELS TABLE (Add FKs and Missing Fields)
-- =============================================================================

-- Add columns missing from V1 skeleton
ALTER TABLE curated.vessels ADD COLUMN IF NOT EXISTS vessel_uuid uuid DEFAULT gen_random_uuid();
ALTER TABLE curated.vessels ADD COLUMN IF NOT EXISTS ircs text;
ALTER TABLE curated.vessels ADD COLUMN IF NOT EXISTS national_registry text;
ALTER TABLE curated.vessels ADD COLUMN IF NOT EXISTS eu_cfr char(12);
ALTER TABLE curated.vessels ADD COLUMN IF NOT EXISTS vessel_name_other text;

-- Add foreign key to country_iso (replace text flag with UUID)
ALTER TABLE curated.vessels ADD COLUMN IF NOT EXISTS flag_country_id uuid REFERENCES curated.country_iso(id);

-- Create index on UUID for relationships
CREATE UNIQUE INDEX IF NOT EXISTS ix_vessels_uuid ON curated.vessels(vessel_uuid);
CREATE INDEX IF NOT EXISTS ix_vessels_flag_country ON curated.vessels(flag_country_id);

COMMENT ON COLUMN curated.vessels.vessel_uuid IS 'Immutable UUID for vessel identity across reregistrations/reflagging. Stable identifier for relationships.';
COMMENT ON COLUMN curated.vessels.flag_country_id IS 'Current flag state. Use vessel_flag_history for temporal flag changes.';

-- =============================================================================
-- VESSEL FLAG HISTORY (Temporal Flag State Changes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.vessel_flag_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vessel reference
  vessel_id bigint NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,

  -- Flag state
  flag_country_id uuid NOT NULL REFERENCES curated.country_iso(id),

  -- Temporal validity
  valid_from date NOT NULL,
  valid_to date,  -- NULL = current flag

  -- Registration details
  registration_number text,
  port_of_registry_id uuid REFERENCES curated.ports(id),

  -- Provenance
  source_document_id bigint REFERENCES stage.documents(id),
  confidence double precision,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Prevent overlapping periods for same vessel
  EXCLUDE USING gist (
    vessel_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS ix_vessel_flag_history_vessel ON curated.vessel_flag_history(vessel_id);
CREATE INDEX IF NOT EXISTS ix_vessel_flag_history_country ON curated.vessel_flag_history(flag_country_id);
CREATE INDEX IF NOT EXISTS ix_vessel_flag_history_current ON curated.vessel_flag_history(vessel_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_vessel_flag_history_dates ON curated.vessel_flag_history(valid_from, valid_to);

COMMENT ON TABLE curated.vessel_flag_history IS 'Temporal record of vessel flag state changes. Tracks reflagging events which are key IUU indicators.';
COMMENT ON COLUMN curated.vessel_flag_history.valid_to IS 'NULL indicates current flag. Non-NULL indicates historical flag state.';

-- =============================================================================
-- VESSEL AUTHORIZATIONS (Temporal Fishing Permits)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.vessel_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vessel reference
  vessel_id bigint NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,

  -- Authorization details
  authorization_type text NOT NULL REFERENCES curated.authorization_types(code),
  authorization_number text,

  -- Issuing authority
  rfmo_id uuid REFERENCES curated.rfmos(id),
  flag_country_id uuid REFERENCES curated.country_iso(id),
  issuing_authority text,

  -- Temporal validity
  valid_from date NOT NULL,
  valid_to date,  -- NULL = indefinite, otherwise expiry date
  issued_date date,

  -- Authorization scope
  authorized_gear_types text[],  -- Array of FAO gear codes
  authorized_species text[],  -- Array of ASFIS species codes
  authorized_areas text[],  -- Array of FAO areas or WKT polygons
  catch_limits jsonb,  -- {"species_code": {"limit_mt": 1000, "period": "annual"}}

  -- Status
  status text NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'PENDING'
  status_changed_at timestamptz,
  revocation_reason text,

  -- Conditions
  requires_observer boolean DEFAULT false,
  requires_reporting boolean DEFAULT true,
  reporting_frequency text,  -- 'DAILY' | 'WEEKLY' | 'PER_LANDING'

  -- Provenance
  source_document_id bigint REFERENCES stage.documents(id),
  confidence double precision,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Constraints
  CHECK (status IN ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'PENDING')),
  CHECK (valid_from <= COALESCE(valid_to, valid_from))
);

CREATE INDEX IF NOT EXISTS ix_vessel_authorizations_vessel ON curated.vessel_authorizations(vessel_id);
CREATE INDEX IF NOT EXISTS ix_vessel_authorizations_type ON curated.vessel_authorizations(authorization_type);
CREATE INDEX IF NOT EXISTS ix_vessel_authorizations_rfmo ON curated.vessel_authorizations(rfmo_id);
CREATE INDEX IF NOT EXISTS ix_vessel_authorizations_status ON curated.vessel_authorizations(status);
CREATE INDEX IF NOT EXISTS ix_vessel_authorizations_dates ON curated.vessel_authorizations(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS ix_vessel_authorizations_current ON curated.vessel_authorizations(vessel_id, status) WHERE status = 'ACTIVE';

COMMENT ON TABLE curated.vessel_authorizations IS 'Temporal fishing authorizations from RFMOs and flag states. Tracks authorization status changes and scope.';
COMMENT ON COLUMN curated.vessel_authorizations.status IS 'Current authorization status. ACTIVE = currently valid, EXPIRED = past valid_to date, SUSPENDED = temporarily invalid, REVOKED = permanently cancelled, PENDING = application submitted.';
COMMENT ON COLUMN curated.vessel_authorizations.catch_limits IS 'JSONB map of species catch limits: {"TOT": {"limit_mt": 500, "period": "annual", "area": "48.3"}}';

-- =============================================================================
-- VESSEL SANCTIONS (IUU Listings & Penalties)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.vessel_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vessel reference
  vessel_id bigint NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,

  -- Sanction details
  sanction_type text NOT NULL REFERENCES curated.sanction_types(code),
  program text,  -- Sanctioning program name
  issuing_authority text NOT NULL,

  -- Temporal validity
  imposed_date date NOT NULL,
  lifted_date date,  -- NULL = still in effect
  reviewed_date date,

  -- Reason & details
  violation_type text,  -- 'IUU_FISHING' | 'MISREPORTING' | 'UNLICENSED_FISHING' | 'PROTECTED_SPECIES' | etc.
  violation_description text,
  violation_date date,
  violation_location geometry(Point, 4326),

  -- Impact
  scope text,  -- 'GLOBAL' | 'REGIONAL' | 'BILATERAL'
  affected_jurisdictions text[],  -- Array of country codes or RFMO codes

  -- Related entities
  also_sanctioned_persons text[],  -- Array of person names
  also_sanctioned_companies text[],  -- Array of company names

  -- Provenance
  source_document_id bigint REFERENCES stage.documents(id),
  source_url text,
  confidence double precision,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_vessel_sanctions_vessel ON curated.vessel_sanctions(vessel_id);
CREATE INDEX IF NOT EXISTS ix_vessel_sanctions_type ON curated.vessel_sanctions(sanction_type);
CREATE INDEX IF NOT EXISTS ix_vessel_sanctions_dates ON curated.vessel_sanctions(imposed_date, lifted_date);
CREATE INDEX IF NOT EXISTS ix_vessel_sanctions_active ON curated.vessel_sanctions(vessel_id) WHERE lifted_date IS NULL;
CREATE INDEX IF NOT EXISTS ix_vessel_sanctions_violation ON curated.vessel_sanctions(violation_type);
CREATE INDEX IF NOT EXISTS ix_vessel_sanctions_geo ON curated.vessel_sanctions USING gist(violation_location);

COMMENT ON TABLE curated.vessel_sanctions IS 'Vessel sanctions including IUU listings, trade bans, port bans. Critical for due diligence and risk assessment.';
COMMENT ON COLUMN curated.vessel_sanctions.lifted_date IS 'NULL indicates sanction still in effect. Non-NULL indicates historical sanction.';
COMMENT ON COLUMN curated.vessel_sanctions.scope IS 'Geographic scope: GLOBAL (UN/international), REGIONAL (RFMO), BILATERAL (specific country pair).';

-- =============================================================================
-- VESSEL ASSOCIATES (Temporal Ownership & Control)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.vessel_associates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vessel reference
  vessel_id bigint NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,

  -- Associate type
  associate_type text NOT NULL REFERENCES curated.association_types(code),
  role text,  -- Additional role details beyond type

  -- Associate entity (person XOR organization)
  person_id bigint REFERENCES curated.entity_persons(person_id),
  organization_id bigint REFERENCES curated.entity_organizations(org_id),

  -- Temporal validity
  valid_from date NOT NULL,
  valid_to date,  -- NULL = current association

  -- Ownership details (if applicable)
  ownership_percentage numeric(5,2),  -- 0.00-100.00
  ownership_type text,  -- 'DIRECT' | 'INDIRECT' | 'BENEFICIAL'
  control_level text,  -- 'MAJORITY' | 'MINORITY' | 'CONTROLLING' | 'NON_CONTROLLING'

  -- Provenance
  source_document_id bigint REFERENCES stage.documents(id),
  confidence double precision,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Constraints
  CHECK (person_id IS NOT NULL OR organization_id IS NOT NULL),
  CHECK (person_id IS NULL OR organization_id IS NULL),  -- XOR constraint
  CHECK (ownership_percentage IS NULL OR (ownership_percentage >= 0 AND ownership_percentage <= 100)),
  CHECK (valid_from <= COALESCE(valid_to, valid_from))
);

CREATE INDEX IF NOT EXISTS ix_vessel_associates_vessel ON curated.vessel_associates(vessel_id);
CREATE INDEX IF NOT EXISTS ix_vessel_associates_type ON curated.vessel_associates(associate_type);
CREATE INDEX IF NOT EXISTS ix_vessel_associates_person ON curated.vessel_associates(person_id);
CREATE INDEX IF NOT EXISTS ix_vessel_associates_org ON curated.vessel_associates(organization_id);
CREATE INDEX IF NOT EXISTS ix_vessel_associates_dates ON curated.vessel_associates(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS ix_vessel_associates_current ON curated.vessel_associates(vessel_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_vessel_associates_beneficial ON curated.vessel_associates(vessel_id, associate_type) WHERE associate_type = 'BENEFICIAL_OWNER';

COMMENT ON TABLE curated.vessel_associates IS 'Temporal associations between vessels and persons/organizations. Tracks ownership, operation, and control relationships over time.';
COMMENT ON COLUMN curated.vessel_associates.valid_to IS 'NULL indicates current association. Non-NULL indicates historical relationship.';
COMMENT ON COLUMN curated.vessel_associates.ownership_type IS 'DIRECT = direct shares, INDIRECT = through subsidiaries, BENEFICIAL = ultimate beneficial ownership.';

-- =============================================================================
-- VESSEL METRICS (Temporal Measurements & Characteristics)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.vessel_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vessel reference
  vessel_id bigint NOT NULL REFERENCES curated.vessels(vessel_id) ON DELETE CASCADE,

  -- Metric identification
  metric_type text NOT NULL,  -- 'TONNAGE' | 'LENGTH' | 'ENGINE_POWER' | 'CREW_COUNT' | 'CATCH' | etc.
  metric_subtype text,  -- e.g., 'GROSS_TONNAGE' vs 'NET_TONNAGE'

  -- Value
  value numeric NOT NULL,
  unit text REFERENCES curated.unit_types(code),

  -- Temporal context
  measured_at date,
  valid_from date,
  valid_to date,  -- NULL = current value

  -- Context
  measurement_context text,  -- 'DESIGN' | 'AS_BUILT' | 'REFIT' | 'SURVEY'
  surveyed_by text,  -- Survey authority

  -- Provenance
  source_document_id bigint REFERENCES stage.documents(id),
  confidence double precision,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_vessel_metrics_vessel ON curated.vessel_metrics(vessel_id);
CREATE INDEX IF NOT EXISTS ix_vessel_metrics_type ON curated.vessel_metrics(metric_type);
CREATE INDEX IF NOT EXISTS ix_vessel_metrics_dates ON curated.vessel_metrics(valid_from, valid_to);
CREATE INDEX IF NOT EXISTS ix_vessel_metrics_current ON curated.vessel_metrics(vessel_id, metric_type) WHERE valid_to IS NULL;

COMMENT ON TABLE curated.vessel_metrics IS 'Temporal vessel measurements and characteristics. Tracks changes over time due to refits, surveys, or corrections.';
COMMENT ON COLUMN curated.vessel_metrics.metric_type IS 'Type of metric: TONNAGE, LENGTH, ENGINE_POWER, CREW_COUNT, CATCH, LANDING, etc.';

-- =============================================================================
-- CONFLICT RESOLUTION (Track Conflicting Intelligence)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.entity_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Entity reference (polymorphic)
  entity_type text NOT NULL,  -- 'VESSEL' | 'PERSON' | 'ORGANIZATION'
  entity_id bigint NOT NULL,

  -- Conflict details
  field_name text NOT NULL,  -- Which field has conflicting values
  conflict_type text NOT NULL,  -- 'VALUE_MISMATCH' | 'DATE_OVERLAP' | 'REFERENTIAL_VIOLATION'

  -- Conflicting values
  value_a text,
  value_b text,
  value_a_source_id bigint REFERENCES stage.documents(id),
  value_b_source_id bigint REFERENCES stage.documents(id),

  -- Resolution
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by text,
  resolution_method text,  -- 'CHOOSE_A' | 'CHOOSE_B' | 'MERGE' | 'DEFER' | 'FLAG_ERROR'
  resolution_notes text,

  detected_at timestamptz DEFAULT now(),

  CHECK (entity_type IN ('VESSEL', 'PERSON', 'ORGANIZATION', 'AUTHORIZATION', 'SANCTION'))
);

CREATE INDEX IF NOT EXISTS ix_entity_conflicts_entity ON curated.entity_conflicts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_entity_conflicts_unresolved ON curated.entity_conflicts(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS ix_entity_conflicts_field ON curated.entity_conflicts(field_name);

COMMENT ON TABLE curated.entity_conflicts IS 'Tracks conflicting intelligence from multiple sources. Ensures conflicts are surfaced and resolved before affecting downstream analytics.';
COMMENT ON COLUMN curated.entity_conflicts.resolution_method IS 'How conflict was resolved: CHOOSE_A (use value_a), CHOOSE_B (use value_b), MERGE (combine both), DEFER (keep both pending review), FLAG_ERROR (source error, discard both).';

-- =============================================================================
-- ENTITY CONFIRMATIONS (Human-Verified Intelligence)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.entity_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Entity reference (polymorphic)
  entity_type text NOT NULL,
  entity_id bigint NOT NULL,

  -- Confirmation details
  confirmed_field text NOT NULL,  -- Specific field confirmed (e.g., 'imo', 'beneficial_owner')
  confirmed_value text NOT NULL,
  confirmation_level text NOT NULL,  -- 'LOW' | 'MEDIUM' | 'HIGH' | 'AUTHORITATIVE'

  -- Confirming source
  confirming_source text NOT NULL,  -- 'SME_REVIEW' | 'OFFICIAL_DOCUMENT' | 'CROSS_REFERENCE' | 'FIELD_INSPECTION'
  confirming_document_id bigint REFERENCES stage.documents(id),
  confirmed_by text NOT NULL,  -- User or authority

  confirmed_at timestamptz DEFAULT now(),

  -- Metadata
  notes text,

  CHECK (entity_type IN ('VESSEL', 'PERSON', 'ORGANIZATION', 'AUTHORIZATION', 'SANCTION')),
  CHECK (confirmation_level IN ('LOW', 'MEDIUM', 'HIGH', 'AUTHORITATIVE'))
);

CREATE INDEX IF NOT EXISTS ix_entity_confirmations_entity ON curated.entity_confirmations(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_entity_confirmations_field ON curated.entity_confirmations(confirmed_field);
CREATE INDEX IF NOT EXISTS ix_entity_confirmations_level ON curated.entity_confirmations(confirmation_level);

COMMENT ON TABLE curated.entity_confirmations IS 'Human-verified intelligence confirmations. Captures SME validation and authoritative source verification for high-confidence intelligence.';
COMMENT ON COLUMN curated.entity_confirmations.confirmation_level IS 'Confidence level: LOW (single source), MEDIUM (cross-referenced), HIGH (SME verified), AUTHORITATIVE (official government/RFMO document).';

-- =============================================================================
-- UPDATE TRIGGERS
-- =============================================================================

CREATE TRIGGER update_vessel_flag_history_updated_at BEFORE UPDATE ON curated.vessel_flag_history
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_vessel_authorizations_updated_at BEFORE UPDATE ON curated.vessel_authorizations
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_vessel_sanctions_updated_at BEFORE UPDATE ON curated.vessel_sanctions
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_vessel_associates_updated_at BEFORE UPDATE ON curated.vessel_associates
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_vessel_metrics_updated_at BEFORE UPDATE ON curated.vessel_metrics
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

-- =============================================================================
-- VIEWS FOR TEMPORAL QUERIES
-- =============================================================================

-- Current vessel state (flatten temporal tables to latest values)
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
LEFT JOIN curated.country_iso c ON fh.flag_country_id = c.id;

COMMENT ON VIEW curated.v_vessels_current_state IS 'Current vessel state flattened view. Aggregates latest values from temporal tables for easy querying.';

-- Authorization expiry warnings
CREATE OR REPLACE VIEW curated.v_authorizations_expiring_soon AS
SELECT
  va.id,
  va.vessel_id,
  v.imo,
  v.name AS vessel_name,
  va.authorization_type,
  va.authorization_number,
  r.code AS rfmo_code,
  va.valid_from,
  va.valid_to,
  va.valid_to - CURRENT_DATE AS days_until_expiry
FROM curated.vessel_authorizations va
JOIN curated.vessels v ON va.vessel_id = v.vessel_id
LEFT JOIN curated.rfmos r ON va.rfmo_id = r.id
WHERE
  va.status = 'ACTIVE'
  AND va.valid_to IS NOT NULL
  AND va.valid_to BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY va.valid_to ASC;

COMMENT ON VIEW curated.v_authorizations_expiring_soon IS 'Authorizations expiring in next 30 days. Used for renewal alerts and risk monitoring.';

-- =============================================================================
-- COMPLETION
-- =============================================================================

COMMENT ON SCHEMA curated IS 'Curated maritime intelligence with temporal validity. All relationship and event tables track valid_from/valid_to for time-series analysis and historical queries.';