# Oceanid Infrastructure

Pulumi-powered GitOps stack for operating the Oceanid K3s fleet behind Cloudflare Zero Trust.

Status: Networking stack consolidated and hardened. Cloudflare tunnels (cluster + node), Tailscale subnet router, and egress DB proxy are fully reconciled. Flux is standardized to the flux-system namespace only, with OPA guardrails.

## Infrastructure Ownership

| Project | Manages | Runs Where | Triggered By |
|---------|---------|------------|--------------|
| **[cloud/](cloud/)** | Cloudflare DNS/Access, CrunchyBridge PostgreSQL, ESC secrets | GitHub Actions (OIDC) | Push to `cloud/**` |
| **[cluster/](cluster/)** | K3s bootstrap, Flux, PKO, Cloudflare tunnels | Local / Self-hosted runner | Manual `pulumi up` |
| **[clusters/](clusters/)** | Application workloads (PostGraphile, Go services) | Flux CD in-cluster | Push to `clusters/**` |
| **[policy/](policy/)** | OPA security policies, TypeScript helpers | GitHub Actions CI | All PRs |

**Key Principle:** Cloud resources (DNS, DB) are automated via CI.
Cluster bootstrap requires kubeconfig and runs locally.
Applications deploy via GitOps.

## Architecture Overview

**Oceanid** serves as the **data processing + ML pipeline layer** that cleans and validates data before promotion to
the **@ebisu globalDB** (maritime intelligence platform).

```text
┌─────────────────────────────────────────────────────────────┐
│ @oceanid: ETL + ML Pipeline (Staging)                       │
│                                                              │
│  Raw CSV/PDF → Cleaning → Human Review                      │
│      ↓              ↓                ↓                      │
│  Go services   Structure        PostGraphile                │
│                Extraction                                     │
│                                                              │
│  Components:                                                 │
│  - Triton Inference (Calypso GPU): Models                   │
│  - Cleandata DB: Separate database for data pipeline        │
│  - CSV Ingestion Worker: Go service for data cleaning       │
│  - Staging Pipeline: Confidence scoring + human review      │
└──────────────────────┬──────────────────────────────────────┘
                       │ Promotion (audited)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ @ebisu: GlobalDB (Production)                               │
│                                                              │
│  Intelligence Platform: Vessel entities, cross-source       │
│  confirmations, conflict tracking, trust scoring            │
└─────────────────────────────────────────────────────────────┘
```

### Key Principle: Separation of Concerns

- **@oceanid**: "How was this document cleaned?" (ETL metadata, ML model versions, human corrections)
- **@ebisu**: "What do we know about this vessel?" (domain intelligence, entity relationships, temporal changes)

See [CLAUDE.md](CLAUDE.md) for AI assistant guidelines and [docs/RESOURCE_OWNERSHIP.md](docs/RESOURCE_OWNERSHIP.md) for resource ownership contract.

### Observability Split

Observability (dashboards, alerts, SLOs) is being moved to a dedicated project/repository to decouple runtime telemetry from this infra/data repo. In this repo we will retain only:
- WAF and tunnel configs under `cloud/` (security controls)
- Any base ServiceMonitor/metrics endpoints required for cluster health

The `dashboards/` directory remains for now as legacy artifacts and will be migrated to the new observability project.

### Key Docs

- EBISU Pipeline Workflows (Ingress/Egress): docs/EBISU_PIPELINE_WORKFLOWS.md
- Collision Review UI RFC (separate project): docs/RFC_UI_COLLISION_REVIEW.md
- EBISU Data Dictionary: docs/ebisu-data-dictionary.md
- EBISU Implementation Summary: docs/EBISU_IMPLEMENTATION_SUMMARY.md

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

All sensitive values are expected to come from Pulumi ESC via `Pulumi.prod.yaml`.
Populate the `default/oceanid-cluster` environment (or override via `pulumi config`) with the following keys before
running `pulumi up`:

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
| `gitRepositoryUrl` | Git repository watched by Flux (default: this repo). |
| `gitRepositoryBranch` | Branch Flux reconciles (default: `main`). |
| `gitRepositoryPath` | Path within the repo containing the kustomizations (default: `clusters/tethys`). |

Kubeconfig for the cluster stack:

- The cluster project requires `KUBECONFIG` to be set by the self‑hosted runner (or your local shell) to a kubeconfig file path.
- There is no fallback to Pulumi config or repo files.
- If `KUBECONFIG` contains multiple paths, only the first is used.

Example resource override (set via `pulumi config set --path` or ESC JSON):

```bash
pulumi config set --path 'oceanid-cluster:cloudflareTunnelResources.requests.memory' 384Mi
pulumi config set --path 'oceanid-cluster:cloudflareTunnelResources.limits.memory' 768Mi
```

## Repository Layout

