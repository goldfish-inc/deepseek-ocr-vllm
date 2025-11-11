# Argilla Pull Worker (Mode B) — Spec

Purpose
- Export annotated records from Argilla and ingest them into MotherDuck `md_annotated` using `argilla_export_loader.sql`.
- Maintain append-only versioning via `export_run_id` and preserve provenance.

Out of Scope
- Any normalization into Postgres vessel warehouse (deferred to Phase 6+).

Inputs
- Argilla dataset name: `vessels_ocr_<batch_id>`
- Env vars: `ARGILLA_API_URL`, `ARGILLA_API_KEY`, `MD_TOKEN`
- Optional filter: export only records updated since last run (if API supports `updated_from`/`since`).

Outputs
- MotherDuck `md_annotated.main.annotations_exports`, `annotations_pages`, `annotations_spans` populated for a new `export_run_id`.

API
- Export annotated records: use Argilla REST export or official client library.
  - Endpoint pattern: `/api/v1/datasets/{dataset}/records` with query/pagination, include annotations and status.
  - Include per-record fields: `id`, `text`, `metadata.doc_id`, `metadata.page_num`, `status`, and `annotation.entities` (label, start, end, annotator).

MotherDuck Loader (provided)
- `sql/motherduck/argilla_export_loader.sql` handles:
  - Allocating `export_run_id` (monotonic)
  - Idempotent inserts into `annotations_pages` and `annotations_spans`
  - Finalizing export header (`annotations_exports`)

Staging Shape (temp tables)
```sql
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
```

Mapping (pseudocode)
```
for each record in argilla_export:
  pages += {
    argilla_record_id: record.id,
    doc_id: record.metadata.doc_id,
    page_num: int(record.metadata.page_num),
    status: record.status,
    annotator_id: record.annotation.annotator_id,
    reviewer_id: record.annotation.reviewer_id,
    record_json: record,  # optional audit
    record_sha256: sha256(json_dump(record))
  }
  for idx, ent in enumerate(record.annotation.entities):
    spans += {
      argilla_record_id: record.id,
      span_id: f"{record.id}:{idx}",
      doc_id: record.metadata.doc_id,
      page_num: int(record.metadata.page_num),
      label: ent.label,
      start: ent.start,
      end: ent.end,
      text: record.text[ent.start:ent.end],
      text_sha256: sha256(record.text[ent.start:ent.end]),
      norm_value: null,
      annotator_id: ent.annotator_id
    }
```

Execution Flow
1) Fetch Argilla records (paginate; consider `updated_from=last_completed_at`).
2) Open DuckDB connection with MotherDuck extension; `ATTACH 'md:md_annotated' AS anndb (READ_WRITE); SET schema 'anndb.main';`
3) Create temp tables; insert page and span rows.
4) `.read sql/motherduck/argilla_export_loader.sql` (uses `_params` for dataset metadata; or set `_params` before).
5) Post-ingest checks: query `vw_latest_annotations_spans` and counts per dataset.

Idempotency & Resume
- Primary keys prevent duplicate spans: `(export_run_id, argilla_record_id, span_id)`.
- For re-runs: either allocate a new export_run_id or detect conflicts before inserts (loader does both diagnostics and `INSERT OR IGNORE`).
- To resume partial exports: keep a cursor (`last_record_id` or timestamp) and continue fetching/ingesting.

Batching & Performance
- Page size: 500–2000 records per fetch (tune to API limits and memory).
- Stream large exports to temp tables incrementally to avoid high memory usage.

Error Handling
- Network/5xx: retry with exponential backoff; cap total retries (e.g., 7).
- Partial ingestion: on failure after temp table load but before COMMIT, rerun the same batch (loader is idempotent).

Observability
- Export header: `annotations_exports(record_count, completed_at)` updated by loader.
- Dashboards: use queries in `sql/motherduck/grafana_panels.sql`.

Security
- Keep Argilla and MotherDuck tokens in ESC; redact PII in logs; avoid logging full records.
