# GitHub Issues — Suggested Backlog and Checklists

Use these as issue bodies (copy/paste into GitHub). Labels: `type:feat`, `area:adapter|triton|calypso|db|ops`, priorities as needed.

## 1) LS Task‑Aware PDF Endpoint in Adapter

Background
- SMEs upload PDFs; adapter should read Label Studio task payload and fetch the PDF automatically.

Scope
- Add `/predict_ls` endpoint to adapter and document setup.

Checklist
- [x] Implement `/predict_ls` to extract `pdf`/`file`/`url` from task data
- [x] Fetch PDF and call `docling_granite_python`
- [x] Docs: README.md updated with LS URL
- [ ] Project config: Set ML model URL in LS to `/predict_ls`
- [ ] Validation: Upload a PDF task and observe adapter logs + response

Validation
- `curl -s -X POST http://ls-triton-adapter:9090/predict_ls -d @sample_task.json`
- `curl -s https://gpu.<base>/v2/models/docling_granite_python`

## 2) Triton GPU Pinning + Batching Tuning

Background
- Prevent Docling workloads from starving NER; tune throughput.

Scope
- Pin DistilBERT to GPU0, Docling to GPU1; adjust dynamic batching.

Checklist
- [x] `distilbert-base-uncased/config.pbtxt`: `instance_group.gpus: [0]`
- [x] `docling_granite_python/config.pbtxt`: `instance_group.gpus: [1]`
- [ ] Tune `preferred_batch_size`/`max_queue_delay_microseconds` for NER
- [ ] Verify GPU utilization per model

Validation
- `curl -s https://gpu.<base>/v2/models` and confirm versions load
- Observe GPU 0/1 utilization during concurrent traffic

## 3) Hands‑Off NER Training Pipeline — Secrets and First Run

Background
- CI trains nightly and publishes ONNX to HF; Calypso puller auto‑deploys.

Checklist
- [ ] GitHub Secrets: `HF_TOKEN`, `NER_LABELS_JSON`
- [ ] GitHub Vars: `HF_DATASET_REPO`, `HF_MODEL_REPO`
- [ ] Trigger `Train and Publish NER Model` workflow manually
- [ ] Verify artifact in HF model repo (onnx/model.onnx)
- [ ] Confirm Calypso pulls a new version and Triton loads it

Validation
- GH Actions run green; HF model repo commit present
- Calypso: `/opt/triton/models/distilbert-base-uncased/<n>/model.onnx` updated

## 4) CrunchyBridge Staging — Migrations and Checks

Checklist
- [ ] ESC/Pulumi: set `oceanid-cluster:postgres_url`
- [ ] `make up` applies config
- [ ] `make db:migrate` against CrunchyBridge
- [ ] Verify views: `stage.v_documents_freshness`, `stage.v_duplicates`

Validation
- `psql "$DATABASE_URL" -c "select * from stage.v_documents_freshness;"`

## 5) Future: Adapter Burst Routing to HF IE

Checklist
- [ ] Config map for per‑model backend priorities (local Triton → HF IE)
- [ ] Circuit breaker + latency threshold
- [ ] Health checks for endpoints

## 6) Future: Grafana Cloud Agent (Host + K8s)

Checklist
- [ ] Grafana Cloud credentials in ESC
- [ ] Host agent (Calypso) scrapes Triton:8002, cloudflared:2200, GPU exporter
- [ ] K8s agent for adapter/sink logs + metrics
- [ ] Dashboards: latency, QPS, GPU utilization, 5xx

## 7) SME Multi‑Format Workflow Guide (v1 now, v2 plan)

Background
- SMEs work with text, PDFs, images, and CSVs. v1 supports pre‑labels for Text/PDF; CSVs work when a row has `text` or `pdf`/`url`. v2 will integrate existing pandas cleaners to normalize CSVs automatically.

Scope
- Document SME v1 workflow (CSV/Text/PDF/Images) with clear steps and diagrams, and outline v2 changes.

