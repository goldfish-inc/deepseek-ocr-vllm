# Workplan: HF Space → Cloudflare Worker → MotherDuck (Raw) → Argilla → MotherDuck (Annotated)

This plan sequences delivery in auditable stages with concrete deliverables, acceptance criteria, and rollback/verification steps. It assumes existing components: CF Worker `/upload`, DeepSeek OCR job, entity extractor (optional prelabels), and Argilla sync worker (push Mode A).

## Phase 0 — Prereqs & Guardrails
- Deliverables
  - HF Space env configured (`ARGILLA_API_URL`, `ARGILLA_API_KEY`, `MD_RAW_URL`, `MD_ANNOT_URL`).
  - CF Worker `/upload` CORS/size/content-type enforcement; returns `{ doc_id, doc_sha256 }` receipt.
  - Service accounts: `raw_loader` (INSERT-only to `md_raw_ocr`), `argilla_loader` (INSERT-only to `md_annotated`).
  - ESC secrets: R2, Argilla, MotherDuck tokens (scoped by role).
- Acceptance
  - Test upload returns `doc_id`; object present in R2; no PII leakage.
  - Role credentials verify proper permissions (no UPDATE/DELETE).
- Notes
  - Document `doc_id` format (UUIDv7) and retention; choose HF Space commit tracking.

## Phase 1 — Raw DB (MotherDuck) setup
- Deliverables
  - Create DB `md_raw_ocr` tables: `raw_documents`, `raw_pages` (optional `raw_blocks`).
  - Append-only loader from DeepSeek Parquet; compute/stash `text_sha256`.
  - View `vw_argilla_pages` for Argilla push: `SELECT doc_id, page_num, text, text_sha256 ...` from latest run.
- Acceptance
  - Upload sample PDF → OCR → rows appear in `raw_documents` and `raw_pages`.
  - Text hashes stable across reexports; counts match page count.
- Rollback
  - Keep tables append-only; if schema adjust needed, add new columns rather than destructive changes.

## Phase 2 — Argilla Push (Mode A)
- Deliverables
  - Sync worker reads `vw_argilla_pages` and creates Argilla records.
  - Metadata on each record: `doc_id`, `page_num`, `text_sha256`, `r2_key` (optional), `labelset_version`.
- Acceptance
  - 1:1 records with pages; traceability from Argilla back to `doc_id` and `text_sha256`.
- Notes
  - Optional weak prelabels from entity extractor; keep suggestions flagged.

## Phase 2.5 — Pre-annotation (Spark + Ollama)
- Deliverables
  - Batch job reads latest OCR pages from `md_raw_ocr.main.vw_argilla_pages` and runs NER with Ollama on DGX Spark (`ollama.goldfish.io` or tailnet `spark-291b:11434`).
  - Emits Parquet suggestions to object storage (S3/R2) at a batch prefix, e.g., `s3://…/argilla/in/<dataset>/suggestions/`.
  - Suggestions schema documented (see `sql/motherduck/PREANNOTATION_SCHEMA.md`).
- Acceptance
  - For the selected batch, ≥90% of pages have at least one suggestion row (tunable).
  - No writes to `md_raw_ocr` or `md_annotated` (keep raw/annotated separation intact).
- Notes
  - Keep offsets aligned to page `text` (char-based, end-exclusive). Store model/version and confidence per span.
  - Argilla ingestion merges suggestions with pages during import (client-side merge) — no API write-backs required.

## Phase 3 — Annotated DB (MotherDuck) setup
- Deliverables
  - Create DB `md_annotated` tables: `annotations_pages`, `annotations_spans` (optional relations/decisions/exports).
  - Enforce append-only via service account permissions; versioning via `export_run_id`.
- Acceptance
  - Smoke insert via dummy export; read-only access verified.

## Phase 4 — Argilla Pull (Mode B)
- Deliverables
  - Export Argilla annotations; loader writes to `md_annotated` with `export_run_id`, annotator/reviewer IDs, and checksums.
  - Store record JSON optionally for audit (`record_json`).
