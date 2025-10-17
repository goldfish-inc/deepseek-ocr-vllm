# Exec Brief: NVIDIA DGX Spark Integration

**Audience:** Leadership & budget holders
**Purpose:** Summarize why we invested in the DGX Spark and how it unlocks the next phase of Oceanid.

---

## 1. Quick Summary
- **We purchased:** NVIDIA DGX Spark (multi-GPU supernode with 4 TB RAM).
- **Why:** accelerate ML training and batch pre-annotation so SMEs review insights instead of labeling from scratch.
- **Outcome:** faster data throughput, richer pre-filled annotations, and a sustainable feedback loop that improves our models with every SME correction.

---

## 2. Business Value

| Pain Today | DGX Impact | Benefit |
|------------|-----------|---------|
| Manual annotation only; SMEs spend 80% of time labeling | Run Granite Docling + DistilBERT pre-annotations at scale | SMEs verify suggestions (10× faster), focus on edge cases |
| Slow model iteration (days per fine-tune) | 8× GPUs + 4 TB RAM for parallel training | Weekly or even daily model refreshes, faster improvements |
| Growing backlog of PDFs/CSVs | High-throughput batch processing | Clear backlog, keep data fresh, feed dashboards in near real time |
| Calypso GPU already serving production load | DGX handles heavy training without disrupting inference | Stable production inference AND rapid experimentation |

---

## 3. What Changes for Our Teams

- **SMEs:** See pre-annotated tasks inside Label Studio; they simply approve/edit rather than start from scratch.
- **ML Platform:** Moves heavy training/jobs to DGX, ships fine-tuned models to Calypso for serving.
- **DevOps:** Adds a managed GPU node with Tailscale access, standard monitoring, and documented maintenance tasks.
- **Executives:** Faster time-to-insight, better use of SME capacity, and a clear path to scale Oceanid’s automation.

---

## 4. Key Capabilities We Gain
- Run multi-hour training jobs in minutes (large batch sizes, longer sequences).
- Convert massive PDF archives through Granite Docling rapidly to support pre-annotation.
- Generate synthetic data / active learning campaigns without blocking production GPUs.
- Evaluate multiple models in parallel; pick the best performing candidate for each SME project.

---

## 5. Operational Plan (Highlights)
1. Rack & power the DGX; connect to tailnet for secure access.
2. Align CUDA/drivers with Calypso’s Triton version to ensure model portability.
3. Stage shared datasets (S3 + local NVMe cache); enable monitoring in Grafana.
4. Stand up training/batch pipelines (DistilBERT fine-tuning, Docling pre-processing).
5. Promote models from DGX → Calypso inference; SMEs see richer pre-filled tasks.

---

## 6. ROI Metrics to Track
- **SME throughput:** tasks reviewed per hour before vs after pre-annotation.
- **Model latency:** time from new data to updated model (goal: < 1 week).
- **Backlog burn-down:** PDF/CSV backlog processed monthly.
- **GPU utilisation:** DGX vs Calypso, ensure both are productive.

---

## 7. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Facility power/cooling limits | Pre-check rack specs; monitor thermals |
| Model portability gaps | Keep driver/CUDA versions aligned, use containerized builds |
| Security | Restrict SSH to Tailscale, enforce key rotation, monitoring |
| Under-utilisation | Schedule recurring training jobs, synthetic data runs |

---

## 8. Ask from Leadership
- Confirm facilities readiness (power/cooling/network) ahead of delivery.
- Support infrastructure upgrades (10/25 GbE) if needed.
- Approve ongoing GPU maintenance budget (drivers, support contracts).

With the DGX Spark, we close the biggest gap in Oceanid—automated pre-annotation and rapid ML iteration. The result: SMEs work faster, models learn continuously, and we keep our advantage in data quality.
