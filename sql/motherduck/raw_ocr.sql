-- md_raw_ocr: DeepSeek OCR outputs (append-only)
-- Execute in database context: md_raw_ocr (schema main)

CREATE TABLE IF NOT EXISTS raw_documents (
  doc_id           VARCHAR NOT NULL,                 -- UUID/ULID string
  run_id           BIGINT  NOT NULL DEFAULT 1,       -- OCR pipeline run counter for the same doc
  ingest_ts        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  filename         VARCHAR,
  r2_key           VARCHAR,
  content_type     VARCHAR,
  size_bytes       BIGINT,
  doc_sha256       VARCHAR NOT NULL,                 -- hash of original PDF
  uploader         VARCHAR,                          -- user/service identifier
  source_meta_json JSON,                             -- any upstream metadata
  hf_space_commit  VARCHAR,                          -- git sha of HF Space at OCR time
  ocr_model        VARCHAR,                          -- DeepSeek model/version
  ocr_image_digest VARCHAR,                          -- container/image digest
  ocr_params_json  JSON,                             -- serialized OCR config

  PRIMARY KEY (doc_id, run_id)
);

CREATE TABLE IF NOT EXISTS raw_pages (
  doc_id            VARCHAR NOT NULL,
  run_id            BIGINT  NOT NULL,
  page_num          INTEGER NOT NULL,
  page_width        DOUBLE,
  page_height       DOUBLE,
  text              TEXT,                             -- verbatim OCR text
  text_sha256       VARCHAR NOT NULL,
  page_image_sha256 VARCHAR,                          -- optional per-page image hash
  ocr_confidence    DOUBLE,
  blocks_json       JSON,                             -- optional structures
  lines_json        JSON,
  tables_json       JSON,
  figures_json      JSON,
  ocr_runtime_ms    BIGINT,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (doc_id, run_id, page_num)
);

-- Optional granular table (create only if you need block-level indexing)
-- CREATE TABLE IF NOT EXISTS raw_blocks (
--   doc_id     VARCHAR NOT NULL,
--   run_id     BIGINT  NOT NULL,
--   page_num   INTEGER NOT NULL,
--   block_id   INTEGER NOT NULL,
--   type       VARCHAR,
--   text       TEXT,
--   bbox_json  JSON,
--   confidence DOUBLE,
--   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
--   PRIMARY KEY (doc_id, run_id, page_num, block_id)
-- );
