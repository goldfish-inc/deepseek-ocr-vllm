-- Smoke Test: Annotated DB ingestion and views
-- Context: Run in md_annotated (schema main). Safe to re-run; uses new export_run_id each time.

BEGIN TRANSACTION;

-- Allocate a fresh export_run_id
CREATE TEMP TABLE _export_run AS
SELECT COALESCE(MAX(export_run_id), 0) + 1 AS export_run_id FROM annotations_exports;

-- Parameters
CREATE TEMP TABLE _params AS SELECT
  'test_smoke'::VARCHAR AS argilla_dataset,
  'sha256:smoke'::VARCHAR AS checksum,
  'smoke/0.1.0'::VARCHAR AS tool_version;

-- Export header
INSERT INTO annotations_exports (export_run_id, argilla_dataset, record_count, checksum, started_at, tool_version)
SELECT e.export_run_id, p.argilla_dataset, NULL::BIGINT, p.checksum, CURRENT_TIMESTAMP, p.tool_version
FROM _export_run e CROSS JOIN _params p;

-- Dummy data
CREATE TEMP TABLE _incoming_pages (
  argilla_record_id VARCHAR,
  doc_id            VARCHAR,
  page_num          INTEGER,
  status            VARCHAR,
  annotator_id      VARCHAR,
  reviewer_id       VARCHAR,
  record_sha256     VARCHAR
);

INSERT INTO _incoming_pages VALUES
  ('rec-1', 'SMOKE-ULID-001', 1, 'annotated', 'ann-1', NULL, 'sha256:rec1'),
  ('rec-2', 'SMOKE-ULID-001', 2, 'annotated', 'ann-1', 'rev-1', 'sha256:rec2');

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

INSERT INTO _incoming_spans VALUES
  ('rec-1', 'rec-1:1', 'SMOKE-ULID-001', 1, 'VESSEL_NAME', 0, 5, 'SMOKE', 'sha256:SMOKE', NULL, 'ann-1'),
  ('rec-1', 'rec-1:2', 'SMOKE-ULID-001', 1, 'IMO', 7, 14, '1234567', 'sha256:1234567', NULL, 'ann-1'),
  ('rec-2', 'rec-2:1', 'SMOKE-ULID-001', 2, 'MMSI', 10, 19, '123456789', 'sha256:123456789', NULL, 'ann-1');

-- Insert pages
INSERT OR IGNORE INTO annotations_pages (
  export_run_id, argilla_dataset, argilla_record_id,
  doc_id, page_num, record_sha256, status, annotator_id, reviewer_id, created_at, updated_at
)
SELECT e.export_run_id, p.argilla_dataset, ip.argilla_record_id,
       ip.doc_id, ip.page_num, ip.record_sha256, ip.status, ip.annotator_id, ip.reviewer_id,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM _incoming_pages ip, _export_run e, _params p;

-- Insert spans
INSERT OR IGNORE INTO annotations_spans (
  export_run_id, argilla_dataset, argilla_record_id, span_id,
  doc_id, page_num, label, start, "end", text, text_sha256, norm_value, confidence, annotator_id, created_at
)
SELECT e.export_run_id, p.argilla_dataset, s.argilla_record_id, s.span_id,
       s.doc_id, s.page_num, s.label, s.start, s."end", s.text, s.text_sha256,
       s.norm_value, NULL::DOUBLE, s.annotator_id, CURRENT_TIMESTAMP
FROM _incoming_spans s, _export_run e, _params p;

-- Finalize export
UPDATE annotations_exports ae
SET record_count = (SELECT COUNT(*) FROM annotations_pages ap WHERE ap.export_run_id = ae.export_run_id AND ap.argilla_dataset = ae.argilla_dataset),
    completed_at = CURRENT_TIMESTAMP
FROM _export_run e, _params p
WHERE ae.export_run_id = e.export_run_id AND ae.argilla_dataset = p.argilla_dataset;

COMMIT;

-- Verifications
SELECT 'pages_inserted' AS check_name, COUNT(*) AS n FROM annotations_pages WHERE argilla_dataset = 'test_smoke';
SELECT 'spans_inserted' AS check_name, COUNT(*) AS n FROM annotations_spans WHERE argilla_dataset = 'test_smoke';

-- Latest spans view
SELECT 'latest_spans_view' AS check_name, COUNT(*) AS n
FROM vw_latest_annotations_spans WHERE argilla_dataset = 'test_smoke';
