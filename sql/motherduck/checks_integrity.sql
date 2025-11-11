-- Integrity checks for md_raw_ocr and md_annotated
-- Run these queries daily or post-load to validate append-only guarantees and provenance.

-- ========================================
-- CHECK 1: Raw documents coverage
-- ========================================
-- Verify every doc_id has at least one page
SELECT 'Coverage: Documents without pages' AS check_name, COUNT(*) AS violation_count
FROM raw_documents d
LEFT JOIN raw_pages p ON d.doc_id = p.doc_id AND d.run_id = p.run_id
WHERE p.doc_id IS NULL;

-- ========================================
-- CHECK 2: Page count validation
-- ========================================
-- Compare actual page count to expected (if stored in metadata)
-- Adjust source_meta_json path to match your schema
SELECT
  'Coverage: Page count mismatch' AS check_name,
  d.doc_id,
  d.filename,
  CAST(d.source_meta_json->>'expected_pages' AS INTEGER) AS expected_pages,
  COUNT(p.page_num) AS actual_pages
FROM raw_documents d
JOIN raw_pages p ON d.doc_id = p.doc_id AND d.run_id = p.run_id
WHERE d.source_meta_json->>'expected_pages' IS NOT NULL
GROUP BY d.doc_id, d.filename, d.source_meta_json->>'expected_pages'
HAVING COUNT(p.page_num) <> CAST(d.source_meta_json->>'expected_pages' AS INTEGER);

-- ========================================
-- CHECK 3: Text hash integrity
-- ========================================
-- Recompute text_sha256 and compare to stored value
-- WARNING: Expensive on large tables; sample or partition by date
SELECT
  'Integrity: Text hash mismatch' AS check_name,
  doc_id,
  run_id,
  page_num,
  text_sha256 AS stored_hash,
  sha256(text::BLOB) AS computed_hash
FROM raw_pages
WHERE text_sha256 <> sha256(text::BLOB)
LIMIT 100;  -- Limit for performance; expand for full audit

-- ========================================
-- CHECK 4: Duplicate detection (append-only violation)
-- ========================================
-- Flag any (doc_id, run_id, page_num) duplicates (should be impossible with PK)
SELECT
  'Integrity: Duplicate raw_pages' AS check_name,
  doc_id,
  run_id,
  page_num,
  COUNT(*) AS duplicate_count
FROM raw_pages
GROUP BY doc_id, run_id, page_num
HAVING COUNT(*) > 1;

-- ========================================
-- CHECK 5: Argilla push coverage
-- ========================================
-- Ensure all latest OCR pages have corresponding Argilla records
-- Requires annotations_pages table in md_annotated
ATTACH 'md:md_annotated' AS anndb (READ_ONLY);

SELECT
  'Coverage: Pages missing Argilla records' AS check_name,
  COUNT(*) AS missing_count
FROM rawdb.main.vw_argilla_pages raw
LEFT JOIN anndb.main.annotations_pages ann
  ON raw.doc_id = ann.doc_id AND raw.page_num = ann.page_num
WHERE ann.argilla_record_id IS NULL;

-- ========================================
-- CHECK 6: Annotation export audit
-- ========================================
-- Verify annotations_exports record counts match actual rows
SELECT
  'Integrity: Export record count mismatch' AS check_name,
  ex.export_run_id,
  ex.argilla_dataset,
  ex.record_count AS declared_count,
  COUNT(DISTINCT ap.argilla_record_id) AS actual_count
FROM anndb.main.annotations_exports ex
LEFT JOIN anndb.main.annotations_pages ap
  ON ex.export_run_id = ap.export_run_id
  AND ex.argilla_dataset = ap.argilla_dataset
GROUP BY ex.export_run_id, ex.argilla_dataset, ex.record_count
HAVING ex.record_count <> COUNT(DISTINCT ap.argilla_record_id);

-- ========================================
-- CHECK 7: Span text hash verification
-- ========================================
-- Recompute span text_sha256 to detect tampering
-- WARNING: Expensive; sample or run during off-peak
SELECT
  'Integrity: Span text hash mismatch' AS check_name,
  export_run_id,
  argilla_record_id,
  span_id,
  text_sha256 AS stored_hash,
  sha256(text::BLOB) AS computed_hash
FROM anndb.main.annotations_spans
WHERE text_sha256 <> sha256(text::BLOB)
LIMIT 100;

-- ========================================
-- CHECK 8: Orphaned annotations
-- ========================================
-- Flag annotations referencing nonexistent raw pages
SELECT
  'Integrity: Orphaned annotations' AS check_name,
  ann.doc_id,
  ann.page_num,
  ann.argilla_record_id
