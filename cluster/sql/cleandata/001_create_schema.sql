-- Oceanid Cleaned Data Schema
-- Database: labelfish (Crunchy Bridge Ebisu cluster)
-- Schema: cleandata
-- Purpose: Store ML-cleaned vessel registry data from RFMOs with JSONB for flexibility

-- Create dedicated schema for cleaned data (separate from Label Studio tables)
CREATE SCHEMA IF NOT EXISTS cleandata;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Set search path to use cleandata schema
SET search_path TO cleandata, public;

-- Enum for data source types
CREATE TYPE data_source_type AS ENUM (
    'CCSBT',   -- Commission for the Conservation of Southern Bluefin Tuna
    'FFA',     -- Pacific Islands Forum Fisheries Agency
    'IATTC',   -- Inter-American Tropical Tuna Commission
    'ICCAT',   -- International Commission for the Conservation of Atlantic Tunas
    'IOTC',    -- Indian Ocean Tuna Commission
    'NAFO',    -- Northwest Atlantic Fisheries Organization
    'NEAFC',   -- North East Atlantic Fisheries Commission
    'NPFC',    -- North Pacific Fisheries Commission
    'PNA',     -- Parties to the Nauru Agreement
    'SEAFO',   -- South East Atlantic Fisheries Organisation
    'SPRFMO',  -- South Pacific Regional Fisheries Management Organisation
    'WCPFC'    -- Western and Central Pacific Fisheries Commission
);

-- Enum for processing status
CREATE TYPE processing_status AS ENUM (
    'raw',           -- Initial upload, no processing
    'extracted',     -- Data extracted from PDF/Excel
    'cleaned',       -- ML cleaning applied
    'validated',     -- Human validation complete
    'published'      -- Ready for production use
);

-- Core table: Cleaned vessel records
-- Uses JSONB for flexible schema across different RFMO formats
CREATE TABLE vessels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Source metadata
    source data_source_type NOT NULL,
    source_file TEXT NOT NULL,                    -- Original filename
    source_date DATE NOT NULL,                     -- Date of source data

    -- Processing metadata
    status processing_status DEFAULT 'raw' NOT NULL,
    extracted_at TIMESTAMPTZ,                      -- When PDF/Excel extraction completed
    cleaned_at TIMESTAMPTZ,                        -- When ML cleaning completed
    validated_at TIMESTAMPTZ,                      -- When human validation completed
    published_at TIMESTAMPTZ,                      -- When marked ready for production

    -- Data payload (JSONB for flexibility)
    raw_data JSONB NOT NULL,                       -- Original extracted data
    cleaned_data JSONB,                            -- ML-cleaned data
    validation_data JSONB,                         -- Human corrections/annotations

    -- Normalized fields (for common queries)
    vessel_name TEXT,
    imo_number TEXT,
    call_sign TEXT,
    flag_state TEXT,

    -- Change tracking
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_by TEXT,                               -- User/service that created record
    updated_by TEXT,                               -- User/service that last updated

    -- Versioning
    version INTEGER DEFAULT 1 NOT NULL,
    previous_version_id UUID REFERENCES vessels(id),

    -- Constraints
    CONSTRAINT vessels_imo_format CHECK (
        imo_number IS NULL OR
        imo_number ~ '^IMO\s*\d{7}$' OR
        imo_number ~ '^\d{7}$'
    )
);

-- Change history table for audit trail
CREATE TABLE vessel_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,

    -- What changed
    changed_fields JSONB NOT NULL,                 -- Fields that changed: {"field": {"old": "...", "new": "..."}}
    change_type TEXT NOT NULL,                     -- 'create', 'update', 'validate', 'publish'

    -- Who and when
    changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    changed_by TEXT NOT NULL,

    -- Context
    change_reason TEXT,                            -- Optional: why the change was made
    label_studio_task_id INTEGER,                 -- Link to Label Studio annotation task

    -- Snapshot
    data_snapshot JSONB NOT NULL                   -- Full data at time of change
);

-- ML training data: Store annotations from Label Studio
CREATE TABLE ml_annotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,

    -- Label Studio metadata
    task_id INTEGER NOT NULL,
    annotation_id INTEGER NOT NULL,
    annotator TEXT NOT NULL,

    -- Annotation data
    annotations JSONB NOT NULL,                    -- Full Label Studio annotation JSON
    ground_truth BOOLEAN DEFAULT FALSE,            -- Is this a verified ground truth?

    -- Quality metrics
    confidence_score DECIMAL(3,2),                 -- 0.00-1.00
    review_status TEXT,                            -- 'pending', 'approved', 'rejected'
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT ml_annotations_confidence CHECK (
        confidence_score IS NULL OR
        (confidence_score >= 0 AND confidence_score <= 1)
    )
);

-- Statistics table for data quality tracking
CREATE TABLE data_quality_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source data_source_type NOT NULL,
    source_file TEXT NOT NULL,

    -- Quality metrics
    total_records INTEGER NOT NULL,
    complete_records INTEGER,                      -- All required fields present
    imo_present INTEGER,                           -- Records with IMO numbers
    duplicates_found INTEGER,                      -- Duplicate records identified
    validation_errors JSONB,                       -- Validation errors by field

    -- Processing stats
    processing_time_ms INTEGER,                    -- Time to process file
    ml_corrections INTEGER,                        -- Number of ML corrections applied
    human_corrections INTEGER,                     -- Number of human corrections

    computed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_vessels_source ON vessels(source);
