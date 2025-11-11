# Project: Triton + Monitoring Rollout and Verification

Status: ACTIVE
Owner(s): (assign in tracking issue)
Links:
- Tracking issue: create under goldfish-inc/oceanid (search for title "Triton + Monitoring: finalize rollout and verification")
- Ops Runbook: docs/operations/triton-ml-backend-runbook.md

---

## Goals
- Ensure ls-triton-adapter is healthy and serving NER via Triton
- Verify Prometheus/Grafana alerting works (warning→critical)
- Align canonical model names across code, IaC, and docs
- Decide and (optionally) enable Docling PDF extraction

## Canonical Names
- NER (Triton repository): `distilbert-base-uncased`
- Docling (Triton repository): `docling_granite_python`

## Environment Configuration
- Adapter (Kubernetes env):
  - `TRITON_BASE_URL` (prod: `http://192.168.2.110:8000` or `https://gpu.boathou.se` with Access headers)
  - `TRITON_MODEL_NAME=distilbert-base-uncased`
  - `TRITON_DOCLING_ENABLED=false` (enable only when ready)
  - `TRITON_DOCLING_MODEL_NAME=docling_granite_python`

## Verification Checklist
1) Adapter readiness
- `kubectl -n apps port-forward svc/ls-triton-adapter 9090:9090 &`
- `curl -s http://localhost:9090/health` → `{ "ok": true }`

2) Metrics and alerts
- Grafana Explore: `up{job="ls-triton-adapter"}` → 1 when healthy
- Optional off-hours alert test:
  - `kubectl -n apps scale deploy ls-triton-adapter --replicas=0`
  - Expect warning ~1m (TritonAdapterUnhealthy), critical ~2m (TritonAdapterDown)
  - `kubectl -n apps scale deploy ls-triton-adapter --replicas=1`

3) PrometheusRule
- `kubectl -n monitoring get prometheusrule triton-adapter-alerts -o yaml`
- Expect: `expr: up{job="ls-triton-adapter"} == 0`, `for: 1m` (warning rule)

4) Canonical naming
- Code/IaC uses `distilbert-base-uncased` and `docling_granite_python`
- Docs updated accordingly

## Docling Enablement (Optional)
Preconditions:
- Triton has `/opt/triton/models/docling_granite_python` with valid `config.pbtxt`
- `curl http://192.168.2.110:8000/v2/models/docling_granite_python/ready` → `{ "ready": true }`

Steps:
- `kubectl -n apps set env deploy/ls-triton-adapter TRITON_DOCLING_ENABLED=true`
- `kubectl -n apps rollout restart deploy/ls-triton-adapter`
- Verify PDF → text → NER path works via `/predict_ls` flow

## Cleanup & Ownership
- Optional: archive legacy Triton model folder if unused: `/opt/triton/models/distilbert`
- Resolve Pulumi SSA for adapter Deployment off-hours (delete + `pulumi up`) to return control to IaC

## Acceptance Criteria
- Adapter healthy and serving NER
- `up{job="ls-triton-adapter"} == 1` in Grafana Cloud
- Alerts verified (warning, critical, and recovery)
- Canonical names consistent across code, IaC, and docs
- Decision recorded for Docling enablement; if enabled, PDF flow verified

---

## Repro Commands (Quick Reference)
- Adapter env update:
```
kubectl -n apps set env deploy/ls-triton-adapter TRITON_BASE_URL=http://192.168.2.110:8000 TRITON_MODEL_NAME=distilbert-base-uncased
kubectl -n apps rollout restart deploy/ls-triton-adapter
kubectl -n apps rollout status deploy/ls-triton-adapter --timeout=180s
```

- Alert test:
```
kubectl -n apps scale deploy ls-triton-adapter --replicas=0
sleep 150
kubectl -n apps scale deploy ls-triton-adapter --replicas=1
```

- Triton ready checks:
```
curl http://192.168.2.110:8000/v2/health/ready
curl http://192.168.2.110:8000/v2/models/distilbert-base-uncased
curl http://192.168.2.110:8000/v2/models/docling_granite_python/ready
```

---

## Notes
- Cloud-init on Calypso configured to keep password auth enabled to avoid lockouts.
- Use `TRITON_REPO_NAME` in `apps/ner-training/deploy.sh` to deploy under `distilbert-base-uncased`.
> Archived: This rollout plan covers Triton + Docling/DistilBERT. The current NER pipeline uses DeepSeek OCR + Ollama (Spark) with Argilla and does not rely on Triton Docling.
