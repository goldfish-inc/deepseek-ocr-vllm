# Argilla Parquet Flow — HF Upload → OCR → MD (raw) → Parquet → Argilla → Parquet → MD (annotated)

This document captures the Parquet-centric flow you confirmed:

1) SMEs upload PDF via HF Space (Gradio) → Cloudflare Worker `/upload` → R2; UI shows `doc_id`.
2) DeepSeek OCR runs; writes Parquet outputs into MotherDuck `md_raw_ocr` (or exports to Parquet on object storage).
3) Pre-annotation: Spark + Ollama reads `md_raw_ocr.main.vw_argilla_pages` and writes Parquet suggestions to `s3://…/argilla/in/<dataset>/suggestions/` (see `sql/motherduck/PREANNOTATION_SCHEMA.md`).
4) Merge pages + suggestions (pre-Argilla)
   - Run `sql/motherduck/merge_suggestions_for_argilla.sql` to produce a single `argilla_records.parquet` containing text and a `suggestions_json` array per record.
   - This keeps join logic explicit and simplifies Argilla ingestion.
5) Argilla ingests the merged Parquet and displays pre-filled spans.
   - Use the loader script to push records to Argilla via API:
     `python scripts/load_argilla_records.py --parquet s3://…/argilla_records.parquet --dataset vessels_ocr_<batch_id> --api-url https://argilla.example.com --api-key *****`
6) SMEs annotate in Argilla UI.
7) Argilla exports annotated records as Parquet.
8) We load Parquet into MotherDuck `md_annotated` tables.

## Export Parquet for Argilla (from md_raw_ocr)

Use `sql/motherduck/export_for_argilla.sql` to export the latest OCR pages (view `vw_argilla_pages`) to Parquet in an object store path partitioned by `doc_id`. Ensure the pre-annotation job writes suggestions Parquet under the batch prefix so Argilla can merge them during ingestion.

Outputs include: `doc_id`, `page_num`, `text`, `text_sha256`. Additional metadata (filename, etc.) can be added if needed.

## Argilla Ingest (from Parquet)

On the Argilla side, use the Python client to create a TokenClassification dataset named `vessels_ocr_<batch_id>` and load records from the merged `argilla_records.parquet`. Each row becomes one record with fields:

- `id`: `<doc_id>:<page_num>`
- `text`: OCR page text
- `metadata`: `{ doc_id, page_num, text_sha256, labelset_version: 'v1', source: 'deepseek-ocr' }`
- `suggestions`: suggestions_json (array) with entries like:
  `[{
     "question_name": "entities",
     "value": [{"start": 10, "end": 25, "label": "VESSEL_NAME"}],
     "score": 0.87,
     "agent": "ollama-llama3.3-70b",
     "type": "model"
   }]`

Batch 100–500 records per request, retry on transient failures.

## Load Annotated Parquet back to MotherDuck

Use `sql/motherduck/load_annotated_parquet.sql` to read Argilla-exported Parquet (pages and spans) and stage into temp tables `_incoming_pages` and `_incoming_spans`, then run `argilla_export_loader_from_staged.sql` to populate `md_annotated` tables (`annotations_exports`, `annotations_pages`, `annotations_spans`).

## Provenance & Idempotency

- Dataset naming: `vessels_ocr_<batch_id>` (ULID/semantic). Store in `annotations_exports/annotations_pages.argilla_dataset`.
- `export_run_id`: Central monotonic counter (sequence or transactional `MAX()+1`).
- Idempotent inserts: primary keys prevent duplicates; re-exports generate new `export_run_id`.

## Integrity & Monitoring

- Run `sql/motherduck/checks_integrity.sql` daily to validate coverage, hash presence, orphaned annotations.
- Use `sql/motherduck/grafana_panels.sql` for dashboards (docs/pages ingested, coverage %, label distribution, annotator throughput).
