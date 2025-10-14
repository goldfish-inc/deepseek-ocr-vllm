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
- ESC / Pulumi config keys (cluster stack):
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.accessKeyId`
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.secretAccessKey`
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.bucketName`
  - `pulumiConfig.oceanid-cluster:aws.labelStudio.region`
  - Optional overrides:
    - `aws.labelStudio.endpoint` (S3-compatible endpoint)
    - `aws.labelStudio.importPrefix`
    - `aws.labelStudio.exportPrefix`
    - `aws.labelStudio.importRegex`
    - `aws.labelStudio.importTitle` / `aws.labelStudio.exportTitle`
- Label Studio Helm chart reads `AWS_*` env vars for file persistence (`persistence.type: s3`).
- **Per-project storage is now automated**:
  - The provisioner job calls `/api/storages/s3/` and `/api/storages/export/s3/` to create project-scoped import/export storage using the ESC values above.
  - Prefix templating:
    - `aws.labelStudio.importPrefix` / `exportPrefix` act as base paths. They support `{project}` (slugified title + id) and `{project_id}` placeholders.
    - If no placeholders are provided, we append `/<project-slug>-<id>/import/` (or `/export/`) automatically so each project lands in its own folder.
    - Example (defaults): `raw-uploads/ner-data-123/import/` for uploads, `annotations/ner-data-123/export/` for completed labels.
  - Import storage defaults to presigned URLs (`use_blob_urls=true`, `presign=true`) and triggers `/sync` immediately so assets appear without manual UI work.
  - Update prefixes/regex/titles via the Pulumi config keys listed above.
- Remember to configure bucket CORS (`https://label.boathou.se` origin, GET/PUT/POST methods) so presigned URLs load correctly from the browser.
- Note: S3 remains a file store; all project metadata/annotations still live in Postgres.

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

## 3) Analytics / Clean Data DB (cleandata database)

- Purpose: Store ingested documents, extracted spans, and curated tables
- Engine: Postgres (CrunchyBridge)
- ESC keys:
  - `pulumiConfig.oceanid-cluster:cleandataDbUrl` (used by CSV Ingestion Worker)
  - `pulumiConfig.oceanid-cluster:postgres_url` (legacy, being phased out)
- Schema ownership:
  - `stage.*`: CSV worker writes documents, extractions, cleaning_rules, review_queue, etc.
  - `control.*`: migration bookkeeping (control.schema_versions)
  - `curated.*`: IMO registry, RFMO vessels, flag registry, temporal events
  - `label.*`: Label Studio integration mappings
  - `raw.*`: Unprocessed source data
- Migrations:
  - Consolidated schema: `sql/migrations/consolidated_cleandata_schema.sql`
  - Run via `.github/workflows/database-migrations.yml`

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

- **Database: `cleandata`** (Analytics/clean data pipeline)
  - User: `postgres` (superuser for migrations)
  - Schemas: `stage`, `control`, `curated`, `label`, `raw`
  - Managed by: Consolidated schema in `sql/migrations/consolidated_cleandata_schema.sql`
  - ESC key: `pulumiConfig.oceanid-cluster:cleandataDbUrl`
  - Used by: CSV Ingestion Worker, future data pipeline components

**Important**: Both databases are in the **same CrunchyBridge cluster** but properly isolated. The `labelfish` database is exclusively for Label Studio app data, while the `cleandata` database contains all data pipeline schemas for staging, curation, and reference data.

## How to Configure via ESC

**Current configuration** (already set in production):

```bash
# Label Studio DB (already configured)
esc env get default/oceanid-cluster --value pulumiConfig.oceanid-cluster:labelStudioDbUrl
# Returns: postgres://labelfish_owner:***@p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com:5432/labelfish

# Clean Data DB (NEW - used by CSV Ingestion Worker)
esc env get default/oceanid-cluster --value pulumiConfig.oceanid-cluster:cleandataDbUrl
# Returns: postgres://postgres:***@p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com:5432/cleandata

# Legacy Analytics DB (being phased out)
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

## Running Migrations

### From GitHub Actions (workflow_dispatch)

Trigger manually from Actions tab - requires self-hosted runner with database access:
```bash
gh workflow run database-migrations.yml -f migration_version=all -f dry_run=false
```

### Manually from Local Machine

Requires your IP to be whitelisted in CrunchyBridge firewall:

```bash
# Get database URL from ESC
export DATABASE_URL=$(esc env get default/oceanid-cluster pulumiConfig.oceanid-cluster:postgres_url --value string --show-secrets)

