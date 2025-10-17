# DGX Spark Integration Plan

**Equipment:** NVIDIA DGX Spark (multi-GPU, 4 TB RAM)
**Purpose:** Establish a reproducible path to bring the DGX online for Oceanid training and batch inference workloads.
**Audience:** ML Platform • DevOps • Data Engineering
**Last updated:** 2025‑10‑16

---

## 1. Objectives

1. Power heavyweight training (NER fine-tunes, Docling adaptation, synthetic data pipelines).
2. Accelerate batch inference (PDF pre-processing, large entity extraction jobs).
3. Keep the existing K3s cluster stable; DGX complements Calypso rather than replacing it.
4. Deliver reproducible, containerised workflows so SMEs see richer pre-annotations and faster turnaround times.

---

## 2. High-Level Timeline

| Phase | Goal | Key Outcomes |
|-------|------|--------------|
| Week 0 | Arrival & rack-ready | Rack space, power, networking validated |
| Week 1 | Base OS & drivers | DGX OS/Ubuntu, NVIDIA DGX stack, CUDA, Triton-compatible driver |
| Week 2 | Tailscale + storage | DGX joined to tailnet, S3/CrunchyBridge access tested, dataset cache provisioned |
| Week 3 | Container toolchain | Buildx/podman/conda alternatives established, image registry access confirmed |
| Week 4 | Workload shakeout | Run benchmark training job + batch Docling pipeline, publish results |

Timelines assume on-site power/network readiness. Adjust as needed.

---

## 3. Task Breakdown

### Phase 0 – Preparation (before delivery)
- Confirm rack U space, 2x 3.5 kW power feeds, cooling requirements.
- Order required cables (10/25 GbE NICs, fibre if needed).
- Create static IP/DNS plan and Tailscale ACL updates.

### Phase 1 – Physical install
- Rack the DGX and connect redundant power.
- Connect to core switch; verify link speed (target ≥10 GbE).
- Run basic hardware diagnostics (BIOS, NVIDIA diagnostics).

### Phase 2 – System setup
- Install OS (NVIDIA DGX OS or Ubuntu 22.04 + DGX stack).
- Install NVIDIA drivers, CUDA, cuDNN matching Triton/ML frameworks.
- Enable SSH, configure Tailscale, lock firewall to tailnet.
- Set up monitoring: DCGM Exporter, node exporter, log shipping.

### Phase 3 – Data & access
- Mount S3 via AWS CLI and validate IAM credentials.
- Set up dataset cache (NVMe) and optionally NFS/MinIO for shared storage.
- Enable CrunchyBridge access (allowlist IP or tunnel).
- Mirror container registries (GHCR, Triton repos) to local cache if desired.

### Phase 4 – Integrate with Oceanid
- Add node entry in infrastructure docs (hostname, Tailscale name).
- Option A: Join as GPU worker node in K3s (install k3s agent, GPU operator).
- Option B: Standalone job runner (Airflow/Argo/Slurm) accessible via API.
- Configure node labels/taints if added to Kubernetes.
- Register Triton access credentials for pushing models.

### Phase 5 – Workload validation
- Run baseline training job (e.g., fine-tune DistilBERT on sample dataset) and document throughput.
- Run Granite Docling batch conversion on a pilot PDF set; compare runtime vs current setup.
- Push resulting model to shared registry; deploy on Calypso for inference.
- Capture metrics dashboards (GPU utilisation, throughput) and add to Grafana.

### Phase 6 – Handoff & documentation
- Update SME/ML runbooks with “training on DGX” instructions.
- Document model promotion flow (DGX → registry → Calypso Triton).
- Schedule recurring maintenance tasks (driver patching, firmware updates, cleaning filters).

---

## 4. Key Decisions

| Decision | Options | Notes |
|----------|---------|-------|
| Workload scheduler | K3s integration vs standalone | K3s gives unified scheduling; standalone avoids mixing prod workloads |
| Storage strategy | Direct S3 / CIFS / NFS | Favour S3 + local NVMe cache; use NFS only for team-shared volumes |
| Model registry | GHCR, S3, HuggingFace | Keep existing GHCR pipeline for Triton artifacts; optionally mirror to HF |
| Security | Tailnet only vs VPN + LAN | Tailnet only to keep SSH restricted; update ACLs for training services |

---

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Power/cooling mismatch | Hardware throttling or shutdown | Verify facility capacity before delivery, monitor thermals |
| Driver mismatch with Triton | Models fail to run on Calypso | Align CUDA/driver versions, maintain compatibility matrix |
| Network bottlenecks | Slow training data transfer | Use 10/25 GbE, stage data locally, compress datasets |
| Scheduling conflicts | Prod inference competes with training | Use taints/node selectors, or keep DGX outside inference cluster |
| Security gap | Unauthorised access to high-value GPU | Enforce Tailscale auth, disable password SSH, enable logging |

---

## 6. Success Criteria

1. DGX reachable via Tailscale with monitoring in Grafana.
2. Training job results published (throughput, runtime, sample logs).
3. Docling batch pipeline running reliably on DGX.
4. Model handoff documented (DGX → Calypso Triton).
5. No disruption to existing K3s workloads.

---

## 7. Next Steps

1. Kick off facility readiness checklist (power, cooling, networking).
2. Align driver/CUDA versions with Calypso’s Triton deployment.
3. Schedule installation window and assign on-site engineer.
4. Draft container templates (training, docling) to run on DGX day-one.
5. Prepare exec brief (below) to communicate value to leadership.

---

## Appendix – Reference links

- NVIDIA DGX System Guide
- NVIDIA DGX OS Release Notes
- Oceanid ML model registry procedures
- Tailscale ACL documentation
- NVIDIA DCGM Exporter setup
