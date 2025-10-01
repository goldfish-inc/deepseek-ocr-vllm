# Oceanid Infrastructure

Pulumi-powered GitOps stack for operating the Oceanid k3s fleet behind Cloudflare Zero Trust.

> **Status:** Infrastructure operational with Label Studio, Triton Inference Server (Calypso RTX 4090), DistilBERT NER, and Docling-Granite PDF extraction. New staging database pipeline in development (see [CURRENT_STATE.md](CURRENT_STATE.md) and issues #46-#50).

## Infrastructure Ownership

| Project | Manages | Runs Where | Triggered By |
|---------|---------|------------|--------------|
| **[cloud/](cloud/)** | Cloudflare DNS/Access, CrunchyBridge PostgreSQL, ESC secrets | GitHub Actions (OIDC) | Push to `cloud/**` |
| **[cluster/](cluster/)** | k3s bootstrap, Flux, PKO, Cloudflare tunnels | Local / Self-hosted runner | Manual `pulumi up` |
| **[clusters/](clusters/)** | Application workloads (Label Studio, etc.) | Flux CD in-cluster | Push to `clusters/**` |
| **[policy/](policy/)** | OPA security policies, TypeScript helpers | GitHub Actions CI | All PRs |

**Key Principle:** Cloud resources (DNS, DB) are automated via CI. Cluster bootstrap requires kubeconfig and runs locally. Applications deploy via GitOps.

## Architecture Overview

**Oceanid** serves as the **data processing + ML pipeline layer** that cleans and validates data before promotion to the **@ebisu globalDB** (maritime intelligence platform).

```
┌─────────────────────────────────────────────────────────────┐
│ @oceanid: ETL + ML Pipeline (Staging)                       │
│                                                              │
│  Raw CSV/PDF → Docling-Granite → ML Cleaning → Human Review│
│      ↓              ↓                ↓             ↓        │
│  Label Studio   Structure      csv-repair     Corrections  │
│                 Extraction       -bert                      │
│                                                              │
│  Components:                                                 │
│  - Triton Inference (Calypso GPU): Models                   │
│  - Label Studio: Annotation + review UI                     │
│  - Staging DB: Document versions + cleaning audit           │
│  - Ingestion Worker: Automated CSV processing               │
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

See [CURRENT_STATE.md](CURRENT_STATE.md) for detailed component status and [CLAUDE.md](CLAUDE.md) for AI assistant guidelines.

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
curl -s http://localhost:9090/health
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

## GPU Access via Calypso (Contract)

This is the standardized path to the GPU workstation — do not reinvent this.

- DNS: `gpu.<base>` (e.g., `gpu.boathou.se`) is a CNAME to the Cloudflare Node Tunnel target `TUNNEL_ID.cfargotunnel.com`.
- Host tunnel on Calypso: Pulumi `HostCloudflared` renders `/etc/cloudflared/config.yaml` and a systemd unit `cloudflared-node.service` to route `gpu.<base>` → `http://localhost:8000`.
- Triton on Calypso: Pulumi `HostDockerService` renders `tritonserver.service` (Docker) with GPU flags and binds `/opt/triton/models`.
- Adapter in cluster: `ls-triton-adapter` calls `TRITON_BASE_URL=https://gpu.<base>`.
 - When enabled, the adapter presents a Cloudflare Access service token so the public GPU endpoint is not exposed to the world.
- Pulumi flags/keys: `enableCalypsoHostConnector=true`, `cloudflareNodeTunnelId|Token|Hostname`, optional `tritonImage`.

Mermaid (request flow):

```mermaid
sequenceDiagram
  participant SME as SME Browser
  participant LS as Label Studio (K8s)
  participant AD as Adapter (K8s)
  participant CF as Cloudflare Edge
  participant CL as cloudflared (Calypso)
  participant TR as Triton (Calypso)

  SME->>LS: Upload doc / open task
  LS->>AD: ML backend /predict
  AD->>CF: HTTPS https://gpu.<base>
  CF->>CL: Tunnel request
  CL->>TR: http://localhost:8000/v2/models/.../infer
  TR-->>CL: logits
  CL-->>CF: response
  CF-->>AD: 200 + logits
  AD-->>LS: pre-labels
  ```

  Admin commands (Calypso):
  - Restart Triton: `sudo systemctl restart tritonserver`
  - Restart tunnel: `sudo systemctl restart cloudflared-node`
  - Model repo: `/opt/triton/models/<model>/1/model.onnx` (config.pbtxt in model dir)

### PDF Support (Docling‑Granite via Triton Python)

- Copy the provided Triton Python model to Calypso:
  - `scp -r triton-models/docling_granite_python calypso:/tmp/`
  - `ssh calypso "sudo mv /tmp/docling_granite_python /opt/triton/models/ && sudo systemctl restart tritonserver"`
- Call through the adapter with `model: "docling_granite_python"` and `pdf_base64`.

Example:

```bash
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
PDF64=$(base64 -w0 sample.pdf)
curl -s -X POST http://localhost:9090/predict \
  -H 'Content-Type: application/json' \
  -d '{"model":"docling_granite_python","pdf_base64":"'"$PDF64"'","prompt":"Extract vessel info"}'
```

Alternatively, if you have an accessible document URL, you can pass `pdf_url` and skip base64:

```bash
curl -s -X POST http://localhost:9090/predict \
  -H 'Content-Type: application/json' \
  -d '{"model":"docling_granite_python","pdf_url":"https://example.com/doc.pdf","prompt":"Extract vessel info"}'
```

Label Studio integration
- For automatic PDF pre‑labels from tasks, set the ML Model URL to the adapter's LS endpoint:
  - `http://ls-triton-adapter.apps.svc.cluster.local:9090/predict_ls`
  - See docs/ML_BACKEND_CONNECTION.md for per‑project connection steps
  The adapter extracts the PDF URL from the task payload and routes to `docling_granite_python`.

## Model Training Loop (DistilBERT NER)

- Train a NER model from your HF JSONL annotations, export to ONNX, and deploy to Triton.
  This is automated via GitHub Actions and a host-side puller.

Steps
- Prepare labels JSON (ESC `nerLabels` order is the ground truth).
- Train locally (requires Python, transformers, datasets):
  - `python scripts/ner_train.py --labels labels.json --data-dir ./local_annotations --out ./models/ner-distilbert`
- Export ONNX with Optimum:
  - `bash scripts/export_onnx.sh ./models/ner-distilbert distilbert_onnx 63`
- Deploy to Calypso:
  - `scp distilbert_onnx/model.onnx calypso:/tmp && ssh calypso 'sudo mkdir -p /opt/triton/models/distilbert-base-uncased/1 && sudo mv /tmp/model.onnx /opt/triton/models/distilbert-base-uncased/1/ && sudo systemctl restart tritonserver'`

Notes
- Keep `triton-models/distilbert-base-uncased/config.pbtxt` in sync with label count.
- CI: `.github/workflows/train-ner.yml` runs nightly (or on demand) to train and publish `onnx/model.onnx` to `HF_MODEL_REPO` (set via GitHub Variables).
- Calypso: a `model-puller` systemd timer fetches the latest ONNX from HF and drops a new version under `/opt/triton/models/distilbert-base-uncased/<n>/`.
- Triton runs with `--model-control-mode=poll` and auto-loads new versions.

## SME Workflow (CSV/Text/PDF/Images)

For SMEs working with multi-format data:

- v1 (current): Pre-labels for Text and PDFs. CSVs work when a row has a `text` column or a `pdf`/`url` column. Images require conversion to PDF or OCR to enable pre-labels.
- v2 (planned): Integrate existing pandas cleaners to normalize per-country spreadsheets automatically in-cluster and import clean tasks into Label Studio.

See the detailed guide with diagrams: `docs/SME_WORKFLOW.md`.

## External Postgres (CrunchyBridge)

- Preferred for staging. Provide the connection URI via Pulumi config, then apply SQL migrations locally.

Steps
- Set the DB URL (secret):
  - `pulumi -C cluster config set --secret oceanid-cluster:postgres_url 'postgresql://<user>:<pass>@<host>:5432/<db>'`
- Deploy the sink (reads `DATABASE_URL` from config):
  - `make up`
- Apply schema migrations from your workstation:
  - `export DATABASE_URL='postgresql://<user>:<pass>@<host>:5432/<db>'`
  - `make db:migrate`
- Check connectivity:
  - `make db:psql`

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
