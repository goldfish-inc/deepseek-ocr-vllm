# Oceanid Infrastructure

Pulumi-powered GitOps stack for operating the Oceanid k3s fleet behind Cloudflare Zero Trust. The repository is structured as a pnpm workspace with two packages:

- `@oceanid/cluster` – the Pulumi program that bootstraps Cloudflare tunnels, Flux, and any supporting workloads on the k3s control plane.
- `@oceanid/policy` – lightweight TypeScript helpers plus OPA policies that run during CI to keep baseline security controls in place.

> **Status:** The infrastructure compiles and previews successfully, but deployment still depends on Pulumi ESC secrets being populated with real credentials. Treat the manifests as production-ready templates that require verification in your environment.

## Getting Started

```bash
# Install dependencies for the whole workspace (cluster + policy)
pnpm install --frozen-lockfile

# (Optional) type-check the Pulumi program and policies locally
pnpm --filter @oceanid/cluster build
pnpm --filter @oceanid/policy lint
pnpm --filter @oceanid/policy test

# Select the stack and run a preview
cd cluster
pulumi stack select ryan-taylor/oceanid-cluster/prod
pulumi preview
```

### Required Pulumi Config / ESC Keys

All sensitive values are expected to come from Pulumi ESC via `Pulumi.prod.yaml`. Populate the `default/oceanid-cluster` environment (or override via `pulumi config`) with the following keys before running `pulumi up`:

| Key | Description |
| --- | ----------- |
| `cloudflareAccountId` | Cloudflare account that owns the tunnel. |
| `cloudflareApiToken` | API token with DNS + tunnel permissions. |
| `cloudflareTunnelId` | Identifier of the cloudflared tunnel. |
| `cloudflareTunnelToken` | Service token used by the cloudflared deployment. |
| `cloudflareZoneId` | Cloudflare zone where records are created. |
| `cloudflareNodeTunnelId` | Dedicated tunnel ID for node-level connectivity (Calypso, etc.). |
| `cloudflareNodeTunnelToken` | Service token / credentials JSON for the node tunnel. |
| `cloudflareNodeTunnelHostname` | Base domain for node tunnel routes (e.g. `boathou.se`). |
| `cloudflareNodeTunnelTarget` | (Optional) override for the node tunnel CNAME target; defaults to `<tunnelId>.cfargotunnel.com`. |
| `cloudflareNodeTunnelMetricsPort` | (Optional) metrics port for the node tunnel DaemonSet; defaults to `2200`. |
| `cloudflareNodeTunnelResources` | (Optional) JSON overrides for node tunnel container resources. |
| `tunnelHostname` | FQDN routed through the tunnel (e.g. `tethys.boathou.se`). |
| `tunnelServiceUrl` | Internal endpoint reached behind the tunnel (e.g. `https://10.0.0.10:6443`). |
| `cloudflareTunnelResources` | (Optional) JSON blob overriding tunnel container requests/limits; defaults to 200m/256Mi requests and 500m/512Mi limits. |
| `kubeconfigPath` | (Optional) override path to local kubeconfig; defaults to `./kubeconfig.yaml`. |
| `gitRepositoryUrl` | Git repository watched by Flux (default: this repo). |
| `gitRepositoryBranch` | Branch Flux reconciles (default: `main`). |
| `gitRepositoryPath` | Path within the repo containing the kustomizations (default: `clusters/tethys`). |

Kubeconfig location and GitOps settings can also be supplied through conventional Pulumi config (`pulumi config set oceanid-cluster:kubeconfigPath ...`).

Example resource override (set via `pulumi config set --path` or ESC JSON):

```bash
pulumi config set --path 'oceanid-cluster:cloudflareTunnelResources.requests.memory' 384Mi
pulumi config set --path 'oceanid-cluster:cloudflareTunnelResources.limits.memory' 768Mi
```

## Repository Layout

```
.
├── cluster/
│   ├── src/
│   │   ├── config.ts              # Strongly typed Pulumi config model
│   │   ├── providers.ts           # Shared providers (k3s + Cloudflare)
│   │   ├── components/
│   │   │   ├── cloudflareTunnel.ts # Hardened tunnel deployment + DNS automation
│   │   │   └── fluxBootstrap.ts    # Flux bootstrap via Helm
│   │   └── index.ts               # Entry point wiring components together
│   ├── legacy/                    # Previous ad-hoc resources kept for reference
│   ├── package.json               # pnpm workspace package definition
│   └── tsconfig.json
├── clusters/
│   ├── base/
│   │   ├── pulumi-system/         # Pulumi Kubernetes Operator manifests
│   │   └── stacks/                # Stack CR definitions consumed by the operator
│   └── tethys/                    # Cluster overlay referencing the base manifests
├── policy/
│   ├── opa-policies.rego          # OPA policies executed in CI
│   ├── validation.ts              # Pulumi-aware validation helpers
│   └── package.json
├── scripts/                       # Operational scripts (bootstrap, validation, etc.)
└── pnpm-workspace.yaml
```

