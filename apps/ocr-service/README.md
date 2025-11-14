# DeepSeek OCR Service

Async ingestion API that accepts PDF uploads from subject matter experts (SMEs), writes them to a durable inbox, and queues work for GPU workers that run DeepSeek OCR. The service stays responsive even when the GPU is busy because uploads are written to storage and published to a queue instead of calling vLLM directly.

## Features

- `POST /upload` stores a PDF, validates metadata, and enqueues a job.
- `GET /status/{task_id}` returns live status, queue depth, and worker metadata.
- `/healthz` and `/readyz` remain responsive because the service never blocks on inference.
- Storage backends are pluggable (local directory by default, S3/R2 ready).
- Redis-backed queue for workers that live on Calypso next to the RTX 4090.

## Configuration

Environment variables use the `OCR_SERVICE_` prefix (see `config.py` for defaults):

| Variable | Default | Description |
| --- | --- | --- |
| `OCR_SERVICE_REDIS_URL` | `redis://localhost:6379/0` | Redis connection for queue/status |
| `OCR_SERVICE_QUEUE_NAME` | `ocr:tasks` | Redis list/stream workers consume |
| `OCR_SERVICE_STORAGE_MODE` | `local` | `local` or `s3` |
| `OCR_SERVICE_STORAGE_ROOT` | `/data/ocr-inbox` | Local path for PDFs (if `local`) |
| `OCR_SERVICE_MAX_PDF_SIZE_MB` | `80` | Upload limit |
| `OCR_SERVICE_TASK_TTL_SECONDS` | `604800` | How long to keep task metadata in Redis |

Run locally with uv:

```bash
cd apps/ocr-service
uv sync
uv run uvicorn ocr_service.app:app --reload
```

When deploying to K3s/Calypso, build the container (Dockerfile uses `uv` multi-stage) and mount the same Redis + storage endpoints the GPU worker uses.
