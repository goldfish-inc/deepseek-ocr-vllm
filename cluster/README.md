# Oceanid Cluster Bootstrap

This Pulumi project bootstraps the **K3s Kubernetes cluster** with foundational infrastructure components. It manages in-cluster resources and requires kubeconfig access.

## Scope

**Managed Resources:**

- **Flux CD**: GitOps continuous deployment
- **Pulumi Kubernetes Operator (PKO)**: In-cluster Pulumi deployments
- **Cloudflare Tunnel (cloudflared)**: Secure k8s API ingress
- **Node Tunnels**: Per-node cloudflared daemonsets (optional)
- **Image Automation**: Automated dependency updates
- **Label Studio**: Annotation platform (k8s deployment)
- **Triton Adapter**: ML inference bridge

**NOT Managed Here:**

- Cloud resources (DNS, Access, databases) → See `../cloud/`
- Application workloads → Managed by Flux in `../clusters/`

## Important: Deployment Model

**This stack CANNOT run in GitHub Actions** due to kubeconfig requirements.

### Local Deployment (Current)

```bash
cd cluster/

# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Preview changes
pulumi preview

# Deploy changes
pulumi up
```

**Prerequisites:**

- SSH tunnel to K3s control plane (see [CLAUDE.md](../CLAUDE.md#k3s-cluster-access))
- Valid kubeconfig at `~/.kube/k3s-config.yaml`
- Pulumi CLI authenticated

### Self-Hosted Deployment (Future)

For automated cluster bootstrap, use **Pulumi Deployments** with a self-hosted agent:

```bash
# On a machine with cluster access (e.g., tethys control plane)

# 1. Install Pulumi Deployments agent
pulumi deployments agent install \
  --token $(op read "op://Infrastructure/Pulumi Agent/token") \
  --pool oceanid-cluster

# 2. Configure agent to run on startup
sudo systemctl enable pulumi-deployments-agent
sudo systemctl start pulumi-deployments-agent

# 3. Update stack settings in Pulumi Cloud console
# Settings → Deployments → Enable
# Deployment pool: oceanid-cluster
# Trigger: Git push to main
# Work directory: cluster/
```

**Benefits:**

- Automated deployments on git push
- Audit trail in Pulumi Cloud
- No local CLI dependencies
- Centralized secret management

**Tradeoffs:**

- Agent must maintain cluster access
- Requires paid Pulumi tier (or free tier quota)
- Additional operational complexity

See [Pulumi Deployments docs](https://www.pulumi.com/docs/pulumi-cloud/deployments/) for setup details.

## Stack Configuration

**Stack:** `ryan-taylor/oceanid-cluster/prod`
**ESC Environment:** `default/oceanid-cluster` (shared with cloud project)

### Required Configuration

```bash
# Node IP addresses
pulumi config set tethysIp 157.173.210.123
pulumi config set styxIp 191.101.1.3

# Cloudflare tunnel credentials
pulumi config set --secret cloudflare_tunnel_token <token>
pulumi config set --secret cloudflare_node_tunnel_token <token>

# GitHub token for Flux
pulumi config set --secret github_token <token>

# Database connection (from cloud stack)
pulumi config set --secret postgres_url <url>
```

## CI Guard

This stack includes a runtime guard to prevent accidental execution in GitHub Actions:

```typescript
if (process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true") {
    throw new Error("CLUSTER STACK CANNOT RUN IN GITHUB ACTIONS");
}
```

If you see this error in CI, you likely meant to modify the `cloud/` stack instead.

## Architecture

### Bootstrap Flow

1. **Flux CD**: Bootstraps GitOps controller watching `clusters/tethys/`
2. **PKO**: Enables in-cluster Pulumi operations (future use)
3. **Cloudflare Tunnel**: Exposes k8s API at `k3s.boathou.se`
4. **Node Tunnels**: Optional per-node access (GPU, wildcard pods)
5. **Image Automation**: Watches registries for dependency updates
6. **Applications**: Label Studio, Triton adapter, etc.

### Dependencies

```
Flux (GitOps engine)
  ↓
PKO (in-cluster IaC)
  ↓
Cloudflare Tunnel (ingress)
  ↓
Applications (Label Studio, Triton)
```

## Stack Outputs

```typescript
export const kubeconfigPath: string              // Path to kubeconfig file
export const fluxNamespace: string               // flux-system
export const pkoNamespace: string                // pulumi-system
export const cloudflareNamespace: string         // cloudflared
export const labelStudioHostname: string         // label.boathou.se
export const migrationStatus: object             // Component migration state
```

View outputs:

```bash
pulumi stack output kubeconfigPath
pulumi stack output labelStudioHostname
```

## GitOps Workflow

**This stack bootstraps GitOps; applications deploy via Flux:**

1. Modify manifests in `clusters/tethys/`
2. Commit and push to `main`
3. Flux reconciles automatically (default: 1 minute)
4. Monitor: `flux get all -A`

**Force reconciliation:**

```bash
flux reconcile source git flux-system
flux reconcile kustomization apps
```

## Common Operations

### Update K3s Node Configuration

```bash
# Edit node IPs or labels in src/index.ts
vim src/index.ts

# Build and deploy
pnpm build
pulumi up
```

### Add New Cloudflare Ingress Rule

```bash
# Edit extraIngress in src/index.ts
# Add to CloudflareTunnel instantiation

# Deploy
pnpm build
pulumi up
```

### Rotate Secrets

```bash
# Update in Pulumi config (encrypts automatically)
pulumi config set --secret github_token <new_token>

# Apply changes
pulumi up
```

## Troubleshooting

### "Unable to connect to cluster"

```bash
# Verify SSH tunnel is active
lsof -ti:16443

# If not, establish tunnel
ssh -L 16443:localhost:6443 tethys -N &

# Verify kubeconfig
export KUBECONFIG=~/.kube/k3s-config.yaml
kubectl get nodes
```

### "Resource already exists"

If Pulumi fails with duplicate resources:

```bash
# Import existing resource
pulumi import <type> <name> <id>

# Or delete from state if no longer needed
pulumi state delete <URN>
```

### Flux Not Reconciling

```bash
# Check Flux health
flux check

# View reconciliation logs
kubectl logs -n flux-system deploy/source-controller
kubectl logs -n flux-system deploy/kustomize-controller

# Force reconciliation
flux reconcile source git flux-system --with-source
```

## Migration Notes

**2025-01-30:** Cloud resources migrated to separate `oceanid-cloud` stack:

- Cloudflare DNS records → `cloud/`
- CrunchyBridge database → `cloud/`
- Cloudflare Access apps → `cloud/`

This stack now focuses exclusively on k8s cluster bootstrap.

## See Also

- [Cloud Infrastructure](../cloud/README.md) - DNS, Access, databases
- [CLAUDE.md](../CLAUDE.md) - Cluster connection guide
