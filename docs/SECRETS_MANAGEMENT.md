# Secrets Management - Pulumi ESC Only

**Principle:** All project secrets are stored in Pulumi ESC (Environments, Secrets, and Configuration). No other secret management tools (1Password, Vault, etc.) are used in deployment workflows.

---

## Single Source of Truth: Pulumi ESC

**ESC Environment:** `default/oceanid-cluster`

All secrets, credentials, and configuration values are stored in Pulumi ESC and accessed via:
- Pulumi config: `pulumi config get <key> --plaintext`
- ESC CLI: `esc env get default/oceanid-cluster`
- Runtime environment variables (injected by Pulumi)

---

## Secrets Inventory

### Database

```bash
# CrunchyBridge PostgreSQL connection string
pulumi -C cluster config get postgres_url --plaintext
# Format: postgresql://user:password@host.crunchybridge.com:5432/database

# Or for app runtime (injected automatically):
echo $DATABASE_URL
```

**Stored in ESC as:** `oceanid-cluster:postgres_url`

### GitHub Integration

```bash
# GitHub personal access token for Flux
pulumi -C cluster config get github_token --plaintext

# GitHub repository URL
pulumi -C cluster config get github_repo --plaintext
```

**Stored in ESC as:**
- `oceanid-cluster:github_token`
- `oceanid-cluster:github_repo`

### Cloudflare Tunnel

```bash
# Cloudflare tunnel token for cluster ingress
pulumi -C cluster config get cloudflareTunnelToken --plaintext

# Cloudflare node tunnel token for GPU node
pulumi -C cluster config get cloudflareNodeTunnelToken --plaintext
```

**Stored in ESC as:**
- `oceanid-cluster:cloudflareTunnelToken`
- `oceanid-cluster:cloudflareNodeTunnelToken`

### HuggingFace API

```bash
# HuggingFace API token for model downloads
pulumi -C cluster config get hf_token --plaintext
```

**Stored in ESC as:** `oceanid-cluster:hf_token`

### Sentry Monitoring

```bash
# Sentry DSN for error tracking
pulumi -C cluster config get sentry_dsn --plaintext
```

**Stored in ESC as:** `oceanid-cluster:sentry_dsn`

### NER Labels (Configuration)

```bash
# 63-label taxonomy as JSON array
pulumi -C cluster config get nerLabels --plaintext
```

**Stored in ESC as:** `oceanid-cluster:nerLabels`

---

## Adding New Secrets

### Via Pulumi CLI

```bash
# Add a secret value (encrypted)
pulumi -C cluster config set --secret my-secret "secret-value"

# Add a non-secret configuration value
pulumi -C cluster config set my-config "config-value"

# Verify
pulumi -C cluster config get my-secret --plaintext
```

### Via ESC Web UI

1. Navigate to https://app.pulumi.com
2. Go to Environments → `default/oceanid-cluster`
3. Add secret under `pulumiConfig` section
4. Click "Save"

### Via ESC CLI

```bash
# Set a secret in ESC environment
esc env set default/oceanid-cluster --secret pulumiConfig.oceanid-cluster:my-secret "value"

# Get a secret
esc env get default/oceanid-cluster --value pulumiConfig.oceanid-cluster:my-secret
```

---

## Accessing Secrets in Code

### Pulumi Infrastructure (TypeScript)

```typescript
const cfg = new pulumi.Config();

// Get secret (returns Output<string>)
const dbUrl = cfg.requireSecret("postgres_url");

// Get non-secret config
const enableFeature = cfg.getBoolean("enableFeature");

// Use in resource
const deployment = new k8s.apps.v1.Deployment("app", {
  spec: {
    template: {
      spec: {
        containers: [{
          env: [{
            name: "DATABASE_URL",
            value: dbUrl,  // Pulumi handles secret injection
          }],
        }],
      },
    },
  },
});
```

### Python Adapter (Runtime)

```python
import os

# Secrets injected as environment variables by Pulumi
DATABASE_URL = os.getenv("DATABASE_URL")
SENTRY_DSN = os.getenv("SENTRY_DSN")
HF_TOKEN = os.getenv("HF_TOKEN")

# Fail fast if critical secrets missing
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not set - check Pulumi ESC configuration")
```

### Shell Scripts (Deployment)