- Acceptance
  - After SME annotate N pages, `annotations_spans` contains spans with provenance.
  - Idempotency on re-export: duplicate detection by `(export_run_id, argilla_record_id, span_id)` or content hash.

## Phase 5 — Monitoring & QA
- Deliverables
  - Coverage dashboard: per `doc_id`, page counts vs Argilla records vs annotated pages.
  - Integrity job: recompute `text_sha256` daily; alert on mismatches.
  - Export audit: `annotations_exports` with counts and checksum; alert on drift.
- Acceptance
  - Sample batch shows 100% coverage; no integrity violations.

## Phase 6 — Backfill
- Deliverables
  - Batch tool to read historical PDFs from R2; run OCR → load `md_raw_ocr` → push Argilla → pull to `md_annotated`.
  - Retries and failure ledger.
- Acceptance
  - Target corpus ingested; discrepancies logged with retry plan.

---

## Labelset v1 (SME)
- Identity: `VESSEL_NAME`, `FLAG`, `HOME_PORT`, `HOME_PORT_STATE`, `IMO`, `MMSI`, `IRCS`, `EU_CFR`, `NATIONAL_REG_NO`.
- External IDs: `RFMO_ID`, `PORT_ID`, `OTHER_EXT_ID`.
- Metrics: `METRIC_TYPE`, `METRIC_VALUE`, `METRIC_UNIT`.
- Build: `BUILD_YEAR`, `BUILD_COUNTRY`, `BUILDER_LOCATION`.
- Authorizations: `AUTH_TYPE`, `LICENSE_NO`, `START_DATE`, `END_DATE`, `RFMO_CODE`, `FAO_AREA_CODE`, `SPECIES_NAME`.
- Associates: `ASSOC_NAME`, `ASSOC_ROLE`, `ADDRESS`, `CITY`, `STATE`, `COUNTRY_CODE`, `REG_NO`.
- History: `NAME_CHANGE`, `FLAG_CHANGE`, `ID_CHANGE`.

Guidelines
- Use dropdowns for controlled vocab; regex validations for IDs/dates; "Unsure" flag allowed per bundle.
- Keep spans tight; avoid trailing punctuation; annotate units separately.

---

## Success Metrics
- Time-to-first-annotation < 1 day.
- 95% of pages exported to Argilla within 5 minutes of OCR completion.
- 99.9% integrity (hash matches) on raw pages.
- Zero UPDATE/DELETE operations on `md_raw_ocr` and `md_annotated` (validated via audit logs).

## Risks & Mitigations
- Large PDFs slow OCR → parallelize per page; track `ocr_runtime_ms`.
- Argilla export drift → pin `labelset_version` and `guideline_revision`; use `export_run_id` versioning.
- Permission creep → separate service accounts by DB; least privilege.

## Ownership
- `HF Space & Gradio`: App Platform team
- `CF Worker & R2`: Edge team
- `MotherDuck (raw/annotated)`: Data platform
- `Argilla`: Data ops

## Rollout Checklist
- [ ] Create `md_raw_ocr` and `md_annotated` with service accounts and tokens in ESC
- [ ] Enable `/upload` CORS/limits; return receipt
- [ ] Wire HF Space to call `/upload`; display `doc_id`
- [ ] OCR to Parquet; load `raw_documents` and `raw_pages`
- [ ] Build `vw_argilla_pages`; push to Argilla
- [ ] SMEs annotate sample; export spans; load `annotations_*`
- [ ] Validate coverage/integrity; enable monitoring
- [ ] Start backfill batch
## Phase 3.5 — Argilla Auto-Discovery (Autoload)
- Deliverables
  - Autoload job (CronJob/systemd) that scans `s3://…/argilla/in/vessels_ocr_*/argilla_records.parquet` and ingests new datasets to Argilla automatically.
  - State tracking in `md_annotated.main.argilla_ingest_log`.
- Acceptance
  - New merged Parquet drops appear in Argilla within 15 minutes without manual commands.
  - Duplicate drops are ignored; failures logged with error message and retried.
- Notes
  - See `docs/operations/argilla-auto-discovery.md`.
