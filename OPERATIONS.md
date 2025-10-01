# Operations Guide

This guide covers the day‑to‑day flows for the Oceanid stack with 2× VPS and 1× GPU workstation.

## Topology
- K8s on primary VPS (tethys). Label Studio runs here and is exposed via the Cloudflare cluster tunnel at `https://label.boathou.se`.
- Calypso (GPU workstation) runs a host‑level cloudflared connector and a simple GPU HTTP service at `https://gpu.boathou.se`.
- All secrets and tokens are stored in Pulumi ESC (`default/oceanid-cluster`).

### Calypso Contract
- DNS: `gpu.<base>` CNAME points to the Node Tunnel target `<TUNNEL_ID>.cfargotunnel.com`.
- Host tunnel: systemd `cloudflared-node.service`, config under `/etc/cloudflared/config.yaml` routing `gpu.<base>` → `http://localhost:8000`.
- Triton: systemd `tritonserver.service` (Docker), ports 8000/8001/8002; models mounted from `/opt/triton/models`.
- Adapter: calls `TRITON_BASE_URL=https://gpu.<base>`.
- Pulumi ownership: `HostCloudflared` and `HostDockerService` components render/update these units.

## Deploy
- Minimal, non‑disruptive deploy:
  - `make deploy-simple`
- Full deploy (enable provisioning + LB) once tunnels are stable:
  - `pulumi config set oceanid-cluster:enableNodeProvisioning true`
  - `pulumi config set oceanid-cluster:enableControlPlaneLB true`
  - `pulumi up`

## Validate
- If kubectl is flaky, ensure a local API tunnel:
  - `scripts/k3s-ssh-tunnel.sh tethys`
  - `export KUBECONFIG=cluster/kubeconfig.yaml`
- Basic smoke tests:
  - `make smoke` (uses label.boathou.se and gpu.boathou.se)
  - Triton HTTP V2 live:
    - `curl -s https://gpu.boathou.se/v2/health/ready`
    - `curl -s https://gpu.boathou.se/v2/models`
  - Docling model present:
    - `curl -s https://gpu.<base>/v2/models/docling_granite_python`

## Hands‑off Training and Deployment (ESC‑only)

- GitHub Actions (`.github/workflows/train-ner.yml`) trains (nightly or on demand) from the HF dataset and publishes an updated ONNX to a private HF model repo.
- Calypso runs a `model-puller` systemd timer that fetches the latest ONNX into `/opt/triton/models/distilbert-base-uncased/<n>/`.
- Triton repository polling reloads new versions automatically.

Configure once in Pulumi ESC (no GitHub Secrets/Vars required):
- `pulumiConfig.oceanid-cluster:hfAccessToken` → HF write token (used by sink + CI)
- `pulumiConfig.oceanid-cluster:hfDatasetRepo` → e.g., `goldfish-inc/oceanid-annotations`
- `pulumiConfig.oceanid-cluster:hfModelRepo` → e.g., `goldfish-inc/oceanid-ner-distilbert`
- `pulumiConfig.oceanid-cluster:postgres_url` → CrunchyBridge PG 17 URL (for migrations)

ESC commands:
```bash
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfAccessToken "<HF_WRITE_TOKEN>" --secret
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfDatasetRepo "goldfish-inc/oceanid-annotations"
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:hfModelRepo "goldfish-inc/oceanid-ner-distilbert"
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:postgres_url "postgres://<user>:<pass>@p.<cluster-id>.db.postgresbridge.com:5432/postgres" --secret
```

Workflows:
- `train-ner.yml` pulls HF token + repo names from ESC via OIDC.
- `database-migrations.yml` pulls DB URL from ESC and applies SQL migrations V3–V6; ensures extensions `pgcrypto`, `postgis`, `btree_gist`. Skips gracefully if DB URL not set.
- Check connector health in Cloudflare Zero Trust → Tunnels.

Mermaid (GPU path):

```mermaid
flowchart LR
  LS[Label Studio] --> AD[Adapter]
  AD --> CF[Cloudflare Edge]
  CF --> CL[cloudflared (Calypso)]
  CL --> TR[Triton 8000]
```

## Label Studio ML Backend (Auto-configured)

- **ML backend auto-connection**: Kubernetes CronJob runs hourly to connect `ls-triton-adapter` to all projects
- **No manual setup required**: New projects automatically get ML backend within 1 hour
- **Architecture**: CronJob → Label Studio API → Connect ML backend to all projects
- **Authentication**: Uses Label Studio API token from 1Password (stored in ESC as `labelStudioApiToken`)

**Manual trigger** (if needed):
```bash
KUBECONFIG=~/.kube/k3s-config.yaml kubectl create job --from=cronjob/ls-ml-setup ls-ml-setup-manual -n apps
```

**Check status**:
```bash
KUBECONFIG=~/.kube/k3s-config.yaml kubectl get cronjob ls-ml-setup -n apps
KUBECONFIG=~/.kube/k3s-config.yaml kubectl logs -n apps -l app=ls-ml-setup --tail=50
```

## Secrets & Config
- ESC keys to verify:
  - `cloudflareNodeTunnelId`, `cloudflareNodeTunnelToken`, `cloudflareNodeTunnelHostname`, `cloudflareNodeTunnelTarget`
  - `cloudflareAccountId`, `cloudflareApiToken`, `cloudflareZoneId`
  - `labelStudioApiToken` - API token for ML backend auto-configuration (from 1Password)
