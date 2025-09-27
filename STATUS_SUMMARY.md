# Oceanid Cluster Status Summary
**Date**: September 26, 2025
**Session Duration**: ~4 hours

## ✅ Completed Tasks

### 1. **Cluster Cleanup & Rebuild**
- Destroyed old Pulumi stack with conflicting resources
- Cleaned up namespaces and CRDs from k3s cluster
- Rebuilt infrastructure with new component-based architecture

### 2. **SSH Access Fixed**
- Consolidated to single SSH key (Hostinger-managed)
- Created local key pair: `~/.ssh/hostinger_vps`
- SSH shortcut configured: `ssh tethys` now works
- Clean access to both VPS servers (tethys and styx)

### 3. **Cloudflare Tunnel Operational**
- Fixed memory limits: 768Mi (was causing OOM kills at 256Mi)
- Added `noTLSVerify: true` for self-signed certificates
- Changed service URL from http:// to https://
- Tunnel pods running successfully with 4 connections established
- Ready for web application traffic (Label Studio, etc.)

### 4. **kubectl Access Working**
- SSH tunnel method: `ssh -L 6443:localhost:6443 tethys`
- Kubeconfig saved: `~/.kube/k3s-hostinger.yaml`
- All 3 nodes visible and ready:
  - srv712429 (tethys) - control-plane
  - srv712695 (styx)
  - calypso

## ⚠️ Pending Tasks

### Issue #38: Flux/PKO Validation
- Flux namespace exists but CRDs not installed
- Need to run `pulumi up` to complete Flux deployment
- GitOps sync not yet validated

### Issue #39: Cloudflare Tunnel Verification
- Tunnel is running but k3s API access through tunnel has issues
- Recommendation: Use SSH tunnel for kubectl, Cloudflare for apps

## 🔧 Current Configuration

### Resource Limits (Cloudflared)
```yaml
requests:
  cpu: 250m
  memory: 384Mi
limits:
  cpu: 750m
  memory: 768Mi
```

### Access Methods
- **SSH**: `ssh tethys` or `ssh styx`
- **kubectl**: Via SSH tunnel on localhost:6443
- **Web Apps**: Will use k3s.boathou.se (Cloudflare tunnel)

## 🚀 Next Steps

1. **Complete Flux deployment**:
   ```bash
   pulumi up --yes
   ```

2. **Deploy Label Studio** through Cloudflare tunnel:
   - Configure ingress for labelstudio.boathou.se
   - Update tunnel config to route to Label Studio service

3. **Set up monitoring** for pod health and resource usage

4. **Document** the final architecture and access patterns

## 📝 Key Decisions Made

1. **Use SSH tunnel for kubectl** instead of Cloudflare tunnel
   - Simpler, more reliable for management access
   - Cloudflare tunnel complexity not worth it for API access

2. **Keep Cloudflare tunnel for web applications**
   - DDoS protection valuable for public apps
   - Automatic SSL certificates
   - No port exposure on VPS

3. **Single SSH key management**
   - Using Hostinger-managed key for recovery capability
   - Stored in 1Password for backup

## ⚡ Known Issues

1. **DNS resolution problems** in some pods (CoreDNS connectivity)
2. **Cloudflare tunnel TCP mode** not working for k3s API
3. **Flux CRDs** need to be installed

## 📊 Cluster Health
- All nodes: Ready
- Cloudflared: 2/2 pods running
- Networking: Functional with minor DNS issues
- Storage: Local-path provisioner ready
- Security: Network policies in place

---

**Commit Hash**: 5411c90
**Pulumi Stack**: ryan-taylor/oceanid-cluster/prod
**Hostinger VPS IPs**: 157.173.210.123 (tethys), 191.101.1.3 (styx)