# ML Backend & Ingest (2025-10)

This document describes the in‑cluster ML backend (adapter), the raw ingestion path, and the project auto‑provisioning for SMEs.

## Overview

- Adapter: `ls-triton-adapter` (FastAPI) in namespace `apps`
  - Health: `/health` (200 OK)
  - Setup: `/setup` (GET/POST) for Label Studio model validation
  - Prediction: `/predict` (internal) and `/predict_ls` (Label Studio payloads)
  - Normalizes inputs for prelabels:
    - Text → NER
    - PDF → Docling text → NER
    - CSV/XLSX → header‑aware flattening → NER
- Sink: `annotations-sink` (FastAPI) in namespace `apps`
  - Health: `/health`
  - Webhook: `/webhook` for annotation events (appends JSONL to HF dataset; writes spans to stage.extractions)
  - Ingest: `/ingest` for task‑create events (writes raw rows to `stage.table_ingest` and flattened text to `stage.documents`)
- Provisioner (one‑off Job): `ls-provisioner-ner-data`
  - Connects ML backend to project `NER_Data`
  - Applies full NER labeling interface (from ESC `NER_LABELS` or `labels.json`)
  - Registers webhook for `TASK_CREATED`/`TASKS_BULK_CREATED` → sink `/ingest`

## Images (GHCR, private)

- Adapter: `ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:main`
- Sink: `ghcr.io/goldfish-inc/oceanid/annotations-sink:main`
- Configure a cluster imagePullSecret via Pulumi config:
  - `ghcrUsername` (GitHub user/bot)
  - `ghcrToken` (PAT with `read:packages`)

## Label Studio Integration

- ML Backend URL: `http://ls-triton-adapter.apps.svc.cluster.local:9090`
- Health: `/health`
- Setup: `/setup` (GET/POST)
- Project `NER_Data`: provisioned automatically by Job with a full NER interface.

## CSV/XLSX Handling

- CSV: system reads rows; if header row detected, flattens as `Header: Value` lines for NER.
- XLSX: system parses `.xlsx` via stdlib (zip/xml shared strings and sheets), producing `Header: Value` lines.
- Both raw rows are stored under `stage.table_ingest` for downstream ETL/testing.

## Database Tables (stage)

- `stage.documents(text, external_id, source, created_at)`
- `stage.extractions(document_id, label, value, start, end, confidence, db_mapping, annotator, updated_at)`
- `stage.table_ingest(document_id, rows_json, meta, created_at)`

## Security

- Label Studio PAT is stored only in ESC and materialized as a K8s Secret for the provisioner.
- GHCR images are private; the cluster uses `apps/ghcr-creds` to pull.

## Troubleshooting

- Adapter readiness/liveness: `/health`
- LS model connect: `/setup` must return 200 for GET and POST
- CSV/XLSX prelabels missing: verify signed URLs resolve and adapter logs for fetch errors
- Ingest counts:
  - `select count(*) from stage.table_ingest;`
  - `select count(*) from stage.documents;`