FROM anndb.main.annotations_pages ann
LEFT JOIN rawdb.main.raw_pages raw
  ON ann.doc_id = raw.doc_id AND ann.page_num = raw.page_num
WHERE raw.doc_id IS NULL;

-- ========================================
-- CHECK 9: Annotation progress summary
-- ========================================
-- Track annotation status distribution per dataset
SELECT
  argilla_dataset,
  status,
  COUNT(*) AS record_count,
  COUNT(DISTINCT doc_id) AS document_count,
  MIN(created_at) AS earliest,
  MAX(updated_at) AS latest
FROM anndb.main.annotations_pages
GROUP BY argilla_dataset, status
ORDER BY argilla_dataset, status;

-- ========================================
-- CHECK 10: Daily append-only audit
-- ========================================
-- Detect any UPDATE/DELETE operations (requires audit logging at DB level)
-- MotherDuck may not expose this natively; consider external audit via logs
-- Placeholder query: check created_at vs updated_at drift
SELECT
  'Integrity: Potential mutation detected' AS check_name,
  COUNT(*) AS suspect_rows
FROM anndb.main.annotations_pages
WHERE updated_at IS NOT NULL
  AND updated_at > created_at + INTERVAL '1 minute';
  -- Adjust threshold based on legitimate update windows

-- ========================================
-- Summary Dashboard Query
-- ========================================
-- Single query for daily health report
SELECT
  'md_raw_ocr' AS database,
  COUNT(DISTINCT d.doc_id) AS total_docs,
  COUNT(p.page_num) AS total_pages,
  COUNT(DISTINCT d.run_id) AS total_runs,
  MAX(d.ingest_ts) AS latest_ingest
FROM rawdb.main.raw_documents d
LEFT JOIN rawdb.main.raw_pages p ON d.doc_id = p.doc_id AND d.run_id = p.run_id

UNION ALL

SELECT
  'md_annotated' AS database,
  COUNT(DISTINCT doc_id) AS total_docs,
  COUNT(DISTINCT argilla_record_id) AS total_pages,
  COUNT(DISTINCT export_run_id) AS total_runs,
  MAX(created_at) AS latest_ingest
FROM anndb.main.annotations_pages;

-- ========================================
-- OPTIONAL: Parquet Schema Validation (Argilla)
-- ========================================
-- Usage:
--   CREATE TEMP TABLE _schema_check_params(
--     pages_glob VARCHAR,
--     spans_glob VARCHAR
--   );
--   INSERT INTO _schema_check_params VALUES (
--     's3://bucket/argilla/out/<dataset>/pages/*.parquet',
--     's3://bucket/argilla/out/<dataset>/spans/*.parquet'
--   );
-- Then run the two queries below to detect missing columns.

-- Pages Parquet expected columns
-- Expected: argilla_record_id, doc_id, page_num, status, annotator_id, reviewer_id, record_sha256
-- Actual columns from DESCRIBE of read_parquet(pages_glob)
-- NOTE: Requires httpfs settings if using S3/R2
--
-- CREATE TEMP TABLE _pages_cols AS
-- SELECT column_name
-- FROM (DESCRIBE SELECT * FROM read_parquet((SELECT pages_glob FROM _schema_check_params)));
--
-- WITH expected(column_name) AS (
--   VALUES ('argilla_record_id'),('doc_id'),('page_num'),('status'),('annotator_id'),('reviewer_id'),('record_sha256')
-- ), missing AS (
--   SELECT e.column_name
--   FROM expected e
--   LEFT JOIN _pages_cols c USING (column_name)
--   WHERE c.column_name IS NULL
-- )
-- SELECT 'Schema: Missing pages columns' AS check_name,
--        COUNT(*) AS missing_count,
--        string_agg(column_name, ', ') AS missing_columns
-- FROM missing;

-- Spans Parquet expected columns
-- Expected: argilla_record_id, span_id, doc_id, page_num, label, start, end, text, text_sha256, norm_value, annotator_id
--
-- CREATE TEMP TABLE _spans_cols AS
-- SELECT column_name
-- FROM (DESCRIBE SELECT * FROM read_parquet((SELECT spans_glob FROM _schema_check_params)));
--
-- WITH expected(column_name) AS (
--   VALUES ('argilla_record_id'),('span_id'),('doc_id'),('page_num'),('label'),('start'),('end'),('text'),('text_sha256'),('norm_value'),('annotator_id')
-- ), missing AS (
--   SELECT e.column_name
--   FROM expected e
--   LEFT JOIN _spans_cols c USING (column_name)
--   WHERE c.column_name IS NULL
-- )
-- SELECT 'Schema: Missing spans columns' AS check_name,
--        COUNT(*) AS missing_count,
--        string_agg(column_name, ', ') AS missing_columns
-- FROM missing;
