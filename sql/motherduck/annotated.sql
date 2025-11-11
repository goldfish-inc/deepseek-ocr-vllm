-- md_annotated: Argilla annotations (append-only)
-- Execute in database context: md_annotated (schema main)

-- Optional registry of each export
CREATE TABLE IF NOT EXISTS annotations_exports (
  export_run_id   BIGINT      NOT NULL,            -- monotonically increasing per deployment/team
  argilla_dataset VARCHAR     NOT NULL,
  record_count    BIGINT,
  checksum        VARCHAR,                         -- checksum of exported JSON/NDJSON
  started_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    TIMESTAMP,
  tool_version    VARCHAR,
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (export_run_id, argilla_dataset)
);

-- Per-page Argilla record metadata
CREATE TABLE IF NOT EXISTS annotations_pages (
  export_run_id     BIGINT      NOT NULL,
  argilla_dataset   VARCHAR     NOT NULL,
  argilla_record_id VARCHAR     NOT NULL,
  doc_id            VARCHAR     NOT NULL,
  page_num          INTEGER     NOT NULL,
  record_sha256     VARCHAR,                       -- hash of Argilla record payload
  status            VARCHAR,                       -- e.g. queued|annotated|reviewed
  annotator_id      VARCHAR,
  reviewer_id       VARCHAR,
  created_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP,
  PRIMARY KEY (export_run_id, argilla_record_id)
);

-- Span-level annotations (NER-style)
CREATE TABLE IF NOT EXISTS annotations_spans (
  export_run_id       BIGINT    NOT NULL,
  argilla_dataset     VARCHAR   NOT NULL,
  argilla_record_id   VARCHAR   NOT NULL,
  span_id             VARCHAR   NOT NULL,
  doc_id              VARCHAR   NOT NULL,
  page_num            INTEGER   NOT NULL,
  label               VARCHAR   NOT NULL,
  start               INTEGER   NOT NULL,
  "end"               INTEGER   NOT NULL,
  text                TEXT      NOT NULL,          -- span text (copied from raw)
  text_sha256         VARCHAR   NOT NULL,
  norm_value          VARCHAR,                     -- normalized value (e.g., numeric unit coercion)
  confidence          DOUBLE,
  annotator_id        VARCHAR,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (export_run_id, argilla_record_id, span_id)
);

-- Optional: relations between spans
-- CREATE TABLE IF NOT EXISTS annotations_relations (
--   export_run_id     BIGINT    NOT NULL,
--   argilla_dataset   VARCHAR   NOT NULL,
--   argilla_record_id VARCHAR   NOT NULL,
--   relation_id       VARCHAR   NOT NULL,
--   head_span_id      VARCHAR   NOT NULL,
--   tail_span_id      VARCHAR   NOT NULL,
--   label             VARCHAR   NOT NULL,
--   created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   PRIMARY KEY (export_run_id, argilla_record_id, relation_id)
-- );

-- Optional: reviewer decisions
-- CREATE TABLE IF NOT EXISTS annotations_decisions (
--   export_run_id     BIGINT    NOT NULL,
--   argilla_dataset   VARCHAR   NOT NULL,
--   argilla_record_id VARCHAR   NOT NULL,
--   decision          VARCHAR   NOT NULL,         -- accepted|needs_review|rejected
--   rationale         TEXT,
--   reviewer_id       VARCHAR,
--   created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   PRIMARY KEY (export_run_id, argilla_record_id)
-- );
