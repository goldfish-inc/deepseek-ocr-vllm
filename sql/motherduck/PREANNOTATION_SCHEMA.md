# Pre-annotation Suggestions — Parquet Schema (Expected)

This schema defines the Parquet output written by the Spark + Ollama pre-annotation job. It is consumed alongside the pages Parquet during Argilla ingestion to pre-fill predicted spans.

Columns (one row per span)
- `doc_id` (STRING) — Document ULID/UUID.
- `page_num` (INT) — Page number (1-based).
- `span_id` (STRING) — Unique per page (e.g., `${doc_id}:${page_num}:${hash}` or `${record_id}:${idx}`).
- `label` (STRING) — Entity label (must align with Argilla labelset).
- `start` (INT) — Character offset (inclusive) in page `text`.
- `end` (INT) — Character offset (exclusive) in page `text`.
- `text` (STRING) — Extracted substring `text[start:end]`.
- `text_sha256` (STRING) — Hex hash of `text`.
- `confidence` (DOUBLE, NULLABLE) — Model confidence or heuristic score.
- `model` (STRING) — Model name (e.g., `llama3.3:70b`).
- `model_version` (STRING, NULLABLE) — Optional model/image digest.
- `generated_at` (TIMESTAMP) — Time the suggestion was generated.

Notes
- Offsets must match the exact page text that Argilla will display.
- Keep label set consistent with Argilla dataset.
- Use ZSTD compression; partition by `doc_id` to scale ingestion.
