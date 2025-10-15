# ML Backend & Ingest (2025-10)

This document describes the in‑cluster ML backend (adapter), the raw ingestion path, and the project auto‑provisioning for SMEs.

## Overview

- Adapter: `ls-triton-adapter` (**Go service**, ~80Mi RAM) in namespace `apps`
  - Health: `/health` (200 OK)
  - Prediction: `/predict` (internal) and `/predict_ls` (Label Studio payloads)
  - Normalizes inputs for prelabels:
    - Text → NER
    - CSV → header‑aware flattening → NER (simplified in Go)
- Sink: `annotations-sink` (**Go service**, ~50Mi RAM) in namespace `apps`
  - Health: `/health` (includes DB connectivity status)
  - Webhook: `/webhook` for annotation events — enqueues to a Postgres outbox and asynchronously commits JSONL shards to the correct Hugging Face dataset repo based on task type:
    - Text NER → `HF_REPO_NER` (fallback `HF_REPO`)
    - PDF layout/boxes (Docling) → `HF_REPO_DOCLING` (fallback `HF_REPO`)
    - Shard path: `vertical=<vertical>/schema-<version>/project-<id>/YYYY/MM/DD/HH/batch-<uuid>.jsonl`
    - Outbox columns: `target_repo`, `task_type`, `vertical` (added for routing/lineage)
  - Ingest: `/ingest` for task-create events (writes raw rows to `stage.table_ingest` and flattened text to `stage.documents`)
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
- Project `NER_Data`: can be provisioned automatically by a one‑off Job (gated by Pulumi config `enableLsProvisionerJob`) with a full NER interface.
- Provisioner auto-configures project S3 storage (import + export) using ESC-managed AWS credentials, presigned URLs, regex filters, and triggers an immediate sync, so no manual storage setup is required in the UI.
- Labeling Interface mapping: the primary control is `<Labels name="label" toName="text" ...>`. An optional HTML Labels control (e.g., `name="label_html" toName="html"`) may exist for read‑only/auxiliary views—it's not required for CSV/XLSX flows.

## PDF Boxes (Hybrid)

- UI: Label Studio renders page images for box tools while still showing a pdf.js preview.
- Storage: The sink writes box rows to `stage.pdf_boxes` on every annotation webhook.
  - Fields include percent geometry and, when possible, PDF-point geometry (x_pt/y_pt/w_pt/h_pt) computed in-cluster using the source PDF page size.
  - `stage.v_pdf_boxes_latest` view exposes the latest per unique box for QA.
- Training: consume PDF-point geometry directly, or convert back to pixels at any DPI on demand.

## Datasets & Storage

- Annotations (JSONL shards):
  - NER: `hfDatasetRepoNER` (ESC) → env `HF_REPO_NER`
  - Docling: `hfDatasetRepoDocling` (ESC) → env `HF_REPO_DOCLING`
  - Fallback/default: `hfDatasetRepo` → env `HF_REPO`
- Original PDFs:
  - Not stored in Hugging Face, GitHub, or Postgres.
  - SMEs configure per‑project S3 storage in Label Studio. The sink stores only references (URL and derived `s3_bucket`, `s3_key`, optional `s3_version_id`) and a stable `source_tag` for auditing.

Training consumers read annotation shards (`vertical=` or `schema-` paths) and may fetch original PDFs directly from S3 if required, using the stored S3 references. The system does not copy PDF bytes into HF or DB.

## CSV/XLSX Handling

- CSV: system reads rows; if header row detected, flattens as `Header: Value` lines for NER.
- XLSX: system parses `.xlsx` via stdlib (zip/xml shared strings and sheets), producing `Header: Value` lines.
- Both raw rows are stored under `stage.table_ingest` for downstream ETL/testing.
- UI note: Because rows are flattened to text, predictions and annotations bind to the Text control; an HTML Labels control is not needed for tables.

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
- Labeling Interface validation error “Label config contains non‑unique names”: Ensure only one Labels block uses `name="label"`. If an HTML Labels block is present, use a different name like `label_html`.
- Provisioner/verify jobs: disable with Pulumi config `enableLsProvisionerJob=false` or `enableLsVerifyJob=false` if you want to manage projects purely via UI.
