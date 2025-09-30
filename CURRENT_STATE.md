# Oceanid Infrastructure — Current State Snapshot
Date: 2025-09-30
Stack: ryan-taylor/oceanid-cluster/prod

## Status
- Access: Cloudflare Zero Trust protects `label.<base>`; GPU access via `gpu.<base>`.
- Tunnels:
  - Cluster tunnel: in‑cluster cloudflared serves `label.<base>` and optional UIs.
  - Host tunnel (Calypso): systemd cloudflared connected with correct node tunnel credentials; serves `gpu.<base>`.
- NodeTunnels (K8s): Disabled (`enableNodeTunnels=false`) while focusing on pre‑labels; host connector covers GPU.
- Label Studio: deployed; ML backend points to the in‑cluster adapter.
- Adapter: FastAPI in `apps`; DistilBERT support; `DEFAULT_MODEL=distilbert-base-uncased`.
- Triton: running on Calypso via systemd Docker; image `ghcr.io/triton-inference-server/server:2.60.0-py3`; model repo `/opt/triton/models`.
- DistilBERT ONNX: installed at `/opt/triton/models/distilbert-base-uncased/1/model.onnx`.
- Annotations Sink: deployed in `apps`; appends JSONL to HF dataset; writes cleaned extractions to Postgres (CrunchyBridge or in‑cluster) when configured.
- NER labels: ESC → adapter env; no rebuilds required.

## Key Endpoints
- Label Studio: `https://label.<base>` (ZeroTrust)
- Triton (Calypso): `https://gpu.<base>` (HTTP v2 `/v2/health/ready`)
- Adapter (cluster): `svc/ls-triton-adapter.apps.svc:9090` (`/healthz`, `/predict`)
- Annotations Sink: `http://annotations-sink.apps.svc.cluster.local:8080/webhook`

## Secrets / Config (ESC)
- Cloudflare: account, api token, zone, cluster tunnel id/token/hostname/target; node tunnel id/token/hostname/target
- NER labels (JSON, secret): `pulumiConfig.oceanid-cluster:nerLabels`
- Calypso SSH key: `pulumiConfig.oceanid-cluster:calypso_ssh_key`
- Optional: `sentry.dsn`, DB creds, HF token

## Deploy Flags
- `enableNodeProvisioning` (default true) — set false to avoid SSH provisioning during troubleshooting
- `enableCalypsoHostConnector` (default true) — host cloudflared + Triton
- `enableNodeTunnels` (default true) — currently false to avoid CrashLoop; host tunnel serves `gpu.<base>`
- `useExternalAdapter` (default false) — prefer built‑in adapter app for NER decode
- `tritonImage` — override Triton image (defaults to 2.60.0 py3)
- `enableAppsStack` (default false) — Postgres only (MinIO/Airflow skipped)

## Validation
```bash
# Triton
curl -sk https://gpu.<base>/v2/health/ready

# Adapter
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
curl -s http://localhost:9090/healthz
curl -s -X POST http://localhost:9090/predict -H 'Content-Type: application/json' \
  -d '{"model":"distilbert-base-uncased","task":"ner","text":"MV Aurora bert test."}'
```

## What’s Left for SME Go‑Live
1) Ensure NER labels secret exists in ESC and adapter loads it
2) Validate pre‑labels flow LS → adapter → Triton (`/predict`)
3) (Optional) Enable Postgres; verify stage.documents/extractions populate via sink
4) (Optional) Re‑enable NodeTunnels once stable (`enableNodeTunnels=true`)
5) (Optional) Implement/trial alternate GPU services via Triton Python backend or standalone container

## Runbook
```bash
# Deploy minimal
make deploy-simple
# Enable Calypso + Triton
make deploy-calypso
# Restart adapter / Triton
kubectl -n apps rollout restart deploy/ls-triton-adapter
ssh calypso 'sudo systemctl restart tritonserver'
```

## Pointers
- Adapter: `cluster/src/components/lsTritonAdapter.ts`
- Triton service (systemd): `cluster/src/components/hostDockerService.ts`
- SME readiness (ZeroTrust): `cluster/src/components/smeReadiness.ts`
- Host cloudflared: `cluster/src/components/hostCloudflared.ts`
- Label Studio: `cluster/src/components/labelStudio.ts`
- Cluster tunnel: `cluster/src/components/cloudflareTunnel.ts`
- NER module (mounted): `adapter/ner/...`
- Model configs: `triton-models/bert-base-uncased/config.pbtxt`, `triton-models/dockling-granite-python/...`

See also: `SME_READINESS.md` for a detailed onboarding guide.