- The node tunnel token can be either:
  - Base64‑encoded credentials.json, or
  - Raw TUNNEL_TOKEN string
  The NodeTunnels + HostCloudflared components auto‑detect both.

## Troubleshooting
- Cloudflare record exists: delete the existing DNS record (e.g., `label.boathou.se`) or remove Pulumi management for that hostname.
- cloudflared “control stream failure”:
  - Ensure `protocol: auto` and `dnsPolicy: ClusterFirstWithHostNet` are active.
  - Verify Calypso has the label `oceanid.cluster/tunnel-enabled=true` if using the K8s DaemonSet.
- SSH provisioning timeouts:
  - Keep `enableNodeProvisioning=false` while stabilizing tunnels.
- Calypso sudo:
  - `oceanid` must have passwordless sudo for apt/systemd.

### Calypso quick checks
```bash
ssh calypso 'systemctl status cloudflared-node --no-pager; systemctl status tritonserver --no-pager'
ssh calypso 'curl -sf http://localhost:8000/v2/health/ready && echo OK'
curl -sk https://gpu.<base>/v2/health/ready
```

### CrunchyBridge Postgres
- Configure sink to use external DB:
  - `pulumi -C cluster config set --secret oceanid-cluster:postgres_url 'postgresql://<user>:<pass>@<host>:5432/<db>'`
  - `make up`
- Apply schema migrations locally:
  - `export DATABASE_URL='postgresql://<user>:<pass>@<host>:5432/<db>'`
  - `make db:migrate`
- Quick checks:
  - `make db:psql`
  - `psql "$DATABASE_URL" -c "select * from stage.v_documents_freshness;"`

### Label Studio database (labelfish)
- Database: `labelfish` on the "ebisu" CrunchyBridge cluster (PG 17), isolated from staging/curated
- Schema: `labelfish` (bootstrap in `sql/labelstudio/labelfish_schema.sql`); app tables created by Label Studio migrations
- Roles: `labelfish_owner` (app), `labelfish_rw` (optional services), `labelfish_ro` (read‑only)
- Extensions: `pgcrypto`, `citext`, `pg_trgm`, `btree_gist`; defaults: `UTC`, `search_path=labelfish,public`, timeouts

Provision (manual):
```bash
# Create DB (example owner shown via CrunchyBridge CLI)
cb psql 3x4xvkn3xza2zjwiklcuonpamy --role postgres -- -c \
  "CREATE DATABASE labelfish OWNER u_ogfzdegyvvaj3g4iyuvlu5yxmi;"

# Apply bootstrap SQL (roles/schema/extensions/grants)
cb psql 3x4xvkn3xza2zjwiklcuonpamy --role postgres --database labelfish \
  < sql/labelstudio/labelfish_schema.sql

# Store connection URL for the cluster stack
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:labelStudioDbUrl \
  "postgres://labelfish_owner:<password>@p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com:5432/labelfish" --secret
```

Wire Label Studio (cluster):
- The cluster stack reads `labelStudioDbUrl` (ESC secret) and sets `DATABASE_URL` for the LS deployment.
- Public host: `LABEL_STUDIO_HOST=https://label.<base>`
- Tunnel ingress/DNS: `label.<base>` CNAME → `<cluster_tunnel_id>.cfargotunnel.com` (proxied) with ingress mapping to LS service.

Verify:
- `curl -I https://label.<base>/` → `302 Found` to `/user/login/`
- First start creates app tables: `psql …/labelfish -c "\dt labelfish.*"`

## Add a new GPU host (host‑level)
1. Provision SSH user + key; add to ESC.
2. Add a `HostCloudflared` + optional `HostGpuService` for the host.
3. Point a new `gpuX.<base>` route via Cloudflare DNS.

## Using Triton with Docling/Granite
- If you have a ready Docker image (e.g., a Docling‑Granite HTTP server), you can run it instead of Triton. Ask and we’ll switch the host service to that container and route `gpu.<base>` to its HTTP port.
- To use a model with Triton, place it under `/opt/triton/models/<model_name>/1/` on Calypso and add a `config.pbtxt`. Triton supports TensorRT, ONNX, PyTorch, TensorFlow and Python backends.
- For Docling‑Granite via Python backend, this repo includes a skeleton at `triton-models/docling_granite_python/`. Copy it to Calypso and customize `model.py` as needed.

Example (on Calypso):

```bash
sudo mkdir -p /opt/triton/models
scp -r triton-models/docling_granite_python calypso:/tmp/
ssh calypso "sudo mv /tmp/docling_granite_python /opt/triton/models/ && sudo systemctl restart tritonserver"
curl -s https://gpu.<base>/v2/models

GPU pinning
- `distilbert-base-uncased` is pinned to GPU0; `docling_granite_python` is pinned to GPU1 (see `instance_group.gpus` in each `config.pbtxt`). Adjust if hardware layout changes.
```

Adapter usage (PDF):

```bash
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
PDF64=$(base64 -w0 sample.pdf)
curl -s -X POST http://localhost:9090/predict \
  -H 'Content-Type: application/json' \
  -d '{"model":"docling_granite_python","pdf_base64":"'"$PDF64"'","prompt":"Extract vessel summary"}' | jq .
```
