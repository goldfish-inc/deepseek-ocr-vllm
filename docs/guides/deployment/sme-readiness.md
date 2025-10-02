# SME Readiness and Onboarding Plan

## Overview

- Goal: Label Studio on K3s (VPS) using an external GPU backend on Calypso (Triton), all managed by Pulumi + ESC, exposed via Cloudflare. No L3 overlays.
- Status: Infra wired end‑to‑end; ESC secrets flow; in‑cluster adapter bridges Label Studio → Triton; optional Cloudflare Access for UIs; NER schema integration ready.

## What’s Working

- ZeroTrust Access for Label Studio via SMEReadiness.
- Tunnels:
  - Cluster tunnel for in‑cluster services (e.g., `label.<base>`).
  - Calypso host tunnel for Triton at `https://gpu.<base>`; host cloudflared is connected with the correct node tunnel token.
- Triton on Calypso: systemd + Docker + GPUs; model repo at `/opt/triton/models`; image pinned to `ghcr.io/triton-inference-server/server:2.60.0-py3`.
- K8s LS→Triton adapter: FastAPI in `apps` namespace; built‑in NER by default; internal ML backend URL for Label Studio; text (BERT) + PDF bytes (Docling stub).
- NER_LABELS (63 labels) via ESC → Pulumi secret → K8s Secret → adapter env (no rebuilds).
- CI: Adapter type‑checks; OPA tests.

## ESC / Pulumi Config (secrets)

- Cloudflare: `cloudflareAccountId`, `cloudflareApiToken`, `cloudflareZoneId`.
- Cluster tunnel: `cloudflareTunnelId`, `cloudflareTunnelToken`, `cloudflareTunnelHostname`, `cloudflareTunnelTarget`.
- Node tunnel: `cloudflareNodeTunnelId`, `cloudflareNodeTunnelToken` (token string or base64 credentials.json), `cloudflareNodeTunnelHostname`, `cloudflareNodeTunnelTarget`.
- NER labels (JSON, secret): `pulumiConfig.oceanid-cluster:nerLabels`.
- Calypso SSH key: `pulumiConfig.oceanid-cluster:calypso_ssh_key`.
- Optional: `sentry.dsn`, Postgres/MinIO credentials, HF token for DAGs.

Set labels (recommended):

```bash
# Single-line JSON file to avoid quoting issues
cat > ner_labels.json <<'JSON'
["O","VESSEL","VESSEL_TYPE","IMO","IRCS","MMSI","EU_CFR","HULL_ID","PORT","PORT_REGISTRY","FLAG","COUNTRY","RFMO","FAO_AREA","HS_CODE","COMMODITY","SPECIES_SCIENTIFIC","SPECIES_COMMON","SPECIES_ASFIS","TAXON_KINGDOM","TAXON_PHYLUM","TAXON_CLASS","TAXON_ORDER","TAXON_FAMILY","TAXON_GENUS","GEAR_TYPE_FAO","GEAR_TYPE_CBP","GEAR_TYPE_MSC","FREEZER_TYPE","HULL_MATERIAL","COMPANY","OWNER","OPERATOR","BENEFICIAL_OWNER","CHARTERER","VESSEL_MASTER","FISH_MASTER","PERSON","ORGANIZATION","SDN_ENTITY","WRO_ENTITY","SANCTION_TYPE","AUTHORIZATION","LICENSE","DATE","METRIC_LENGTH","METRIC_TONNAGE","METRIC_CAPACITY","METRIC_POWER","CRIME_TYPE","IUU_TYPE","MSC_FISHERY","CERTIFICATION","ISSF_INITIATIVE","ADDRESS","NATIONALITY","GENDER","BUILD_YEAR","MEASUREMENT_UNIT","RISK_INDICATOR","INTELLIGENCE_SCORE","TRUST_SCORE","CONFLICT_INDICATOR"]
JSON
# Store in ESC as a secret so Pulumi materializes a K8s Secret for the adapter
esc env set default/oceanid-cluster pulumiConfig.oceanid-cluster:nerLabels "$(cat ner_labels.json)" --secret
```

## Validation / Smoke

