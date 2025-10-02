# Version Monitoring Setup

**Status:** ✅ Implemented
**Date:** September 26, 2025

## Overview

Automated version monitoring is now configured using Flux's image automation controllers. The system continuously monitors container registries for new versions and provides alerts when updates are available.

## How It Works

1. **Image Repositories**: Flux scans container registries every hour
2. **Image Policies**: Define which versions are acceptable using semantic versioning
3. **Alerts**: Notifications when new versions are detected
4. **GitOps Ready**: Can be extended to create automated PRs

## Monitored Components

| Component | Registry | Policy | Current | Latest Available |
|-----------|----------|--------|---------|------------------|
| **Cloudflared** | Docker Hub | `>=2024.0.0` | latest | 2025.9.1 |
| **Cert-Manager** | Quay.io | `>=1.0.0 <2.0.0` | v1.16.2 | v1.18.2 ⬆️ |
| **PKO** | Docker Hub | `>=2.0.0 <3.0.0` | v2.2.0 | v2.2.0 |

## Configuration Files

### Version Monitoring Resources

**Location:** `/clusters/tethys/version-monitoring.yaml`

Contains:

- `ImageRepository` resources for each monitored component
- `ImagePolicy` resources defining version constraints
- `Alert` resource for notifications
- `Provider` for alert handling

### Image Automation Component (Optional)

**Location:** `/cluster/src/components/imageAutomation.ts`

Pulumi component for programmatic deployment (includes automated PR creation).

## Viewing Current Status

```bash
# Check repository scanning status
kubectl get imagerepository -n flux-system

# View latest detected versions
kubectl get imagepolicy -n flux-system

# Check alerts
kubectl get alert -n flux-system

# View detailed policy info
kubectl describe imagepolicy cloudflared -n flux-system
```

## Version Policies Explained

### Cloudflared

- **Policy:** `>=2024.0.0`
- **Strategy:** Track all stable releases from 2024 onwards
- **Current:** Using `latest` tag (auto-updates)

### Cert-Manager

- **Policy:** `>=1.0.0 <2.0.0`
- **Strategy:** Stay on v1.x branch for stability
- **Action Required:** Update from v1.16.2 to v1.18.2 available

### Pulumi Kubernetes Operator

- **Policy:** `>=2.0.0 <3.0.0`
- **Strategy:** Stay on v2.x branch
- **Current:** Already at latest (v2.2.0)

## Extending the System

### Enable Automated PRs

To enable automated pull requests when new versions are detected:

1. Create GitHub token secret:

```bash
kubectl create secret generic github-token \
  -n flux-system \
  --from-literal=token=$GITHUB_TOKEN
```

2. Add `ImageUpdateAutomation` resource (see imageAutomation.ts)

3. Configure commit messages and PR settings

### Add More Components

To monitor additional components:

1. Add to `version-monitoring.yaml`:

```yaml
---
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImageRepository
metadata:
  name: my-component
  namespace: flux-system
spec:
  image: registry/org/image
  interval: 1h
---
apiVersion: image.toolkit.fluxcd.io/v1beta2
kind: ImagePolicy
metadata:
  name: my-component
  namespace: flux-system
spec:
  imageRepositoryRef:
    name: my-component
  policy:
    semver:
      range: ">=1.0.0"
```

2. Apply the changes:

```bash
kubectl apply -f clusters/tethys/version-monitoring.yaml
```

## Alert Notifications

Currently configured with a simple logger provider that records events. Can be extended to:

- Send GitHub issues
- Post to Slack/Discord
- Email notifications
- Webhook triggers

## Maintenance

### Regular Tasks

- Review detected versions weekly
- Update components quarterly (or for security patches)
- Review and adjust version policies as needed

### Troubleshooting

```bash
# Check image scanning logs
kubectl logs -n flux-system deployment/image-reflector-controller

# View alert events
kubectl get events -n flux-system --field-selector involvedObject.kind=Alert

# Force rescan
kubectl annotate imagerepository cloudflared -n flux-system \
  reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

## Benefits

1. **Proactive Awareness**: Know when updates are available immediately
2. **Policy Control**: Define acceptable version ranges
3. **GitOps Integration**: Can automate update PRs
4. **Security**: Quick awareness of security patches
5. **No Manual Checking**: Automated scanning every hour

## Next Steps

1. **Review cert-manager update** from v1.16.2 to v1.18.2
2. **Consider automated PRs** for non-breaking updates
3. **Add more components** as needed
4. **Configure external notifications** (GitHub, Slack, etc.)

---

*Version monitoring implemented as part of the zero-technical-debt initiative.*