# Test connection
psql "$DATABASE_URL" -c "SELECT version();"

# Run specific migration
psql "$DATABASE_URL" -f sql/migrations/V3__staging_tables_complete.sql

# Check migration history
psql "$DATABASE_URL" -c "SELECT domain, version, activated_at FROM control.schema_versions ORDER BY activated_at;"
```

## CrunchyBridge Firewall Management

### Overview

All cluster database egress routes through the **egress gateway pod** (SNAT + proxy) on `srv712429`. This unified egress point means the CrunchyBridge firewall **only needs one IP**: the control plane's public address.

**Network**: `ebisu-network` (ID: `ooer7tenangenjelkxbkgz6sdi`)
**Required IP**: `157.173.210.123/32` (srv712429 public IP)

### Prerequisites

Install the CrunchyBridge CLI:
```bash
brew install crunchy-bridge/brew/cb

# Authenticate (uses 1Password token)
export BRIDGE_TOKEN=$(op read "op://Private/CrunchyBridge API Token/credential")
cb login --token "$BRIDGE_TOKEN"

# Verify access
cb cluster list
```

### List Current Firewall Rules

```bash
cb network list-firewall-rules --network ooer7tenangenjelkxbkgz6sdi
```

Expected output shows rule ID, CIDR, and description for each allowed IP.

### Remove Stale Worker IPs

After migrating to unified egress, remove any legacy node-specific rules:

```bash
# List rules and identify stale IPs (e.g., 191.101.1.3/32 for srv712695, calypso's IP)
cb network list-firewall-rules --network ooer7tenangenjelkxbkgz6sdi

# Remove by rule ID
cb network remove-firewall-rule --network ooer7tenangenjelkxbkgz6sdi --rule <RULE_ID>
```

**Important**: Keep only `157.173.210.123/32` (srv712429 egress gateway). Stale rules defeat the purpose of centralized egress.

### Add New IP (Emergency Only)

If the egress gateway moves to a different host:

```bash
cb network add-firewall-rule \
  --network ooer7tenangenjelkxbkgz6sdi \
  --rule <NEW_IP>/32 \
  --description "srv712429-oceanid egress gateway"
```

### Verify Egress Routing

After firewall changes, confirm all cluster traffic routes through the gateway:

```bash
# 1. Check egress gateway is running
kubectl -n egress-system get pod -l app=egress-gateway
kubectl -n egress-system logs deploy/egress-gateway -c squid --tail=20

# 2. Verify apps have proxy env vars
kubectl -n apps exec deploy/csv-ingestion-worker -- env | grep -i proxy

# 3. Test HTTP egress from worker pod
kubectl -n apps exec deploy/csv-ingestion-worker -it -- \
  curl -s --max-time 5 https://ipinfo.io/ip

# Expected: 157.173.210.123

# 4. Test database connectivity from worker pod
kubectl -n apps exec deploy/csv-ingestion-worker -it -- \
  nc -zvw5 egress-db-proxy.apps.svc.cluster.local 5432

# Expected: Connection to egress-db-proxy.apps.svc.cluster.local (10.43.x.x) 5432 port [tcp/postgresql] succeeded

# 5. Check database connection from app
kubectl -n apps logs deploy/csv-ingestion-worker --tail=50 | grep -i "database\|postgres"

# Expected: Successful connection messages, no timeout errors
```

### Quick Smoke Test

Run the automated smoke test script:

```bash
./scripts/egress-smoke.sh
```

This validates:
- HTTP egress IP matches gateway (157.173.210.123)
- Proxy environment variables are set on apps
- Database proxy is reachable from apps
- Gateway logs show recent traffic

### Troubleshooting

**Symptom**: Pods timeout connecting to database (15s timeout)

**Diagnosis**:
```bash
# Check if worker IP is bypassing gateway
kubectl -n apps exec deploy/csv-ingestion-worker -- curl -s https://ipinfo.io/ip