CREATE INDEX idx_vessels_status ON vessels(status);
CREATE INDEX idx_vessels_source_date ON vessels(source_date);
CREATE INDEX idx_vessels_imo ON vessels(imo_number) WHERE imo_number IS NOT NULL;
CREATE INDEX idx_vessels_call_sign ON vessels(call_sign) WHERE call_sign IS NOT NULL;
CREATE INDEX idx_vessels_flag_state ON vessels(flag_state) WHERE flag_state IS NOT NULL;

-- GIN indexes for JSONB queries
CREATE INDEX idx_vessels_raw_data ON vessels USING GIN(raw_data);
CREATE INDEX idx_vessels_cleaned_data ON vessels USING GIN(cleaned_data);
CREATE INDEX idx_vessels_validation_data ON vessels USING GIN(validation_data);

-- Indexes for change tracking
CREATE INDEX idx_vessel_changes_vessel_id ON vessel_changes(vessel_id);
CREATE INDEX idx_vessel_changes_changed_at ON vessel_changes(changed_at DESC);
CREATE INDEX idx_vessel_changes_type ON vessel_changes(change_type);

-- Indexes for ML annotations
CREATE INDEX idx_ml_annotations_vessel_id ON ml_annotations(vessel_id);
CREATE INDEX idx_ml_annotations_task_id ON ml_annotations(task_id);
CREATE INDEX idx_ml_annotations_ground_truth ON ml_annotations(ground_truth) WHERE ground_truth = TRUE;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vessels_updated_at
    BEFORE UPDATE ON vessels
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to log changes to vessel_changes table
CREATE OR REPLACE FUNCTION log_vessel_changes()
RETURNS TRIGGER AS $$
DECLARE
    changed_fields JSONB := '{}'::JSONB;
BEGIN
    -- Track field changes
    IF TG_OP = 'UPDATE' THEN
        IF OLD.raw_data IS DISTINCT FROM NEW.raw_data THEN
            changed_fields := jsonb_set(changed_fields, '{raw_data}', jsonb_build_object('old', OLD.raw_data, 'new', NEW.raw_data));
        END IF;
        IF OLD.cleaned_data IS DISTINCT FROM NEW.cleaned_data THEN
            changed_fields := jsonb_set(changed_fields, '{cleaned_data}', jsonb_build_object('old', OLD.cleaned_data, 'new', NEW.cleaned_data));
        END IF;
        IF OLD.validation_data IS DISTINCT FROM NEW.validation_data THEN
            changed_fields := jsonb_set(changed_fields, '{validation_data}', jsonb_build_object('old', OLD.validation_data, 'new', NEW.validation_data));
        END IF;
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            changed_fields := jsonb_set(changed_fields, '{status}', jsonb_build_object('old', to_jsonb(OLD.status::TEXT), 'new', to_jsonb(NEW.status::TEXT)));
        END IF;

        -- Log change if any fields changed
        IF changed_fields != '{}'::JSONB THEN
            INSERT INTO vessel_changes (
                vessel_id,
                changed_fields,
                change_type,
                changed_by,
                data_snapshot
            ) VALUES (
                NEW.id,
                changed_fields,
                CASE
                    WHEN NEW.status = 'validated' AND OLD.status != 'validated' THEN 'validate'
                    WHEN NEW.status = 'published' AND OLD.status != 'published' THEN 'publish'
                    ELSE 'update'
                END,
                COALESCE(NEW.updated_by, 'system'),
                to_jsonb(NEW)
            );
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO vessel_changes (
            vessel_id,
            changed_fields,
            change_type,
            changed_by,
            data_snapshot
        ) VALUES (
            NEW.id,
            '{}'::JSONB,
            'create',
            COALESCE(NEW.created_by, 'system'),
            to_jsonb(NEW)
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vessels_log_changes
    AFTER INSERT OR UPDATE ON vessels
    FOR EACH ROW
    EXECUTE FUNCTION log_vessel_changes();

-- Grant permissions (assuming application user 'oceanid_app')
-- Note: Create this user if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'oceanid_app') THEN
        CREATE ROLE oceanid_app WITH LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA cleandata TO oceanid_app;
GRANT USAGE ON SCHEMA cleandata TO u_ogfzdegyvvaj3g4iyuvlu5yxmi;  -- Database owner
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA cleandata TO oceanid_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA cleandata TO u_ogfzdegyvvaj3g4iyuvlu5yxmi;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cleandata TO oceanid_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cleandata TO u_ogfzdegyvvaj3g4iyuvlu5yxmi;
ALTER DEFAULT PRIVILEGES IN SCHEMA cleandata GRANT SELECT, INSERT, UPDATE ON TABLES TO oceanid_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA cleandata GRANT USAGE, SELECT ON SEQUENCES TO oceanid_app;

-- Comments for documentation
COMMENT ON TABLE vessels IS 'Core vessel registry data with JSONB for flexible schema across RFMOs';
COMMENT ON TABLE vessel_changes IS 'Audit trail for all changes to vessel records';
COMMENT ON TABLE ml_annotations IS 'ML training data from Label Studio annotations';
COMMENT ON TABLE data_quality_metrics IS 'Data quality statistics per source file';

COMMENT ON COLUMN vessels.raw_data IS 'Original extracted data from PDF/CSV/Excel';
COMMENT ON COLUMN vessels.cleaned_data IS 'ML-processed and normalized data';
COMMENT ON COLUMN vessels.validation_data IS 'Human corrections and annotations from Label Studio';
COMMENT ON COLUMN vessels.previous_version_id IS 'Link to previous version for change tracking';
