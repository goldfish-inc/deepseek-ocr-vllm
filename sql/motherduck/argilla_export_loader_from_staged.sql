-- Argilla Export Loader (from staged temp tables)
-- Expects:
--   TEMP TABLE _params(argilla_dataset VARCHAR, export_checksum VARCHAR, tool_version VARCHAR)
--   TEMP TABLE _incoming_pages(...), TEMP TABLE _incoming_spans(...)
-- Writes to md_annotated: annotations_exports, annotations_pages, annotations_spans

BEGIN TRANSACTION;

-- Allocate export_run_id (monotonic)
CREATE OR REPLACE TEMP TABLE _export_run AS
SELECT COALESCE(MAX(export_run_id), 0) + 1 AS export_run_id
FROM annotations_exports;

-- Insert export header
INSERT INTO annotations_exports (export_run_id, argilla_dataset, record_count, checksum, started_at, tool_version)
SELECT e.export_run_id,
       p.argilla_dataset,
       NULL::BIGINT,
        p.export_checksum,
       CURRENT_TIMESTAMP,
       p.tool_version
FROM _export_run e CROSS JOIN _params p;

-- Idempotent pages
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

-- Idempotent spans
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

-- Finalize export header
UPDATE annotations_exports ae
SET record_count = (
      SELECT COUNT(*) FROM annotations_pages ap
      WHERE ap.export_run_id = ae.export_run_id AND ap.argilla_dataset = ae.argilla_dataset
    ),
    completed_at = CURRENT_TIMESTAMP
FROM _export_run e, _params p
WHERE ae.export_run_id = e.export_run_id AND ae.argilla_dataset = p.argilla_dataset;

COMMIT;
