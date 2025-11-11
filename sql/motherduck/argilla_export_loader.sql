-- Argilla Export Loader (md_annotated)
-- Purpose: Ingest Argilla exports into append-only tables with provenance and idempotency.
-- Context: Run in database md_annotated (schema main). Attach md_raw_ocr if you want cross-checks.

-- ==================================
-- 0) PARAMETERS (edit per run)
-- ==================================
-- Provide your dataset name and export source (path/URL) here. You can also load from a temp table.
CREATE TEMP TABLE _params AS SELECT
  'vessels_ocr_SAMPLEBATCH'::VARCHAR     AS argilla_dataset,
  's3://your-bucket/argilla/exports/vessels_ocr_SAMPLEBATCH_2025-11-10.ndjson'::VARCHAR AS export_uri,
  'sha256:CHANGE_ME'::VARCHAR            AS export_checksum,
  'argilla-loader/1.0.0'::VARCHAR        AS tool_version;

-- ==================================
-- 1) ALLOCATE export_run_id (central monotonic counter)
-- ==================================
-- Preferred (sequence) — if your environment supports sequences, create one:
--   CREATE SEQUENCE IF NOT EXISTS seq_export_run_id;
--   SELECT nextval('seq_export_run_id') AS export_run_id;
-- Portable fallback (transactional max+1):
BEGIN TRANSACTION;
CREATE TEMP TABLE _export_run AS
SELECT COALESCE(MAX(export_run_id), 0) + 1 AS export_run_id
FROM annotations_exports;

-- Materialize export header row
INSERT INTO annotations_exports (export_run_id, argilla_dataset, record_count, checksum, started_at, tool_version)
SELECT e.export_run_id,
       p.argilla_dataset,
       NULL::BIGINT,
       p.export_checksum,
       CURRENT_TIMESTAMP,
       p.tool_version
FROM _export_run e CROSS JOIN _params p;

-- ==================================
-- 2) LOAD RAW EXPORT (NDJSON/JSON) INTO TEMP TABLES
-- ==================================
-- Pattern A: Direct load from NDJSON/JSON
--   CREATE TEMP TABLE _export_raw AS
--   SELECT * FROM read_json_auto((SELECT export_uri FROM _params));

-- Pattern B: If the caller already staged two temp tables, skip this and ensure they match schemas below.

-- Create shape for pages and spans (adjust mappings to your Argilla export structure)
CREATE TEMP TABLE _incoming_pages (
  argilla_record_id VARCHAR,
  doc_id            VARCHAR,
  page_num          INTEGER,
  status            VARCHAR,
  annotator_id      VARCHAR,
  reviewer_id       VARCHAR,
  record_json       JSON,
  record_sha256     VARCHAR
);

CREATE TEMP TABLE _incoming_spans (
  argilla_record_id VARCHAR,
  span_id           VARCHAR,
  doc_id            VARCHAR,
  page_num          INTEGER,
  label             VARCHAR,
  start             INTEGER,
  "end"             INTEGER,
  text              TEXT,
  text_sha256       VARCHAR,
  norm_value        VARCHAR,
  annotator_id      VARCHAR
);

-- Example mapping from a generic Argilla record payload (uncomment and adapt):
-- INSERT INTO _incoming_pages
-- SELECT
--   id                            AS argilla_record_id,
--   metadata.doc_id               AS doc_id,
--   metadata.page_num::INTEGER    AS page_num,
--   status                        AS status,
--   annotation.annotator_id       AS annotator_id,
--   annotation.reviewer_id        AS reviewer_id,
--   to_json(*)                    AS record_json,
--   lower(sha256(CAST(to_json(*) AS VARCHAR))) AS record_sha256
-- FROM _export_raw;

