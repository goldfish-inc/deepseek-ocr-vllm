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

## Workspace Context

This directory lives under the monorepo root that contains `pnpm-workspace.yaml`. pnpm runs in workspace context here, even though `workers/vessel-ner` is not listed as a formal workspace member. Effects:

- Dependencies install to the workspace root `node_modules`.
- Binaries (like `wrangler`) resolve from the workspace root.
- Always invoke binaries via `pnpm exec <bin>` or npm scripts via `pnpm run <script>`.

CI is aligned with this model. See `.github/workflows/vessel-ner-workers.yml`, which installs with pnpm and runs `pnpm exec wrangler` for verification. Local and CI usage should match the examples below.

## Quick Start

### 1. Install Dependencies

```bash
cd workers/vessel-ner
pnpm install
```

### 2. Create Infrastructure

```bash
# Create R2 bucket
pnpm exec wrangler r2 bucket create vessel-pdfs

# Create queues
pnpm exec wrangler queues create pdf-processing
pnpm exec wrangler queues create entity-extraction
pnpm exec wrangler queues create argilla-sync
```

### 3. Set Secrets

```bash
# MotherDuck token
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Motherduck API/credential" | \
  pnpm exec wrangler secret put MOTHERDUCK_TOKEN

# Claude API key
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Claude API NER/credential" | \
  pnpm exec wrangler secret put ANTHROPIC_API_KEY

# HuggingFace token
op read "op://ddqqn2cxmgi4xl4rris4mztwea/Hugging Face API Token/credential" | \
  pnpm exec wrangler secret put HF_TOKEN

# Argilla API key (from K8s secret)
kubectl -n apps get secret argilla-secrets -o jsonpath='{.data.ADMIN_API_KEY}' | base64 -d | \
  pnpm exec wrangler secret put ARGILLA_API_KEY
```

### 4. Deploy

```bash
# Deploy main worker
pnpm deploy

# Deploy queue consumers (separate workers)
pnpm exec wrangler deploy --config wrangler.ocr-processor.toml
pnpm exec wrangler deploy --config wrangler.entity-extractor.toml
pnpm exec wrangler deploy --config wrangler.argilla-sync.toml
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
pnpm exec wrangler tail vessel-ner-pipeline

# Check queue depth
pnpm exec wrangler queues list

# R2 bucket usage
pnpm exec wrangler r2 bucket usage vessel-pdfs
```

## Runbook: CI vs Local

Use the same commands locally that CI runs, just with credentials set via `wrangler login` or environment variables.

- CI (GitHub Actions)
  - Node: `24.x`, pnpm: `9.12.2`
  - Working dir: `workers/vessel-ner`
  - Install: `pnpm install --no-frozen-lockfile`
  - Deploy: `bash deploy.sh`
  - Verify: `pnpm exec wrangler deployments list --name vessel-ner-entity-extractor | head -5`
  - Auth: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are provided as secrets

- Local
  - `cd workers/vessel-ner && pnpm install`
  - Authenticate: run `pnpm exec wrangler login` (browser) or export `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
  - Deploy: `./deploy.sh`
  - Verify: `pnpm exec wrangler deployments list --name vessel-ner-entity-extractor | head -5`
  - Logs: `pnpm exec wrangler tail vessel-ner-pipeline`

## Next Steps

1. ✅ Project structure created
2. ⏳ Implement OCR processor worker
3. ⏳ Implement NER extractor worker
4. ⏳ Implement Argilla sync worker
5. ⏳ Test end-to-end with sample PDF
6. ⏳ Deploy to production
