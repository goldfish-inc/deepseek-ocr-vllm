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
- Label Studio DB: external Postgres on CrunchyBridge (database `labelfish`); cluster reads `labelStudioDbUrl` from ESC to set `DATABASE_URL`.
- Adapter: FastAPI in `apps`; DistilBERT support; `DEFAULT_MODEL=distilbert-base-uncased`.
- Triton: running on Calypso via systemd Docker; image `ghcr.io/triton-inference-server/server:2.60.0-py3`; model repo `/opt/triton/models`.
- DistilBERT ONNX: installed at `/opt/triton/models/distilbert-base-uncased/1/model.onnx`.
- Docling-Granite: Available at `/opt/triton/models/docling_granite_python/` for PDF → structured data extraction.
- Annotations Sink: deployed in `apps`; appends JSONL to HF dataset; writes cleaned extractions to Postgres (CrunchyBridge or in‑cluster) when configured.
- NER labels: ESC → adapter env; no rebuilds required.

## New Architecture: Staging DB Pipeline (In Development)
**GitHub Issues**: #46 (DB schema), #47 (pandas extraction), #48 (ingestion worker), #49 (ML training), #50 (promotion)

### Goals
- **Separate ETL from intelligence**: @oceanid/staging for document cleaning, @ebisu/globalDB for maritime intelligence
- **ML-powered cleaning**: Replace 11 manual pandas scripts with trainable pipeline
- **Human-in-the-loop**: Label Studio for low-confidence cells, continuous model improvement
- **Audited promotion**: Stage → GlobalDB with rollback capability

### Components (Planned)
1. **Staging Database** (Issue #46)
   - `stage.documents` - Track CSV/PDF uploads with processing status
   - `stage.document_processing_log` - Version history (parsed → cleaned → reviewed → promoted)
   - `stage.csv_extractions` - Cell-level raw vs cleaned values
   - `stage.cleaning_rules` - Knowledge base extracted from pandas scripts
   - `stage.training_corpus` - Human corrections for ML training
   - `stage.promotion_log` - Audit trail for stage → globalDB

2. **CSV Ingestion Worker** (Issue #48)
   - Watches `/data/raw/vessels/` for new CSVs
   - Docling-Granite: Parse structure, detect issues
   - Rule engine: Apply cleaning_rules in priority order
   - DistilBERT NER: Extract vessel_name, IMO, IRCS entities
   - Confidence scoring: Flag <85% similarity cells for review
   - Write to `stage.csv_extractions`

3. **Training Pipeline** (Issue #49)
   - Bootstrap: Extract patterns from 11 pandas scripts → ~5k examples
   - Human corrections: Label Studio → `stage.training_corpus` → target 10k
   - Fine-tune: DistilBERT → csv-repair-bert (6-class classification)
   - Deploy: ONNX → Triton `/opt/triton/models/csv-repair-bert/`

4. **Promotion Workflow** (Issue #50)
   - Pre-checks: Schema validation, conflict detection, duplicate checks
   - Transaction-based: All-or-nothing promotion to @ebisu
   - Rollback: 30-day window to revert
   - Intelligence preservation: Conflicts stored, not overwritten

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