```text
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
│   │   └── stacks/                # Stack CR definitions consumed by the operator
│   └── tethys/                    # Cluster overlay referencing the base manifests
├── policy/
│   ├── opa-policies.rego          # OPA policies executed in CI
│   ├── validation.ts              # Pulumi-aware validation helpers
│   └── package.json
├── scripts/                       # Operational scripts (bootstrap, validation, etc.)
└── pnpm-workspace.yaml
```

## Networking Architecture

Core networking is provided by Cloudflare tunnels (cluster + node), optional Cloudflare WARP for operator access, and a Tailscale subnet router for unified egress. Highlights:

- Cluster tunnel (namespace `cloudflared`): In‑cluster Deployment publishes private services through Cloudflare Zero Trust. Uses remote tunnel config, `protocol: auto`, `edge-ip-version: "4"`, and extended startupProbe for resilience during external DNS slowness.
- Node tunnels (namespace `node-tunnels`): DaemonSet with `warp-routing: enabled: true` to route private CIDRs and GPU access; hostNetwork with `ClusterFirstWithHostNet` DNS.
- Calypso connector: Host‑level cloudflared (systemd) exposes Triton at `https://gpu.<base>` without in‑cluster adapters.
- Tailscale subnet router (namespace `tailscale`): Single Deployment (pinned to tethys) advertises K8s CIDRs and can act as an exit node.
- Egress DB proxy (namespace `apps`): Lightweight Deployment to forward Postgres traffic through a known egress IP.
- Flux controllers: Managed only in `flux-system`. OPA forbids controllers outside this namespace.

Operational shortcuts:

```bash
# Simple deploy path and smoke checks
make deploy-simple
make smoke

# Triton health (Calypso)
curl -sk https://gpu.boathou.se/v2/health/ready
```

If kubectl cannot reach the API, prefer WARP (see docs/warp-next-action.md). SSH tunnels are deprecated but available:

```bash
scripts/k3s-ssh-tunnel.sh tethys
export KUBECONFIG=cluster/kubeconfig.yaml
kubectl get nodes
```

### Rollouts & Health

- Force rollouts deterministically by bumping the pod template annotation `oceanid.dev/rollout-token` on Deployments.
- Cloudflared startup: extended `startupProbe` window (~140s) tolerates transient external DNS slowness during bootstrap.
- Resource timeouts: `customTimeouts` (create/update 10m) prevent Pulumi from timing out while pods make progress.
- Last resort during incident response: set `metadata.annotations["pulumi.com/skipAwait"] = "true"` on the Deployment to unblock reconciliation; remove after recovery.

Troubleshooting cloudflared DNS:
- If CoreDNS upstreams are slow, check logs in `kube-system` and verify forwarders.
- As a temporary bypass, you can set per‑pod DNS on cloudflared (not required in steady state):
  - `dnsPolicy: None`
  - `dnsConfig.nameservers: ["1.1.1.1", "8.8.8.8"]`

## GPU Access via Calypso (Contract)

This is the standardized path to the GPU workstation — do not reinvent this.

- DNS: `gpu.<base>` (e.g., `gpu.boathou.se`) is a CNAME to the Cloudflare Node Tunnel target `TUNNEL_ID.cfargotunnel.com`.
- Host tunnel on Calypso: Pulumi `HostCloudflared` renders `/etc/cloudflared/config.yaml` and a systemd unit
  `cloudflared-node.service` to route `gpu.<base>` → `http://localhost:8000`.
- Triton on Calypso: Pulumi `HostDockerService` renders `tritonserver.service` (Docker) with GPU flags and binds
  `/opt/triton/models`.
- Access gating: Use Cloudflare Access service tokens to protect `gpu.<base>` without exposing it publicly.
- Pulumi flags/keys: `enableCalypsoHostConnector=true`, `cloudflareNodeTunnelId|Token|Hostname`, optional `tritonImage`.

Mermaid (request flow):

```mermaid
sequenceDiagram
  participant SME as SME Browser
  participant CF as Cloudflare Edge
  participant CL as cloudflared (Calypso)
  participant TR as Triton (Calypso)

  SME->>CF: HTTPS https://gpu.<base>
  CF->>CL: Tunnel request
  CL->>TR: http://localhost:8000/v2/models/.../infer
  TR-->>CL: logits
  CL-->>CF: response
  CF-->>SME: 200 + logits
  ```

Admin commands (Calypso):

- Restart Triton: `sudo systemctl restart tritonserver`
- Restart tunnel: `sudo systemctl restart cloudflared-node`
- Model repo: `/opt/triton/models/<model>/1/model.onnx` (config.pbtxt in model dir)

### PDF Support (Docling‑Granite via Triton Python)

- Copy the provided Triton Python model to Calypso:
  - `scp -r triton-models/docling_granite_python calypso:/tmp/`
  - `ssh calypso "sudo mv /tmp/docling_granite_python /opt/triton/models/ && sudo systemctl restart tritonserver"`
- Call Triton directly via `https://gpu.<base>` with the Triton HTTP v2 API.