```bash
# Triton
curl -sk https://gpu.<base>/v2/health/ready

# Adapter
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
curl -s http://localhost:9090/health
# BERT NER example
curl -s -X POST http://localhost:9090/predict \
  -H 'Content-Type: application/json' \
  -d '{"model":"bert-base-uncased","task":"ner","text":"MV Iconic arrived with HS code 123456."}'
```

## SME Onboarding

- Access Label Studio at `https://label.<base>` (optionally protected by Cloudflare Access).
- Label Studio ML backend is preconfigured to the in‑cluster adapter.
- SMEs can import cleaned data and use pre‑labeling (adapter → Triton), then export.

## Model Management on Calypso

- BERT (NER with 63 labels):

```bash
pip install optimum[exporters]
optimum-cli export onnx --model bert-base-uncased --task token-classification bert_onnx/ --num_labels 63

sudo mkdir -p /opt/triton/models/bert-base-uncased/1
sudo cp bert_onnx/model.onnx /opt/triton/models/bert-base-uncased/1/
sudo cp triton-models/bert-base-uncased/config.pbtxt /opt/triton/models/bert-base-uncased/
# Ensure dims: [-1, -1, 63] in config.pbtxt
sudo systemctl restart tritonserver
```

- Docling‑Granite (Python backend): place `model.py` under `/opt/triton/models/docling_granite_python/1/` with BYTES inputs (`pdf_data`, `prompt`) → JSON output; restart Triton.

## NER Schema & Postprocessor

- Mounted into adapter Pod if present in repo:
  - `adapter/ner/ner_config.py`, `adapter/ner/ner_postprocessor.py`, `adapter/ner/schema/ebisu_ner_schema_mapping.json`
- Adapter maps indices → names via `NER_LABELS` and returns entities with offsets/confidence; can import your `create_postprocessor` if needed.

## Operational Runbook

- Deploy:

```bash
make deploy-simple   # minimal stack
make deploy-calypso  # Triton + Calypso host connector
```

- Restart:

```bash
kubectl -n apps rollout restart deploy/ls-triton-adapter
ssh calypso 'sudo systemctl restart tritonserver'
```

- Logs:

```bash
kubectl -n apps logs deploy/ls-triton-adapter -f
ssh calypso 'sudo journalctl -u tritonserver -f'
ssh calypso 'sudo journalctl -u cloudflared-node -f'
```

## Cloudflare Access (UIs)

- Optional and recommended for `label.<base>`, and for `airflow.<base>` / `minio.<base>` when `enableAppsStack=true`.
- Enable Access for Label Studio:

```bash
pulumi -C cluster config set oceanid-cluster:enableLabelStudioAccess true
```

- Configure allowed identities:

```bash
pulumi -C cluster config set oceanid-cluster:accessAllowedEmailDomain your-company.com
# or specific emails
pulumi -C cluster config set --path oceanid-cluster:accessAllowedEmails[0] user1@your-company.com
pulumi -C cluster config set --path oceanid-cluster:accessAllowedEmails[1] user2@your-company.com
```

- Access applies to hosts where enabled and identity rules are set.

## What’s Left to Go Live for SMEs

1. Set NER labels secret via ESC (63‑label list) ✔
2. Export/install BERT ONNX with 63 labels; update Triton config; restart ✔
3. Validate LS → adapter → Triton pre‑labels flow ✔
4. (Optional) Re‑enable `enableNodeTunnels=true` once stable ✔
5. (Optional) Implement `docling_granite_python` model in Triton; restart ✔
6. (Optional) Enable app stack (Postgres/MinIO/Airflow) and verify Access on UIs; set app secrets in ESC.

## Key File References

- Adapter (K8s): `cluster/src/components/lsTritonAdapter.ts`
- Triton host service: `cluster/src/components/hostDockerService.ts`
- Sentry config helper: `cluster/src/sentry-config.ts`
- Label Studio: `cluster/src/components/labelStudio.ts`
- Cloudflare tunnel: `cluster/src/components/cloudflareTunnel.ts`
- NER module: `adapter/ner/...`
- Model configs: `triton-models/bert-base-uncased/config.pbtxt`, `triton-models/dockling-granite-python/...`

## Next Actions (optional)

- Protect Label Studio behind Cloudflare Access
- Bake tokenizer into adapter image or mount cache (offline‑ready)
- Add schema‑aware evaluator tests in CI using your fixtures