-- INSERT INTO _incoming_spans
-- SELECT
--   r.id                          AS argilla_record_id,
--   CONCAT(r.id, ':', ent.idx)    AS span_id,
--   r.metadata.doc_id             AS doc_id,
--   r.metadata.page_num::INTEGER  AS page_num,
--   ent.label                     AS label,
--   ent.start                     AS start,
--   ent.end                       AS "end",
--   substr(r.text, ent.start + 1, ent.end - ent.start) AS text,
--   lower(sha256(substr(r.text, ent.start + 1, ent.end - ent.start))) AS text_sha256,
--   ent.annotator_id              AS annotator_id,
--   NULL                          AS norm_value
-- FROM _export_raw r,
-- UNNEST(r.annotation.entities) AS ent(idx, label, start, "end", annotator_id);

-- ==================================
-- 3) CONFLICT DETECTION (optional diagnostics)
-- ==================================
-- Existing pages for this dataset/run (should be empty unless re-run)
SELECT 'incoming_pages_conflicts' AS check_name,
       COUNT(*)                   AS conflicts
FROM _incoming_pages ip
JOIN _export_run e
  ON TRUE
JOIN _params p
  ON TRUE
JOIN annotations_pages ap
  ON ap.export_run_id = e.export_run_id
 AND ap.argilla_dataset = p.argilla_dataset
 AND ap.argilla_record_id = ip.argilla_record_id;

-- Existing spans for this dataset/run
SELECT 'incoming_spans_conflicts' AS check_name,
       COUNT(*)                    AS conflicts
FROM _incoming_spans ispn
JOIN _export_run e
  ON TRUE
JOIN _params p
  ON TRUE
JOIN annotations_spans s
  ON s.export_run_id = e.export_run_id
 AND s.argilla_dataset = p.argilla_dataset
 AND s.argilla_record_id = ispn.argilla_record_id
 AND s.span_id = ispn.span_id;

-- ==================================
-- 4) INSERT (idempotent): pages then spans
-- ==================================
-- Pages
INSERT OR IGNORE INTO annotations_pages (
  export_run_id, argilla_dataset, argilla_record_id,
  doc_id, page_num, record_sha256, status, annotator_id, reviewer_id, created_at, updated_at
)
SELECT e.export_run_id,
       p.argilla_dataset,
       ip.argilla_record_id,
       ip.doc_id,
       ip.page_num,
       ip.record_sha256,
       ip.status,
       ip.annotator_id,
       ip.reviewer_id,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM _incoming_pages ip
JOIN _export_run e ON TRUE
JOIN _params p     ON TRUE;

-- Optional: store record_json for auditing (add column first, see annotated_alter_add_record_json.sql)
-- UPDATE annotations_pages ap
-- SET record_json = ip.record_json
-- FROM _incoming_pages ip, _export_run e, _params p
-- WHERE ap.export_run_id = e.export_run_id
--   AND ap.argilla_dataset = p.argilla_dataset
--   AND ap.argilla_record_id = ip.argilla_record_id;

-- Spans (primary key guards duplicates)
INSERT OR IGNORE INTO annotations_spans (
  export_run_id, argilla_dataset, argilla_record_id, span_id,
  doc_id, page_num, label, start, "end", text, text_sha256, norm_value, confidence, annotator_id, created_at
)
SELECT e.export_run_id, p.argilla_dataset, s.argilla_record_id, s.span_id,
       s.doc_id, s.page_num, s.label, s.start, s."end", s.text, s.text_sha256,
       s.norm_value, NULL::DOUBLE, s.annotator_id, CURRENT_TIMESTAMP
FROM _incoming_spans s
JOIN _export_run e ON TRUE
JOIN _params p     ON TRUE;

-- Update export record_count and completed_at
UPDATE annotations_exports ae
SET record_count = (
      SELECT COUNT(*) FROM annotations_pages ap
      WHERE ap.export_run_id = ae.export_run_id AND ap.argilla_dataset = ae.argilla_dataset
    ),
    completed_at = CURRENT_TIMESTAMP
FROM _export_run e, _params p
WHERE ae.export_run_id = e.export_run_id AND ae.argilla_dataset = p.argilla_dataset;

COMMIT;

-- ==================================
-- 5) POST-INGEST CHECKS
-- ==================================
-- Spans available via latest view (if this dataset is latest export)
SELECT COUNT(*) AS latest_spans
FROM vw_latest_annotations_spans
WHERE argilla_dataset = (SELECT argilla_dataset FROM _params);
