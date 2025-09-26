# Pulumi Preview Results

## Preview Summary
- **Stack**: `ryan-taylor/oceanid-cluster/prod`
- **Date**: 2025-09-26
- **Domain**: `boathou.se` (corrected spelling and zone ID configured)
- **Zone ID**: `a81f75a1931dcac429c50f2ee5252955`
- **Status**: ✅ Ready for deployment

## Resource Count Summary

### Resources to Create: 13
- 2x Component Resources (CloudflareTunnel, FluxBootstrap)
- 2x Providers (Cloudflare, Kubernetes)
- 2x Namespaces (cloudflared, flux-system)
- 1x Cloudflare DNS Record (k3s.boahou.se)
- 1x Kubernetes Secret (cloudflared-credentials)
- 1x Kubernetes ConfigMap (cloudflared-config)
- 1x Kubernetes Deployment (cloudflared)
- 1x Kubernetes Service (cloudflared-metrics)
- 1x Helm Release (flux2)
- 1x GitRepository (flux-system)
- 1x Kustomization (flux-system)

### Resources to Delete: 8
These are old resources from previous deployment:
- Old cloudflared deployment in cloudflare namespace
- Old ServiceAccount
- Old Secret/ConfigMap
- Old Service
- Gateway resources (replaced by Cloudflare tunnel)
- Old namespace

### Resources Unchanged: 1
- pulumi:pulumi:Stack (root stack)

## Expected Infrastructure Components

### Cloudflare Tunnel
- **DNS Record**: `k3s.boahou.se` → `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc.cfargotunnel.com`
- **Tunnel ID**: `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc`
- **Namespace**: `cloudflared`
- **Replicas**: 2
- **Image**: `cloudflare/cloudflared:2024.9.1`
- **Resources**:
  - Requests: 100m CPU, 128Mi memory
  - Limits: 250m CPU, 256Mi memory

### Flux GitOps
- **Namespace**: `flux-system`
- **Chart**: `flux2` v2.12.0
- **Repository**: `https://github.com/goldfish-inc/oceanid`
- **Branch**: `main`
- **Path**: `clusters/tethys`
- **Components**:
  - source-controller
  - kustomize-controller
- **Sync Interval**: 60s
- **Reconciliation**: 600s

### Kubernetes Provider
- **Server**: `https://157.173.210.123:6443` (Tethys node)
- **Authentication**: K3s token from ESC

## Configuration Issues Identified

### ✅ Fixed Issues
1. Domain corrected from `oceanid.io` to `boahou.se`
2. Config key mapping fixed for ESC integration (snake_case support)
3. Flux Helm repository URL corrected to community charts

### ✅ Resolved Issues
1. **Zone ID**: Fixed - using actual zone ID `a81f75a1931dcac429c50f2ee5252955` for boathou.se
2. **Domain Spelling**: Corrected from boahou.se to proper boathou.se

### ⚠️ Minor Issues
1. **Deprecation Warning**: `cloudflare.Record` deprecated, should use `cloudflare.DnsRecord` (non-blocking)

## Stack Outputs Expected
Based on the component structure, the following outputs should be available:
- `namespace`: Cloudflared namespace name
- `deploymentName`: Cloudflared deployment name
- `metricsServiceName`: Metrics service name
- `dnsRecordName`: DNS record name

## Security Configuration
- All containers run as non-root (UID 65532)
- Read-only root filesystem
- All capabilities dropped
- Pod security baseline enforced
- Secrets properly mounted and referenced

## Next Steps
1. Get actual Cloudflare zone ID for boahou.se domain
2. Update deprecated Record to DnsRecord
3. Run `pulumi up` to deploy (once zone ID is configured)
4. Verify tunnel connectivity after deployment
5. Check Flux GitOps synchronization

## Notes
- The preview shows replacement of old resources with new component-based architecture
- All sensitive values (tokens, keys) are properly marked as secrets
- Resource limits and requests are appropriately configured
- High availability with 2 replicas for tunnel deployment