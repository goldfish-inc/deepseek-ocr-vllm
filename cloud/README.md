# Oceanid Cloud Infrastructure

This Pulumi project manages **cloud-only resources** for the Oceanid platform. It runs in GitHub Actions with OIDC authentication and requires **no kubeconfig**.

## Scope

**Managed Resources:**

- **Cloudflare DNS**: CNAME records for K3s API endpoint and GPU node access
- **Cloudflare Access**: Zero Trust application gateways (Label Studio, etc.)
- **CrunchyBridge**: Managed PostgreSQL 17 database cluster
- **Pulumi ESC**: Shared secrets and configuration environment

**NOT Managed Here:**

- Kubernetes cluster resources (see `../cluster/` for K3s bootstrap)
- Application workloads (managed by Flux GitOps in `../clusters/`)

## Stack Configuration

**Stack:** `ryan-taylor/oceanid-cloud/prod`
**ESC Environment:** `default/oceanid-cluster` (shared with cluster bootstrap)

### Required Secrets

Set via Pulumi config:

```bash
# Cloudflare API token (DNS + Access management)
pulumi config set cloudflare:apiToken --secret <token>

# CrunchyBridge API key
pulumi config set oceanid-cloud:crunchybridge_api_key --secret <api_key>
pulumi config set oceanid-cloud:crunchybridge_team_id --secret <team_id>

# Enable CrunchyBridge provisioning
pulumi config set oceanid-cloud:enableCrunchyBridgeProvisioning true
```

## Deployment

### Via GitHub Actions (Recommended)

Changes to `cloud/**` automatically trigger deployment via `.github/workflows/cloud-infrastructure.yml`:

1. Commit changes to `cloud/` directory
2. Push to `main` branch
3. GitHub Actions runs `pulumi up` with OIDC authentication
4. Monitor via `gh run watch`

**Authentication:** Uses GitHub Actions OIDC to Pulumi Cloud
**Concurrency:** Single deployment at a time (per branch)

### Local Development

```bash
cd cloud/

# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Preview changes
pulumi preview

# Deploy changes (NOT recommended - use GitHub Actions)
pulumi up
```

## Importing Existing Resources

All current resources were imported from existing infrastructure. Use these patterns for future imports:

### CrunchyBridge Cluster

```bash
# 1. Add resource definition to src/index.ts with protect: true
# 2. Import using cluster ID
pulumi import --yes \
  crunchybridge:index/cluster:Cluster \
  ebisu \
  <CLUSTER_ID>

# 3. Update code with actual configuration from import output
# 4. Verify no changes: pulumi preview
```

### Cloudflare DNS Record

```bash
# Import format: <zone_id>/<record_id>
pulumi import --yes \
  cloudflare:index/record:Record \
  k3s-cname \
  a81f75a1931dcac429c50f2ee5252955/76faef384cb1bc4db07fbad2c38a4fcb
```

### Cloudflare Access Application

```bash
# Import format: <account_id>/<app_id>
pulumi import --yes \
  cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication \
  label-studio \
  8fa97474778c8a894925c148ca829739/87585388-5de3-43ea-a506-d523e8ad3933
```

### Finding Resource IDs

```bash
# Cloudflare zone ID
pulumi config get cloudflare:zoneId

# Cloudflare DNS record ID
wrangler dns records list --zone-name boathou.se

# CrunchyBridge cluster ID
cb cluster list
```

## CI/CD Requirements

### GitHub Actions OIDC Setup

The workflow uses OIDC authentication with these claims:

- **Audience:** `urn:pulumi:org:ryan-taylor`
- **Subject:** `repo:goldfish-inc/oceanid:*`
- **Token Type:** `urn:pulumi:token-type:access_token:personal` (free tier)

### Environment Variables

Set in workflow file (`.github/workflows/cloud-infrastructure.yml`):

- `PULUMI_STACK`: `ryan-taylor/oceanid-cloud/prod`
- `PULUMI_PROJECT`: `oceanid-cloud`
- `PULUMI_ORGANIZATION`: `ryan-taylor`
- `ESC_ENVIRONMENT`: `default/oceanid-cluster`

### GitHub Secrets

