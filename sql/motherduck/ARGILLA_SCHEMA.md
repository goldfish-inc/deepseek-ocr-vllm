# Argilla Parquet Schema — Expected Columns

This documents the expected Parquet columns for Argilla ingestion and export used by our MotherDuck loaders. Adjust mappings in the SQL scripts if the actual Argilla export format differs.

Pages for Argilla (exported from md_raw_ocr)
--------------------------------------------
Source: `sql/motherduck/export_for_argilla.sql`

Expected columns (per row = one page):
- `doc_id` (STRING): Stable document ULID/UUID.
- `page_num` (INT): 1-based page index.
- `text` (STRING): OCR text for the page (verbatim, unnormalized).
- `text_sha256` (STRING): Hex hash of `text` (lowercase).

Notes:
- Partitioned by `doc_id` in S3/R2 for scalable ingestion by Argilla.
- Add extra metadata if needed (e.g., `filename`, `r2_key`).

Annotated Parquet from Argilla (export back to MotherDuck)
---------------------------------------------------------
We expect two logical outputs — pages and spans — that can be combined into a single Parquet with nested fields or exported as two datasets. Our loader targets a flat model using two staged temp tables.

1) Pages dataset (staged into `_incoming_pages`):
- `argilla_record_id` (STRING): Record ID in Argilla (e.g., `<doc_id>:<page_num>` or opaque).
- `doc_id` (STRING): As above.
- `page_num` (INT): As above.
- `status` (STRING): e.g., `queued|annotated|reviewed`.
- `annotator_id` (STRING): User who created spans.
- `reviewer_id` (STRING, NULLABLE): Reviewer if applicable.
- `record_sha256` (STRING): Hash of the record JSON payload for audit.
- Optional: `record_json` (JSON): Full Argilla record (enable via ALTER on `annotations_pages`).

2) Spans dataset (staged into `_incoming_spans`):
- `argilla_record_id` (STRING): FK to pages dataset.
- `span_id` (STRING): Unique per record (e.g., `<record_id>:<index>`), or any stable identifier.
- `doc_id` (STRING)
- `page_num` (INT)
- `label` (STRING): Entity label.
- `start` (INT): Byte/char offset start (matching Argilla’s convention).
- `end` (INT): Byte/char offset end (exclusive).
- `text` (STRING): Span substring.
- `text_sha256` (STRING): Hex hash of span text.
- `norm_value` (STRING, NULLABLE): Optional normalized value.
- `annotator_id` (STRING)

Loader Targets
--------------
- Staging → Loaders: `sql/motherduck/load_annotated_parquet.sql` → `argilla_export_loader_from_staged.sql`.
- DB sinks: `md_annotated.main.annotations_exports`, `annotations_pages`, `annotations_spans`.

Validation & Changes
--------------------
- If Argilla exports a different schema (e.g., nested entities), flatten them into the two staging temp tables before running the loader.
- Validate schema with the optional checks in `sql/motherduck/checks_integrity.sql` (see bottom section).