## Minimal Architecture (Recommended)

- Kubernetes only on the primary VPS.
- Label Studio runs in K8s and is exposed at `https://label.boathou.se` via the cluster tunnel.
- Calypso (GPU workstation) runs a host-level cloudflared and Triton Inference Server, exposed at `https://gpu.boathou.se`.
- An in-cluster adapter (`ls-triton-adapter`) bridges Label Studio’s ML backend API to Triton HTTP v2.
- All secrets live in Pulumi ESC; infra is managed by Pulumi.

Quick deploy (skip SSH-heavy steps while stabilizing):

```bash
make deploy-simple
```

Validate:

```bash
make smoke
# Triton health
curl -sk https://gpu.boathou.se/v2/health/ready
# Adapter health (port-forward)
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
curl -s http://localhost:9090/healthz
```

Adapter config

- Set NER labels (optional) via Pulumi config:
  ```bash
  pulumi -C cluster config set oceanid-cluster:nerLabels '["O","VESSEL","HS_CODE","PORT","COMMODITY","IMO","FLAG","RISK_LEVEL","DATE"]'
  ```

If kubectl cannot reach the API, start a resilient tunnel:

```bash
scripts/k3s-ssh-tunnel.sh tethys
export KUBECONFIG=cluster/kubeconfig.yaml
kubectl get nodes
```

## CI/CD Overview

The `.github/workflows/infrastructure.yml` pipeline performs the following:

1. **Lint & Test** – installs workspace dependencies, type-checks the Pulumi program, and runs OPA tests using the new pnpm workspace.
2. **Preview (PRs)** – acquires a short-lived Pulumi access token via GitHub OIDC, then runs `pulumi preview` with comments posted back to the pull request.
3. **Deploy (main)** – uses the same OIDC workflow to execute `pulumi up` once changes merge to `main`.

Set the repository secret `PULUMI_CONFIG_PASSPHRASE` and ensure the Pulumi project is configured to trust the GitHub Actions OIDC provider before enabling automatic deploys.

## Cluster Access

### SSH Tunnel Setup

To access the K3s cluster API, you need to establish an SSH tunnel to the control plane node (tethys):

```bash
# Set up SSH tunnel (port 16443 locally → 6443 on tethys)
ssh -L 16443:localhost:6443 -N tethys &

# Use the cluster with the pre-configured kubeconfig
export KUBECONFIG=~/.kube/k3s-config.yaml
kubectl get nodes
```

**Important Notes:**
- The kubeconfig expects the API server at `https://localhost:16443`
- The SSH tunnel forwards local port 16443 to the K3s API on tethys:6443
- Kill any conflicting processes on port 16443 before establishing the tunnel
- The tunnel must remain active for kubectl commands to work

### Troubleshooting Connection Issues

If you encounter "connection reset" or "connection refused" errors:

1. Check for conflicting processes:
   ```bash
   lsof -i :16443
   pkill -f "ssh.*16443"  # Kill existing tunnels
   ```

2. Re-establish the tunnel:
   ```bash
   ssh -L 16443:localhost:6443 -N tethys &
   ```

3. Verify the tunnel is working:
   ```bash
   export KUBECONFIG=~/.kube/k3s-config.yaml
   kubectl get nodes
   ```

## Operational Tips

- `pnpm --filter @oceanid/cluster build` is the authoritative type-check for changes to the Pulumi program.
- To validate policy changes locally, run `pnpm --filter @oceanid/policy test` (requires the `opa` CLI).
- Flux reconciles the manifests under `clusters/`; updating the stack CR or overlays there influences what the Pulumi Kubernetes Operator deploys.
- Legacy TypeScript files live under `cluster/legacy/` for reference; migrate logic into strongly typed component resources before reenabling.

## Roadmap

- Expand component coverage (cert-manager, PKO installation, backup tooling) using the new component/resource pattern.
- Flesh out policy enforcement by integrating the validation helpers into the Pulumi stack runtime once the stack has real-world resources.
- Replace placeholder documentation (e.g. node inventory, monitoring claims) with data gathered from an actual deployment once the cluster is online.