Checklist
- [ ] Docs: Add “SME Workflow (v1/v2)” to README/ARCHITECTURE/OPERATIONS
- [ ] Include two Mermaid diagrams (pre‑label flow, data lifecycle)
- [ ] CSV instructions: mapping, examples, best practices, limitations
- [ ] Images guidance: convert to PDF or OCR for pre‑labels
- [ ] Note v2 pandas integration plan and what changes for SMEs (no scripts)

Validation
- SMEs can import a CSV with `text` or `pdf`/`url`, see pre‑labels, and save
- Docs link to concrete endpoints and project settings

Labels: `type:docs`, `area:ops`, `priority:p1`, `status:ready`

## 8) CSV v1 UX: Import Templates and Samples

Background
- Reduce friction for CSV imports by providing mapping templates, sample CSVs, and a Label Studio project config aligned to maritime NER labels.

Scope
- Ship sample CSVs and a ready Label Studio labeling config; verify `/predict_ls` for both text and pdf/url rows.

Checklist
- [ ] Add `samples/csv/text_and_pdf_examples.csv`
- [ ] Add LS labeling config for NER to `docs/labeling-configs/ner_text.xml`
- [ ] README section: “Import CSVs — v1 quickstart”
- [ ] Validate `/predict_ls` on both patterns; include `curl` examples

Validation
- Import sample into LS, open tasks, pre‑labels render; adapter logs confirm requests

Labels: `type:feat`, `area:adapter`, `priority:p2`, `status:ready`

## 9) CsvIngestor (v2): Integrate Pandas Cleaners (Per‑Country)

Background
- Many country‑specific pandas scripts clean messy spreadsheets. Integrate them so normalization is automated in‑cluster, then push clean tasks to LS.

Scope
- Containerize cleaners (micromamba), add a CsvIngestor (CronJob + on‑demand Service), compose `text` via templates, import into LS, and record runs.

Checklist
- [ ] Dockerize cleaners with `environment.yml` (pandas, pyarrow, openpyxl)
- [ ] Define cleaner CLI contract: `--input <path|url> --country XX --out clean.csv`
- [ ] Templates: per‑country `text` composition in ConfigMap
- [ ] CsvIngestor K8s: CronJob schedule + manual HTTP trigger
- [ ] ESC: LS_URL, LS_TOKEN, PROJECT_ID, source endpoints/credentials
- [ ] Writes `control.ingestion_runs` start/finish rows
- [ ] Store clean.csv artifacts to object storage (optional)

Validation
- Run job for one country; tasks appear in LS; pre‑labels show; stage.* gets inserts after save

Labels: `type:feat`, `area:ops`, `area:adapter`, `priority:p1`, `status:ready`

## 10) Grafana Cloud PDC Agent — Allowlist + Deploy

Background
- Deploy Private Data Source Connect (PDC) and restrict remote opens via PermitRemoteOpen (allowed hosts only).

Scope
- Define allowlist; deploy agent; add Prometheus/Loki data sources; verify scrape.

Checklist
- [ ] Allowlist host:port pairs (e.g., `192.168.2.80:8002`, `192.168.2.80:2200`, `srv712429:9100`, `srv712695:9100`)
- [ ] Configure PermitRemoteOpen with allowlist in agent
- [ ] Add Grafana Cloud data sources for the allowed endpoints
- [ ] Dashboards for adapter, sink, Triton, cloudflared, node metrics

Validation
- Grafana Cloud can reach only allowlisted endpoints; metrics populate

Labels: `type:ops`, `area:ops`, `priority:p2`, `status:ready`

## 11) Pulumi Deployments Triggers — Governance

Background
- Avoid double deployments: clarify whether Pulumi Cloud auto‑deploys on push or local `pulumi up` is the source of truth.

Scope
- Document and configure triggers (preview‑only on PRs, deploy on merge, or local‑only applies). Add rollback notes.

Checklist
- [ ] Decide policy: Cloud preview only, local `pulumi up` applies (or Cloud applies on merge)
- [ ] Update OPERATIONS.md with the policy and steps
- [ ] Configure Pulumi Deployments accordingly

Validation
- No overlapping updates; team follows one path

Labels: `type:docs`, `area:ops`, `priority:p2`, `status:ready`
