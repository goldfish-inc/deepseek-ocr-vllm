-- ============================================================================
-- CONSOLIDATED SCHEMA FOR CLEANDATA DATABASE
-- ============================================================================
-- This consolidated script creates all schemas and tables for the cleandata
-- database in one go, rather than using incremental migrations.
-- Used for initial database setup on CrunchyBridge.
-- ============================================================================
-- NOTE: Legacy bootstrap script. Prefer applying versioned migrations
--       (sql/migrations/V*.sql) for new environments to stay aligned with
--       the current Oceanid schema.

-- Create PostgreSQL extensions (may fail on CrunchyBridge, that's OK)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- SCHEMAS
-- ============================================================================

-- Control schema for version tracking and system metadata
CREATE SCHEMA IF NOT EXISTS control;

-- Raw data as received from sources
CREATE SCHEMA IF NOT EXISTS raw;

-- Staging area for data cleaning and validation
CREATE SCHEMA IF NOT EXISTS stage;

-- Label Studio integration
CREATE SCHEMA IF NOT EXISTS label;

-- Curated, production-ready data
CREATE SCHEMA IF NOT EXISTS curated;

-- ============================================================================
-- CONTROL SCHEMA - System metadata
-- ============================================================================

-- Schema version tracking (formerly used for migrations)
CREATE TABLE IF NOT EXISTS control.schema_versions (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(100) UNIQUE NOT NULL, -- V1, V2, etc. or feature names
    version VARCHAR(255) NOT NULL,
    activated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- Insert consolidated schema version
INSERT INTO control.schema_versions (domain, version, notes)
VALUES ('CONSOLIDATED', 'consolidated_cleandata_schema.sql', 'Initial consolidated schema creation')
ON CONFLICT (domain) DO UPDATE
SET version = EXCLUDED.version,
    activated_at = EXCLUDED.activated_at,
    notes = EXCLUDED.notes;

-- ============================================================================
-- STAGE SCHEMA - Data staging and cleaning
-- ============================================================================

-- Document tracking
CREATE TABLE IF NOT EXISTS stage.documents (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT UNIQUE,
    file_name VARCHAR(500),
    file_url TEXT,
    file_size BIGINT,
    mime_type VARCHAR(100),
    source_type VARCHAR(100),
    source_name VARCHAR(200),
    org_id VARCHAR(100),
    doc_type VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_task_id ON stage.documents(task_id);
CREATE INDEX IF NOT EXISTS idx_documents_source ON stage.documents(source_type, source_name);
CREATE INDEX IF NOT EXISTS idx_documents_created ON stage.documents(created_at);

-- CSV extraction results with confidence scoring
CREATE TABLE IF NOT EXISTS stage.csv_extractions (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES stage.documents(id),
    row_index INT,
    column_name VARCHAR(200),
    raw_value TEXT,
    cleaned_value TEXT,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    rule_chain BIGINT[],
    needs_review BOOLEAN DEFAULT false,
    similarity DECIMAL(3,2),
    source_type VARCHAR(100),
    source_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_csv_extractions_document ON stage.csv_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_csv_extractions_review ON stage.csv_extractions(needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS idx_csv_extractions_confidence ON stage.csv_extractions(confidence);
CREATE INDEX IF NOT EXISTS idx_csv_extractions_column ON stage.csv_extractions(column_name);

-- Cleaning rules engine
CREATE TABLE IF NOT EXISTS stage.cleaning_rules (
    id BIGSERIAL PRIMARY KEY,
    rule_name VARCHAR(200) UNIQUE NOT NULL,
    rule_type VARCHAR(50), -- regex_replace, field_merger, validator, type_coercion
    applies_to_columns TEXT[], -- array of column names or patterns
    applies_to_sources TEXT[], -- array of source types
    pattern TEXT,
    replacement TEXT,
    confidence DECIMAL(3,2) DEFAULT 0.8,
    priority INT DEFAULT 100,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cleaning_rules_active ON stage.cleaning_rules(active, priority);
CREATE INDEX IF NOT EXISTS idx_cleaning_rules_type ON stage.cleaning_rules(rule_type);

-- Processing log for audit trail
CREATE TABLE IF NOT EXISTS stage.document_processing_log (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES stage.documents(id),
    task_id BIGINT,
    processing_status VARCHAR(50), -- processing, completed, failed
    rows_processed INT,
    cells_processed INT,
    cells_needing_review INT,
    confidence_avg DECIMAL(3,2),
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_processing_log_document ON stage.document_processing_log(document_id);
CREATE INDEX IF NOT EXISTS idx_processing_log_status ON stage.document_processing_log(processing_status);
CREATE INDEX IF NOT EXISTS idx_processing_log_task ON stage.document_processing_log(task_id);

-- Event log for webhooks and system events
CREATE TABLE IF NOT EXISTS stage.event_log (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50),
    event_action VARCHAR(100),
    task_id BIGINT,
    document_id BIGINT,
    payload JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_log_task ON stage.event_log(task_id);
CREATE INDEX IF NOT EXISTS idx_event_log_type ON stage.event_log(event_type, event_action);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON stage.event_log(created_at);

-- Review queue for human validation
CREATE TABLE IF NOT EXISTS stage.review_queue (
    id BIGSERIAL PRIMARY KEY,
    extraction_id BIGINT REFERENCES stage.csv_extractions(id),
    review_status VARCHAR(50) DEFAULT 'pending', -- pending, in_review, approved, rejected
    reviewer VARCHAR(200),
    review_notes TEXT,
    original_value TEXT,
    corrected_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON stage.review_queue(review_status);
CREATE INDEX IF NOT EXISTS idx_review_queue_extraction ON stage.review_queue(extraction_id);

-- ============================================================================
-- STAGE VIEWS - Data quality monitoring
-- ============================================================================

-- Data freshness monitoring
CREATE OR REPLACE VIEW stage.data_freshness AS
SELECT
    source_type,
    source_name,
    COUNT(*) as document_count,
    MAX(created_at) as last_updated,
    AGE(CURRENT_TIMESTAMP, MAX(created_at)) as time_since_update,
    CASE
        WHEN AGE(CURRENT_TIMESTAMP, MAX(created_at)) < INTERVAL '1 day' THEN 'fresh'
        WHEN AGE(CURRENT_TIMESTAMP, MAX(created_at)) < INTERVAL '7 days' THEN 'recent'
        WHEN AGE(CURRENT_TIMESTAMP, MAX(created_at)) < INTERVAL '30 days' THEN 'stale'
        ELSE 'expired'
    END as freshness_status
FROM stage.documents
GROUP BY source_type, source_name;

-- Duplicate detection
CREATE OR REPLACE VIEW stage.potential_duplicates AS
SELECT
    ce1.document_id as doc1_id,
    ce2.document_id as doc2_id,
    ce1.column_name,
    ce1.cleaned_value,
    COUNT(*) as duplicate_count,
    AVG(ce1.confidence) as avg_confidence
FROM stage.csv_extractions ce1
JOIN stage.csv_extractions ce2
    ON ce1.cleaned_value = ce2.cleaned_value
    AND ce1.column_name = ce2.column_name
    AND ce1.document_id < ce2.document_id
WHERE ce1.cleaned_value IS NOT NULL
    AND LENGTH(ce1.cleaned_value) > 3
GROUP BY ce1.document_id, ce2.document_id, ce1.column_name, ce1.cleaned_value
HAVING COUNT(*) > 5;

-- ============================================================================
-- CURATED SCHEMA - Production-ready reference data
-- ============================================================================

-- IMO vessel registry (authoritative vessel identification)
CREATE TABLE IF NOT EXISTS curated.imo_registry (
    imo_number VARCHAR(20) PRIMARY KEY,
    vessel_name VARCHAR(255),
    vessel_type VARCHAR(100),
    flag_state VARCHAR(100),
    gross_tonnage NUMERIC,
    year_built INTEGER,
    mmsi VARCHAR(20),
    call_sign VARCHAR(20),
    owner_name VARCHAR(500),
    operator_name VARCHAR(500),
    valid_from DATE,
    valid_to DATE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_source VARCHAR(200),
    confidence_score DECIMAL(3,2)
);

CREATE INDEX IF NOT EXISTS idx_imo_vessel_name ON curated.imo_registry(vessel_name);
CREATE INDEX IF NOT EXISTS idx_imo_mmsi ON curated.imo_registry(mmsi);
CREATE INDEX IF NOT EXISTS idx_imo_call_sign ON curated.imo_registry(call_sign);
CREATE INDEX IF NOT EXISTS idx_imo_flag ON curated.imo_registry(flag_state);
CREATE INDEX IF NOT EXISTS idx_imo_valid ON curated.imo_registry(valid_from, valid_to);

-- RFMO vessel registry (regional fisheries management organizations)
CREATE TABLE IF NOT EXISTS curated.rfmo_vessels (
    id BIGSERIAL PRIMARY KEY,
    rfmo_code VARCHAR(50) NOT NULL,
    registry_id VARCHAR(100),
    vessel_name VARCHAR(500),
    flag_state VARCHAR(100),
    imo_number VARCHAR(20),
    mmsi VARCHAR(20),
    call_sign VARCHAR(50),
    vessel_type VARCHAR(200),
    gear_type VARCHAR(500),
    length_overall NUMERIC,
    gross_tonnage NUMERIC,
    authorization_status VARCHAR(100),
    authorization_period DATERANGE,
    fishing_area TEXT[],
    port_of_registry VARCHAR(200),
    owner_name VARCHAR(500),
    operator_name VARCHAR(500),
    beneficial_owner VARCHAR(500),
    registration_date DATE,
    last_updated DATE,
    data_source VARCHAR(200),
    raw_data JSONB,
    UNIQUE(rfmo_code, registry_id)
);

CREATE INDEX IF NOT EXISTS idx_rfmo_name ON curated.rfmo_vessels(vessel_name);
CREATE INDEX IF NOT EXISTS idx_rfmo_imo ON curated.rfmo_vessels(imo_number);
CREATE INDEX IF NOT EXISTS idx_rfmo_mmsi ON curated.rfmo_vessels(mmsi);
CREATE INDEX IF NOT EXISTS idx_rfmo_flag ON curated.rfmo_vessels(flag_state);
CREATE INDEX IF NOT EXISTS idx_rfmo_rfmo ON curated.rfmo_vessels(rfmo_code);
CREATE INDEX IF NOT EXISTS idx_rfmo_auth ON curated.rfmo_vessels(authorization_status);
CREATE INDEX IF NOT EXISTS idx_rfmo_period ON curated.rfmo_vessels USING GIST(authorization_period);

-- Flag state registry (country vessel registrations)
CREATE TABLE IF NOT EXISTS curated.flag_registry (
    id BIGSERIAL PRIMARY KEY,
    flag_code VARCHAR(10),
    registry_number VARCHAR(100),
    vessel_name VARCHAR(500),
    vessel_type VARCHAR(200),
    imo_number VARCHAR(20),
    mmsi VARCHAR(20),
    call_sign VARCHAR(50),
    gross_tonnage NUMERIC,
    net_tonnage NUMERIC,
    deadweight NUMERIC,
    length_overall NUMERIC,
    beam NUMERIC,
    year_built INTEGER,
    shipyard VARCHAR(500),
    owner_name VARCHAR(500),
    operator_name VARCHAR(500),
    port_of_registry VARCHAR(200),
    registration_date DATE,
    expiry_date DATE,
    status VARCHAR(100),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_source VARCHAR(200),
    UNIQUE(flag_code, registry_number)
);

CREATE INDEX IF NOT EXISTS idx_flag_name ON curated.flag_registry(vessel_name);
CREATE INDEX IF NOT EXISTS idx_flag_imo ON curated.flag_registry(imo_number);
CREATE INDEX IF NOT EXISTS idx_flag_mmsi ON curated.flag_registry(mmsi);
CREATE INDEX IF NOT EXISTS idx_flag_flag ON curated.flag_registry(flag_code);
CREATE INDEX IF NOT EXISTS idx_flag_status ON curated.flag_registry(status);

-- ============================================================================
-- CURATED TEMPORAL EVENTS - Time-series vessel activities
-- ============================================================================

-- Port calls and arrivals
CREATE TABLE IF NOT EXISTS curated.port_events (
    id BIGSERIAL PRIMARY KEY,
    vessel_identifier VARCHAR(50),
    identifier_type VARCHAR(20), -- IMO, MMSI, etc.
    port_code VARCHAR(20),
    port_name VARCHAR(200),
    country_code VARCHAR(10),
    event_type VARCHAR(50), -- arrival, departure, berthing, anchoring
    event_time TIMESTAMP,
    reported_eta TIMESTAMP,
    reported_etd TIMESTAMP,
    terminal_name VARCHAR(200),
    berth_number VARCHAR(50),
    draft_arrival NUMERIC,
    draft_departure NUMERIC,
    cargo_type VARCHAR(200),
    cargo_volume NUMERIC,
    last_port VARCHAR(200),
    next_port VARCHAR(200),
    voyage_number VARCHAR(100),
    data_source VARCHAR(200),
    confidence_score DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_port_events_vessel ON curated.port_events(vessel_identifier, identifier_type);
CREATE INDEX IF NOT EXISTS idx_port_events_port ON curated.port_events(port_code, port_name);
CREATE INDEX IF NOT EXISTS idx_port_events_time ON curated.port_events(event_time);
CREATE INDEX IF NOT EXISTS idx_port_events_type ON curated.port_events(event_type);
CREATE INDEX IF NOT EXISTS idx_port_events_country ON curated.port_events(country_code);

-- Inspection records
CREATE TABLE IF NOT EXISTS curated.inspection_events (
    id BIGSERIAL PRIMARY KEY,
    vessel_identifier VARCHAR(50),
    identifier_type VARCHAR(20),
    inspection_id VARCHAR(100),
    inspection_type VARCHAR(100), -- PSC, FSC, MLC, ISPS, etc.
    inspection_date DATE,
    port_code VARCHAR(20),
    port_name VARCHAR(200),
    inspection_authority VARCHAR(200),
    deficiency_count INTEGER,
    detention BOOLEAN DEFAULT false,
    detention_days INTEGER,
    deficiency_codes TEXT[],
    deficiency_descriptions TEXT[],
    action_taken VARCHAR(500),
    next_inspection_due DATE,
    inspector_comments TEXT,
    data_source VARCHAR(200),
    report_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(inspection_id, data_source)
);

CREATE INDEX IF NOT EXISTS idx_inspection_vessel ON curated.inspection_events(vessel_identifier, identifier_type);
CREATE INDEX IF NOT EXISTS idx_inspection_date ON curated.inspection_events(inspection_date);
CREATE INDEX IF NOT EXISTS idx_inspection_port ON curated.inspection_events(port_code);
CREATE INDEX IF NOT EXISTS idx_inspection_detention ON curated.inspection_events(detention) WHERE detention = true;
CREATE INDEX IF NOT EXISTS idx_inspection_type ON curated.inspection_events(inspection_type);

-- Sanctions and compliance events
CREATE TABLE IF NOT EXISTS curated.compliance_events (
    id BIGSERIAL PRIMARY KEY,
    vessel_identifier VARCHAR(50),
    identifier_type VARCHAR(20),
    event_date DATE,
    event_type VARCHAR(100), -- sanction, blacklist, warning, clearance
    issuing_authority VARCHAR(200),
    reason TEXT,
    sanction_program VARCHAR(200),
    list_name VARCHAR(200),
    action_required TEXT,
    effective_date DATE,
    expiry_date DATE,
    status VARCHAR(50), -- active, expired, resolved
    resolution_date DATE,
    resolution_notes TEXT,
    data_source VARCHAR(200),
    reference_number VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compliance_vessel ON curated.compliance_events(vessel_identifier, identifier_type);
CREATE INDEX IF NOT EXISTS idx_compliance_date ON curated.compliance_events(event_date);
CREATE INDEX IF NOT EXISTS idx_compliance_type ON curated.compliance_events(event_type);
CREATE INDEX IF NOT EXISTS idx_compliance_status ON curated.compliance_events(status);
CREATE INDEX IF NOT EXISTS idx_compliance_authority ON curated.compliance_events(issuing_authority);

-- ============================================================================
-- CURATED VIEWS - Vessel Information
-- ============================================================================

-- Create type for GeoJSON point (if PostGIS not available, use JSON instead)
DO $$
BEGIN
    CREATE TYPE curated.geojson_point AS (
        type TEXT,
        coordinates NUMERIC[]
    );
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END$$;

-- Comprehensive vessel information view
CREATE OR REPLACE VIEW curated.vessel_info AS
WITH latest_imo AS (
    SELECT DISTINCT ON (imo_number)
        imo_number,
        vessel_name,
        vessel_type,
        flag_state,
        gross_tonnage::NUMERIC,
        year_built::INTEGER,
        mmsi,
        call_sign,
        owner_name,
        operator_name,
        last_updated
    FROM curated.imo_registry
    WHERE valid_to IS NULL OR valid_to > CURRENT_DATE
    ORDER BY imo_number, last_updated DESC
),
latest_rfmo AS (
    SELECT DISTINCT ON (imo_number)
        imo_number,
        rfmo_code,
        authorization_status,
        fishing_area,
        gear_type
    FROM curated.rfmo_vessels
    WHERE imo_number IS NOT NULL
    ORDER BY imo_number, last_updated DESC NULLS LAST
),
latest_flag AS (
    SELECT DISTINCT ON (imo_number)
        imo_number,
        flag_code,
        port_of_registry,
        status as flag_status
    FROM curated.flag_registry
    WHERE imo_number IS NOT NULL
    ORDER BY imo_number, last_updated DESC
),
recent_port AS (
    SELECT DISTINCT ON (vessel_identifier)
        vessel_identifier as imo_number,
        port_name as last_port,
        event_time as last_port_time,
        country_code as last_port_country
    FROM curated.port_events
    WHERE identifier_type = 'IMO'
        AND event_type IN ('arrival', 'departure')
        AND event_time > CURRENT_DATE - INTERVAL '6 months'
    ORDER BY vessel_identifier, event_time DESC
),
recent_inspection AS (
    SELECT DISTINCT ON (vessel_identifier)
        vessel_identifier as imo_number,
        inspection_date as last_inspection_date,
        inspection_type as last_inspection_type,
        deficiency_count,
        detention as last_detention
    FROM curated.inspection_events
    WHERE identifier_type = 'IMO'
    ORDER BY vessel_identifier, inspection_date DESC
),
active_sanctions AS (
    SELECT
        vessel_identifier as imo_number,
        COUNT(*) as active_sanction_count,
        ARRAY_AGG(DISTINCT issuing_authority) as sanctioning_authorities
    FROM curated.compliance_events
    WHERE identifier_type = 'IMO'
        AND status = 'active'
        AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
    GROUP BY vessel_identifier
)
SELECT
    -- Primary identifiers
    i.imo_number,
    i.vessel_name,
    i.mmsi,
    i.call_sign,

    -- Vessel characteristics
    i.vessel_type,
    i.flag_state,
    f.flag_code,
    i.gross_tonnage,
    i.year_built,

    -- Ownership
    i.owner_name,
    i.operator_name,

    -- Registration
    f.port_of_registry,
    f.flag_status,

    -- RFMO authorization
    r.rfmo_code,
    r.authorization_status,
    r.fishing_area,
    r.gear_type,

    -- Recent activity
    p.last_port,
    p.last_port_time,
    p.last_port_country,

    -- Compliance
    ins.last_inspection_date,
    ins.last_inspection_type,
    ins.deficiency_count,
    ins.last_detention,
    COALESCE(s.active_sanction_count, 0) as active_sanctions,
    s.sanctioning_authorities,

    -- Metadata
    i.last_updated,
    CASE
        WHEN s.active_sanction_count > 0 THEN 'high_risk'
        WHEN ins.last_detention = true THEN 'medium_risk'
        WHEN ins.deficiency_count > 5 THEN 'medium_risk'
        ELSE 'low_risk'
    END as risk_level
FROM latest_imo i
LEFT JOIN latest_rfmo r ON i.imo_number = r.imo_number
LEFT JOIN latest_flag f ON i.imo_number = f.imo_number
LEFT JOIN recent_port p ON i.imo_number = p.imo_number
LEFT JOIN recent_inspection ins ON i.imo_number = ins.imo_number
LEFT JOIN active_sanctions s ON i.imo_number = s.imo_number;

-- ============================================================================
-- LABEL SCHEMA - Label Studio integration
-- ============================================================================

-- Label Studio project mapping
CREATE TABLE IF NOT EXISTS label.projects (
    id BIGSERIAL PRIMARY KEY,
    ls_project_id INTEGER UNIQUE NOT NULL,
    project_title VARCHAR(500),
    project_description TEXT,
    document_type VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Label Studio task mapping
CREATE TABLE IF NOT EXISTS label.tasks (
    id BIGSERIAL PRIMARY KEY,
    ls_task_id INTEGER UNIQUE NOT NULL,
    ls_project_id INTEGER REFERENCES label.projects(ls_project_id),
    document_id BIGINT REFERENCES stage.documents(id),
    task_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_label_tasks_project ON label.tasks(ls_project_id);
CREATE INDEX IF NOT EXISTS idx_label_tasks_document ON label.tasks(document_id);

-- Label Studio annotations
CREATE TABLE IF NOT EXISTS label.annotations (
    id BIGSERIAL PRIMARY KEY,
    ls_annotation_id INTEGER UNIQUE NOT NULL,
    ls_task_id INTEGER REFERENCES label.tasks(ls_task_id),
    annotation_data JSONB,
    annotation_result JSONB,
    annotator VARCHAR(200),
    confidence DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_label_annotations_task ON label.annotations(ls_task_id);
CREATE INDEX IF NOT EXISTS idx_label_annotations_annotator ON label.annotations(annotator);

-- ============================================================================
-- RAW SCHEMA - Unprocessed source data
-- ============================================================================

-- Raw CSV imports
CREATE TABLE IF NOT EXISTS raw.csv_imports (
    id BIGSERIAL PRIMARY KEY,
    source_file VARCHAR(500),
    source_url TEXT,
    import_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    row_count INTEGER,
    column_count INTEGER,
    headers TEXT[],
    raw_data JSONB,
    processing_status VARCHAR(50),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_csv_timestamp ON raw.csv_imports(import_timestamp);
CREATE INDEX IF NOT EXISTS idx_raw_csv_status ON raw.csv_imports(processing_status);

-- Raw API responses
CREATE TABLE IF NOT EXISTS raw.api_responses (
    id BIGSERIAL PRIMARY KEY,
    api_endpoint TEXT,
    request_method VARCHAR(20),
    request_params JSONB,
    response_code INTEGER,
    response_headers JSONB,
    response_body JSONB,
    request_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processing_status VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_raw_api_timestamp ON raw.api_responses(request_timestamp);
CREATE INDEX IF NOT EXISTS idx_raw_api_endpoint ON raw.api_responses(api_endpoint);

-- ============================================================================
-- DEFAULT CLEANING RULES
-- ============================================================================

-- Insert some default cleaning rules
INSERT INTO stage.cleaning_rules (rule_name, rule_type, applies_to_columns, pattern, replacement, confidence, priority)
VALUES
    ('trim_whitespace', 'regex_replace', ARRAY['*'], '^\s+|\s+$', '', 0.95, 10),
    ('normalize_imo', 'regex_replace', ARRAY['imo_number', 'imo', 'imo_no'], '^IMO\s*', '', 0.95, 20),
    ('normalize_mmsi', 'regex_replace', ARRAY['mmsi'], '[^0-9]', '', 0.9, 30),
    ('uppercase_callsign', 'format_standardizer', ARRAY['call_sign', 'callsign', 'ircs'], '{"format":"uppercase"}', NULL, 0.9, 40),
    ('validate_imo_format', 'validator', ARRAY['imo_number', 'imo'], '^\d{7}$', NULL, 0.85, 50)
ON CONFLICT (rule_name) DO NOTHING;

-- ============================================================================
-- PERMISSIONS (if not superuser, may fail - that's OK)
-- ============================================================================

-- Grant usage on schemas
GRANT USAGE ON SCHEMA control, raw, stage, label, curated TO PUBLIC;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA control TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA raw TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stage TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA label TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA curated TO PUBLIC;

-- Grant sequence permissions
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA control TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA raw TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA stage TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA label TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA curated TO PUBLIC;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE 'Consolidated schema creation completed successfully';
    RAISE NOTICE 'Schemas created: control, raw, stage, label, curated';
    RAISE NOTICE 'All tables, indexes, and views have been created';
END$$;
