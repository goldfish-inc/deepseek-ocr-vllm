# Secret Management Rules for Oceanid Cluster

## 🔐 CRITICAL RULE: All Secrets MUST Use Pulumi ESC

**NO EXCEPTIONS**: Every secret, token, key, or credential MUST be managed through Pulumi ESC (Environments, Secrets, and Configuration).

## ❌ What NOT to Do

1. **NEVER hardcode secrets in code**
   - No tokens in YAML files
   - No keys in TypeScript/JavaScript
   - No credentials in environment files

2. **NEVER commit secrets to Git**
   - GitHub push protection will block you
   - Even in "test" files or examples

3. **NEVER create .env files**
   - All environment variables come from ESC

4. **NEVER manually create Kubernetes secrets**
   - Let Pulumi create them from ESC

## ✅ Correct Approach

### 1. Store in 1Password

All secrets start in 1Password for secure storage and backup.

### 2. Add to Pulumi ESC

```bash
# Add secret from 1Password to Pulumi config
op read "op://vault/item/field" | pulumi config set --secret --path category.secret_name

# Or add directly
pulumi config set --secret --path category.secret_name
```

### 3. Use in Pulumi Components

```typescript
// In your Pulumi component
const cfg = new pulumi.Config();
const apiToken = cfg.getSecret("category.secret_name");

// Create Kubernetes secret from ESC
new k8s.core.v1.Secret("my-secret", {
    stringData: {
        token: apiToken,
    },
});
```

## 📋 Current Secrets in ESC

| Secret | Path in ESC | Purpose |
|--------|------------|---------|
| Cloudflare API Token | `cloudflare.api_token` | Cloudflare API access |
| Cloudflare Tunnel Token | `cloudflare.tunnel_token` | Cloudflared authentication |
| Flux SSH Key | `flux.ssh_private_key` | GitOps repository access |
| Pulumi Access Token | `pulumi.access_token` | PKO API access |
| Node SSH Keys | `ssh.*_private_key` | Node access (managed) |

## 🔄 Secret Rotation

ESC supports automatic secret rotation:

1. Keys are rotated every 90 days by default
2. ESC can generate SSH keys automatically
3. Webhook notifications for rotation events

## 🚨 Violations

If you accidentally commit a secret:

1. GitHub will block the push
2. Rotate the secret immediately
3. Update it in 1Password and ESC
4. Never use `--force` to bypass

## 📝 Examples

### Adding a New API Token

```bash
# Store in 1Password first
op create item API --title "Service API Token" --vault Development \
  credential=<token>

# Add to Pulumi ESC
op read "op://Development/Service API Token/credential" | \
  pulumi config set --secret --path service.api_token
```

### Creating a Kubernetes Secret

```typescript
// WRONG - Hardcoded secret
new k8s.core.v1.Secret("api-secret", {
    stringData: {
        token: "abc123", // NEVER DO THIS
    },
});

// CORRECT - From ESC
const cfg = new pulumi.Config();
new k8s.core.v1.Secret("api-secret", {
    stringData: {
        token: cfg.requireSecret("service.api_token"),
    },
});
```

## 🛡️ Security Benefits

1. **Single source of truth**: ESC manages all secrets
2. **Audit trail**: Every secret access is logged
3. **Rotation**: Automated key rotation capability
4. **No leaks**: Secrets never in Git history
5. **Type safety**: TypeScript ensures correct usage

## 🔍 Verification

Check that no secrets are hardcoded:

```bash
# Scan for potential secrets
grep -r "token\|key\|password\|secret" --include="*.yaml" --include="*.ts" .

# Verify Pulumi config is encrypted
cat Pulumi.prod.yaml | grep "secure:" # Should show encrypted values
```

---

**Remember**: If you're typing a secret directly into a file, you're doing it wrong. Use Pulumi ESC!
