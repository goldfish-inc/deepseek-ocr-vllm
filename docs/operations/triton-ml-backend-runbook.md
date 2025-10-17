# Triton ML Backend Operations Runbook

**Component**: `ls-triton-adapter` (Go service running in `apps` namespace)
**Dependencies**: Triton Inference Server on Calypso GPU node, DistilBERT NER model, Docling-Granite model
**Critical Path**: PDF document extraction and NER pre-annotation for Label Studio

---

## Architecture

```
Label Studio → ls-triton-adapter → Triton (Calypso GPU)
                     ↓
            [Docling-Granite + DistilBERT NER]
                     ↓
            NER entities + extracted tables
```

**Design Principle**: The adapter intentionally fails when Triton is unavailable. There is NO fallback extraction service.

---

## Triton Server Access

**Calypso Internal IP**: `192.168.2.110` (LAN-only)
**Access Methods**:
- SSH: `ssh neptune@192.168.2.110` (requires Tailscale or LAN access)
- Triton HTTP: `http://192.168.2.110:8000` (from within cluster or via Tailscale)

**Models Deployed**:
- `docling_granite_python` - PDF structure extraction (tables, text, layout)
- `ner-distilbert` - Named entity recognition (9 labels: O, VESSEL, HS_CODE, PORT, COMMODITY, IMO, FLAG, RISK_LEVEL, DATE)

---

## Health Check Procedures

### 1. Check Adapter Health
```bash
kubectl -n apps exec deploy/ls-triton-adapter -- wget -qO- localhost:9090/health
```
**Expected**: `{"ok":true}` (200 OK)
**Failure modes**:
- `503` with `"triton_unavailable"` → Triton server not reachable
- `424` with `"docling_no_text"` → Docling returned empty text (check source PDF)

### 2. Check Triton Model Ready
```bash
# Requires VPN/Tailscale access
curl http://192.168.2.110:8000/v2/models/docling_granite_python/ready
curl http://192.168.2.110:8000/v2/models/ner-distilbert/ready
```
**Expected**: `{"ready":true}` for both models

### 3. Check GPU Available
```bash
ssh neptune@192.168.2.110 nvidia-smi
```
**Expected**: GPU 0 visible with CUDA version displayed

### 4. Check Adapter Logs
```bash
kubectl -n apps logs -l app=ls-triton-adapter --tail=100 | grep -E "error|failed|unavailable"
```
**Look for**:
- `docling_unavailable` - Triton connection failed
- `triton_inference_failed` - NER inference returned error
- `docling_no_text` - PDF extraction returned empty result

---

## Recovery Procedures

### Scenario 1: Triton Server Down

**Symptoms**:
- Adapter `/health` returns 503 "triton_unavailable"
- PDF predictions fail in Label Studio
- Alert: `TritonAdapterUnhealthy` firing

**Recovery Steps**:
```bash
# 1. SSH to Calypso
ssh neptune@192.168.2.110

# 2. Check GPU status
nvidia-smi
# Must show CUDA version and GPU 0 with memory stats

# 3. Check Triton container
docker ps | grep triton
# If not running: docker start triton-server

# 4. Restart Triton (if running but unhealthy)
docker restart triton-server

# 5. Wait for models to load (~30 seconds)
sleep 30

# 6. Verify models ready
curl http://localhost:8000/v2/models/docling_granite_python/ready
curl http://localhost:8000/v2/models/ner-distilbert/ready
```

**Verify Recovery**:
```bash
# From local machine (with Tailscale/VPN)
kubectl -n apps rollout restart deploy/ls-triton-adapter
kubectl -n apps rollout status deploy/ls-triton-adapter
kubectl -n apps exec deploy/ls-triton-adapter -- wget -qO- localhost:9090/health
```

### Scenario 2: GPU Not Detected

**Symptoms**:
- `nvidia-smi` shows "No devices found"
- Triton logs show CUDA initialization errors

**Recovery Steps**:
```bash
# 1. Check NVIDIA driver loaded
ssh neptune@192.168.2.110 lsmod | grep nvidia
# Should show nvidia, nvidia_uvm, nvidia_modeset

# 2. Reload NVIDIA driver (if missing)
sudo modprobe nvidia
sudo modprobe nvidia_uvm

# 3. Restart Docker daemon
sudo systemctl restart docker

# 4. Restart Triton container
docker restart triton-server

# 5. Verify GPU now visible
nvidia-smi
```

**Escalation**: If GPU still not detected, this requires physical hardware inspection or OS-level debugging on Calypso.

### Scenario 3: Models Not Loading

**Symptoms**:
- Triton starts but `/v2/models/<name>/ready` returns 400 or 404
- Triton logs show model load errors

