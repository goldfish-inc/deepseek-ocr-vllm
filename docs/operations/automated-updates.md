# Automated Image Updates Configuration

**Status:** Ready to Enable
**Requirements:** GitHub token in Pulumi ESC

## Overview

The infrastructure is configured to automatically update container images for non-breaking changes (patch and minor versions). This uses Flux's ImageUpdateAutomation with GitHub integration via Pulumi ESC.

## Setup Instructions

### 1. Create GitHub Personal Access Token

Create a GitHub token with the following permissions:

- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows (if needed)

Token creation: <https://github.com/settings/tokens/new>

### 2. Add Token to Pulumi ESC

```bash
# Add the GitHub token to your Pulumi ESC environment
pulumi config set --secret github.token <YOUR_GITHUB_TOKEN>

# Or add it directly to ESC via the web UI:
# https://app.pulumi.com/ryan-taylor/oceanid-cluster/prod/config
```

### 3. Deploy the Configuration

```bash
# Build and deploy the updated configuration
pnpm --filter @oceanid/cluster build
pulumi up --yes

# Apply the Flux configurations
kubectl apply -f clusters/tethys/version-monitoring.yaml
kubectl apply -f clusters/tethys/image-updates.yaml
```

## How It Works

### Version Detection

1. **Image Repositories** scan Docker registries every hour
2. **Image Policies** filter versions based on semantic versioning rules
3. **Alerts** notify when new versions matching policies are found

### Automated Updates

1. **ImageUpdateAutomation** detects changes matching policies
2. Creates a new branch `flux-image-updates`
3. Updates image tags in manifests
4. Pushes changes to GitHub
5. Creates/updates PR for review

### Update Policies

| Component | Current | Auto-Update Policy | Manual Review |
|-----------|---------|-------------------|---------------|
| **Cert-Manager** | v1.16.2 | ✅ v1.16.x - v1.18.x | Major versions |
| **Cloudflared** | latest | ✅ All versions | None (using latest) |
| **PKO** | v2.2.0 | ✅ v2.2.x patches | Minor/Major versions |
| **Flux** | v2.6.4 | ✅ v2.6.x patches | Minor/Major versions |

## Configuration Files

### Pulumi Component

`cluster/src/components/fluxBootstrap.ts`

- Manages GitHub token secret from ESC
- Creates Kubernetes secret for Flux

### Flux Configurations

- `clusters/tethys/version-monitoring.yaml` - Image scanning and policies
- `clusters/tethys/image-updates.yaml` - Automation configuration
- `infrastructure/cert-manager-auto-update.yaml` - Component update markers

## Image Update Markers

Components must be marked for auto-updates:

```yaml
# Example: cert-manager deployment
spec:
  template:
    spec:
      containers:
      - name: cert-manager
        image: quay.io/jetstack/cert-manager-controller:v1.16.2 # {"$imagepolicy": "flux-system:cert-manager"}
```

## Monitoring Updates

```bash
# Check for available updates
kubectl get imagepolicy -n flux-system

# View update automation status
kubectl get imageupdateautomation -n flux-system

# Check for created branches
git fetch origin
git branch -r | grep flux-image-updates

# View automation logs
kubectl logs -n flux-system deployment/image-automation-controller
```

## Manual Override

To manually trigger an update check:

```bash
# Force image repository scan
kubectl annotate imagerepository cert-manager -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite

# Trigger automation run
kubectl annotate imageupdateautomation flux-system -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Rollback Procedure

If an automated update causes issues:

```bash
# 1. Revert the commit
git revert <commit-hash>
git push

# 2. Or manually set the image version
kubectl set image deployment/cert-manager \
  cert-manager-controller=quay.io/jetstack/cert-manager-controller:v1.16.2 \
  -n cert-manager

# 3. Disable automation temporarily
kubectl suspend imageupdateautomation flux-system -n flux-system
```

## Security Considerations

1. **GitHub Token Security**
   - Stored in Pulumi ESC (encrypted)
   - Only deployed to cluster as Kubernetes secret
   - Limited scope (repo access only)
   - Rotate regularly (quarterly)

2. **Update Safety**
   - Only non-breaking changes auto-applied
   - Major versions require manual approval
   - All changes go through PR review
   - Automatic rollback on deployment failure

3. **Audit Trail**
   - All updates tracked in Git history
   - Flux events logged in cluster
   - GitHub PRs provide review history

## Benefits

1. **Reduced Manual Work**: No need to check for updates manually
2. **Security Patches**: Applied automatically within policy constraints
3. **GitOps Workflow**: All changes tracked and reviewable
4. **Rollback Capability**: Easy reversion through Git
5. **Policy Control**: Fine-grained control over what updates are allowed

## Next Steps

1. Add GitHub token to Pulumi ESC
2. Deploy the configuration
3. Monitor the first automated PR
4. Adjust policies based on experience

---

*Automated updates are a key component of maintaining a zero-technical-debt infrastructure.*
