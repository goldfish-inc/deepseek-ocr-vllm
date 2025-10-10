-- Emergency Schema Patch for CSV Ingestion Worker
-- Adds missing columns to match worker code expectations
-- Run against cleandata database to unblock pod crashes
--
-- Background: The consolidated schema used arrays (applies_to_*) and 'active',
-- but the Go worker expects scalar columns (source_type, source_name, column_name, is_active)
-- This patch adds compatibility columns to allow the worker to start.

BEGIN;

-- 1. Fix stage.cleaning_rules - Add columns worker expects
ALTER TABLE stage.cleaning_rules
ADD COLUMN IF NOT EXISTS source_type TEXT,
ADD COLUMN IF NOT EXISTS source_name TEXT,
ADD COLUMN IF NOT EXISTS column_name TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN GENERATED ALWAYS AS (active) STORED;

-- 2. Fix stage.document_processing_log - Add missing columns
ALTER TABLE stage.document_processing_log
ADD COLUMN IF NOT EXISTS processing_stage TEXT,
ADD COLUMN IF NOT EXISTS processing_metrics JSONB;

-- 3. Fix stage.csv_extractions - Add review_status for worker
ALTER TABLE stage.csv_extractions
ADD COLUMN IF NOT EXISTS review_status TEXT;

-- 4. Seed at least one cleaning rule so /health endpoint passes
-- (Health check requires rules to be loaded to return 200)
INSERT INTO stage.cleaning_rules (
    rule_name,
    rule_type,
    pattern,
    replacement,
    confidence,
    priority,
    active,
    applies_to_columns,
    applies_to_sources
) VALUES (
    'trim_whitespace',
    'format_standardizer',
    '{"format":"trim"}',
    NULL,
    0.95,
    10,
    true,
    ARRAY['*'],  -- Apply to all columns
    ARRAY['GLOBAL']  -- Apply to all sources
)
ON CONFLICT (rule_name) DO NOTHING;

COMMIT;

-- Verification queries
SELECT
    'cleaning_rules columns' AS table_check,
    COUNT(*) FILTER (WHERE column_name = 'source_type') AS has_source_type,
    COUNT(*) FILTER (WHERE column_name = 'is_active') AS has_is_active
FROM information_schema.columns
WHERE table_schema = 'stage' AND table_name = 'cleaning_rules';

SELECT
    'cleaning_rules seed' AS data_check,
    COUNT(*) AS rule_count
FROM stage.cleaning_rules;

SELECT
    'document_processing_log columns' AS table_check,
    COUNT(*) FILTER (WHERE column_name = 'processing_stage') AS has_processing_stage
FROM information_schema.columns
WHERE table_schema = 'stage' AND table_name = 'document_processing_log';

SELECT
    'csv_extractions columns' AS table_check,
    COUNT(*) FILTER (WHERE column_name = 'review_status') AS has_review_status
FROM information_schema.columns
WHERE table_schema = 'stage' AND table_name = 'csv_extractions';
