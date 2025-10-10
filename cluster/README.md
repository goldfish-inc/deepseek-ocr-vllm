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

## Deployment Model (Default)

This stack is deployed by a GitHub self‑hosted runner on a host with kubeconfig access (e.g., tethys). The workflow is responsible for providing `KUBECONFIG` to the Pulumi program. Do not run `pulumi up` from GitHub‑hosted runners without a self‑hosted agent and kubeconfig.

### Self‑Hosted Actions Runner (Required)

Install a GitHub Actions runner on tethys and register it to this repository or organization. Then use the provided workflow to run `pulumi up` on push to `main` for `cluster/` changes.

Monitoring:
- GitHub Actions → Deploy Cluster (self‑hosted)

### Kubeconfig Provisioning (CI Service)

- The self‑hosted workflow loads kubeconfig into `$RUNNER_TEMP/kubeconfig.yaml` and exports `KUBECONFIG`.
- Preferred source: Pulumi ESC key `pulumiConfig.oceanid-cluster:kubeconfig` (stored as a secret value).
- Alternative: Pre‑configure the runner environment to export `KUBECONFIG` to an existing kubeconfig file path.

Store kubeconfig in ESC (recommended):

```bash
esc env set default/oceanid-cluster \
  pulumiConfig.oceanid-cluster:kubeconfig \
  "$(cat ~/.kube/k3s-config.yaml)" \
  --secret
```

Pulumi config/env requirements:

- `oceanid-cluster:kubeconfigPath` Pulumi config key, or
- `KUBECONFIG` environment variable set by the CI job.

There is no default path: if neither is provided, the program fails fast with a clear error.

### Manual Fallback (Discouraged)

For break‑glass only (coord with ops):

```bash
cd cluster/
pnpm install && pnpm build
PULUMI_CONFIG_PASSPHRASE=… pulumi up
```

Prereqs: SSH tunnel to control plane (see [CLAUDE.md](../CLAUDE.md#k3s-cluster-access)) and `KUBECONFIG` exported to your kubeconfig path, e.g.:

```bash
export KUBECONFIG=~/.kube/k3s-config.yaml
```

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

This stack bootstraps GitOps; applications deploy via Flux:

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
