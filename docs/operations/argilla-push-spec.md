# Argilla Push Worker (Mode A) — Spec

Note: In the confirmed Parquet-centric architecture, Argilla can ingest directly from Parquet exported out of `md_raw_ocr` (see docs/operations/argilla-parquet-flow.md). This Push spec remains useful if you prefer API-based ingestion or as a fallback when Parquet export isn’t available.

Purpose
- Create TokenClassification records in Argilla from latest OCR pages stored in MotherDuck (`md_raw_ocr`).
- Keep the raw DB immutable and maintain provenance (doc_id, page_num, text_sha256, dataset).

Out of Scope
- Running OCR (already done), exporting annotations (Mode B), or transforming text.

Inputs
- MotherDuck (raw): `md_raw_ocr.main.vw_argilla_pages` (latest OCR run per doc)
  - Columns: `doc_id`, `page_num`, `text`, `text_sha256`
- Config:
  - Dataset: `vessels_ocr_<batch_id>` (ULID or semantic ID, e.g., `rfmo_ccsbt_2024q4`)
  - Labelset version: `v1` (string)
  - Env vars: `ARGILLA_API_URL`, `ARGILLA_API_KEY`, `MD_TOKEN`

Outputs
- Records created in Argilla dataset for each `(doc_id, page_num)`.
- Optional: Push log in MotherDuck (see “Push Log Table” below).

API
- Create dataset (once): `POST /api/v1/datasets`
  - Body (example): `{ "name": "vessels_ocr_<batch_id>", "task": "TokenClassification" }`
- Insert records: `POST /api/v1/datasets/{dataset}/records`
  - Auth: `Authorization: ApiKey <ARGILLA_API_KEY>` or `X-Argilla-API-Key`
  - Body (batch): array of record objects (see “Record Payload”).

Record Payload (TokenClassification)
```json
{
  "id": "<doc_id>:<page_num>",
  "text": "... OCR text ...",
  "metadata": {
    "doc_id": "<doc_id>",
    "page_num": <int>,
    "text_sha256": "<sha256>",
    "labelset_version": "v1",
    "source": "deepseek-ocr"
  }
}
```

Batching & Limits
- Batch size: 100–500 records per request (tune per Argilla deployment limits).
- Concurrency: start with 1–2 workers; backoff on 429/5xx.
  - Retry policy: exponential backoff with jitter: 0.5s, 1s, 2s, 4s, 8s (cap 32s), max 7 retries.

Idempotency
- Use stable `id` = `"<doc_id>:<page_num>"` to allow server-side dedupe/upsert.
- Pre-check candidates to avoid re-push:
  - Option A (recommended): motherduck “push log” table to track what was sent.
  - Option B: query Argilla for record existence via search endpoint if available.

Push Log Table (Optional)
```sql
-- In md_annotated (or a separate ops DB) for convenience
CREATE TABLE IF NOT EXISTS argilla_push_log (
  dataset      VARCHAR NOT NULL,
  doc_id       VARCHAR NOT NULL,
  page_num     INTEGER NOT NULL,
  text_sha256  VARCHAR NOT NULL,
  pushed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status       VARCHAR,
  message      VARCHAR,
  PRIMARY KEY (dataset, doc_id, page_num)
);
```

Selection Query (new pages only)
```sql
WITH candidates AS (
  SELECT doc_id, page_num, text, text_sha256 FROM md_raw_ocr.main.vw_argilla_pages
)
SELECT c.*
FROM candidates c
LEFT JOIN md_annotated.main.argilla_push_log l
  ON l.dataset = $dataset AND l.doc_id = c.doc_id AND l.page_num = c.page_num
WHERE l.doc_id IS NULL;
```

Pseudocode
```
connect_motherduck(MD_TOKEN)
dataset = env["ARGILLA_DATASET"] or "vessels_ocr_<batch_id>"
ensure_dataset_exists(dataset, task="TokenClassification")

loop:
  rows = fetch_candidates(limit=500)
  if rows.empty(): break
  payload = [
    { id: f"{r.doc_id}:{r.page_num}", text: r.text,
      metadata: { doc_id: r.doc_id, page_num: r.page_num,
                  text_sha256: r.text_sha256, labelset_version: "v1",
                  source: "deepseek-ocr" } }
    for r in rows
  ]
  try:
    argilla.post(f"/api/v1/datasets/{dataset}/records", json=payload)
    log_push_success(rows)
  except RateLimitOr5xx as e:
    retry_with_backoff()
  except ClientError as e:
    log_push_failure(rows, e)
```

Error Handling
- 4xx: log row-level failures; do not retry unless 409 duplicate (ignore).
- 429/5xx: retry with exponential backoff.
- Circuit breaker: pause after N consecutive failures (e.g., 10) for 5–10 minutes.

Observability
- Counters: rows selected, posted, failed, retried.
- Gauge: backlog (new candidates remaining).
- Latency: Argilla POST duration.

Security
- Keep tokens in ESC; never log full payloads on failure (log counts and IDs only).
