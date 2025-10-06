---
name: HF→DB backfill CronJob (idempotent)
about: Periodically sync annotations from HF dataset JSONL into Postgres
title: "Add HF→DB backfill CronJob with UPSERTs"
labels: enhancement, reliability, data-pipeline
assignees: ''
---

Summary

Add a CronJob that reads new records from the HF dataset and upserts them into Postgres (`stage.documents`, `stage.extractions`, `stage.pdf_boxes`). Ensures DB catches up after outages with no duplicates.

Acceptance Criteria

- [ ] CronJob runs hourly (configurable) and processes only new items
- [ ] Idempotent UPSERTs keyed by (project_id, task_id, annotation_id, updated_at)
- [ ] PDF boxes include PDF-point conversion when `pdf_url` available
- [ ] Metrics: processed_total, upserted_total, skipped_total
- [ ] Docs: add troubleshooting and manual run instructions

Notes

- Keep HF dataset as system of record; DB used for QA/analytics. This job makes DB eventually consistent.
