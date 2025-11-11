# OCR → Argilla → MotherDuck: Raw vs Annotated, Provenance, and Staged Execution

This document defines the SME-facing document intelligence pipeline using a Hugging Face Space (Gradio) for uploads and review handoff to Argilla, with MotherDuck as the lake for both raw OCR and human annotations. It formalizes strict data boundaries and provenance to support intelligence-grade auditing and downstream vessel integration.

## Goals
- Preserve a truly raw, immutable store of DeepSeek OCR outputs.
- Keep human output separate in an "annotated" database (append-only; versioned by export run).
- Maintain end-to-end chain-of-custody: document → OCR → Argilla → annotations.
- Provide a clear, staged plan to ship quickly without sacrificing rigor.

## Data Boundaries (Two Databases)
- Raw (append-only): `md_raw_ocr`
  - Only DeepSeek OCR outputs (no transforms, no edits, no enrichments).
  - Tables: `raw_documents`, `raw_pages` (optional: `raw_blocks`).

- Annotated (append-only): `md_annotated`
  - Only Argilla outputs and review metadata (spans, relations, decisions; optional record JSON for audit).
  - Tables: `annotations_pages`, `annotations_spans` (optional: `annotations_relations`, `annotations_decisions`, `annotations_exports`).

## Identifiers & Provenance
- `doc_id`: UUIDv7/ULID per uploaded PDF; shared across both DBs.
- Hashes: `doc_sha256`, `page_image_sha256`, `text_sha256` for tamper detection.
- OCR provenance: `hf_space_commit`, `ocr_model`, `ocr_image_digest`, `ocr_params_json`, `ocr_runtime_ms`.
- Argilla provenance: `argilla_dataset`, `argilla_record_id`, `annotation_id`, `annotator_id`, `reviewer_id`, `labelset_version`, `guideline_revision`, `export_run_id`.
- Postgres bridge (later): map `doc_id` to `original_sources_vessels.source_id` for lineage in vessel warehouse.

## MotherDuck: Raw DB (`md_raw_ocr`)
Tables (logical design; implement as DuckDB/MotherDuck DDL):
- `raw_documents(doc_id, ingest_ts, filename, r2_key, content_type, size_bytes, doc_sha256, uploader, source_meta_json, hf_space_commit, ocr_model, ocr_image_digest, ocr_params_json)`
- `raw_pages(doc_id, page_num, page_width, page_height, text, text_sha256, page_image_sha256, ocr_confidence, blocks_json, lines_json, tables_json, figures_json, ocr_runtime_ms, created_at)`
- Optional `raw_blocks(doc_id, page_num, block_id, type, text, bbox_json, confidence, created_at)` if granular indexing is required.

Invariants:
- Append-only: never UPDATE/DELETE; repeat OCR runs create new `run_id` and append.
- No normalization: preserve DeepSeek text verbatim. Expose normalized views instead of writing back.

Access:
- `raw_loader` service account: INSERT-only to `md_raw_ocr`; SELECT allowed; no UPDATE/DELETE.
- Daily snapshots and row-count/hash checks for integrity.

## MotherDuck: Annotated DB (`md_annotated`)
Tables (logical design):
- `annotations_pages(doc_id, page_num, argilla_dataset, argilla_record_id, record_sha256, status, annotator_id, reviewer_id, created_at, updated_at)`
- `annotations_spans(doc_id, page_num, argilla_record_id, span_id, label, start, end, text, text_sha256, norm_value, confidence, annotator_id, created_at)`
- Optional: `annotations_relations(...)`, `annotations_decisions(...)`, `annotations_exports(export_run_id, argilla_dataset, record_count, checksum, started_at, completed_at, tool_version)`

Invariants:
- Append-only, versioned by `export_run_id`.
- Do not modify `md_raw_ocr`. Only append Argilla-derived data here.

Access:
- `argilla_loader` service account: INSERT-only to `md_annotated`; SELECT allowed; no UPDATE/DELETE.