- `PULUMI_CONFIG_PASSPHRASE`: Stack encryption passphrase

## ESC‑only CI (No GitHub Secrets)

All CI workflows use Pulumi ESC via OIDC. No GitHub Secrets or Variables are required for model training or database migrations.

Set these ESC keys once:

```bash
# HF token for training/sink/model publish
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfAccessToken "<HF_WRITE_TOKEN>" --secret

# Optional: repo names (defaults are shown)
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfDatasetRepo "goldfish-inc/oceanid-annotations"
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfModelRepo "goldfish-inc/oceanid-ner-distilbert"

# CrunchyBridge Postgres URL for migrations
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:postgres_url "postgres://<user>:<pass>@p.<cluster-id>.db.postgresbridge.com:5432/postgres" --secret

# Label Studio DB password (manual provisioning only)
esc env set default/oceanid-cluster pulumiConfig.oceanid-cloud:labelStudioOwnerPassword "<strong_password>" --secret
```

Workflows:

- `train-ner.yml` reads `hfAccessToken`, `hfDatasetRepo`, and `hfModelRepo` from ESC.
- `database-migrations.yml` reads `postgres_url` from ESC and applies SQL migrations (V3–V6). It ensures extensions: `pgcrypto`, `postgis`, `btree_gist`.

## Label Studio DB (labelfish) — Manual provisioning on ebisu

Recommended (keeps CI safe and LS isolated from staging/curated):

```bash
# 1) Create database in CrunchyBridge "ebisu" (example owner shown)
cb psql 3x4xvkn3xza2zjwiklcuonpamy --role postgres -- -c \
  "CREATE DATABASE labelfish OWNER u_ogfzdegyvvaj3g4iyuvlu5yxmi;"

# 2) Apply bootstrap SQL
cb psql 3x4xvkn3xza2zjwiklcuonpamy --role postgres --database labelfish \
  < ../sql/labelstudio/labelfish_schema.sql

# 3) Store LS connection URL in ESC for the cluster stack
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioDbUrl \
  "postgres://labelfish_owner:<password>@p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com:5432/labelfish" --secret
```

Notes:

- The cluster stack requires `labelStudioDbUrl` and sets `DATABASE_URL` for the Label Studio deployment.
- You can also provision the DB via IaC by setting `oceanid-cloud:enableLabelStudioDb=true` and running `pulumi up` locally (not in GitHub Actions). Default is `false` for safety.

## Database Provisioning (Manual Only)

### Label Studio Database (`labelfish`)

**IMPORTANT:** Database provisioning is **disabled by default** and uses `command.local.Command`, which requires psql installed locally. It **will not run in GitHub Actions**.

#### Safety Guarantees

1. **Cluster never recreated on push**: `enableCrunchyBridgeProvisioning: true` with `protect: true` prevents deletion
2. **Database never created on push**: `enableLabelStudioDb` defaults to `false`
3. **Idempotent**: Safe to run multiple times (uses `IF NOT EXISTS` patterns)

#### Manual Provisioning Steps

```bash
cd cloud/

# 1. Set admin URL (must have CREATEDB privilege)
# Get from: cb uri <cluster-id> or use existing admin credentials
pulumi config set --secret oceanid-cloud:crunchyAdminUrl "postgres://<admin_user>:<pass>@p.<cluster-id>.db.postgresbridge.com:5432/postgres"

# 2. Generate strong password and store in ESC
esc env set default/oceanid-cluster pulumiConfig.oceanid-cloud:labelStudioOwnerPassword "$(openssl rand -base64 32)" --secret

# 3. Enable database provisioning (local only)
pulumi config set oceanid-cloud:enableLabelStudioDb true

# 4. Run Pulumi locally (requires psql in PATH)
pulumi up

# 5. Disable flag to prevent accidental re-runs
pulumi config set oceanid-cloud:enableLabelStudioDb false

# 6. Store connection URL in ESC for cluster stack
pulumi stack output labelStudioDbUrl --show-secrets
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioDbUrl "<url_from_above>" --secret
```

**Config Key Scoping:**

