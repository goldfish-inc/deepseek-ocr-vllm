# Pre-annotation (Spark + Ollama) — Spec

Purpose
- Generate machine suggestions (spans) for SMEs to review in Argilla, increasing throughput.
- Keep raw/annotated DBs clean: write suggestions only to Parquet in object storage.

Inputs
- MotherDuck: `md_raw_ocr.main.vw_argilla_pages` (doc_id, page_num, text, text_sha256)
- Model: Ollama (e.g., llama3.3:70b) via DGX endpoint (`http://spark-291b:11434` or `https://ollama.goldfish.io` after Access fix).
- Batch scope: list of `doc_id`s or dataset prefix `vessels_ocr_<batch_id>`.

Outputs
- Parquet suggestions at `s3://…/argilla/in/<dataset>/suggestions/` with columns from `sql/motherduck/PREANNOTATION_SCHEMA.md`.

Flow
1) Query pages: read `doc_id, page_num, text, text_sha256` from `vw_argilla_pages` for batch.
2) Chunking: ensure model max-token safe (e.g., 4–8k tokens per request). If chunked, map chunk offsets back to page offsets.
3) Inference: call Ollama `/api/generate` or `/api/chat` with an extraction prompt; return entities with label, start, end, confidence.
4) Offsets: compute absolute page offsets (start, end) against full page text.
5) Emit Parquet: write rows with `doc_id, page_num, span_id, label, start, end, text, text_sha256, confidence, model, model_version, generated_at`.

Schema
- See `sql/motherduck/PREANNOTATION_SCHEMA.md`.
- `span_id` can be `${doc_id}:${page_num}:${lower_sha1(start||end||label)}` or a monotonic index per page.

Batching & Performance
- Page fetch size: 1–5k pages per partition (Spark DataFrame partitioning by doc_id/page_num).
- Inference concurrency: start with 1–4 concurrent requests per GPU; adjust based on 11434 CPU/GPU saturation.
- Retries: exponential backoff on 429/5xx; skip after N attempts and log.

Security
- Access DGX via Tailscale or Cloudflare Access service token; keep creds in ESC.
- Do not log full text; log counts and IDs only.

Observability
- Counters: pages processed, spans produced, failures.
- Latency: per request latency; tokens/sec if available.
- Output size: Parquet rows per dataset.

Integration with Argilla
- Argilla loader merges suggestions Parquet with pages Parquet when creating records.
- No API writes required; suggestions are predictions visible to SMEs.
