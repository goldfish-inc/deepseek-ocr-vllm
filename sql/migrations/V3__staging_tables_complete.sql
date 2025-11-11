-- V3: Complete Staging Schema (Missing Tables from CURRENT_STATE.md)
-- Created: 2025-09-30
-- Depends on: V1__staging_baseline.sql
-- Purpose: Add missing staging tables for ML-powered CSV cleaning pipeline

-- =============================================================================
-- CLEANING RULES (Knowledge Base from Legacy Pandas Scripts)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stage.cleaning_rules (
  id bigserial PRIMARY KEY,

  -- Rule identification
  rule_name text UNIQUE NOT NULL,
  rule_type text NOT NULL,  -- 'field_merger' | 'regex_replace' | 'validator' | 'type_coercion' | 'format_standardizer'

  -- Source context
  source_type text,  -- 'COUNTRY' | 'RFMO' | 'VESSEL_TYPE' | 'GENERIC'
  source_name text,  -- Specific source like 'SEAFO' | 'CCAMLR'

  -- Rule definition
  pattern text,  -- Regex or match pattern
  replacement text,  -- Replacement value or template
  condition jsonb,  -- Additional conditions (e.g., column filters, row conditions)

  -- Execution control
  priority int DEFAULT 100,  -- Lower = earlier execution (1-1000)
  enabled boolean DEFAULT true,

  -- Provenance
  extracted_from_script text,  -- e.g., 'clean_all_vessel_types.py:24'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Metadata
  description text,
  examples jsonb,  -- Example transformations for documentation

  -- Usage tracking
  times_applied bigint DEFAULT 0,
  last_applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_cleaning_rules_type ON stage.cleaning_rules(rule_type);
CREATE INDEX IF NOT EXISTS ix_cleaning_rules_source ON stage.cleaning_rules(source_type, source_name);
CREATE INDEX IF NOT EXISTS ix_cleaning_rules_priority ON stage.cleaning_rules(priority) WHERE enabled = true;

COMMENT ON TABLE stage.cleaning_rules IS 'Knowledge base extracted from legacy pandas cleaning scripts. Applied by CSV ingestion worker in priority order.';
COMMENT ON COLUMN stage.cleaning_rules.rule_type IS 'Type of transformation: field_merger (combine columns), regex_replace (pattern substitution), validator (check integrity), type_coercion (cast to proper type), format_standardizer (normalize format)';
COMMENT ON COLUMN stage.cleaning_rules.priority IS 'Execution order: 1-50 (preprocessing), 51-100 (main cleaning), 101-150 (validation), 151-200 (postprocessing)';
COMMENT ON COLUMN stage.cleaning_rules.condition IS 'JSONB conditions like {"column": "VESSEL_TYPE", "value_contains": "FISHING"}';

-- =============================================================================
-- CSV EXTRACTIONS (Cell-Level Raw vs Cleaned Values)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stage.csv_extractions (
  id bigserial PRIMARY KEY,

  -- Document reference
  document_id bigint NOT NULL REFERENCES stage.documents(id) ON DELETE CASCADE,

  -- Cell location
  row_index int NOT NULL,
  column_name text NOT NULL,

  -- Values
  raw_value text,  -- Original value from CSV
  cleaned_value text,  -- After cleaning rules applied

  -- Cleaning provenance
  rule_id bigint REFERENCES stage.cleaning_rules(id) ON DELETE SET NULL,
  rule_chain jsonb,  -- Array of rule IDs applied in order: [12, 34, 56]

  -- Confidence scoring
  confidence double precision,  -- 0.0-1.0 confidence in cleaning
  similarity_score double precision,  -- String similarity between raw and cleaned (Levenshtein/Jaro-Winkler)

  -- Review workflow
  needs_review boolean DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  review_status text,  -- 'approved' | 'rejected' | 'corrected'

  -- Extraction metadata
  extraction_method text,  -- 'rule_based' | 'ml_model' | 'manual'
  model_version text,  -- e.g., 'csv-repair-bert-v1'

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Constraints
  UNIQUE (document_id, row_index, column_name)
);

CREATE INDEX IF NOT EXISTS ix_csv_extractions_doc ON stage.csv_extractions(document_id);
CREATE INDEX IF NOT EXISTS ix_csv_extractions_needs_review ON stage.csv_extractions(needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS ix_csv_extractions_confidence ON stage.csv_extractions(confidence) WHERE confidence < 0.85;
CREATE INDEX IF NOT EXISTS ix_csv_extractions_rule ON stage.csv_extractions(rule_id);

COMMENT ON TABLE stage.csv_extractions IS 'Cell-level tracking of CSV cleaning transformations. Records raw → cleaned value pairs with confidence scores for ML training and human review.';
COMMENT ON COLUMN stage.csv_extractions.confidence IS 'ML model confidence in cleaning (0.0-1.0). Values <0.85 flagged for review.';
COMMENT ON COLUMN stage.csv_extractions.similarity_score IS 'String distance between raw and cleaned. High scores (>0.9) indicate minor changes, low scores (<0.5) indicate major transformations needing review.';
COMMENT ON COLUMN stage.csv_extractions.rule_chain IS 'Ordered list of cleaning rule IDs applied to transform raw_value → cleaned_value. Enables replay and debugging.';

-- =============================================================================
-- TRAINING CORPUS (Human Corrections for ML Retraining)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stage.training_corpus (
  id bigserial PRIMARY KEY,

  -- Source extraction
  extraction_id bigint REFERENCES stage.csv_extractions(id) ON DELETE CASCADE,

  -- Training example
  original_value text NOT NULL,  -- What model/rules produced
  corrected_value text NOT NULL,  -- Human correction
  correction_type text NOT NULL,  -- 'value_fix' | 'format_fix' | 'type_fix' | 'false_positive' | 'false_negative'

  -- Annotation provenance
  annotator text NOT NULL,  -- Email or user ID from Argilla/Oceanid reviewer
  annotated_at timestamptz DEFAULT now(),
  annotation_source text,  -- 'argilla' | 'direct_review' | 'batch_import'

  -- Context for training
  context_before text,  -- Surrounding text/cells for context-aware models
  context_after text,
  column_type text,  -- 'VESSEL_NAME' | 'IMO' | 'FLAG' | etc.

  -- Quality metadata
  difficulty_rating int,  -- 1-5 (annotator assessment of difficulty)
  inter_annotator_agreement double precision,  -- If multiple annotators reviewed

  -- Training usage
  used_in_training_run text,  -- e.g., 'csv-repair-bert-v2-20250930'
  training_split text,  -- 'train' | 'validation' | 'test'

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_training_corpus_extraction ON stage.training_corpus(extraction_id);
CREATE INDEX IF NOT EXISTS ix_training_corpus_type ON stage.training_corpus(correction_type);
CREATE INDEX IF NOT EXISTS ix_training_corpus_column ON stage.training_corpus(column_type);
CREATE INDEX IF NOT EXISTS ix_training_corpus_annotator ON stage.training_corpus(annotator);
CREATE INDEX IF NOT EXISTS ix_training_corpus_split ON stage.training_corpus(training_split);

COMMENT ON TABLE stage.training_corpus IS 'Human corrections from Argilla/Oceanid reviewers for ML retraining. Each row is a training example showing original → corrected value pair with context.';
COMMENT ON COLUMN stage.training_corpus.correction_type IS 'Classification of correction: value_fix (wrong value), format_fix (right value, wrong format), type_fix (wrong data type), false_positive (should not have been extracted), false_negative (should have been extracted but was not)';
COMMENT ON COLUMN stage.training_corpus.difficulty_rating IS 'Annotator-assessed difficulty (1=trivial, 5=expert judgment required). Used for curriculum learning and active learning sampling.';

-- =============================================================================
-- DOCUMENT PROCESSING LOG (Version History & State Transitions)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stage.document_processing_log (
  id bigserial PRIMARY KEY,

  -- Document reference
  document_id bigint NOT NULL REFERENCES stage.documents(id) ON DELETE CASCADE,

  -- State transition
  from_state text,  -- 'uploaded' | 'parsed' | 'cleaned' | 'reviewed' | 'promoted' | 'rejected'
  to_state text NOT NULL,

  -- Processing metadata
  processor text,  -- Service/worker that performed transition
  processor_version text,  -- e.g., 'csv-ingestion-worker-v1.2.3'
  processing_duration_ms bigint,  -- Time taken for this step

  -- Results
  success boolean NOT NULL,
  error_message text,
  error_details jsonb,

  -- Metrics for this processing step
  metrics jsonb,  -- e.g., {"rows_processed": 1234, "cells_cleaned": 5678, "confidence_avg": 0.92}

  -- Provenance
  triggered_by text,  -- 'scheduled_job' | 'manual_trigger' | 'api_request' | user_email
  triggered_at timestamptz DEFAULT now(),

  -- Version tracking
  input_snapshot_id text,  -- Reference to versioned input (e.g., Git SHA, S3 version ID)
  output_snapshot_id text,  -- Reference to versioned output

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_doc_processing_log_document ON stage.document_processing_log(document_id);
CREATE INDEX IF NOT EXISTS ix_doc_processing_log_state ON stage.document_processing_log(to_state);
CREATE INDEX IF NOT EXISTS ix_doc_processing_log_success ON stage.document_processing_log(success);
CREATE INDEX IF NOT EXISTS ix_doc_processing_log_time ON stage.document_processing_log(triggered_at DESC);

COMMENT ON TABLE stage.document_processing_log IS 'Audit trail of document processing state transitions. Enables replay, debugging, and performance monitoring.';
COMMENT ON COLUMN stage.document_processing_log.metrics IS 'Processing-specific metrics as JSONB. Examples: row counts, extraction counts, average confidence, processing speed.';
COMMENT ON COLUMN stage.document_processing_log.input_snapshot_id IS 'Immutable reference to input version (Git SHA, S3 version, etc.) for reproducibility.';

-- =============================================================================
-- PROMOTION LOG (Stage → Curated Audit Trail)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stage.promotion_log (
  id bigserial PRIMARY KEY,

  -- Source document
  document_id bigint NOT NULL REFERENCES stage.documents(id) ON DELETE CASCADE,

  -- Promotion metadata
  promoted_at timestamptz DEFAULT now(),
  promoted_by text NOT NULL,  -- User or service that approved promotion
  promotion_type text NOT NULL,  -- 'full_document' | 'partial_entities' | 'corrections_only'

  -- Target in curated schema
  target_table text NOT NULL,  -- e.g., 'curated.vessels'
  target_ids jsonb NOT NULL,  -- e.g., {"vessel_ids": [123, 456], "authorization_ids": [789]}

  -- Promotion details
  entities_promoted int,
  entities_skipped int,
  skip_reasons jsonb,  -- e.g., {"duplicate": 12, "validation_failed": 3}

  -- Rollback capability
  rollback_possible boolean DEFAULT true,
  rollback_completed boolean DEFAULT false,
  rollback_at timestamptz,
  rollback_by text,

  -- Snapshot for rollback
  before_snapshot jsonb,  -- State of curated records before promotion
  after_snapshot jsonb,  -- State of curated records after promotion

  -- Quality gates
  quality_checks_passed jsonb,  -- e.g., {"uniqueness": true, "referential_integrity": true}
  quality_score double precision,  -- Overall quality score (0.0-1.0)

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_promotion_log_document ON stage.promotion_log(document_id);
CREATE INDEX IF NOT EXISTS ix_promotion_log_time ON stage.promotion_log(promoted_at DESC);
CREATE INDEX IF NOT EXISTS ix_promotion_log_table ON stage.promotion_log(target_table);
CREATE INDEX IF NOT EXISTS ix_promotion_log_rollback ON stage.promotion_log(rollback_possible) WHERE rollback_completed = false;

COMMENT ON TABLE stage.promotion_log IS 'Audit trail for promoting vetted data from staging to curated schema. Supports rollback and quality tracking.';
COMMENT ON COLUMN stage.promotion_log.target_ids IS 'JSONB map of promoted record IDs by table. Enables efficient rollback queries.';
COMMENT ON COLUMN stage.promotion_log.before_snapshot IS 'JSONB snapshot of affected curated records before promotion. Enables point-in-time rollback.';
COMMENT ON COLUMN stage.promotion_log.quality_checks_passed IS 'Results of quality gates (uniqueness, referential integrity, value ranges, etc.) run before promotion.';

-- =============================================================================
-- UPDATE TRIGGERS (Maintain updated_at timestamps)
-- =============================================================================

CREATE OR REPLACE FUNCTION stage.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cleaning_rules_updated_at BEFORE UPDATE ON stage.cleaning_rules
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_csv_extractions_updated_at BEFORE UPDATE ON stage.csv_extractions
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

-- =============================================================================
-- VIEWS FOR COMMON QUERIES
-- =============================================================================

-- High-confidence extractions ready for auto-promotion
CREATE OR REPLACE VIEW stage.v_auto_promotable AS
SELECT
  ce.document_id,
  ce.column_name,
  ce.cleaned_value,
  ce.confidence,
  d.source_id,
  d.source_doc_id,
  d.metadata
FROM stage.csv_extractions ce
JOIN stage.documents d ON ce.document_id = d.id
WHERE
  ce.confidence >= 0.95
  AND ce.needs_review = false
  AND ce.review_status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM stage.promotion_log pl
    WHERE pl.document_id = ce.document_id
    AND pl.rollback_completed = false
  );

COMMENT ON VIEW stage.v_auto_promotable IS 'High-confidence, reviewed extractions ready for automated promotion to curated schema.';

-- Extractions needing human review
CREATE OR REPLACE VIEW stage.v_review_queue AS
SELECT
  ce.id,
  ce.document_id,
  d.source_doc_id,
  ce.row_index,
  ce.column_name,
  ce.raw_value,
  ce.cleaned_value,
  ce.confidence,
  ce.similarity_score,
  cr.rule_name,
  ce.created_at
FROM stage.csv_extractions ce
JOIN stage.documents d ON ce.document_id = d.id
LEFT JOIN stage.cleaning_rules cr ON ce.rule_id = cr.id
WHERE
  ce.needs_review = true
  AND ce.review_status IS NULL
ORDER BY
  ce.confidence ASC,  -- Lowest confidence first
  ce.created_at ASC;

COMMENT ON VIEW stage.v_review_queue IS 'Extractions flagged for human review, ordered by confidence (lowest first).';

-- Processing statistics by document
CREATE OR REPLACE VIEW stage.v_document_processing_stats AS
SELECT
  d.id AS document_id,
  d.source_doc_id,
  d.collected_at,
  COUNT(ce.id) AS total_extractions,
  COUNT(ce.id) FILTER (WHERE ce.confidence >= 0.95) AS high_confidence_count,
  COUNT(ce.id) FILTER (WHERE ce.needs_review = true) AS needs_review_count,
  AVG(ce.confidence) AS avg_confidence,
  MAX(dpl.triggered_at) AS last_processed_at,
  BOOL_OR(dpl.success = false) AS has_processing_errors,
  EXISTS(SELECT 1 FROM stage.promotion_log pl WHERE pl.document_id = d.id) AS promoted
FROM stage.documents d
LEFT JOIN stage.csv_extractions ce ON ce.document_id = d.id
LEFT JOIN stage.document_processing_log dpl ON dpl.document_id = d.id
GROUP BY d.id, d.source_doc_id, d.collected_at;

COMMENT ON VIEW stage.v_document_processing_stats IS 'Per-document processing statistics for monitoring and dashboards.';

-- =============================================================================
-- INITIAL DATA (Bootstrap cleaning rules from seed script)
-- =============================================================================

-- Note: Actual cleaning rules loaded via sql/seed_cleaning_rules.sql
-- This migration ensures the table exists first.

-- =============================================================================
-- COMPLETION
-- =============================================================================

COMMENT ON SCHEMA stage IS 'Staging schema for document ingestion, cleaning, and ML training. Data flows: raw documents → csv_extractions (cleaned cells) → training_corpus (human corrections) → promotion to curated schema.';
