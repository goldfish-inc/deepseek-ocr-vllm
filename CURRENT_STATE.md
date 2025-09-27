# Oceanid Infrastructure Current State
**Date**: September 26, 2025
**Last Update**: Session completed with full infrastructure rebuild

## ✅ Infrastructure Status: OPERATIONAL

### Cluster Access
- **kubectl via SSH tunnel**: ✅ Working
  ```bash
  ssh -L 6443:localhost:6443 tethys
  export KUBECONFIG=~/.kube/k3s-hostinger.yaml
  kubectl get nodes
  ```
- **Direct SSH**: ✅ Working (`ssh tethys` or `ssh styx`)
- **Cloudflare Tunnel**: ✅ Running (2/2 pods healthy)

### Node Status
All 3 nodes online and ready:
- **tethys** (157.173.210.123) - control-plane
- **styx** (191.101.1.3) - worker
- **calypso** - worker

### Key Components
| Component | Status | Notes |
|-----------|--------|-------|
| K3s Cluster | ✅ Running | v1.29.5+k3s1 |
| Cloudflare Tunnel | ✅ Running | 768Mi memory, stable |
| CoreDNS | ⚠️ Running | Minor DNS issues in some pods |
| Flux CD | ⏳ Pending | CRDs need installation |
| PKO | ⏳ Pending | Awaiting Flux completion |

## 🔑 Security Configuration

### SSH Access
- **Single SSH Key**: Ed25519 key stored in 1Password
- **1Password Entry**: "Hostinger VPS SSH (Current)"
- **ID**: fw4k46jbufjc7id3w3z2bs5egu
- **Local Path**: `~/.ssh/hostinger_vps`

### Secrets Management
- All secrets in Pulumi ESC
- No .env files
- Runtime access via `op read`

## 🏗️ Architecture Decisions

### Access Pattern
1. **Management**: SSH tunnel for kubectl (simple, reliable)
2. **Applications**: Cloudflare tunnel for web apps (DDoS protection, SSL)
3. **Rationale**: Separation of concerns, optimal for each use case

### Resource Allocation (Cloudflared)
```yaml
requests:
  cpu: 250m
  memory: 384Mi
limits:
  cpu: 750m
  memory: 768Mi
```

## 📋 GitHub Issues Status

| Issue | Title | Status | Resolution |
|-------|-------|--------|------------|
| #35 | CI/CD Pipeline Validation | ✅ Closed | OPA policies fixed with Rego v1 |
| #36 | ESC Environment Verification | ✅ Closed | All secrets configured |
| #37 | Pulumi Preview Validation | ✅ Closed | Domain/Zone ID corrected |
| #38 | Flux CD Deployment | ⏳ Open | CRDs pending installation |
| #39 | PKO Deployment | ⏳ Open | Awaiting Flux |

## 🚀 Next Actions

1. **Complete Flux Deployment**
   ```bash
   cd cluster
   pulumi up --yes
   ```

2. **Deploy Label Studio**
   - Configure ingress for labelstudio.boathou.se
   - Route through Cloudflare tunnel

3. **Fix DNS Issues**
   - Investigate CoreDNS connectivity
   - May need to restart affected pods

## 🔧 Useful Commands

### Quick Access
```bash
# SSH to nodes
ssh tethys
ssh styx

# kubectl via tunnel
ssh -L 6443:localhost:6443 tethys
kubectl --kubeconfig ~/.kube/k3s-hostinger.yaml get nodes

# Check cloudflared
kubectl get pods -n cloudflare-tunnel
kubectl logs -n cloudflare-tunnel cloudflare-deployment-xxx
```

### Pulumi Operations
```bash
cd cluster
pulumi stack select prod
pulumi up --yes
```

## 📝 Configuration Files

### Key Files Modified
- `cluster/src/config.ts` - Resource limits, domain config
- `cluster/src/components/cloudflareTunnel.ts` - noTLSVerify added
- `cluster/Pulumi.prod.yaml` - Zone ID, resource overrides
- `~/.ssh/config` - SSH shortcuts for tethys/styx

### Environment
- **Pulumi Stack**: ryan-taylor/oceanid-cluster/prod
- **Domain**: boathou.se
- **Cloudflare Zone**: a81f75a1931dcac429c50f2ee5252955
- **Tunnel Hostname**: k3s.boathou.se

## ⚠️ Known Issues

1. **DNS Resolution**: Some pods have intermittent DNS issues
2. **Flux CRDs**: Not yet installed, blocking GitOps
3. **TCP Tunnel Mode**: Not working for k3s API (using SSH tunnel instead)

## 📊 Resource Usage

### Cluster Capacity
- **Total**: 6 vCPUs, 24GB RAM, ~200GB storage
- **Available**: ~4 vCPUs, ~18GB RAM after system overhead
- **Cloudflared**: Using 384-768Mi RAM (well within limits)

### Pod Distribution
- **tethys**: Control plane + system pods
- **styx**: Cloudflared replicas
- **calypso**: Available for workloads

---

**Last Commit**: 3bb885a - Updated Claude permissions
**Session Duration**: ~5 hours
**Major Achievement**: Complete infrastructure rebuild with clean architecture