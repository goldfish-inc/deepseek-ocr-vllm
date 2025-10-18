# ls-triton-adapter

Bridges Label Studio to Triton Inference Server for NER. Provides:
- `/setup` – ML backend config for LS
- `/predict` – JSON API (text or base64 PDF/image with Docling)
- `/predict_ls` – Label Studio-formatted predictions
- `/metrics` – Minimal Prometheus metrics
- `/health` – Health check

Notes
- Warmup: on start, performs a tiny inference to pre-load tokenizer and model.
- Safety: logs a warning if Triton `num_labels` differs from configured `NER_LABELS`.
- Environment: `TRITON_BASE_URL`, `TRITON_MODEL_NAME` (e.g., `ner-distilbert`), optional Cloudflare Access headers.

Metrics (Prometheus text)
- `oceanid_requests_total{endpoint}` – total requests
- `oceanid_errors_total{endpoint}` – error count
- `oceanid_latency_ms_sum{endpoint}` – sum of latencies
- `oceanid_tokens_total` – tokens processed (approx.)

Run
- Deployed via Pulumi in `cluster/src/components/lsTritonAdapter.ts`.
- Auto-connect component registers the ML backend with Label Studio on project creation.
