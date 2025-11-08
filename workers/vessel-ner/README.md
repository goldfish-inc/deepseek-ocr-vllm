# Vessel NER Pipeline - Cloudflare Workers

Cloud-native NER extraction pipeline for vessel intelligence documents.

## Architecture

```
PDF Upload → R2 Storage → DeepSeek OCR (HF Space) → MotherDuck (parquet)
   ↓
Claude NER → MotherDuck entities → Argilla (K3s cluster) → SME Review
   ↓
MotherDuck entity_corrections → (optional) CrunchyBridge Postgres
```

## Prerequisites

- Node.js 18+ with pnpm
- Cloudflare account (account_id: 8fa97474778c8a894925c148ca829739)
- Wrangler CLI v4.46+ (already installed)
- 1Password CLI (for secrets)

## Quick Start

### 1. Install Dependencies

```bash
cd workers/vessel-ner
pnpm install
```

### 2. Create Infrastructure

```bash
# Create R2 bucket
wrangler r2 bucket create vessel-pdfs

# Create queues
wrangler queues create pdf-processing
wrangler queues create entity-extraction
wrangler queues create argilla-sync
```

### 3. Set Secrets

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

# Argilla API key (from K8s secret)
kubectl -n apps get secret argilla-secrets -o jsonpath='{.data.ADMIN_API_KEY}' | base64 -d | \
  wrangler secret put ARGILLA_API_KEY
```

### 4. Deploy

```bash
# Deploy main worker
pnpm deploy

# Deploy queue consumers (separate workers)
wrangler deploy --config wrangler.ocr-processor.toml
wrangler deploy --config wrangler.entity-extractor.toml
wrangler deploy --config wrangler.argilla-sync.toml
```

## Development

```bash
# Local dev server
pnpm dev

# Test upload
curl -X POST http://localhost:8787/upload \
  -F "pdf=@test.pdf"

# View logs
pnpm tail
```

## Project Structure

```
workers/vessel-ner/
├── src/
│   ├── index.ts                    # Main router
│   ├── handlers/
│   │   ├── upload.ts               # PDF upload handler
│   │   └── argilla-webhook.ts      # Argilla callback
│   ├── workers/
│   │   ├── ocr-processor.ts        # Queue: pdf-processing
│   │   ├── entity-extractor.ts     # Queue: entity-extraction
│   │   └── argilla-sync.ts         # Queue: argilla-sync
│   └── lib/
│       ├── motherduck.ts           # MotherDuck client
│       ├── deepseek-ocr.ts         # DeepSeek HF Space client
│       └── argilla.ts              # Argilla API client
├── wrangler.toml                   # Main worker config
├── wrangler.ocr-processor.toml     # OCR worker config
├── wrangler.entity-extractor.toml  # NER worker config
└── wrangler.argilla-sync.toml      # Argilla worker config
```

## Secrets Management

All secrets stored in 1Password vault `ddqqn2cxmgi4xl4rris4mztwea`:
- ✅ Motherduck API
- ✅ Claude API NER
- ✅ Hugging Face API Token
- ✅ Argilla API key (from K8s cluster)

## MotherDuck Schema

Database: `vessel_intelligence`

Tables:
- `raw_ocr` - OCR text from DeepSeek
- `entities` - Extracted entities from Claude
- `entity_corrections` - SME corrections from Argilla
- `processing_log` - Pipeline status tracking

## Endpoints

### Public (Humans)
- `POST /upload` - Upload PDF for processing

### Internal (Webhooks)
- `POST /webhook/argilla` - Argilla annotation callback

### Queue Consumers (Workers)
- `pdf-processing` → ocr-processor.ts
- `entity-extraction` → entity-extractor.ts
- `argilla-sync` → argilla-sync.ts

## Monitoring

```bash
# View worker logs
wrangler tail vessel-ner-pipeline

# Check queue depth
wrangler queues list

# R2 bucket usage
wrangler r2 bucket usage vessel-pdfs
```

## Next Steps

1. ✅ Project structure created
2. ⏳ Implement OCR processor worker
3. ⏳ Implement NER extractor worker
4. ⏳ Implement Argilla sync worker
5. ⏳ Test end-to-end with sample PDF
6. ⏳ Deploy to production
