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

## CI/CD Overview

The `.github/workflows/infrastructure.yml` pipeline performs the following:

1. **Lint & Test** – installs workspace dependencies, type-checks the Pulumi program, and runs OPA tests using the new pnpm workspace.
2. **Preview (PRs)** – acquires a short-lived Pulumi access token via GitHub OIDC, then runs `pulumi preview` with comments posted back to the pull request.
3. **Deploy (main)** – uses the same OIDC workflow to execute `pulumi up` once changes merge to `main`.

Set the repository secret `PULUMI_CONFIG_PASSPHRASE` and ensure the Pulumi project is configured to trust the GitHub Actions OIDC provider before enabling automatic deploys.

## Operational Tips

- `pnpm --filter @oceanid/cluster build` is the authoritative type-check for changes to the Pulumi program.
- To validate policy changes locally, run `pnpm --filter @oceanid/policy test` (requires the `opa` CLI).
- Flux reconciles the manifests under `clusters/`; updating the stack CR or overlays there influences what the Pulumi Kubernetes Operator deploys.
- Legacy TypeScript files live under `cluster/legacy/` for reference; migrate logic into strongly typed component resources before reenabling.

## Roadmap

- Expand component coverage (cert-manager, PKO installation, backup tooling) using the new component/resource pattern.
- Flesh out policy enforcement by integrating the validation helpers into the Pulumi stack runtime once the stack has real-world resources.
- Replace placeholder documentation (e.g. node inventory, monitoring claims) with data gathered from an actual deployment once the cluster is online.
