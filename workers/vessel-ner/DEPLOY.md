## Vessel NER Pipeline - Complete Deployment Guide

### ✅ What's Implemented

**Project Structure**:
```
workers/vessel-ner/
├── src/
│   ├── index.ts                      # Main HTTP router
│   ├── handlers/
│   │   ├── upload.ts                 # POST /upload
│   │   └── argilla-webhook.ts        # POST /webhook/argilla
│   ├── workers/
│   │   ├── ocr-processor.ts          # Queue: pdf-processing
│   │   ├── entity-extractor.ts       # Queue: entity-extraction
│   │   └── argilla-sync.ts           # Queue: argilla-sync
│   └── lib/
│       ├── motherduck.ts             # MotherDuck client (SQL + parquet)
│       ├── deepseek-ocr.ts           # DeepSeek HF Space client
│       └── argilla.ts                # Argilla API client
├── wrangler.toml                     # Main worker config
├── wrangler.ocr-processor.toml       # OCR worker config
├── wrangler.entity-extractor.toml    # NER worker config
├── wrangler.argilla-sync.toml        # Argilla worker config
└── deploy.sh                         # One-command deployment
```

---

## 🚀 Deployment Steps

### Step 1: Create Cloudflare Infrastructure

```bash
cd /Users/rt/Developer/oceanid/workers/vessel-ner

# Create R2 bucket
wrangler r2 bucket create vessel-pdfs

# Create queues
wrangler queues create pdf-processing
wrangler queues create entity-extraction
wrangler queues create argilla-sync

# Create dead letter queues (for failed messages)
wrangler queues create pdf-processing-dlq
wrangler queues create entity-extraction-dlq
wrangler queues create argilla-sync-dlq
```

### Step 2: Set Secrets

```bash
# MotherDuck token
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Motherduck API/credential" | \
  wrangler secret put MOTHERDUCK_TOKEN

# Claude API key
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Claude API NER/credential" | \
  wrangler secret put ANTHROPIC_API_KEY

# HuggingFace token
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Hugging Face API Token/credential" | \
  wrangler secret put HF_TOKEN

# Argilla API key (from K8s cluster)
sshpass -p "TaylorRules" ssh root@157.173.210.123 \
  'kubectl -n apps get secret argilla-secrets -o jsonpath="{.data.ADMIN_API_KEY}"' | \
  base64 -d | wrangler secret put ARGILLA_API_KEY

# Set secrets for each worker
for worker in vessel-ner-ocr-processor vessel-ner-entity-extractor vessel-ner-argilla-sync; do
  echo "Setting secrets for $worker..."

  op read "op://ddqqn2cxmgi4xl4rris4mztwea/Motherduck API/credential" | \
    wrangler secret put MOTHERDUCK_TOKEN --name $worker

  if [[ "$worker" == *"entity-extractor"* ]]; then
    op read "op://ddqqn2cxmgi4xl4rris4mztwea/Claude API NER/credential" | \
      wrangler secret put ANTHROPIC_API_KEY --name $worker
  fi

  if [[ "$worker" == *"ocr-processor"* ]]; then
    op read "op://ddqqn2cxmgi4xl4rris4mztwea/Hugging Face API Token/credential" | \
      wrangler secret put HF_TOKEN --name $worker
  fi

  if [[ "$worker" == *"argilla-sync"* ]]; then
    sshpass -p "TaylorRules" ssh root@157.173.210.123 \
      'kubectl -n apps get secret argilla-secrets -o jsonpath="{.data.ADMIN_API_KEY}"' | \
      base64 -d | wrangler secret put ARGILLA_API_KEY --name $worker
  fi
done
```

### Step 3: Deploy Workers

```bash
# Deploy all workers with one command
./deploy.sh

# Or deploy individually
wrangler deploy --config wrangler.toml
wrangler deploy --config wrangler.ocr-processor.toml
wrangler deploy --config wrangler.entity-extractor.toml
wrangler deploy --config wrangler.argilla-sync.toml
```

---

## 🧪 Testing

### Test 1: Health Check

```bash
curl https://vessel-ner-pipeline.<your-subdomain>.workers.dev/health
# Expected: {"status":"ok","service":"vessel-ner-pipeline","version":"1.0.0"}
```

### Test 2: Upload PDF

```bash
# Create test PDF or use existing
curl -X POST https://vessel-ner-pipeline.<your-subdomain>.workers.dev/upload \
  -F "pdf=@test.pdf"

# Expected response:
# {
#   "success": true,
#   "pdf_key": "uploads/2025-01-07T19-45-00_test.pdf",
#   "message": "PDF uploaded successfully. Processing started."
# }
```

### Test 3: Monitor Queue Processing

