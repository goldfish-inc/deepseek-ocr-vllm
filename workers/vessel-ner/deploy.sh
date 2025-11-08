#!/bin/bash
# Deploy Vessel NER Pipeline Workers
set -e

echo "🚀 Deploying Vessel NER Pipeline..."

# Deploy main worker (HTTP handlers)
echo "📦 Deploying main worker..."
wrangler deploy --config wrangler.toml

# Deploy queue consumers
echo "📦 Deploying OCR processor..."
wrangler deploy --config wrangler.ocr-processor.toml

echo "📦 Deploying entity extractor..."
wrangler deploy --config wrangler.entity-extractor.toml

echo "📦 Deploying Argilla sync..."
wrangler deploy --config wrangler.argilla-sync.toml

echo "✅ All workers deployed successfully!"
echo ""
echo "📊 Next steps:"
echo "  1. Test upload: curl -X POST https://vessel-ner-pipeline.your-subdomain.workers.dev/upload -F 'pdf=@test.pdf'"
echo "  2. Monitor logs: wrangler tail vessel-ner-pipeline"
echo "  3. Check queues: wrangler queues list"
