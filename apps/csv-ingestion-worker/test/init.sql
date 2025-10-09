-- Create stage schema for testing
CREATE SCHEMA IF NOT EXISTS stage;

-- Documents table
CREATE TABLE IF NOT EXISTS stage.documents (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT UNIQUE,
    file_name TEXT NOT NULL,
    source_type TEXT,
    source_name TEXT,
    org_id TEXT,
    doc_type TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CSV extractions table
CREATE TABLE IF NOT EXISTS stage.csv_extractions (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES stage.documents(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    column_name TEXT NOT NULL,
    raw_value TEXT,
    cleaned_value TEXT,
    confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
    rule_chain BIGINT[],
    needs_review BOOLEAN DEFAULT false,
    similarity NUMERIC(4,3),
    source_type TEXT,
    source_name TEXT,
    review_status TEXT CHECK (review_status IN ('pending', 'approved', 'rejected', 'corrected')),
    reviewer_id TEXT,
    reviewed_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    promotion_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cleaning rules table
CREATE TABLE IF NOT EXISTS stage.cleaning_rules (
    id BIGSERIAL PRIMARY KEY,
    rule_name TEXT NOT NULL,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('regex_replace', 'field_merger', 'validator', 'type_coercion', 'format_standardizer')),
    pattern TEXT,
    replacement TEXT,
    priority INTEGER DEFAULT 100,
    confidence NUMERIC(3,2) DEFAULT 0.80,
    source_type TEXT,
    source_name TEXT,
    column_name TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document processing log
CREATE TABLE IF NOT EXISTS stage.document_processing_log (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES stage.documents(id) ON DELETE CASCADE,
    task_id BIGINT,
    processing_status TEXT,
    processing_stage TEXT,
    processing_metrics JSONB,
    rows_processed INTEGER,
    confidence_avg NUMERIC(4,3),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event log for webhooks
CREATE TABLE IF NOT EXISTS stage.event_log (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_action TEXT,
    task_id BIGINT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Training corpus for ML
CREATE TABLE IF NOT EXISTS stage.training_corpus (
    id BIGSERIAL PRIMARY KEY,
    extraction_id BIGINT REFERENCES stage.csv_extractions(id),
    raw_value TEXT NOT NULL,
    corrected_value TEXT NOT NULL,
    correction_type TEXT,
    context_before TEXT,
    context_after TEXT,
    column_name TEXT,
    source_type TEXT,
    difficulty_rating INTEGER CHECK (difficulty_rating >= 1 AND difficulty_rating <= 5),
    training_split TEXT CHECK (training_split IN ('train', 'validation', 'test')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_csv_extractions_document_id ON stage.csv_extractions(document_id);
CREATE INDEX idx_csv_extractions_needs_review ON stage.csv_extractions(needs_review) WHERE needs_review = true;
CREATE INDEX idx_csv_extractions_confidence ON stage.csv_extractions(confidence);
CREATE INDEX idx_cleaning_rules_active ON stage.cleaning_rules(is_active, priority) WHERE is_active = true;
CREATE INDEX idx_cleaning_rules_source ON stage.cleaning_rules(source_type, column_name) WHERE is_active = true;

-- Insert sample cleaning rules for vessel data
INSERT INTO stage.cleaning_rules (rule_name, rule_type, pattern, replacement, priority, confidence, source_type, column_name) VALUES
-- Global rules (apply to all sources)
('Remove Extra Spaces', 'regex_replace', '\s+', ' ', 10, 0.95, 'GLOBAL', NULL),
('Remove Leading/Trailing Quotes', 'regex_replace', '^["'']|["'']$', '', 20, 0.90, 'GLOBAL', NULL),
('Fix Escaped Quotes', 'regex_replace', '\\["'']', '"', 30, 0.85, 'GLOBAL', NULL),

-- Vessel name specific rules
('Standardize Vessel Prefix', 'regex_replace', '^(M/V|MV|F/V|FV|S/V|SV)\s+', '', 40, 0.88, 'GLOBAL', 'VESSEL_NAME'),
('Fix Common Misspellings', 'regex_replace', 'VESSLE', 'VESSEL', 50, 0.92, 'GLOBAL', 'VESSEL_NAME'),
('Remove Special Characters', 'regex_replace', '[^\w\s\-\.]', '', 60, 0.75, 'GLOBAL', 'VESSEL_NAME'),

-- IMO number rules
('Extract IMO Number', 'regex_replace', '.*?(IMO\s*)?(\d{7}).*', '$2', 70, 0.98, 'GLOBAL', 'IMO'),
('Validate IMO Format', 'validator', '^\d{7}$', NULL, 80, 0.99, 'GLOBAL', 'IMO'),

-- Date formatting rules
('Standardize Date Format', 'type_coercion', '{"type": "date"}', NULL, 90, 0.85, 'GLOBAL', 'DATE'),

-- Flag state rules
('Uppercase Flag', 'format_standardizer', '{"format": "uppercase"}', NULL, 100, 0.95, 'GLOBAL', 'FLAG'),
('Fix Common Flag Codes', 'regex_replace', '^USA$', 'US', 110, 0.98, 'GLOBAL', 'FLAG'),
('Fix Common Flag Codes 2', 'regex_replace', '^GBR$', 'GB', 111, 0.98, 'GLOBAL', 'FLAG'),

-- Source-specific rules (example for RFMO data)
('RFMO Vessel Format', 'regex_replace', '^\[RFMO\]\s*', '', 40, 0.90, 'RFMO', 'VESSEL_NAME'),
('RFMO Date Format', 'regex_replace', '(\d{2})/(\d{2})/(\d{4})', '$3-$1-$2', 85, 0.88, 'RFMO', 'DATE');

-- Create a view for review queue
CREATE OR REPLACE VIEW stage.v_review_queue AS
SELECT
    e.id,
    e.document_id,
    d.file_name,
    e.row_index,
    e.column_name,
    e.raw_value,
    e.cleaned_value,
    e.confidence,
    e.source_type,
    e.source_name,
    e.created_at,
    CASE
        WHEN e.confidence < 0.6 THEN 'high'
        WHEN e.confidence < 0.8 THEN 'medium'
        ELSE 'low'
    END as priority
FROM stage.csv_extractions e
JOIN stage.documents d ON e.document_id = d.id
WHERE e.needs_review = true
  AND e.review_status IS NULL
ORDER BY e.confidence ASC, e.created_at ASC;

-- Create a view for auto-promotable data
CREATE OR REPLACE VIEW stage.v_auto_promotable AS
SELECT
    e.*,
    d.file_name,
    d.org_id,
    d.doc_type
FROM stage.csv_extractions e
JOIN stage.documents d ON e.document_id = d.id
WHERE e.confidence >= 0.95
  AND (e.review_status = 'approved' OR e.confidence >= 0.98)
  AND e.promoted_at IS NULL;

-- Create a view for processing statistics
CREATE OR REPLACE VIEW stage.v_document_processing_stats AS
WITH rule_counts AS (
    SELECT
        document_id,
        COUNT(DISTINCT rule_id) as unique_rules
    FROM stage.csv_extractions,
         LATERAL unnest(rule_chain) as rule_id
    GROUP BY document_id
)
SELECT
    d.id as document_id,
    d.file_name,
    d.source_type,
    d.created_at,
    COUNT(e.id) as total_cells,
    COUNT(CASE WHEN e.needs_review THEN 1 END) as cells_needing_review,
    AVG(e.confidence) as avg_confidence,
    MIN(e.confidence) as min_confidence,
    MAX(e.confidence) as max_confidence,
    COUNT(DISTINCT e.column_name) as unique_columns,
    COALESCE(rc.unique_rules, 0) as unique_rules_applied
FROM stage.documents d
LEFT JOIN stage.csv_extractions e ON d.id = e.document_id
LEFT JOIN rule_counts rc ON d.id = rc.document_id
GROUP BY d.id, d.file_name, d.source_type, d.created_at, rc.unique_rules;