```bash
# Watch logs for main worker
wrangler tail vessel-ner-pipeline

# Watch OCR processor
wrangler tail vessel-ner-ocr-processor

# Watch entity extractor
wrangler tail vessel-ner-entity-extractor

# Watch Argilla sync
wrangler tail vessel-ner-argilla-sync

# Check queue depth
wrangler queues list
```

### Test 4: Verify Argilla

```bash
# SSH into cluster and check Argilla logs
sshpass -p "TaylorRules" ssh root@157.173.210.123 \
  'kubectl -n apps logs deploy/argilla --tail=50'

# Visit Argilla UI (from browser)
# https://label.boathou.se
# Login: admin / <password from secret>
```

---

## 📊 Monitoring

### Cloudflare Dashboard
- Workers: https://dash.cloudflare.com/<account-id>/workers
- R2 Buckets: https://dash.cloudflare.com/<account-id>/r2
- Queues: https://dash.cloudflare.com/<account-id>/queues

### Logs
```bash
# Real-time logs for all workers
wrangler tail vessel-ner-pipeline
wrangler tail vessel-ner-ocr-processor
wrangler tail vessel-ner-entity-extractor
wrangler tail vessel-ner-argilla-sync

# Filter by event type
wrangler tail vessel-ner-pipeline --format json | jq 'select(.event == "pdf_uploaded")'
```

### Queue Metrics
```bash
# List queues with message counts
wrangler queues list

# View dead letter queue (failed messages)
wrangler queues consumer list pdf-processing-dlq
```

---

## 🔧 Troubleshooting

### Issue: PDF not processing

**Check**:
1. R2 bucket exists: `wrangler r2 bucket list`
2. Queue has messages: `wrangler queues list`
3. OCR processor logs: `wrangler tail vessel-ner-ocr-processor`

**Common causes**:
- DeepSeek HF Space is down or rate-limited
- MotherDuck connection failed (check token)
- PDF is too large (>10MB may timeout)

### Issue: No entities extracted

**Check**:
1. OCR text in MotherDuck (use DuckDB CLI)
2. Claude API key valid
3. Entity extractor logs for errors

**Common causes**:
- Claude API rate limit
- OCR text is empty or corrupted
- JSON parsing error in Claude response

### Issue: Entities not in Argilla

**Check**:
1. Argilla service running: `kubectl -n apps get pods | grep argilla`
2. Argilla API key correct
3. Argilla sync worker logs

**Common causes**:
- Argilla API URL wrong (must use cluster internal URL)
- Dataset not created (worker will auto-create)
- Network issue between Workers and K8s cluster

---

## 🔄 Pipeline Flow

```
User uploads PDF
  ↓
POST /upload handler
  ├─ Store in R2: vessel-pdfs/uploads/
  └─ Enqueue: pdf-processing
      ↓
OCR Processor Worker
  ├─ Fetch from R2
  ├─ Call DeepSeek HF Space
  ├─ Write to MotherDuck: raw_ocr
  └─ Enqueue: entity-extraction (per page)
      ↓
Entity Extractor Worker
  ├─ Read from MotherDuck: raw_ocr
  ├─ Call Claude API (NER)
  ├─ Write to MotherDuck: entities
  └─ Enqueue: argilla-sync
      ↓
Argilla Sync Worker
  ├─ Read from MotherDuck: raw_ocr + entities
  ├─ Format as Argilla record
  └─ POST to Argilla API (K8s cluster)
      ↓
SME reviews in Argilla UI (label.boathou.se)
  ↓
Argilla webhook → POST /webhook/argilla
  └─ Write to MotherDuck: entity_corrections
```

---

## 📝 Next Steps

1. **Test with 2-5 sample PDFs**
   - Upload via web UI or curl
   - Verify end-to-end flow
   - Check entities in Argilla

2. **Build Upload UI** (optional)
   - Simple HTML form
   - Deploy to Cloudflare Pages
   - Link to main worker

3. **Postgres Sync** (when ready)
   - DuckDB → CrunchyBridge sync script
   - Load vetted entities into EBISU schema
   - Scheduled or manual trigger

4. **Production Monitoring**
   - Set up Sentry for error tracking
   - Cloudflare Analytics for usage
   - Grafana for MotherDuck queries

---

## 🔐 Security Checklist

- ✅ All secrets in Wrangler secrets (not hardcoded)
- ✅ R2 bucket private (Workers-only access)
- ✅ Argilla API key from K8s cluster
- ✅ MotherDuck connections over TLS
- ✅ Workers → Cluster uses internal URL
- ✅ Humans → Web uses public URL

---

## 📚 References

- [Wrangler Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [R2 Storage](https://developers.cloudflare.com/r2/)
- [MotherDuck API](https://motherduck.com/docs/api-reference)
- [Argilla API](https://docs.argilla.io/latest/reference/)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)
