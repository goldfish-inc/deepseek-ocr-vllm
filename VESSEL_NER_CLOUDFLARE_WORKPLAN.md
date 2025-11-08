# Vessel NER Intelligence Pipeline - Cloudflare Architecture
**Created:** 2025-11-07
**Stack:** Cloudflare Workers v4, R2, Queues, MotherDuck, Argilla

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ USER INTERFACE (Argilla + Custom Upload UI)           │
│ SMEs upload PDFs via web form                          │
└─────────────────────────────────────────────────────────┘
                    ↓ HTTPS POST
┌─────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKER: upload-handler                      │
│ • Validates PDF                                         │
│ • Stores in R2 bucket: vessel-pdfs                     │
│ • Sends message to Queue: pdf-processing               │
└─────────────────────────────────────────────────────────┘
                    ↓ Queue consumer
┌─────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKER: ocr-processor                       │
│ • Fetches PDF from R2                                   │
│ • Calls DeepSeek OCR API                               │
│ • Writes to MotherDuck raw_ocr (parquet)               │
│ • Sends message to Queue: entity-extraction            │
└─────────────────────────────────────────────────────────┘
                    ↓ Queue consumer
┌─────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKER: entity-extractor                    │
│ • Reads from MotherDuck raw_ocr                        │
│ • Calls Claude API for NER                             │
│ • Writes to MotherDuck entities (parquet)              │
│ • Sends message to Queue: argilla-sync                 │
└─────────────────────────────────────────────────────────┘
                    ↓ Queue consumer
┌─────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKER: argilla-sync                        │
│ • Formats entities for Argilla                         │
│ • Posts to Argilla API (label.boathou.se)             │
│ • SMEs review in Argilla UI                            │
└─────────────────────────────────────────────────────────┘
                    ↓ Webhook callback
