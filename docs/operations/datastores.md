# Datastores & Storage (Oceanid)

Oceanid’s annotation stack has three primary data planes:

1. **Argilla workspace storage** – in-cluster PostgreSQL + Elasticsearch (short-lived annotation state).
2. **MotherDuck / CrunchyBridge** – durable source-of-truth for OCR/NER outputs and curated tables.
3. **External datasets** – Hugging Face repos for audit/training deliverables.

Cloudflare R2 plus DuckDB/MotherDuck bindings handle document ingestion in the new Worker pipeline (`VESSEL_NER_CLOUDFLARE_WORKPLAN.md`). The legacy Label Studio buckets/DBs are retired.

## 1. Argilla Workspace (in-cluster)

- Deployments live in `clusters/tethys/apps/argilla.yaml` (Postgres + Elasticsearch StatefulSets + Argilla Deployment).
- Secrets (managed by Pulumi via `cluster/src/index.ts`):
  - `argillaPostgresPassword`
  - `argillaAuthSecret`
  - `argillaAdminPassword`
  - `argillaAdminApiKey`
  - `argillaRedisUrl`
  - `huggingFaceToken`
- Public access: `https://label.boathou.se` through the Cloudflare tunnel (`cloud/src/index.ts`). Internal URL: `http://argilla.apps.svc.cluster.local:6900`.
- Workspace DBs are ephemeral—only Argilla owns this storage. All finalized annotations are exported via the Argilla webhook/Worker flow into MotherDuck.

## 2. Clean / Stage / Curated (CrunchyBridge `cleandata`)

- Purpose: store ingested documents, NER spans (Ollama Worker), cleaning rules, curated vessel data.

Current pipeline tables (MotherDuck)
- `md.raw_ocr`
  - pdf_name (VARCHAR), page_number (INTEGER)
  - text (TEXT), clean_text (TEXT), has_tables (BOOLEAN)
  - timestamp (TIMESTAMP), metadata (JSON)
- `md.entities`
  - document_id (VARCHAR), entity_type (VARCHAR), entity_text (TEXT)
  - start_char (INTEGER), end_char (INTEGER), confidence (DOUBLE)
  - extracted_at (TIMESTAMP), model (VARCHAR)
- `md.entity_corrections`
  - document_id, original_entity_type, corrected_entity_type
  - original_text, corrected_text, corrected_by, corrected_at (TIMESTAMP)
  - correction_type (VARCHAR)
- ESC key: `pulumiConfig.oceanid-cluster:cleandataDbUrl` (used by CSV ingestion worker and future services).
- Schemas:
  - `stage.*` (raw documents, cell extractions, review queue)
  - `control.*` (schema versions)
  - `curated.*` (reference datasets)
  - `label.*` (legacy tables; kept until Argilla export fully replaces them)
- Migrations: `sql/migrations/V*.sql` applied via `database-migrations.yml` (versioned path only).

## 3. MotherDuck (`vessel_intelligence`)

- Designed for the Cloudflare Worker pipeline.
- Tables (parquet-backed): `raw_ocr`, `entities`, `entity_corrections`, plus staging views for export.
- Credentials: `MOTHERDUCK_TOKEN` secret in Wrangler projects (`workers/vessel-ner/wrangler*.toml`).
- Acts as the bridge between Workers, Argilla, and CrunchyBridge.

## 4. Hugging Face Datasets

- Repo(s): `goldfish-inc/argilla-annotated`, `goldfish-inc/deepseekocr-output`, etc.
- ESC keys: `pulumiConfig.oceanid-cluster:hfAccessToken`, `...:hfDatasetRepo`, `...:hfDatasetRepoNER`, etc. (see `cloud/README.md`).
- Updated by exporters (either the Argilla webhook Worker or Annotations Sink, depending on stage).

## 5. Cloudflare R2 (planned roll-out)

- Bucket: `vessel-pdfs` (created via `wrangler r2 bucket create vessel-pdfs`).
- Bindings defined in `workers/vessel-ner/wrangler.toml`.
- Receives SME uploads via the Stage 2 upload handler worker, then feeds OCR/NER workers.

## Legacy Assets Removed

- Label Studio S3 prefixes/buckets, PAT scripts, and CrunchyBridge `labelfish` database are decommissioned. Any reference to `aws.labelStudio.*`, `labelStudioDbUrl`, or `labelStudioPat` should be considered historical only.
- SME instructions now live in `@docs/guides/SME/project-setup.mdx` and point to the Argilla deployment + workplan.
