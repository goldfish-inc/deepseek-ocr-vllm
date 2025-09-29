# Reset Checklist — Fast Recovery

Use this when picking up work after a context reset. It restores your local tooling, verifies ESC/stack config, and validates pre‑labels end‑to‑end.

## 0) Prereqs
- Pulumi CLI (logged in to Pulumi Cloud)
- Node 20.x, pnpm 9.x
- kubectl configured to reach the cluster (`cluster/kubeconfig.yaml` exists)

```bash
# From repo root
make install          # pnpm install
make build            # type-check Pulumi program
```

## 1) Select Stack + Attach ESC
```bash
cd cluster
pulumi stack select ryan-taylor/oceanid-cluster/prod
# Verify in Pulumi Cloud UI: Stack → Environments → ensure `default/oceanid-cluster` is attached
# (Optional, if you use pulumi env) pulumi env attach default/oceanid-cluster || true
```

## 2) Verify Required Config (from ESC)
These should appear in `pulumi config` (secrets show as [secret]):
- Cloudflare (provider): `cloudflareAccountId`, `cloudflareZoneId`, `cloudflareApiToken`
- Cluster tunnel: `cloudflareTunnelId`, `cloudflareTunnelToken`, `cloudflareTunnelHostname`
- Node tunnel (Calypso): `cloudflareNodeTunnelId`, `cloudflareNodeTunnelToken`, `cloudflareNodeTunnelHostname`
- Adapter NER labels: `nerLabels` (63‑label JSON)
- Calypso SSH key: `calypso_ssh_key`

```bash
pulumi config
```

If anything is missing, add it to ESC (examples):
```bash
# NER labels (single-line JSON)
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:nerLabels "$(cat ner_labels.json)" --secret
# Node tunnel token (string or base64 credentials.json)
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:cloudflareNodeTunnelToken "<TOKEN>" --secret
```

## 3) Recommended Flags
```bash
# Use host connector + Triton only (stable path for SMEs)
pulumi config set oceanid-cluster:enableCalypsoHostConnector true
pulumi config set oceanid-cluster:enableNodeTunnels false
# (Optional) pin/override Triton image (default already 2.60.0)
pulumi config set oceanid-cluster:tritonImage ghcr.io/triton-inference-server/server:2.60.0-py3
# Keep built-in adapter NER (more reliable)
pulumi config set oceanid-cluster:useExternalAdapter false
```

## 4) Apply
```bash
pulumi up
```

## 5) Prepare Triton (once on Calypso)
Pick one model path below. For SMEs we recommend DistilBERT for lower RAM/CPU while retaining good quality.

Option A — DistilBERT (recommended)
```bash
# Export DistilBERT to ONNX for token classification with 63 labels
pip install --upgrade pip
pip install "optimum[exporters]" onnxruntime
optimum-cli export onnx --model distilbert-base-uncased \
  --task token-classification \
  --num_labels 63 \
  distilbert_onnx/

ssh calypso 'sudo mkdir -p /opt/triton/models/distilbert-base-uncased/1'
scp distilbert_onnx/model.onnx calypso:/opt/triton/models/distilbert-base-uncased/1/
scp triton-models/distilbert-base-uncased/config.pbtxt calypso:/opt/triton/models/distilbert-base-uncased/
ssh calypso 'sudo systemctl restart tritonserver'
```

Option B — BERT base (larger)
```bash
# Export and install BERT ONNX with 63 labels
pip install --upgrade pip
pip install "optimum[exporters]" onnxruntime
optimum-cli export onnx --model bert-base-uncased \
  --task token-classification \
  --num_labels 63 \
  bert_onnx/

ssh calypso 'sudo mkdir -p /opt/triton/models/bert-base-uncased/1'
scp bert_onnx/model.onnx calypso:/opt/triton/models/bert-base-uncased/1/
scp triton-models/bert-base-uncased/config.pbtxt calypso:/opt/triton/models/bert-base-uncased/
ssh calypso 'sudo systemctl restart tritonserver'
```

## 6) Validate
```bash
# Triton
curl -sk https://gpu.<base>/v2/health/ready

# Adapter
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
curl -s http://localhost:9090/healthz
curl -s -X POST http://localhost:9090/predict \
  -H 'Content-Type: application/json' \
  -d '{"model":"bert-base-uncased","task":"ner","text":"MV Iconic arrived with HS code 123456."}'
```

## 7) Troubleshooting Cheats
- Host cloudflared (Calypso) token/auth
  - ssh calypso 'sudo journalctl -u cloudflared-node -f'
  - If you see “Invalid tunnel secret”, ensure `cloudflareNodeTunnelToken` belongs to the exact `cloudflareNodeTunnelId` in config.
- Triton exit 125
  - Install NVIDIA driver + Container Toolkit on Calypso
  - Confirm image pull: ssh calypso 'sudo docker pull ghcr.io/triton-inference-server/server:2.60.0-py3'
  - Confirm model path mounted and exists: /opt/triton/models
- Adapter import errors
  - The adapter now runs with workingDir=/app and built‑in app; check pod logs: kubectl -n apps logs deploy/ls-triton-adapter -f

## 8) Optional — Re‑enable NodeTunnels (K8s)
Once the node token handling is fully stable in the DaemonSet:
```bash
pulumi config set oceanid-cluster:enableNodeTunnels true
pulumi up
```

## 9) Optional — Enable App Stack (Postgres/MinIO/Airflow)
```bash
pulumi config set oceanid-cluster:enableAppsStack true
pulumi up
```

## 10) Optional — ZeroTrust for extra UIs
- Identities:
```bash
pulumi config set oceanid-cluster:accessAllowedEmailDomain your-company.com
```
- SMEReadiness already handles Label Studio; generic helper can additionally protect Airflow/MinIO when enabled.