┌─────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKER: argilla-export                      │
│ • Receives completed annotations                        │
│ • Writes to MotherDuck entity_corrections (parquet)    │
│ • Triggers ML export or Postgres sync                   │
└─────────────────────────────────────────────────────────┘
```

---

## Technology Stack (2025 Latest)

### Cloudflare Platform
- **Wrangler CLI:** v4.45.4 (latest, March 2025)
- **Workers Runtime:** V8 14.1, Node.js compatibility with `nodejs_compat` flag
- **Queues:** 5,000 msg/sec throughput, pull & push consumers
- **R2 Storage:** S3-compatible, Workers binding API
- **D1 Database:** Optional for lightweight state (10 GB SQLite)

### External APIs
- **DeepSeek OCR:** Vision API for document text extraction
- **Claude API:** `claude-haiku-4-5-20251001` for NER (64K output tokens)
- **MotherDuck:** Cloud DuckDB, parquet-native storage
- **Argilla:** Self-hosted annotation UI at label.boathou.se

### Data Formats
- **Storage:** Parquet (native MotherDuck format)
- **Queue Messages:** JSON
- **API Responses:** JSON

---

## Staged Implementation Plan

### Stage 1: Infrastructure Setup
**Goal:** Provision Cloudflare resources and MotherDuck schema

**Tasks:**
1. Install Wrangler v4: `pnpm add -g wrangler@latest`
2. Create Cloudflare project: `wrangler init vessel-ner-pipeline`
3. Create R2 bucket: `wrangler r2 bucket create vessel-pdfs`
4. Create Queues:
   - `wrangler queues create pdf-processing`
   - `wrangler queues create entity-extraction`
   - `wrangler queues create argilla-sync`
5. Verify MotherDuck schema (already created in `vessel_intelligence`)
6. Set up secrets:
   - `wrangler secret put DEEPSEEK_API_KEY`
   - `wrangler secret put ANTHROPIC_API_KEY`
   - `wrangler secret put MOTHERDUCK_TOKEN`
   - `wrangler secret put ARGILLA_API_KEY`

**Deliverables:**
- `wrangler.toml` with all bindings
- Cloudflare resources provisioned
- Secrets configured

---

### Stage 2: Upload Handler Worker
**Goal:** Accept PDF uploads and store in R2

**Worker:** `src/upload-handler.ts`

**Features:**
- HTTPS endpoint: `POST /api/upload`
- Multipart form data parsing
- PDF validation (mimetype, size < 100MB)
- R2 upload with metadata
- Queue message to `pdf-processing`
- CORS headers for web UI

**Dependencies:**
```json
{
  "@cloudflare/workers-types": "^4.20250103.0",
  "hono": "^4.7.14"
}
```

**Testing:**
```bash
wrangler dev --local
curl -F "pdf=@test.pdf" http://localhost:8787/api/upload
```

**Deployment:**
```bash
wrangler deploy src/upload-handler.ts
```

---

### Stage 3: OCR Processor Worker
**Goal:** Process PDFs with DeepSeek OCR, write to MotherDuck

**Worker:** `src/ocr-processor.ts`

**Features:**
- Queue consumer for `pdf-processing`
- Fetch PDF from R2
- Call DeepSeek Vision API (streaming if supported)
- Parse OCR response
- Insert to MotherDuck `raw_ocr` table
- Update `processing_log` table
- Send message to `entity-extraction` queue

**MotherDuck Integration:**
```typescript
// Use DuckDB WASM for Workers (if available)
// OR HTTP API to MotherDuck
// OR batch insert via REST API
```

**Dependencies:**
```json
{
  "@duckdb/duckdb-wasm": "^1.29.0",  // If WASM works in Workers
  "node-fetch": "^3.3.2"  // For MotherDuck HTTP API
}
```

**Testing:**
```bash
wrangler dev --local
# Manually send queue message
wrangler queues send pdf-processing '{"pdf_key": "test.pdf"}'
```

---

### Stage 4: Entity Extractor Worker
**Goal:** Extract entities with Claude, write to MotherDuck

**Worker:** `src/entity-extractor.ts`

**Features:**
- Queue consumer for `entity-extraction`
- Read document from MotherDuck `raw_ocr`
- Call Claude API with NER prompt (68 entity types)
- Parse JSON response
- Batch insert entities to MotherDuck
- Handle truncation (auto-fix JSON)
- Send message to `argilla-sync` queue

**Claude API Config:**
```typescript
{
  model: "claude-haiku-4-5-20251001",
  max_tokens: 16384,
  temperature: 0,
  system: ENTITY_EXTRACTION_PROMPT
}
```

**Dependencies:**
```json
{
  "@anthropic-ai/sdk": "^0.32.1"
}
```

**Testing:**
```bash
# Test with existing MotherDuck data
wrangler queues send entity-extraction '{"document_id": "test_page_0"}'
```

---

### Stage 5: Argilla Sync Worker
**Goal:** Push pre-annotated entities to Argilla for SME review

**Worker:** `src/argilla-sync.ts`

**Features:**
- Queue consumer for `argilla-sync`
- Read entities from MotherDuck
- Format for Argilla dataset (Token Classification task)
- POST to Argilla API
- Handle batch uploads (100 records/request)

**Argilla Integration:**
```typescript
// Argilla Python SDK has REST API
// Use direct HTTP calls from Worker
POST https://label.boathou.se/api/v1/datasets/{dataset_id}/records
```

**Dependencies:**
```json
{
  "hono": "^4.7.14"  // For HTTP client
}
```

---

### Stage 6: Argilla Export Worker
**Goal:** Receive completed annotations, write to MotherDuck

**Worker:** `src/argilla-export.ts`

**Features:**
- Webhook endpoint: `POST /api/argilla/callback`
- Receive annotation completions from Argilla
- Parse reviewed entities
- Write to MotherDuck `entity_corrections` table
- Trigger ML export or Postgres sync

**Webhook Setup:**
Configure Argilla to POST to:
```
https://vessel-ner.your-subdomain.workers.dev/api/argilla/callback
```

---

### Stage 7: ML Export Worker
**Goal:** Export training data in spaCy/CoNLL format

**Worker:** `src/ml-export.ts`

**Features:**
- Scheduled cron or manual trigger
- Read reviewed entities from MotherDuck
- Convert to spaCy format (JSON)
- Convert to CoNLL format (IOB2 tagging)
- Export as parquet to MotherDuck `ml_training_exports` table
- Optional: Upload to R2 for download

**Export Formats:**
```json
// spaCy format
{
  "text": "Vessel OCEAN GLORY flagged Panama",
  "entities": [[7, 18, "VESSEL_NAME"], [27, 33, "FLAG_STATE"]]
}
```

```text
# CoNLL format (IOB2)
Vessel    O
OCEAN     B-VESSEL_NAME
GLORY     I-VESSEL_NAME
flagged   O
Panama    B-FLAG_STATE
```

---

### Stage 8: Simple Upload UI
**Goal:** Web interface for SMEs to upload PDFs

**Option A: Cloudflare Pages + Worker**
- Static HTML form hosted on Pages
- Submits to upload-handler Worker

**Option B: Embed in Argilla**
- Custom Argilla plugin/extension
- Iframe to Cloudflare Pages form

**Implementation:**
```html
<!-- pages/upload.html -->
<form action="/api/upload" method="POST" enctype="multipart/form-data">
  <input type="file" name="pdf" accept=".pdf" required>
  <button type="submit">Upload PDF</button>
