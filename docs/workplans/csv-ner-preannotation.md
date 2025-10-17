# Workplan: CSV Pre-Annotation Pipeline with Guardrails

**Objective**: Let SMEs review model suggestions instead of labeling CSV rows from scratch, while maintaining data quality and operational safety.

---

## 1. Guiding Principles
- Keep `csv-ingestion-worker` focused on cleaning + persistence.
- Add a **detached prediction service** that runs immediately after ingestion, never blocking writes.
- Record both predictions and final SME annotations for audit + retraining.
- Ship with guardrails (confidence thresholds, project opt-out, monitoring, rollback).

---

## 2. Architecture (future state)

```mermaid
flowchart LR
    Upload[SME Uploads CSV] --> CIW[csv-ingestion-worker]
    CIW --> Cleandata[(Cleandata stage schema)]
    CIW --> Event["New document event"]
    Event --> Predictor[Prediction worker]
    Predictor --> Triton[Triton NER (Calypso GPUs)]
    Predictor --> LS[Label Studio (pre-annotations)]
    LS --> SMEReview[SME verifies / edits]
    SMEReview --> Cleandata
    Cleandata --> HF[HuggingFace dataset sync]
    HF --> DGX[DGX Spark training]
    DGX --> Triton
```

---

## 3. Phase Plan

### Phase 0 – Discovery & guardrail design
- Confirm Label Studio API flow for bulk task updates with `predictions` payload.
- Define text template for synthetic NER input (`"VESSEL: {name} ..."`).
- Confirm NER label mapping (ID ↔ label string, including "O").
- Decide where to store prediction metadata in Cleandata (e.g., columns `predicted_label`, `pred_confidence`, `pred_version`).
- Design “opt-out” mechanism: per project flag to disable suggestions.
- Agree on monitoring metrics (override rate, jobs queue depth, GPU utilisation).

### Phase 1 – MVP (single project, low volume)
1. **Event trigger** – choose mechanism (e.g., PostgreSQL NOTIFY, SQS, or poll new rows) to launch prediction jobs after CSV ingestion runs.
2. **Prediction worker** (new service):
   - Read cleaned rows from Cleandata.
   - Generate text snippets (structured data → plain text).
   - Call `ls-triton-adapter` (Renaming this to `ner-inference-service` if needed).
   - Post predictions back to Label Studio.
3. **Store prediction results**
   - Write predictions + confidence into new columns or table (e.g., `stage.csv_predictions`).
   - Link predictions to final annotations when SMEs submit corrections.
4. **Guardrails**
   - Confidence threshold (e.g., <0.6 → skip suggestion).
   - Per-project opt-in toggle (set via config table).
   - Logging + metrics (prometheus counters for predictions, SME overrides).
5. **Pilot** – choose one project; run parallel manual checks, collect feedback.

### Phase 2 – Hardening & scale
- Integrate with the DGX Spark training loop:
  - Nightly job exports predictions + SME corrections to HF dataset with `source=preannotation` metadata.
  - Update retraining script to include new data.
- Add alerting:
  - `SME override rate > threshold` (drift).
  - `Prediction queue depth > threshold` (backlog).
  - `Triton error rate > threshold`.
- Provide per-project dashboards (predictions served, overrides, turnaround time).
- Document rollback procedure (disable predictions with one toggle / config update).

### Phase 3 – Expansion & automation
- Support batch/backfill mode for historical CSVs.
- Extend to PDFs (re-use pipeline with Granite Docling pre-processing).
- Automate canary updates: roll new models to subset of projects, monitor override rate before full rollout.
- Add support for confidence-based auto-approve (optional, long term).

---

## 4. Guardrails Summary
- **Opt-in** per project; default to manual until stakeholders approve.
- **Confidence floor** (skip low-confidence predictions).
- **SME override monitoring** – alert if overrides spike.
- **Fallback kill switch** – environment flag to disable predictions globally.
- **Logs + metrics** – log predictions (model version, latency, confidence distribution); ship to Grafana for oversight.
- **Synthetic vs human data separation** – mark synthetic predictions so they don’t pollute Cleandata; only SME-approved annotations enter production tables.

---

## 5. Success Criteria
- SME review time drops measurably (baseline vs post-launch).
- `csv-ingestion-worker` performance unaffected (no blocking).
- Predictions & SME corrections appear in Cleandata with full lineage.
- Nightly HF sync includes verified annotations, enabling retraining.
- Override monitoring stays below threshold (e.g., <30% edits for majority of predictions).

---

## 6. Open Questions
- Do we prefer database triggers or queue-based orchestration for prediction jobs?
- Where to host the prediction worker (K3s deployment vs batch job)?
- Label Studio version support for `PATCH /api/tasks` with `predictions` – confirm idempotency.
- Do we need human sign-off before enabling predictions per project?
- What is the target SLA for predictions (e.g., <2 minutes after CSV upload)?

---

## 7. Next Steps
- Lock in discovery meeting (Label Studio API, Data Eng, ML Platform).
- Document prediction text template + label mapping in version control.
- Prototype row → prediction → Label Studio loop in dev cluster.
- Design Cleandata schema changes (include predicted vs final fields).
- Draft monitoring dashboards & alert thresholds.
- Coordinate with DGX Spark training team to consume the logs for retraining schedules.

With this roadmap we can bring NER pre-annotations online safely, turn on projects incrementally, and give SMEs a faster, confidence-driven workflow without compromising data trust.