## Argilla Interface
- Push: create Argilla records from a read-only view of `md_raw_ocr.raw_pages` (`doc_id`, `page_num`, `text`, `text_sha256`).
- Pull: export annotated spans and decisions to `md_annotated` with `export_run_id` and full provenance.
- Labelset v1 (aligned to vessel schema):
  - Identity: `VESSEL_NAME`, `FLAG`, `HOME_PORT`, `HOME_PORT_STATE`, `IMO`, `MMSI`, `IRCS`, `EU_CFR`, `NATIONAL_REG_NO`.
  - External IDs: `RFMO_ID`, `PORT_ID`, `OTHER_EXT_ID`.
  - Metrics: `METRIC_TYPE`, `METRIC_VALUE`, `METRIC_UNIT`.
  - Build: `BUILD_YEAR`, `BUILD_COUNTRY`, `BUILDER_LOCATION`.
  - Authorizations: `AUTH_TYPE`, `LICENSE_NO`, `START_DATE`, `END_DATE`, `RFMO_CODE`, `FAO_AREA_CODE`, `SPECIES_NAME`.
  - Associates: `ASSOC_NAME`, `ASSOC_ROLE`, `ADDRESS`, `CITY`, `STATE`, `COUNTRY_CODE`, `REG_NO`.
  - History: `NAME_CHANGE`, `FLAG_CHANGE`, `ID_CHANGE`.

UX Guardrails:
- Prelabels from weak NER; SMEs correct rather than annotate from scratch.
- Controlled vocab for `METRIC_TYPE`, `AUTH_TYPE`, `ASSOC_ROLE`, `RFMO_CODE`, `FAO_AREA_CODE`, and ISO country codes.
- Soft validation for IMO/MMSI patterns and dates; warnings over hard failures.

## Pipeline Stages
1) Upload & Receipt
   - Gradio calls Cloudflare Worker `/upload` → R2; returns `doc_id`, `doc_sha256`.

2) OCR → MotherDuck (Raw)
   - DeepSeek OCR emits Parquet; loader writes `raw_documents` + `raw_pages` in `md_raw_ocr`.
   - No transforms; append-only with optional `run_id`.

3) Pre-annotation (optional but recommended)
   - Spark + Ollama job reads `md_raw_ocr.main.vw_argilla_pages` and writes Parquet suggestions (spans with label, start, end, confidence, model, version).
   - Suggestions are stored in object storage (S3/R2) under the batch prefix; they are not written into MotherDuck to preserve raw/annotated boundaries.
   - Argilla ingestion can merge suggestions with page text to show pre-filled spans for SMEs.

4) Argilla Push
   - Build `vw_argilla_pages` view on latest OCR run; push records with metadata (`doc_id`, `page_num`, `text_sha256`).

5) Argilla Pull → MotherDuck (Annotated)
   - Export spans/decisions; write to `annotations_pages` & `annotations_spans` with `export_run_id` and annotator/reviewer IDs.

6) Monitoring & QA
   - Coverage: `count(raw_pages) == expected_page_count` per `doc_id`.
   - Annotation progress: `annotations_pages.status` distribution; spans per page; export latency.
   - Integrity: recompute text SHA; daily snapshots.

7) Backfill
   - Batch ingest existing PDFs; ensure end-to-end counts and hashes align; track failures for retry.

## Security & Configuration
- Secrets in Pulumi ESC; bind MotherDuck tokens per role.
- CF Worker CORS + content-type/size enforcement; store only `doc_id`/receipt client-side.
- HF Space env: `MD_RAW_URL`, `MD_ANNOT_URL`, `ARGILLA_API_URL`, `ARGILLA_API_KEY`.

## Postgres Bridge (Later)
- Map `doc_id` → `original_sources_vessels.source_id` to bring annotated data into vessel warehouse with lineage.
- Do not write normalized vessel data back into MotherDuck; keep that in Postgres.

## Acceptance Criteria (Day 1)
- SMEs upload PDF and receive `doc_id`.
- `md_raw_ocr.raw_pages` has one row per page with content and hash.
- Argilla dataset contains all pages for the `doc_id` with prelabels (optional).
- After SME annotation, `md_annotated.annotations_spans` contains spans with full provenance.
- Append-only guarantees hold; daily integrity checks pass.