</form>
```

---

## Deployment Strategy

### Development
```bash
# Local testing
wrangler dev --local

# Tail logs in real-time
wrangler tail
```

### Staging
```bash
# Deploy to staging environment
wrangler deploy --env staging
```

### Production
```bash
# Deploy to production
wrangler deploy --env production

# Monitor
wrangler tail --env production --format=pretty
```

---

## Cost Estimate

**Cloudflare Workers (Paid Plan: $5/month)**
- 10M requests/month
- Workers Queues: 5,000 msgs/sec (included)
- R2 Storage: 10 GB free, $0.015/GB after
- No egress fees

**External APIs:**
- DeepSeek OCR: ~$0.10 per 1K pages (estimate)
- Claude Haiku: $0.25 per 1M input tokens, $1.25 per 1M output tokens
  - 191 docs × 8K avg tokens = ~$0.50 total

**MotherDuck:**
- Free tier: 10 GB storage, generous compute

**Total:** ~$10-20/month for production workload

---

## Monitoring & Observability

### Cloudflare Analytics
- Worker invocations
- Queue depth & latency
- R2 requests

### Logging
```typescript
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  worker: "entity-extractor",
  document_id: doc_id,
  entities_extracted: count,
  duration_ms: duration
}));
```

### Error Handling
- Retry logic for API failures
- Dead letter queue for failed messages
- Alerts via Cloudflare notifications

---

## Security

### Secrets Management
All sensitive credentials stored in Wrangler secrets:
- `DEEPSEEK_API_KEY`
- `ANTHROPIC_API_KEY`
- `MOTHERDUCK_TOKEN`
- `ARGILLA_API_KEY`

### Access Control
- Workers behind Cloudflare Access (optional)
- R2 bucket private, Workers-only access
- Argilla authentication required

### Data Privacy
- PDFs stored in R2 with encryption at rest
- MotherDuck connections over TLS
- No PII exposed in logs

---

## Testing Plan

### Unit Tests
- Each Worker function tested with Vitest
- Mock R2, Queues, external APIs

### Integration Tests
- End-to-end: Upload PDF → Argilla annotation
- Use 2-5 test PDFs from existing dataset

### Load Testing
- Simulate 100 concurrent PDF uploads
- Verify queue processing under load

---

## Migration from Existing Data

### One-time Import
Import 191 existing parquet files from `/tmp/hf-deepseekocr*/` to MotherDuck:

```python
# Run once locally
import duckdb
import glob

conn = duckdb.connect('md:vessel_intelligence')

for file in glob.glob('/tmp/hf-deepseekocr*/*.parquet'):
    conn.execute(f"""
        INSERT INTO raw_ocr
        SELECT * FROM read_parquet('{file}')
    """)
```

Then trigger entity extraction for these 191 docs via Worker.

---

## Next Steps

1. ✅ Research completed (Cloudflare 2025 stack)
2. ⏳ Create Wrangler project structure
3. ⏳ Implement Workers (Stages 2-7)
4. ⏳ Deploy and test end-to-end
5. ⏳ Build upload UI
6. ⏳ Production rollout

---

## References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler v4 Changelog](https://developers.cloudflare.com/changelog/2025-03-13-wrangler-v4/)
- [R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Queues Docs](https://developers.cloudflare.com/queues/)
- [MotherDuck Docs](https://motherduck.com/docs/)
- [Argilla Docs](https://docs.argilla.io/)
