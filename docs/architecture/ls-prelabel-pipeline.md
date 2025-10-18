# Label Studio Unified Prelabel + Intelligence DB

Goal: Prelabel CSV/XLSX/PDF/Image/Text in Label Studio, capture SME corrections, and persist clean, versioned records in Postgres with lineage. Retrain NER nightly and publish ONNX with config + VERSION.json.

## Components
- Label Studio (LS) with S3 storage + webhooks
- Adapter (ls-triton-adapter): router + normalizer (CSV/Table/Text → batch NER → LS predictions)
- Annotation sink (Go): receives LS webhooks; writes versioned records
- Postgres: documents, records, record_versions, annotations
- Training worker: reads gold, exports ONNX, publishes VERSION.json + config.pbtxt
- Triton ORT on RTX 4090

## Flow
1. Ingest → LS creates task (file_upload S3 URI)
2. Adapter routes by type:
   - text → tokenize → Triton → LS spans
   - pdf/image → Docling text → Triton; Docling tables → CSV normalization → batch Triton → LS spans
   - csv/xlsx → parse rows → normalize row text → batch Triton → LS spans
3. SME fixes labels in LS; submits
4. Webhook → annotation-sink → normalize spans to canonical fields → insert record_versions + lineage (LS ids, model_version, doc s3 key + sha256)
5. Nightly retrain → publish ONNX + config.pbtxt + VERSION.json → Triton reload

## Postgres Schema
See `sql/migrations/20251018_intelligence_db.sql`.

## Adapter Notes
- Keep ONNX model pure (text → tags). CSV/Table parsing stays in adapter.
- Batch size 8–16 to maintain GPU >70% util; tune LS import chunk size (~100 rows).
- Metrics: /metrics (requests, errors, latency, tokens). Warmup on start.
- Optional pooled HTTP for LS/Triton; gRPC for batch mode later.

## Training & Publishing
- Train from Postgres gold records (latest versions)
- Export ONNX; exporter writes `exporter_mode.txt` (modern|legacy_fallback) and VERSION.json
- Publish to model repo: onnx/model.onnx, onnx/config.pbtxt, onnx/VERSION.json

## DGX Spark (Mon)
- Use DGX for high‑throughput CSV/Table preprocessing (RAPIDS) and micro-batch inference at scale
- Use `apps/spark-jobs/conf/rapids.conf` for baseline
- Consider tritonclient[grpc] for lower per‑batch overhead

## Auditability
- Every record version links to LS ids and source document (s3_key + sha256)
- Spans stored for traceability; canonical fields normalized for analytics
