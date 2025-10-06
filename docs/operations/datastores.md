# Datastores & Storage (Oceanid)

This document catalogs the storages we use, what each one is for, and how to configure them via ESC and Pulumi.

## Summary

- Object Storage (S3/MinIO): Label Studio asset uploads and Cloud Storage imports
- App DB (Label Studio): Postgres ("labelfish"), backs LS projects/tasks/annotations
- Analytics DB (Clean/Stage/Curated): Postgres (CrunchyBridge), used by Annotations Sink and SQL migrations
- Model Dataset (HF): Versioned JSONL for training and audit

## 1) Object Storage (S3/MinIO)

- Purpose: Durable storage of uploaded files and Cloud Storage task sources
- Bucket: `labelstudio-goldfish-uploads`
- ESC keys (cluster stack):
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.accessKeyId`
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.secretAccessKey`
  - `pulumiConfig.ocean-cluster:aws.labelStudio.bucketName`
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.region`
- LS Deployment uses these via env:
  - `USE_BLOB_URLS=true`, `AWS_*`
- Note: S3 is not a database; it stores files referenced by tasks.

## 2) Label Studio App DB (labelfish)

- Purpose: Relational database for LS app data (projects, tasks, users, annotations)
- Engine: Postgres (CrunchyBridge recommended)
- ESC key:
  - `pulumiConfig.oceanid-cluster:labelStudioDbUrl`
    - Example: `postgresql://ls_user:ls_pass@p.<cluster>.db.postgresbridge.com:5432/labelfish?sslmode=require`
- Provisioning (CrunchyBridge):
  - Create database `labelfish`
  - Create user `ls_user` with password
  - Grant `CONNECT`, `CREATE`, `TEMP` on `labelfish`; LS manages its own schema via migrations
- Notes:
  - Keep this DB separate from analytics schemas to avoid accidental cross‑writes
  - Backups: daily; retain ≥7 days

## 3) Analytics / Clean Data DB (stage/control/label/curated)

- Purpose: Store ingested documents, extracted spans, and curated tables
- Engine: Postgres (CrunchyBridge)
- ESC key (used by Annotations Sink):
  - `pulumiConfig.oceanid-cluster:postgres_url`
- Schema ownership:
  - `stage.*`: sink writes documents, extractions, table_ingest, pdf_boxes, etc.
  - `control.*`: migration bookkeeping (control.schema_versions)
  - `curated.*`, `label.*`, `raw.*`: created via `sql/migrations/*`
- Migrations:
  - Run via `.github/workflows/database-migrations.yml` or `make db:migrate`

## 4) Model Dataset (Hugging Face)

- Purpose: Append‑only JSONL for audit/training
- ESC keys:
  - `pulumiConfig.oceanid-cluster:hfAccessToken`
  - `pulumiConfig.oceanid-cluster:hfDatasetRepo`
- Written by Annotations Sink on webhook events

## Current Production Layout (CrunchyBridge)

**Single CrunchyBridge cluster**: `p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com`

- **Database: `labelfish`** (Label Studio app data)
  - User: `labelfish_owner` (auto-created by CrunchyBridge)
  - Stores: projects, tasks, annotations, users, Label Studio metadata
  - Schema: Managed by Label Studio's own migrations (automatic on startup)
  - ESC key: `pulumiConfig.oceanid-cluster:labelStudioDbUrl`

- **Database: `postgres`** (Analytics/clean data)
  - User: `u_ogfzdegyvvaj3g4iyuvlu5yxmi` (auto-created)
  - Schemas: `stage`, `control`, `curated`, `label`, `raw`
  - Managed by: SQL migrations in `sql/migrations/` via GitHub Actions workflow
  - ESC key: `pulumiConfig.oceanid-cluster:postgres_url`

**Important**: Both databases are in the **same CrunchyBridge cluster** but properly isolated. The `labelfish` database is exclusively for Label Studio app data, while the `postgres` database contains all analytics schemas managed by our SQL migrations.

## How to Configure via ESC

**Current configuration** (already set in production):

```bash
# Label Studio DB (already configured)
esc env get default/oceanid-cluster --value pulumiConfig.oceanid-cluster:labelStudioDbUrl
# Returns: postgres://labelfish_owner:***@p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com:5432/labelfish

# Analytics DB (already configured)
esc env get default/oceanid-cluster --value pulumiConfig.oceanid-cluster:postgres_url
# Returns: postgres://u_ogfzdegyvvaj3g4iyuvlu5yxmi:***@p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com:5432/postgres
```

To update (if needed):

```bash
# Update Label Studio DB URL
esc env set default/oceanid-cluster \
  pulumiConfig.oceanid-cluster:labelStudioDbUrl \
  "postgresql://labelfish_owner:password@p.<cluster>.db.postgresbridge.com:5432/labelfish" \
  --secret

# Update Analytics DB URL
esc env set default/oceanid-cluster \
  pulumiConfig.oceanid-cluster:postgres_url \
  "postgresql://user:password@p.<cluster>.db.postgresbridge.com:5432/postgres" \
  --secret
```

## Backups & Access

- CrunchyBridge: enable automated backups; create a read‑only user for BI
- S3: bucket lifecycle for cost control; pre‑signed URLs for private access in tasks
- HF: private dataset; token rotated regularly

## FAQ

- **Can S3 replace the Label Studio DB?** → No. LS requires a relational DB; S3 stores files only.

- **Can we share the same DB for LS and analytics?** → We use separate databases (`labelfish` vs `postgres`) in the same CrunchyBridge cluster for blast-radius isolation and ownership clarity.

- **Do we need to run SQL migrations for Label Studio?** → No. Label Studio applies its own migrations automatically on startup to the `labelfish` database. Our SQL migrations (`.github/workflows/database-migrations.yml`) only apply to the analytics `postgres` database.

- **What database does the CI/CD workflow apply migrations to?** → The `database-migrations.yml` workflow uses `postgres_url` which points to the `postgres` database (not `labelfish`). It creates/updates schemas: `stage`, `control`, `curated`, `label`, `raw`.

- **Where is the ebisu backend database?** → Ebisu backend uses the same CrunchyBridge analytics database (`postgres_url`) to read from curated schemas. Label Studio (deployed in oceanid cluster) is separate.

