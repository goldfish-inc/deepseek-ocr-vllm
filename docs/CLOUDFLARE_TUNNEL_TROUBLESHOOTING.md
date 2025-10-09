# Cloudflare Tunnel Troubleshooting Guide

## Critical Understanding: Remote vs Local Configuration

**IMPORTANT**: Cloudflare tunnels use **remote configuration management**, NOT local ConfigMap files!

### How Cloudflare Tunnel Config Works

1. **Pulumi creates ConfigMap** (`cloudflared-config`) with ingress rules
2. **Cloudflared IGNORES the ConfigMap** and fetches config from Cloudflare's API
3. **Remote config version** is shown in logs as `version=X`
4. **Local ConfigMap changes have NO EFFECT** until remote config is updated via API

### Symptoms of Config Mismatch

- ✅ ConfigMap shows correct service names
- ❌ Cloudflared logs show old service names
- ❌ 502 Bad Gateway errors at tunnel hostnames
- ❌ Restarting pods doesn't fix the issue

### Verifying the Problem

```bash
# 1. Check local ConfigMap
kubectl get configmap -n cloudflared cloudflared-config -o yaml | grep -A2 "hostname:"

# 2. Check what cloudflared is actually using
kubectl logs -n cloudflared -l app.kubernetes.io/name=cloudflared --tail=50 | grep "Updated to new configuration"

# 3. Compare service names - if they differ, you have a mismatch!
```

## Solution: Update Tunnel Config via API

### Prerequisites

```bash
# Get required credentials
TUNNEL_ID="6ff4dfd7-2b77-4a4f-84d9-3241bea658dc"  # oceanid-cluster tunnel
ACCOUNT_ID="8fa97474778c8a894925c148ca829739"    # Cloudflare account
CF_TOKEN=$(pulumi config get oceanid-cluster:cloudflareAdminToken)
```

### Update Tunnel Configuration

```bash
# Full tunnel config update
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "ingress": [
        {
          "hostname": "k3s.boathou.se",
          "service": "https://kubernetes.default.svc.cluster.local:443",
          "originRequest": {
            "noTLSVerify": false,
            "caPool": "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
          }
        },
        {
          "hostname": "label.boathou.se",
          "service": "http://label-studio-ls-app.apps.svc.cluster.local:8080",
          "originRequest": {
            "noTLSVerify": false
          }
        },
        {
          "hostname": "airflow.boathou.se",
          "service": "http://airflow-web.apps.svc.cluster.local:8080",
          "originRequest": {
            "noTLSVerify": true
          }
        },
        {
          "hostname": "minio.boathou.se",
          "service": "http://minio-console.apps.svc.cluster.local:9001",
          "originRequest": {
            "noTLSVerify": true
          }
        },
        {
          "service": "http_status:404"
        }
      ],
      "warp-routing": {
        "enabled": true
      }
    }
  }' | jq '.'
```

### Verification

```bash
# 1. Check API response shows new version number
# Output should show: "version": <higher number than before>

# 2. Wait 5-10 seconds for cloudflared to pick up new config

# 3. Check cloudflared logs
kubectl logs -n cloudflared -l app.kubernetes.io/name=cloudflared --tail=20 | grep "Updated to new configuration"

# 4. Verify service names in logs match your API update

# 5. Test the endpoint
curl -I https://label.boathou.se
```

## Common Issues

### Issue 1: Service Name Mismatch

**Symptom**: 502 error, cloudflared logs show "no such host"

**Cause**: Service name in tunnel config doesn't match actual Kubernetes service

**Fix**:
1. Check actual service name: `kubectl get svc -n apps`
2. Update tunnel config via API with correct name
3. Verify in cloudflared logs

### Issue 2: Wrong Service Port

**Symptom**: 502 error, cloudflared can connect but gets connection refused

**Cause**: Service `targetPort` doesn't match container port

**Fix**:
1. Check container ports: `kubectl get pod -n apps <pod-name> -o json | jq '.spec.containers[].ports'`
2. Update HelmRelease `targetPort` to match
3. Update tunnel config if service port changed

**Example**: Label Studio Helm chart v1.11.4 uses nginx on port 8085, not 8080:
```yaml
app:
  service:
    port: 8080         # External port (what tunnel connects to)
    targetPort: 8085   # Container port (what nginx listens on)
```

### Issue 3: Pulumi Deployment Doesn't Update Config

**Symptom**: Pulumi runs successfully but cloudflared still uses old config

**Cause**: Pulumi only updates the local ConfigMap, which cloudflared ignores

**Fix**: After Pulumi deployment, manually update tunnel config via API

## Best Practices

### 1. Always Verify After Deployment

```bash
# After any infrastructure deployment touching ingress rules:
kubectl logs -n cloudflared -l app.kubernetes.io/name=cloudflared --tail=5 | grep version
```

If version number hasn't increased, run API update.

### 2. Service Name Validation Checklist

When adding new services to tunnel:

- [ ] Check actual service name: `kubectl get svc -n <namespace>`
- [ ] Check service port mapping: `kubectl get svc <name> -o jsonpath='{.spec.ports}'`
- [ ] Check container ports: `kubectl get pod <pod> -o jsonpath='{.spec.containers[].ports}'`
- [ ] Verify `targetPort` matches container port
- [ ] Update tunnel config via API
- [ ] Test endpoint returns 200 OK

### 3. Keep Tunnel Config Script

Save the API update script as `/tmp/update-tunnel-config.sh` for quick updates:

```bash
#!/bin/bash
set -e

TUNNEL_ID="6ff4dfd7-2b77-4a4f-84d9-3241bea658dc"
ACCOUNT_ID="8fa97474778c8a894925c148ca829739"
CF_TOKEN=$(pulumi config get oceanid-cluster:cloudflareAdminToken)

# ... (full config JSON)

curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations" \
  -H "Authorization: Bearer ${CF_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "config": {
    // ... your config ...
  }
}
EOF
```

## Future Improvements

**TODO**: Update Pulumi cloudflare tunnel component to manage config via API

Current implementation:
```typescript
// cluster/src/components/cloudflareTunnel.ts
const configMap = new k8s.core.v1.ConfigMap(`${name}-config`, {
  // Creates local ConfigMap (ignored by cloudflared!)
});
```

Proposed implementation:
```typescript
import * as cloudflare from "@pulumi/cloudflare";

const tunnelConfig = new cloudflare.ZeroTrustTunnelCloudflared(`${name}-config`, {
  accountId: cluster.cloudflare.accountId,
  tunnelId: cluster.cloudflare.tunnelId,
  config: {
    ingress: extraIngress,
    warpRouting: { enabled: true }
  }
});
```

This would eliminate the need for manual API updates after deployments.

## Reference

- **Cloudflare API Docs**: https://developers.cloudflare.com/api/operations/zero-trust-tunnels-update-configuration
- **Cloudflared Config**: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/configuration-file/
- **Tunnel ID**: `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc`
- **Account ID**: `8fa97474778c8a894925c148ca829739`
- **Zero Trust Org**: `goldfishinc.cloudflareaccess.com`

---

**Last Updated**: October 9, 2025
**Related Issue**: Label Studio 502 error due to service name + port mismatch