- `oceanid-cloud:crunchyAdminUrl` - Admin credentials (CREATEDB privilege) for database provisioning
- `oceanid-cloud:labelStudioOwnerPassword` - Password for `labelfish_owner` role
- `oceanid-cluster:labelStudioDbUrl` - Runtime connection URL for Label Studio (used by cluster stack)

#### What Gets Created

- Database: `labelfish`
- Roles: `labelfish_owner`, `labelfish_rw`, `labelfish_ro`
- Schema: `labelfish` (isolated from staging/curated)
- Extensions: `pgcrypto`, `citext`, `pg_trgm`, `btree_gist`
- Sane defaults: UTC timezone, statement/lock timeouts, search_path

#### Verification

```bash
# Check database exists
/opt/homebrew/opt/postgresql@17/bin/psql "$(esc env get default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioDbUrl --show-secrets --value string)" -c "\l"

# Check schema and roles
/opt/homebrew/opt/postgresql@17/bin/psql "$(esc env get default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioDbUrl --show-secrets --value string)" -c "\dn" -c "\du"
```

## Stack Outputs

Current exports:

```typescript
export const clusterId: pulumi.Output<string>          // CrunchyBridge cluster ID
export const clusterHost: pulumi.Output<string>        // Database hostname
export const clusterStatus: pulumi.Output<string>      // Cluster state (ready/provisioning)
export const connectionUrl: pulumi.Output<string>      // PostgreSQL connection URL (secret)
export const k3sDnsRecord: pulumi.Output<string>       // k3s.boathou.se record ID
export const gpuDnsRecord: pulumi.Output<string>       // gpu.boathou.se record ID
export const labelStudioAccessId: pulumi.Output<string> // Access app ID
```

View outputs:

```bash
pulumi stack output clusterId
pulumi stack output connectionUrl --show-secrets
```

## Resource Protection

All imported resources use `protect: true` to prevent accidental deletion:

```typescript
new cloudflare.Record("k3s-cname", {
  // ... config
}, { protect: true });
```

To delete a protected resource:

1. Remove `protect: true` from code
2. Run `pulumi up` to apply protection change
3. Run `pulumi destroy` or delete resource

## Troubleshooting

### Import Conflicts

If import fails with "resource already exists":

```bash
# Check if resource already in state
pulumi stack --show-urns | grep <resource-name>

# If yes, delete from state first
pulumi state delete <URN>

# Then re-import
pulumi import ...
```

### Drift Detection & Response

When `pulumi preview` shows unexpected changes to cloud resources:

**Option 1: Re-import (preferred for manual edits)**

If you made changes directly in Cloudflare/CrunchyBridge console:

```bash
# 1. Note the actual resource configuration
wrangler dns records list --zone-name boathou.se
# or: cb cluster show <cluster-id>

# 2. Delete from Pulumi state
pulumi state delete <URN>

# 3. Update code to match actual configuration
# Edit src/index.ts with current values

# 4. Re-import with correct config
pulumi import --yes <type> <name> <id>

# 5. Verify no changes
pulumi preview  # Should show 0 changes
```

**Option 2: Code change (preferred for intentional updates)**

If you want to update the resource configuration:

```bash
# 1. Update code with desired configuration
# Edit src/index.ts

# 2. Preview changes
pulumi preview

# 3. Apply via CI (push to main)
git add cloud/src/index.ts
git commit -m "update: DNS record configuration"
git push

# 4. Monitor GitHub Actions deployment
gh run watch
```

**When to use each:**

- **Re-import:** Emergency fixes made in console, restoring state consistency
- **Code change:** All planned infrastructure modifications (GitOps principle)

### Provider Authentication

If you see "Unable to authenticate":

```bash
# Verify token is set
pulumi config get cloudflare:apiToken

# Re-set if needed
pulumi config set cloudflare:apiToken --secret <token>
```

## Migration Notes

This stack was created by migrating resources from `oceanid-cluster` stack:

1. **2025-01-30:** Imported CrunchyBridge cluster (ebisu)
2. **2025-01-30:** Imported DNS records (K3s, gpu)
3. **2025-01-30:** Imported Label Studio Access app
4. **2025-01-30:** Removed DNS creation from cluster stack

See `../cluster/MIGRATION.md` for full migration history.
