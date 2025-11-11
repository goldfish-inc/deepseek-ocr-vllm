# Oceanid Cluster Bootstrap

This Pulumi project bootstraps the **K3s Kubernetes cluster** with foundational infrastructure components. It manages in-cluster resources and requires kubeconfig access. For the full CI/CD picture (how this stack interacts with the cloud Pulumi project, Flux, and device workflows) see [docs/operations/cicd-architecture.md](../docs/operations/cicd-architecture.md).

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

This stack is deployed by **GitHub-hosted runners** (`ubuntu-latest`) via GitHub Actions. The workflow fetches kubeconfig from GitHub Secrets and connects to the cluster's public endpoint (`https://157.173.210.123:6443`).

### Automated Deployment

**Trigger**: Push to `main` branch touching `cluster/` directory

**How it works**:
1. GitHub Actions workflow starts on GitHub-hosted runner
2. Kubeconfig decoded from GitHub Secrets (base64-encoded)
3. Connects to cluster at public IP (no SSH tunnel needed)
4. Runs pre-flight checks (ownership conflicts, cluster health)
5. Executes `pulumi up` to deploy cluster resources

**Monitoring**:
- GitHub Actions → Deploy Cluster workflow
- Real-time logs in GitHub UI
- No self-hosted infrastructure required

### Kubeconfig Provisioning

**CI/CD (GitHub Actions)**:
- Kubeconfig stored in GitHub Secrets as `KUBECONFIG` (base64-encoded)
- Automatically decoded and used by workflow
- Connects to public endpoint: `https://157.173.210.123:6443`
- Update via: `base64 < ~/.kube/k3s-tethys-public.yaml | gh secret set KUBECONFIG`

**Local Development**:
- Export kubeconfig path: `export KUBECONFIG=~/.kube/k3s-tethys-public.yaml`
- Connect directly to public endpoint (WARP recommended, SSH tunnel fallback)
- Validate: `kubectl cluster-info --request-timeout=10s`

### Manual Deployment (Emergency Only)

For break‑glass scenarios (coordinate with ops first):

```bash
cd cluster/
pnpm install && pnpm build

# Use public endpoint kubeconfig
export KUBECONFIG=~/.kube/k3s-tethys-public.yaml

# Deploy
pulumi up
```

**Prerequisites**:
- Cluster access via WARP (preferred) or SSH tunnel (see [CLAUDE.md](../CLAUDE.md#cluster-access))
- Pulumi Cloud authentication: `pulumi login`
- Valid kubeconfig with public endpoint

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

## CI/CD Architecture

**GitHub-hosted runners** are used for all cluster deployments. The workflow:
- Fetches kubeconfig from GitHub Secrets (stored as base64)
- Connects to cluster's public endpoint (`157.173.210.123:6443`)
- Runs pre-flight validation checks
- Deploys using Pulumi with OIDC authentication

No self-hosted infrastructure, SSH tunnels, or VPN required for CI/CD.

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
Applications (Argilla, Triton)
```

## Stack Outputs

```typescript
export const kubeconfigPath: string              // Path to kubeconfig file
export const fluxNamespace: string               // flux-system
export const pkoNamespace: string                // pulumi-system
export const cloudflareNamespace: string         // cloudflared
export const migrationStatus: object             // Component migration state
```

View outputs:

```bash
pulumi stack output kubeconfigPath
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

## Namespace Ownership

- Pulumi owns foundational namespaces and creates them before any workloads:
  - `flux-system` (via FluxBootstrap component)
  - `pulumi-system` (via PulumiOperator component)
  - `cloudflared` (via CloudflareTunnel component)
  - `apps` (created early in `src/index.ts`)
- Flux owns workloads inside those namespaces and should not declare Namespace objects for them. Avoid `createNamespace: true` in Flux for these.
- CI must not create namespaces imperatively; ordering is encoded in the Pulumi program.

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

### "Unable to connect to cluster" (Local Development)

**For GitHub Actions**: Verify GitHub Secret `KUBECONFIG` is set correctly

**For local debugging**:
```bash
# Verify kubeconfig points to public endpoint
export KUBECONFIG=~/.kube/k3s-tethys-public.yaml
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
# Expected: https://157.173.210.123:6443

# Test connection
kubectl get nodes

# If using WARP (recommended)
warp-cli status
warp-cli disconnect && warp-cli connect

# If using SSH tunnel (fallback)
ssh -L 16443:localhost:6443 tethys -N &
export KUBECONFIG=~/.kube/k3s-config.yaml
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

### Known Issues (Non-Blocking)

**Pulumi Stack CRD Schema Warning**

Flux may report a Kustomization dry-run warning:
```
⚠️  Kustomization not ready: Stack/pulumi-system/oceanid-cluster-prod dry-run failed:
.spec.resources: field not declared in schema
```

**Impact:** None - deployments work correctly. This is a schema validation issue with PKO v2.2.0 CRDs.

**Resolution:** Will be fixed when upgrading to PKO v2.3.0+ (when available).

**Verification:**
```bash
# Check actual Pulumi Stack status (should show healthy)
kubectl get stack -n pulumi-system oceanid-cluster-prod
```

## Migration Notes

**2025-10-15:** Cluster deployments migrated to GitHub-hosted runners:

- Self-hosted runner removed (no longer required)
- Kubeconfig stored in GitHub Secrets (base64-encoded)
- Direct connection to public endpoint (`https://157.173.210.123:6443`)
- No SSH tunnels needed for CI/CD
- OIDC authentication to Pulumi Cloud

**2025-01-30:** Cloud resources migrated to separate `oceanid-cloud` stack:

- Cloudflare DNS records → `cloud/`
- CrunchyBridge database → `cloud/`
- Cloudflare Access apps → `cloud/`

This stack now focuses exclusively on k8s cluster bootstrap.

## See Also

- [Cloud Infrastructure](../cloud/README.md) - DNS, Access, databases
- [CLAUDE.md](../CLAUDE.md) - Cluster connection guide