```bash
# Export from ESC for local operations
export DATABASE_URL=$(pulumi -C cluster config get postgres_url --plaintext)
export HF_TOKEN=$(pulumi -C cluster config get hf_token --plaintext)

# Run migration
psql $DATABASE_URL -f sql/migrations/V3__staging_tables_complete.sql
```

---

## Security Best Practices

### ✅ DO:

- **Store all secrets in ESC** - Database URLs, API tokens, credentials
- **Use `--secret` flag** - Encrypt sensitive values with `pulumi config set --secret`
- **Access via Pulumi config** - `cfg.requireSecret()` or `pulumi config get`
- **Inject at runtime** - Let Pulumi inject env vars, don't embed in code
- **Rotate regularly** - Update ESC values, Pulumi will propagate changes

### ❌ DON'T:

- ❌ **Hardcode secrets in code** - Never embed credentials in source files
- ❌ **Commit secrets to git** - `.env` files should be `.gitignore`d
- ❌ **Use other secret tools** - Don't reference 1Password/Vault in deployment docs
- ❌ **Share secrets via Slack/email** - Use ESC web UI to grant access
- ❌ **Skip encryption** - Always use `--secret` flag for sensitive values

---

## Local Development (Optional)

**Note:** 1Password is acceptable for individual developer workflows but NOT for project deployment.

Developers MAY use 1Password locally for:
- Personal SSH keys
- Local development credentials
- Testing secrets

But production deployments MUST use ESC exclusively.

**Example local workflow:**
```bash
# Developer's local machine (optional)
export DATABASE_URL=$(op read "op://Personal/Dev Database/url")

# But for project deployment scripts:
export DATABASE_URL=$(pulumi -C cluster config get postgres_url --plaintext)
```

---

## Migration from 1Password (If Needed)

If secrets currently exist in 1Password that need to be in ESC:

```bash
# Step 1: Get value from 1Password (one-time)
VALUE=$(op read "op://vault/item/field")

# Step 2: Store in ESC (permanent)
pulumi -C cluster config set --secret secret-name "$VALUE"

# Step 3: Update code to use ESC
# Change: os.getenv("SECRET") with ESC injection
# Remove: op read commands from deployment scripts

# Step 4: Verify ESC is working
pulumi -C cluster config get secret-name --plaintext

# Step 5: Remove 1Password reference from docs
```

---

## Troubleshooting

### Secret Not Found

```bash
# List all secrets in ESC environment
esc env get default/oceanid-cluster --format json | jq '.pulumiConfig'

# Or use Pulumi CLI
pulumi -C cluster config --show-secrets
```

### Wrong Environment

```bash
# Check current Pulumi stack
pulumi -C cluster stack

# Should be: ryan-taylor/oceanid-cluster/prod

# Check ESC environment reference
pulumi -C cluster config --show-secrets | grep environment
```

### Permission Denied

ESC access requires:
- Pulumi account with access to `default/oceanid-cluster` environment
- Organization membership in appropriate Pulumi org
- Login: `pulumi login`

---

## Emergency Access

If ESC is unavailable and you need to access production:

1. **DO NOT** hardcode secrets as workaround
2. Contact Pulumi support for ESC service status
3. Use read-only database replica if available
4. Document incident and restore ESC access before deployments

---

## Compliance

**Principle:** ESC is the single source of truth for all project secrets.

- **Audit trail:** ESC tracks who accessed what and when
- **Encryption:** All secrets encrypted at rest and in transit
- **Access control:** RBAC via Pulumi organizations
- **Rotation:** Update ESC value, Pulumi propagates to all deployments
- **Recovery:** ESC backups managed by Pulumi (no manual backup needed)

---

## Summary

| Secret Type | Storage | Access Method | Example |
|-------------|---------|---------------|---------|
| Database URL | Pulumi ESC | `pulumi config get postgres_url` | CrunchyBridge connection |
| API Tokens | Pulumi ESC | `pulumi config get <key>` | HuggingFace, GitHub, Sentry |
| Tunnel Tokens | Pulumi ESC | `pulumi config get <key>` | Cloudflare tunnel credentials |
| NER Labels | Pulumi ESC | `pulumi config get nerLabels` | 63-label taxonomy JSON |
| SSH Keys | Pulumi ESC | Runtime injection | Node SSH keys |

**All secrets in ESC. No exceptions for deployment workflows.**