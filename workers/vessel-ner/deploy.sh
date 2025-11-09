#!/bin/bash
# Deploy Vessel NER Pipeline Workers
set -e

echo "🚀 Deploying Vessel NER Pipeline..."

# Use pnpm exec to access workspace wrangler
WRANGLER="pnpm exec wrangler"

# Deploy main worker (HTTP handlers)
echo "📦 Deploying main worker..."
$WRANGLER deploy --config wrangler.toml

# Deploy queue consumers
echo "📦 Deploying OCR processor..."
$WRANGLER deploy --config wrangler.ocr-processor.toml

echo "📦 Deploying entity extractor..."
$WRANGLER deploy --config wrangler.entity-extractor.toml

echo "📦 Deploying Argilla sync..."
$WRANGLER deploy --config wrangler.argilla-sync.toml

echo "✅ All workers deployed successfully!"
echo ""
echo "📊 Next steps:"
echo "  1. Test upload: curl -X POST https://vessel-ner-pipeline.your-subdomain.workers.dev/upload -F 'pdf=@test.pdf'"
echo "  2. Monitor logs: pnpm exec wrangler tail vessel-ner-pipeline"
echo "  3. Check queues: pnpm exec wrangler queues list"
