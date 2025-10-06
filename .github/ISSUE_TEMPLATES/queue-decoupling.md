---
name: Queue-based ingestion decoupling (HF/DB reliability)
about: Decouple webhook ingestion from persistence using Upstash Redis Streams or Kafka
title: "Decouple LS ingestion with queue (Upstash Redis Streams)"
labels: enhancement, reliability, ingestion
assignees: ''
---

Summary

Implement a queue-backed ingestion pipeline so Label Studio webhooks enqueue events immediately and a background worker reliably pushes to HF dataset and Postgres.

Context

- Current sink writes to HF dataset (durable) and best-effort to Postgres inline. DB outages cause lag, but annotations are not lost.
- We want continuous, resilient writes with buffering during outages and backpressure control, without blocking LS.

Proposed Solution (Upstash Redis Streams)

- Webhook path:
  - XADD event to `ls_events` and return 200.
  - Optional: also append to HF inline for belt-and-suspenders.
- Worker `hf-writer`:
  - XREADGROUP from `ls_events`.
  - Commit to HF dataset (batch commits or paced) + insert Postgres rows (`stage.documents`, `stage.extractions`, `stage.pdf_boxes`).
  - XACK on success, retry/backoff on failure.
- Idempotency: Use (project_id, task_id, annotation_id, updated_at) composite key to dedupe; optional Redis SET.
- Observability: processed_total, failed_total, db_write_skipped_total; optional DLQ `ls_events:dlq`.

Config (ESC)

- `upstashRedisUrl`: rediss://:<token>@<host>:<port>
- Reuse `hfDatasetRepo`, `hfAccessToken`, `postgres_url`.

Deliverables

- [ ] Sink enqueue mode behind env `REDIS_URL`, `QUEUE_ONLY`.
- [ ] Worker Deployment `hf-writer` (Pulumi), consumer group, graceful shutdown.
- [ ] HF batching strategy + rate limits respected.
- [ ] DB UPSERTs (idempotent) for stage.* tables, PDF-point conversion included.
- [ ] Metrics/counters, optional DLQ.
- [ ] Docs updates (ops + SME notes).

Alternatives

- Kafka/Redpanda if higher throughput/partitioning is needed (managed service preferred).

Notes

- Keep HF dataset as system of record; DB is a sink for analytics/QA.
- Ensure Pulumi-only deploys; no manual kubectl.