**Recovery Steps**:
```bash
# 1. Check model repository
ssh neptune@192.168.2.110
ls -la /home/neptune/triton-models/docling_granite_python/
ls -la /home/neptune/triton-models/ner-distilbert/

# 2. Verify model files present
# docling_granite_python/1/model.onnx (or model files)
# ner-distilbert/1/model.onnx
# Each should have config.pbtxt

# 3. Check Triton config
docker inspect triton-server | grep -A 10 Cmd
# Verify --model-repository=/models points to correct path

# 4. Check Triton logs for specific error
docker logs triton-server 2>&1 | grep -A 20 "failed to load"
```

**Resolution**: Re-deploy models following `apps/ner-training/deploy.sh` procedure.

---

## Expected Behavior When Triton Down

When Triton is unavailable, the system **intentionally fails loudly**:

| Endpoint | Behavior | HTTP Status | Error Code |
|----------|----------|-------------|------------|
| `/health` | Returns error | 503 | `triton_unavailable` |
| `/predict_ls` (PDF) | Fails | 503 | `docling_unavailable` |
| `/predict` (text) | Fails | 502 | `triton_inference_failed` |

**Alerts Fired**:
- `TritonAdapterUnhealthy` (warning, >2min)
- `TritonAdapterDown` (critical, if adapter pod crashes)

**Impact**:
- PDF document upload tasks in Label Studio will not get pre-annotations
- Text NER predictions will fail
- CSV worker will not receive table extraction webhooks

**NO FALLBACK**: Do not attempt to re-enable fallback extraction. The system is designed to fail when GPU inference is unavailable.

---

## Integration Test Procedure

**Location**: `apps/ls-triton-adapter/testdata/integration/run_integration_test.sh`

**Prerequisites**:
- Triton running and healthy on Calypso
- Label Studio accessible at `https://label.boathou.se`
- `LS_PAT` environment variable set (Label Studio Personal Access Token)

**Test Steps**:
```bash
cd apps/ls-triton-adapter/testdata/integration
export LS_PAT="<your-label-studio-pat>"
./run_integration_test.sh
```

**What it tests**:
1. Creates temporary test project in Label Studio
2. Uploads synthetic test PDF (no PII)
3. Triggers `/predict_ls` endpoint
4. Verifies NER entities detected
5. Verifies CSV webhook fired for extracted tables
6. Cleans up test project

**Expected Output**:
```
✅ Project created: [TEST] Triton Integration (ID: 123)
✅ PDF uploaded successfully
✅ NER prediction returned 15 entities
✅ CSV webhook received for 3 tables
✅ Test project deleted
```

**Troubleshooting**:
- If entities = 0: Check Triton NER model is correct shape (not binary classifier)
- If webhook not received: Check CSV worker logs for signature verification errors
- If extraction fails: Check Docling model loaded on Triton

---

## Operational Verification

### Verify ML Backends Attached to All Projects
```bash
python scripts/verify-ml-backends.py
```
**Checks**: All active Label Studio projects have `http://ls-triton-adapter.apps.svc.cluster.local:9090` as ML backend

**Expected**: `✅ All N projects have Triton backend configured`

### Audit Tasks for Deprecated Service References
```bash
python scripts/audit-ls-tasks.py --ls-url https://label.boathou.se --token $LS_PAT
```
**Checks**: Existing tasks for references to old `document-extraction-service`

**Expected**: Empty result (no legacy references)

---

## Credential Rotation

### Rotating Webhook Secret

**Used By**: CSV worker to verify HMAC signatures on table upload webhooks

**Steps**:
```bash
# 1. Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Update ESC
pulumi -C cluster config set --secret webhookSecret "$NEW_SECRET"

# 3. Redeploy (regenerates K8s secrets)
pulumi -C cluster up

# 4. Restart affected services
kubectl -n apps rollout restart deploy/ls-triton-adapter deploy/csv-ingestion-worker

# 5. Verify (check logs for successful webhook signatures)
kubectl -n apps logs -l app=csv-ingestion-worker --tail=20 | grep "webhook signature"
```

### Rotating S3 Credentials

**Critical**: S3 credentials must be rotated in BOTH ESC and Label Studio UI

**Used By**:
- `ls-triton-adapter` - Downloads PDFs from S3 for extraction
- Label Studio - Uploads PDFs to S3 storage
- `csv-ingestion-worker` - Uploads extracted tables to S3

