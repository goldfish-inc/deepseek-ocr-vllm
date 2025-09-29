# Oceanid Infrastructure — Current State Snapshot
Date: ${TODAY}
Stack: ryan-taylor/oceanid-cluster/prod

## Status
- Access: Cloudflare ZeroTrust protects `label.<base>` via SMEReadiness.
- Tunnels:
  - Cluster tunnel: in‑cluster Cloudflared exposes `label.<base>` and optional UIs.
  - Host tunnel (Calypso): systemd Cloudflared is connected with the correct node tunnel token; serves `gpu.<base>`.
- NodeTunnels (K8s): Disabled by flag (`enableNodeTunnels=false`) to avoid CrashLoop while focusing on pre‑labels; host connector covers GPU.
- Label Studio: deployed; ML backend points to the in‑cluster adapter.
- Adapter: FastAPI in `apps` namespace; defaults to built‑in NER implementation; Sentry ready.
- Triton: running on Calypso via systemd Docker; image pinned to `ghcr.io/triton-inference-server/server:2.60.0-py3`; model repo `/opt/triton/models`.
- NER labels: ESC → Pulumi secret → K8s Secret → adapter env (no rebuilds).

## Key Endpoints
- Label Studio: `https://label.<base>` (ZeroTrust)
- Triton (Calypso): `https://gpu.<base>` (HTTP v2 `/v2/health/ready`)
- Adapter (cluster): `svc/ls-triton-adapter.apps.svc:9090` (`/healthz`, `/predict`)
- Optional UIs (if enabled): `https://airflow.<base>`, `https://minio.<base>` (ZeroTrust)

## Secrets / Config (ESC)
- Cloudflare: account, api token, zone, cluster tunnel id/token/hostname/target; node tunnel id/token/hostname/target
- NER labels (JSON, secret): `pulumiConfig.oceanid-cluster:nerLabels`
- Calypso SSH key: `pulumiConfig.oceanid-cluster:calypso_ssh_key`
- Optional: `sentry.dsn`, DB creds, MinIO creds, HF token

## Deploy Flags
- `enableNodeProvisioning` (default true) — set false to avoid SSH provisioning during troubleshooting
- `enableCalypsoHostConnector` (default true) — host cloudflared + Triton
- `enableNodeTunnels` (default true) — currently false to avoid CrashLoop; host tunnel serves `gpu.<base>`
- `useExternalAdapter` (default false) — prefer built‑in adapter app for NER decode
- `tritonImage` — override Triton image (defaults to 2.60.0 py3)
- `enableAppsStack` (default false) — Postgres/MinIO/Airflow + Access

## Validation
```bash
# Triton
curl -sk https://gpu.<base>/v2/health/ready

# Adapter
kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &
curl -s http://localhost:9090/healthz
curl -s -X POST http://localhost:9090/predict -H 'Content-Type: application/json' \
  -d '{"model":"bert-base-uncased","task":"ner","text":"MV Iconic…"}'
```

## What’s Left for SME Go‑Live
1) Ensure NER labels secret (63‑label list) exists in ESC and adapter loads it
2) Install BERT ONNX with 63 labels on Calypso; set dims to `[-1, -1, 63]`; restart Triton
3) Validate pre‑labels flow LS → adapter → Triton (`/predict`)
4) (Optional) Re‑enable NodeTunnels once stable (`enableNodeTunnels=true`)
5) (Optional) Implement `docling_granite_python`; restart Triton
6) (Optional) Enable app stack; configure secrets; wire export to Postgres

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
