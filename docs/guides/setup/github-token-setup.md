# GitHub Token Setup for Flux Automation

## Create a Dedicated Token

### 1. Go to GitHub Token Settings

<https://github.com/settings/tokens/new>

### 2. Token Configuration

**Token Name:** `flux-oceanid-automation`

**Expiration:** 90 days (rotate quarterly for security)

**Required Permissions (Classic Token):**

- ✅ **repo** (Full control of private repositories)
  - Needed to: Create branches, push commits, create PRs
- ✅ **workflow** (Update GitHub Action workflows)
  - Needed if: Your manifests include .GitHub/workflows

**OR Fine-grained Token (Recommended for better security):**

Repository access: `goldfish-inc/oceanid` only

**Repository Permissions:**

- ✅ **Contents:** Write (push commits, create branches)
- ✅ **Pull requests:** Write (create/update PRs)
- ✅ **Metadata:** Read (always required)
- ✅ **Actions:** Write (only if updating workflows)
- ✅ **Commit statuses:** Write (optional, for PR status)

### 3. Create Token and Copy

After creating, copy the token immediately (you won't see it again).

### 4. Add to Pulumi ESC

```bash
# Option 1: Via CLI
pulumi config set --secret github.token ghp_YOUR_TOKEN_HERE

# Option 2: Via Web UI
# Go to: https://app.pulumi.com/ryan-taylor/oceanid-cluster/prod
# Add to ESC environment configuration:
#   github:
#     token: ghp_YOUR_TOKEN_HERE
```

### 5. Deploy to Cluster

```bash
# Deploy the GitHub token secret to Kubernetes
pulumi up --yes

# Verify secret was created
kubectl get secret github-token -n flux-system
```

### 6. Apply Automation Config

```bash
# Apply the image update automation
kubectl apply -f clusters/tethys/image-updates.yaml

# Verify it's working
kubectl get imageupdateautomation -n flux-system
```

## Security Best Practices

### Token Naming Convention

Use descriptive names that include:

- Purpose: `flux`
- Project: `oceanid`
- Type: `automation`

Example: `flux-oceanid-automation`

### Token Rotation Schedule

- **Quarterly rotation** (every 90 days)
- Set calendar reminder
- Keep old token active for 24h during rotation

### Token Storage

- ✅ **DO:** Store in Pulumi ESC (encrypted)
- ✅ **DO:** Use dedicated token for each cluster
- ❌ **DON'T:** Share tokens between projects
- ❌ **DON'T:** Store in git or .env files
- ❌ **DON'T:** Use personal tokens for automation

### Audit Trail

The token usage is tracked in:

1. GitHub Settings → Personal access tokens → Last used
2. GitHub repo → Settings → Webhooks → Recent Deliveries
3. Flux logs: `kubectl logs -n flux-system deployment/image-automation-controller`

## Token Permissions Explained

### Why These Permissions?

**repo/contents:write**

- Push commits with updated image tags
- Create `flux-image-updates` branch
- Required for GitOps workflow

**pull_requests:write**

- Create PR from `flux-image-updates` branch
- Update PR description with changes
- Auto-close stale PRs

**workflow:write** (optional)

- Only if you have GitHub Actions that reference container images
- Allows updating workflow files with new versions

## Troubleshooting

### Test Token Access

```bash
# Test token manually (replace with your token)
curl -H "Authorization: token ghp_YOUR_TOKEN" \
  https://api.github.com/repos/goldfish-inc/oceanid

# Should return repo details if token is valid
```

### Check Flux Can Access Token

```bash
# Verify secret exists
kubectl get secret github-token -n flux-system -o yaml

# Check if Flux can authenticate
kubectl logs -n flux-system deployment/image-automation-controller | grep -i auth
```

### Common Issues

**"Authentication failed"**

- Token expired or revoked
- Wrong permissions
- Secret not created in cluster

**"Cannot create PR"**

- Missing pull_requests:write permission
- Branch protection rules blocking
- Token for wrong repository

**"Cannot push to branch"**

- Missing contents:write permission
- Branch protection on main
- Token expired

## Monitoring Token Usage

```bash
# View recent automation attempts
kubectl get events -n flux-system \
  --field-selector involvedObject.name=flux-system \
  --sort-by='.lastTimestamp'

# Check for authentication errors
kubectl logs -n flux-system deployment/image-automation-controller \
  --since=1h | grep -E "error|fail|denied"
```

## Example PR Created by Flux

When working correctly, Flux will create PRs like:

```
Title: chore: automated image updates for non-breaking changes

Body:
- quay.io/jetstack/cert-manager-controller: v1.16.2 → v1.18.2
- quay.io/jetstack/cert-manager-webhook: v1.16.2 → v1.18.2
- quay.io/jetstack/cert-manager-cainjector: v1.16.2 → v1.18.2

This update was automatically applied based on the configured semver policy.
Only non-breaking changes (patch and minor versions) are auto-applied.

🤖 Generated with Flux Image Automation
```

---

**Ready to create your token?**
→ <https://github.com/settings/tokens/new>