# If output is NOT 157.173.210.123, egress routing is broken
```

**Fix**:
1. Verify NetworkPolicy allows egress-system traffic:
   ```bash
   kubectl get networkpolicy -n apps
   ```
2. Check proxy env vars are injected:
   ```bash
   kubectl -n apps get deploy csv-ingestion-worker -o yaml | grep -A5 "env:"
   ```
3. Restart affected pods:
   ```bash
   kubectl -n apps delete pod -l app=csv-ingestion-worker
   ```

**Symptom**: "Connection refused" to egress-db-proxy

**Diagnosis**:
```bash
# Check if service exists
kubectl -n apps get svc egress-db-proxy

# Check if tethys tunnel is healthy
kubectl -n apps logs deploy/egress-db-proxy --tail=30
```

**Fix**:
1. Ensure tethys SSH credentials are in cluster
2. Redeploy egress-db-proxy pod
3. Verify tethys node is reachable from within cluster

### API Reference

CrunchyBridge REST API endpoints (alternative to CLI):

```bash
# List firewall rules
curl -X GET "https://api.crunchybridge.com/network/${NETWORK_ID}/firewall" \
  -H "Authorization: Bearer $BRIDGE_TOKEN"

# Add firewall rule
curl -X POST "https://api.crunchybridge.com/network/${NETWORK_ID}/firewall" \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cidr": "157.173.210.123/32",
    "description": "srv712429-oceanid egress gateway"
  }'

# Remove firewall rule
curl -X DELETE "https://api.crunchybridge.com/network/${NETWORK_ID}/firewall/${RULE_ID}" \
  -H "Authorization: Bearer $BRIDGE_TOKEN"
```

## Backups & Access

- CrunchyBridge: enable automated backups; create a read‑only user for BI
- S3: bucket lifecycle for cost control; pre‑signed URLs for private access in tasks
- HF: private dataset; token rotated regularly

## FAQ

- **Can S3 replace the Label Studio DB?** → No. LS requires a relational DB; S3 stores files only.

- **Can we share the same DB for LS and analytics?** → We use separate databases (`labelfish` vs `cleandata`) in the same CrunchyBridge cluster for blast-radius isolation and ownership clarity.

- **Do we need to run SQL migrations for Label Studio?** → No. Label Studio applies its own migrations automatically on startup to the `labelfish` database. Our SQL migrations only apply to the `cleandata` database.

- **What database does the CI/CD workflow apply migrations to?** → The `database-migrations.yml` workflow now targets the `cleandata` database. It manages schemas: `stage`, `control`, `curated`, `label`, `raw`.

- **Why do database migrations fail in GitHub Actions?** → The CrunchyBridge database has firewall rules that only allow specific IPs. GitHub Actions runners use dynamic IPs from large CIDR ranges. For security, we don't whitelist all GitHub IPs. Run migrations manually from an allowed IP or use workflow_dispatch with a self-hosted runner that has database access.

- **How is the CrunchyBridge firewall managed now?** → All cluster egress flows through the **egress gateway pod** on `srv712429`. Keep only `157.173.210.123/32` in the allowlist and remove legacy worker IPs. See the **"CrunchyBridge Firewall Management"** section above for detailed CLI commands, verification steps, and troubleshooting.

- **What's the difference between cleandata and the old postgres database?** → The `cleandata` database is the new dedicated database for our data pipeline (CSV ingestion, staging, curation). The old `postgres` database is being phased out. All new data pipeline components should use `cleandata`.

- **Where is the ebisu backend database?** → Ebisu backend will read from the `cleandata` database's curated schemas. Label Studio (deployed in oceanid cluster) uses the separate `labelfish` database.

## Related Documentation

- [Cluster Networking Architecture](./networking.md) - Network topology, security model, DNS, troubleshooting
- [Operations Overview](./overview.md) - Day-to-day operations and runbooks
- [Self-Hosted Runner](./self-hosted-runner.md) - GitHub Actions runner setup
- [CSV Ingestion Worker](./csv-ingestion-worker.md) - Data pipeline worker configuration
