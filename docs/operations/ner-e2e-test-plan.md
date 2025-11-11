NER Pipeline E2E Test Plan (DeepSeek OCR → MotherDuck → NER via Spark + Ollama Worker → Argilla)

Objective
- Validate each stage of the PDF → entities flow and confirm data quality. This plan is reproducible locally and in CI with appropriate credentials.

Pre‑requisites
- Cloudflare account + API token with Workers/Queues/R2 permissions (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
- Wrangler v4: `pnpm exec wrangler --version`
- Secrets set in Workers (see workers/vessel-ner/README.md):
  - `MOTHERDUCK_TOKEN`, `ARGILLA_API_KEY`, `HF_TOKEN`
- MotherDuck database: `vessel_intelligence` accessible with `MOTHERDUCK_TOKEN`.
- MotherDuck SQL proxy (recommended): set `MD_QUERY_PROXY_URL` in worker vars to a team‑hosted endpoint that executes SQL using the official DuckDB/MotherDuck client. If a proxy is not available yet, use the staging‑to‑load pattern (write JSON/Parquet to R2 and run a periodic loader).
- Ollama Worker proxy reachable (see cloud/README.md for `ollama-api.boathou.se`) and AI Gateway token if required.

Test Data
- Use a representative PDF with vessel names, identifiers (IMO/MMSI), ports, dates, and regulatory text.
- Save as `test.pdf` in your working directory.

Environment Setup
```bash
cd workers/vessel-ner
pnpm install
pnpm exec wrangler login  # or export CLOUDFLARE_* env vars

# Optional: ensure infra exists
pnpm exec wrangler r2 bucket create vessel-pdfs || true
pnpm exec wrangler queues list | grep -E "pdf-processing|entity-extraction|argilla-sync"
```

Step 1 — Upload PDF and verify R2
```bash
# Upload
curl -X POST https://vessel-ner-pipeline.<your-subdomain>.workers.dev/upload \
  -F "pdf=@test.pdf"

# Verify R2 has the object
pnpm exec wrangler r2 object list vessel-pdfs --prefix uploads/ | head -20
```
Expected
- HTTP 200 with `{ success: true, pdf_key: ... }`.
- `uploads/<timestamp>_test.pdf` present in R2 list.

Step 2 — OCR processor writes to MotherDuck
```bash
# Tail OCR logs (newest first)
pnpm exec wrangler tail vessel-ner-ocr-processor --format json | jq -rc 'select(.event=="ocr_completed" or .event=="ocr_error")'

# In MotherDuck (via web or CLI), run:
-- SQL --
SELECT document_id, page_count, length(clean_text) AS chars
FROM raw_ocr
ORDER BY extracted_at DESC
LIMIT 5;
```
Expected
- OCR log shows `ocr_completed` for your document.
- `raw_ocr` has rows for the new document with non‑empty text.

Step 3 — NER via Spark + Ollama Worker
```bash
# Tail entity extractor logs
pnpm exec wrangler tail vessel-ner-entity-extractor --format json | jq -rc 'select(.event|test("entity_extraction_(started|completed|error)"))'

# Verify MotherDuck entities
-- SQL --
SELECT document_id, entity_type, entity_text, confidence
FROM entities
ORDER BY extracted_at DESC
LIMIT 20;
```
Expected
- Logs show `entity_extraction_started` and `entity_extraction_completed` with counts.
- `entities` contains rows for the new document.

Step 4 — Argilla sync and UI
```bash
# Tail Argilla sync logs
pnpm exec wrangler tail vessel-ner-argilla-sync --format json | jq -rc 'select(.event|test("argilla_sync_(started|completed|error)"))'

# Open Argilla UI and confirm dataset contains tasks for the new document
# https://label.boathou.se (credentials from K8s secret)
```
Expected
- Sync logs show `argilla_sync_completed`.
- New records/tasks visible in Argilla dataset.

Step 5 — Webhook and corrections
```bash
# Option A: perform a sample correction in Argilla UI and wait for webhook
# Option B: simulate webhook (for contract only):
curl -X POST https://vessel-ner-pipeline.<your-subdomain>.workers.dev/webhook/argilla \
  -H 'Content-Type: application/json' \
  -d '{"document_id":"<your-doc-id>","corrections":[{"entity_id":"...","new_label":"VESSEL_NAME"}]}'

# Verify MotherDuck corrections
-- SQL --
SELECT document_id, entity_id, new_label, updated_at
FROM entity_corrections
ORDER BY updated_at DESC
LIMIT 5;
```
Expected
- `entity_corrections` updated with your change.

Quality Checks (Minimum)
- OCR completeness: at least 1 page with >50 characters; failure raises alert.
- Entity density: entities per page > threshold for your doc type (e.g., >3/page for licensing docs).
- Key entity presence: at least one `VESSEL_NAME` and one of `IMO_NUMBER` or `MMSI`.
- Confidence distribution: median confidence ≥0.6 (tunable).

Quality Queries (MotherDuck)
```sql
-- OCR completeness
SELECT document_id, SUM(length(coalesce(clean_text, text))) AS total_chars
FROM raw_ocr
WHERE extracted_at > now() - interval '1 day'
GROUP BY 1
ORDER BY total_chars DESC;

-- Entity density
SELECT document_id, COUNT(*)::float / NULLIF(MAX(page_number)+1,0) AS entities_per_page
FROM entities
WHERE extracted_at > now() - interval '1 day'
GROUP BY 1
ORDER BY entities_per_page DESC;

-- Key entity presence
SELECT document_id,
  BOOL_OR(entity_type='VESSEL_NAME') AS has_name,
  BOOL_OR(entity_type IN ('IMO_NUMBER','MMSI')) AS has_id
FROM entities
WHERE extracted_at > now() - interval '1 day'
GROUP BY 1;

-- Confidence distribution
SELECT approx_quantile(confidence, 0.5) AS median_conf,
       approx_quantile(confidence, 0.1) AS p10,
       approx_quantile(confidence, 0.9) AS p90
FROM entities
WHERE extracted_at > now() - interval '1 day';
```

Failure Modes & Remediations
- No OCR text: verify DeepSeek Space availability, R2 object integrity, worker logs.
- NER fails: verify Ollama Worker HTTP connectivity and AI Gateway token; check request payload shape.
- Argilla missing tasks: verify sync worker logs and `ARGILLA_API_URL` correctness.
- MotherDuck insert failures: validate `MOTHERDUCK_TOKEN` and schema existence.

Cleanup (optional)
```sql
-- Remove test rows for a given document_id
DELETE FROM entity_corrections WHERE document_id='<doc-id>';
DELETE FROM entities WHERE document_id='<doc-id>';
DELETE FROM raw_ocr WHERE document_id='<doc-id>';
```

Appendix
- Workers repo: `workers/vessel-ner`
- Ollama Worker proxy docs: see cloud/README.md (Ollama Worker section)
- Argilla UI: https://label.boathou.se