```bash
# Triton health (expect: ready: true)
curl -sk https://gpu.boathou.se/v2/health/ready
```
  - `http://ls-triton-adapter.apps.svc.cluster.local:9090/predict_ls`
  - See docs/ML_BACKEND_CONNECTION.md for per‑project connection steps
  The adapter extracts the PDF URL from the task payload and routes to `docling_granite_python`.

### Active Learning Pipeline

The adapter exposes `/train` to support Label Studio Active Learning with automatic model retraining:

**Architecture:**
1. Annotation submission → POST `/train` → Creates K8s Job on Calypso GPU node
2. Training Job fetches annotations from HuggingFace dataset
3. Fine-tunes DistilBERT model on new annotations
4. Exports optimized ONNX model
5. Publishes to HuggingFace model repository
6. Reloads Triton model via Model Control API (zero-downtime)
7. Next predictions use updated model

**Configuration:**
- `TRAIN_ASYNC` (default `true`): Run training Job asynchronously
- `TRAIN_DRY_RUN` (default `false`): Skip Job creation, log only
- `TRAINING_JOB_IMAGE`: Container image for training worker
- `TRAINING_JOB_NAMESPACE`: K8s namespace for Jobs (default `apps`)
- `TRITON_URL`: Triton server URL for model reload
- `TRITON_MODEL_NAME`: Model name in Triton repository

**Local validation:**

```bash
# Start adapter locally (dry-run)
cd apps/ls-triton-adapter && TRAIN_DRY_RUN=1 go run .

# In another terminal, test endpoint
curl -X POST http://localhost:9090/train \
  -H "Content-Type: application/json" \
  -d '{"annotations": [{"text": "Test", "label": "VESSEL"}]}'
```

**Cluster validation:**

```bash
# Port-forward to adapter
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &

# Trigger training
curl -X POST http://localhost:9090/train \
  -H "Content-Type: application/json" \
  -d '{"annotations": [{"text": "Vessel IMO 1234567", "label": "VESSEL"}]}'

# Check Job status
kubectl get jobs -n apps | grep train
kubectl logs -n apps job/train-<timestamp> -f
```

## Model Training (DistilBERT NER)

### Automated Active Learning (Production)

Training is fully automated via the Active Learning pipeline:
- Annotations submitted in Label Studio trigger K8s Jobs
- Jobs run on Calypso GPU node with RTX 4090
- Trained models automatically reload into Triton (zero-downtime)

See **Active Learning Pipeline** section above for architecture details.

### Manual Training (Development)

For local development and testing:

```bash
# 1. Prepare labels (ESC nerLabels order is ground truth)
cat labels.json

# 2. Train model
python scripts/ner_train.py \
  --labels labels.json \
  --data-dir ./local_annotations \
  --out ./models/ner-distilbert

# 3. Export to ONNX
bash scripts/export_onnx.sh \
  ./models/ner-distilbert \
  ./distilbert_onnx \
  63  # label count

# 4. Test locally with Triton
# (Copy model.onnx to Triton model repository and reload)
```

### Training Worker Components

- **Container**: `ghcr.io/goldfish-inc/oceanid/training-worker:main`
- **Base image**: `python:3.11-slim` (optimized for GitHub Actions disk space)
- **Entrypoint**: `apps/training-worker/entrypoint.py`
  - Fetches annotations from HuggingFace dataset
  - Trains DistilBERT with `scripts/ner_train.py`
  - Exports ONNX with `scripts/export_onnx.sh`
  - Publishes to HuggingFace model repository
  - Reloads Triton model via Model Control API

## SME Workflow (CSV/Text/PDF/Images)

For SMEs working with multi-format data:

- v1 (current): Pre-labels for Text and PDFs. CSVs work when a row has a `text` column or a `pdf`/`url` column. Images require conversion to PDF or OCR to enable pre-labels.
- v2 (planned): Integrate existing pandas cleaners to normalize per-country spreadsheets automatically in-cluster and import clean tasks into Label Studio.

See the detailed guide with diagrams: `@docs/guides/SME/workflow.md`.
For DB access and staging table workflows, see `@docs/guides/SME/index.mdx`.
For docs-site SQLPlayground setup and the `staging` alias, see `docs/operations/sqlplayground-connection.mdx`.

## External Postgres (CrunchyBridge)

- Preferred for staging. Provide the connection URI via Pulumi config, then apply SQL migrations locally.

Steps

- Set the DB URL (secret):
  - `pulumi -C cluster config set --secret oceanid-cluster:postgres_url 'postgresql://<user>:<pass>@<host>:5432/<db>'`
- Deploy the sink (reads `DATABASE_URL` from config):
  - `make up`
- Apply schema migrations from your workstation:
  - `export DATABASE_URL='postgresql://<user>:<pass>@<host>:5432/<db>'`
  - `make db-migrate`
- Check connectivity:
  - `make db-psql`

Notes

- Migrations live under `sql/migrations/`; see `sql/README.md`.
- If `postgres_url` is not set, the sink falls back to in-cluster Postgres when `postgres_password` is configured.

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
