# Resume Pointer (for the agent)

Use this file after a context reset to pick up work fast.

## TL;DR
- Label Studio runs on k3s; the in‑cluster adapter (FastAPI) bridges LS → Triton. Secrets are sourced from ESC.
- Triton runs on Calypso via systemd Docker using `ghcr.io/triton-inference-server/server:2.60.0-py3` and model repo `/opt/triton/models` (mounted at `/models`).
- Cloudflare ZeroTrust protects Label Studio. Host cloudflared on Calypso is connected using the correct node tunnel token. NodeTunnels DaemonSet is currently disabled to avoid CrashLoop.
- NER labels: 63‑label list in ESC → Pulumi → K8s Secret → adapter env (no rebuild).
- Read: `CURRENT_STATE.md` (snapshot) and `SME_READINESS.md` (runbook).

## Critical Files
- Adapter (K8s): `cluster/src/components/lsTritonAdapter.ts`
  - Defaults to built‑in app for reliable NER decode. You may opt‑in to repo apps via `oceanid-cluster:useExternalAdapter=true`.
  - Mounts `adapter/ner/*` and schema JSON into the Pod.
  - Prefers NER labels from K8s Secret (sourced from ESC via Pulumi secret), falls back to config/default.
- Triton on Calypso (systemd): `cluster/src/components/hostDockerService.ts` (unit for `tritonserver`)
- Label Studio: `cluster/src/components/labelStudio.ts`
- Tunnel/ingress: `cluster/src/components/cloudflareTunnel.ts`
- SME Access (ZeroTrust app + token): `cluster/src/components/smeReadiness.ts`
- Host cloudflared (Calypso): `cluster/src/components/hostCloudflared.ts`
- Node tunnels (K8s DaemonSet; currently disabled by flag): `cluster/src/components/nodeTunnels.ts`
- Sentry env helper: `cluster/src/sentry-config.ts`
- Model configs: `triton-models/bert-base-uncased/config.pbtxt`, `triton-models/dockling-granite-python/...`
- NER module (mounted): `adapter/ner/...`

## Required Config (ESC/Pulumi)
- Cloudflare
  - `cloudflareAccountId` (plain), `cloudflareZoneId` (plain)
  - `cloudflareApiToken` (secret)
  - Cluster tunnel: `cloudflareTunnelId` (plain), `cloudflareTunnelToken` (secret), `cloudflareTunnelHostname` (plain)
  - Node tunnel: `cloudflareNodeTunnelId` (plain), `cloudflareNodeTunnelToken` (secret, token string or base64 credentials.json), `cloudflareNodeTunnelHostname` (plain)
- Adapter NER labels (secret): `nerLabels` (63‑label JSON)
- Calypso SSH: `calypso_ssh_key` (secret; PEM)
- Optional: `sentry.dsn`, `postgres_password` (if `enableAppsStack=true`), HF token for Docling.

## Common Flags
- `enableCalypsoHostConnector` (default true) — host cloudflared + Triton systemd on Calypso
- `enableNodeTunnels` (default true; currently set false to avoid CrashLoop while we stabilize)
- `enableAppsStack` (default false) — Postgres/MinIO/Airflow & Access routes
- `useExternalAdapter` (default false) — use repo adapter code instead of built‑in
- `tritonImage` — override Triton image (defaults to `ghcr.io/triton-inference-server/server:2.60.0-py3`)

## Quick Commands
- Deploy minimal: `make deploy-simple`
- Enable Calypso + Triton: `make deploy-calypso`
- Pin Triton 2.60.0 explicitly (optional):
  - `pulumi -C cluster config set oceanid-cluster:tritonImage ghcr.io/triton-inference-server/server:2.60.0-py3`
- Toggle NodeTunnels (K8s):
  - Disable: `pulumi -C cluster config set oceanid-cluster:enableNodeTunnels false`
  - Re‑enable later: `pulumi -C cluster config set oceanid-cluster:enableNodeTunnels true`
- Validate Triton: `curl -sk https://gpu.<base>/v2/health/ready`
- Validate adapter:
  - `kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &`
  - `curl -s http://localhost:9090/health`
  - `curl -s -X POST http://localhost:9090/predict -H 'Content-Type: application/json' -d '{"model":"bert-base-uncased","task":"ner","text":"MV Iconic…"}'`

## Current State (now)
- ZeroTrust Access for Label Studio is configured via `SMEReadiness`.
- Calypso host cloudflared is connected with the correct node tunnel token.
- Triton runs as a systemd service using `ghcr.io/triton-inference-server/server:2.60.0-py3`.
- Adapter is healthy and defaults to built‑in NER implementation.
- NodeTunnels DaemonSet (K8s) is disabled by flag to avoid CrashLoop; host connector handles `gpu.<base>`.
- Action required for NER: ensure 63‑label ONNX is installed and config dims match `[ -1, -1, 63 ]`.

## Next Steps
1) Confirm ESC has `nerLabels` (63‑label JSON) and Triton model `/opt/triton/models/bert-base-uncased/1/model.onnx` with dims `[ -1, -1, 63 ]`; restart Triton.
2) Validate end‑to‑end NER via adapter (`/predict`) and Label Studio pre‑labels.
3) (Optional) Re‑enable `enableNodeTunnels=true` once tunnel token handling is stable in the DaemonSet.
4) (Optional) Implement/replace `docling_granite_python` model; restart Triton.
5) (Optional) Enable app stack (Postgres/MinIO/Airflow) and wire export/ingest pipeline for training data to Postgres.

## Pointers
- Snapshot: `CURRENT_STATE.md`
- Onboarding/runbook: `SME_READINESS.md`
- Access configs (index.ts): `accessAllowedEmailDomain`, `accessAllowedEmails[]`