**Steps**:
```bash
# 1. Generate new AWS IAM credentials for S3 bucket
# (Use AWS Console or aws-cli)

# 2. Update ESC config
pulumi -C cluster config set --secret labelStudioS3AccessKey "NEW_ACCESS_KEY"
pulumi -C cluster config set --secret labelStudioS3SecretKey "NEW_SECRET_KEY"

# 3. Update Label Studio UI
# - Navigate to Settings → Cloud Storage
# - Update AWS Access Key ID and Secret Access Key
# - Click "Validate and Save"

# 4. Redeploy cluster stack
pulumi -C cluster up

# 5. Restart adapter and CSV worker
kubectl -n apps rollout restart deploy/ls-triton-adapter
kubectl -n apps rollout restart deploy/csv-ingestion-worker

# 6. Verify (attempt PDF upload in Label Studio)
# Upload should succeed and pre-annotation should work
```

**Rotation Owner**: Platform team (documented in `docs/SECRETS_MANAGEMENT.md`)

---

## Monitoring & Alerts

### Prometheus Metrics
**ServiceMonitor**: `ls-triton-adapter` (scrapes `/health` endpoint every 60s)

**Available Metrics**:
- `up{job="ls-triton-adapter"}` - Adapter pod reachability (0=down, 1=up)
- `probe_http_status_code{job="ls-triton-adapter"}` - Health endpoint status code

### Alert Rules

**TritonAdapterDown** (critical):
- **Fires when**: Pod unreachable for >2min
- **Impact**: PDF predictions completely unavailable
- **Resolution**: Check pod status, restart deployment

**TritonAdapterUnhealthy** (warning):
- **Fires when**: `/health` returns non-200 for >2min
- **Impact**: Triton GPU service unavailable, predictions failing
- **Resolution**: Follow "Scenario 1: Triton Server Down" recovery steps

### Future Enhancements (Blocked)
**Requires Loki deployment**:
- Log-based alerts for `docling_unavailable` pattern
- Log-based alerts for `triton_inference_failed` pattern
- Grafana dashboard with Docling extraction counts
- Inference latency histogram

**Tracking Issue**: [Create issue for Loki integration]

---

## Configuration Reference

### Pulumi ESC Config
```bash
# Check current Triton config
pulumi -C cluster config get tritonDoclingEnabled  # Should be "true"
pulumi -C cluster config get tritonModelName       # Should be "ner-distilbert"
```

### Environment Variables (Runtime)
**Set in `cluster/src/components/lsTritonAdapter.ts`**:
- `TRITON_DOCLING_ENABLED=true` - Required, no fallback
- `TRITON_BASE_URL=http://192.168.2.110:8000` - Calypso Triton (or via Tailscale hostname)
- `DEFAULT_MODEL=distilbert-base-uncased` - NER model name
- `TRITON_MODEL_NAME=ner-distilbert` - Triton endpoint name
- `S3_BUCKET` - Shared from `labelstudio-s3-credentials` secret
- `WEBHOOK_SECRET` - For CSV worker HMAC verification

---

## Common Error Codes

| Error Code | HTTP Status | Meaning | Resolution |
|------------|-------------|---------|------------|
| `triton_unavailable` | 503 | Triton server not reachable | Restart Triton, check GPU |
| `docling_unavailable` | 503 | Docling model failed to load/respond | Verify model deployed, check Triton logs |
| `docling_no_text` | 424 | PDF extraction returned empty text | Inspect source PDF, check Docling model |
| `triton_inference_failed` | 502 | NER inference returned error | Check NER model shape, verify not binary classifier |
| `tokenization_failed` | 500 | BERT tokenizer error | Check input text encoding |
| `invalid_document` | 400 | PDF/document format unsupported | Verify PDF not encrypted/corrupted |

---

## Deployment Notes

**Image**: `ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:main`
**Namespace**: `apps`
**Resources**: 10m CPU / 16Mi RAM (minimal, CPU-bound for tokenization only)

**Dependencies**:
- `labelstudio-s3-credentials` Secret (for S3 access)
- `hf-credentials` Secret (for training job spawning)
- Triton Inference Server on Calypso (192.168.2.110:8000)

**Deployment Command** (via Pulumi):
```bash
pulumi -C cluster up
```

**Manual Restart**:
```bash
kubectl -n apps rollout restart deploy/ls-triton-adapter
kubectl -n apps rollout status deploy/ls-triton-adapter
```

---

## See Also

- [ML Backend & Ingest Overview](ml-backend-and-ingest.md)
- [Secrets Management](../SECRETS_MANAGEMENT.md)
- [NER Model Deployment](../../apps/ner-training/DEPLOYMENT_SUMMARY.md)
- [Integration Test Results](../../apps/ls-triton-adapter/INTEGRATION_TEST_RESULTS.md)
