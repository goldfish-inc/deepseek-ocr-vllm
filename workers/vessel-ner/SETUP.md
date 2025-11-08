# Vessel NER Pipeline - Setup Guide

## ✅ What's Been Created

### Project Structure
```
workers/vessel-ner/
├── src/
│   ├── index.ts                 # Main Hono router
│   ├── handlers/
│   │   ├── upload.ts            # POST /upload endpoint
│   │   └── argilla-webhook.ts   # POST /webhook/argilla endpoint
│   └── workers/                 # TODO: Queue consumers
├── wrangler.toml                # Cloudflare config
├── package.json                 # Dependencies installed ✅
├── tsconfig.json                # TypeScript config
└── README.md                    # Full documentation
```

### Dependencies Installed
- ✅ `@cloudflare/workers-types` (TypeScript types)
- ✅ `@anthropic-ai/sdk` (Claude API)
- ✅ `hono` (Lightweight web framework)
- ✅ `wrangler` v4.46.0 (Cloudflare CLI)

---

## 🚀 Next Steps (Run These Commands)

### Step 1: Create Cloudflare Infrastructure

```bash
cd /Users/rt/Developer/oceanid/workers/vessel-ner

# Create R2 bucket for PDFs
wrangler r2 bucket create vessel-pdfs

# Create queues
wrangler queues create pdf-processing
wrangler queues create entity-extraction
wrangler queues create argilla-sync
```

### Step 2: Set Secrets from 1Password

```bash
# MotherDuck token
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Motherduck API/credential" | \
  wrangler secret put MOTHERDUCK_TOKEN

# Claude API key
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Claude API NER/credential" | \
  wrangler secret put ANTHROPIC_API_KEY

# HuggingFace token (for DeepSeek OCR Space access)
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Hugging Face API Token/credential" | \
  wrangler secret put HF_TOKEN

# Argilla API key (from K8s cluster)
sshpass -p "TaylorRules" ssh root@157.173.210.123 \
  'kubectl -n apps get secret argilla-secrets -o jsonpath="{.data.ADMIN_API_KEY}"' | \
  base64 -d | wrangler secret put ARGILLA_API_KEY
```

### Step 3: Test Basic Deployment

```bash
# Start local dev server
pnpm dev

# In another terminal, test health endpoint
curl http://localhost:8787/health
# Expected: {"status":"ok","service":"vessel-ner-pipeline","version":"1.0.0"}
```

---

## 📝 Implementation Roadmap

### Phase 1: Core Workers (Next Session)
1. **OCR Processor Worker** (`src/workers/ocr-processor.ts`)
   - Consumes `pdf-processing` queue
   - Calls DeepSeek OCR HuggingFace Space
   - Writes to MotherDuck `raw_ocr` table
   - Enqueues to `entity-extraction`

2. **Entity Extractor Worker** (`src/workers/entity-extractor.ts`)
   - Consumes `entity-extraction` queue
   - Calls Claude API with NER prompt (51 entity types)
   - Writes to MotherDuck `entities` table
   - Enqueues to `argilla-sync`

3. **Argilla Sync Worker** (`src/workers/argilla-sync.ts`)
   - Consumes `argilla-sync` queue
   - Pushes entities to Argilla API at `http://argilla.apps.svc.cluster.local:6900`
   - Creates annotation tasks for SMEs

### Phase 2: MotherDuck Client Library
4. **MotherDuck Client** (`src/lib/motherduck.ts`)
   - SQL query execution
   - Parquet append operations
   - Connection pooling

### Phase 3: Integration Testing
5. Test with 2-5 sample PDFs end-to-end
6. Verify entities appear in Argilla UI
7. Test SME annotation → MotherDuck corrections flow

---

## 🔧 Configuration Details

### Environment Variables (in wrangler.toml)
- `DEEPSEEK_OCR_SPACE_URL` = https://huggingface.co/spaces/deepseek-ai/DeepSeek-VL2
- `ARGILLA_API_URL` = http://argilla.apps.svc.cluster.local:6900 (cluster internal)
- `MOTHERDUCK_DATABASE` = vessel_intelligence

### Secrets (set via wrangler secret put)
- `MOTHERDUCK_TOKEN` - From 1Password
- `ANTHROPIC_API_KEY` - From 1Password
- `HF_TOKEN` - From 1Password
- `ARGILLA_API_KEY` - From K8s cluster

### Bindings
- R2 Bucket: `VESSEL_PDFS`
- Queues: `PDF_PROCESSING_QUEUE`, `ENTITY_EXTRACTION_QUEUE`, `ARGILLA_SYNC_QUEUE`

---

## ⚠️ Important Notes

1. **Workers → Cluster**: Use internal URLs (http://argilla.apps.svc.cluster.local:6900)
2. **Humans → Web**: Use public URLs (https://label.boathou.se)
3. **MotherDuck Schema**: Database `vessel_intelligence` already exists
4. **DeepSeek OCR**: Running on HuggingFace Space (not API directly)
5. **Independent Deployment**: Uses Wrangler CLI (not Pulumi/CI/CD)

---

## 📚 Documentation

- Full setup: [README.md](./README.md)
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- MotherDuck Docs: https://motherduck.com/docs/
- Argilla API: https://docs.argilla.io/
