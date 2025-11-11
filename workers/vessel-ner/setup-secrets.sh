#!/bin/bash
# Setup secrets from Pulumi ESC to Cloudflare Workers via Wrangler
set -euo pipefail

echo "🔐 Setting up secrets from Pulumi ESC..."

# Resolve repository root relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Get secrets from Pulumi ESC (expects Pulumi logged in and config available)
echo "📥 Fetching secrets from Pulumi ESC..."
MOTHERDUCK_TOKEN=$(pulumi config get --cwd "$ROOT_DIR/cloud" oceanid-cloud:motherduckToken)
HF_TOKEN=$(pulumi config get --cwd "$ROOT_DIR/cloud" oceanid-cluster:huggingFaceToken)
ARGILLA_API_KEY=$(pulumi config get --cwd "$ROOT_DIR/cloud" argillaApiKey)

cd "$SCRIPT_DIR"

# Use pnpm exec to ensure Wrangler resolves from workspace root
WRANGLER="pnpm exec wrangler"

# Set secrets for main worker
echo "🔑 Setting secrets for vessel-ner-pipeline..."
echo "$MOTHERDUCK_TOKEN" | $WRANGLER secret put MOTHERDUCK_TOKEN --name vessel-ner-pipeline
echo "$HF_TOKEN" | $WRANGLER secret put HF_TOKEN --name vessel-ner-pipeline
echo "$ARGILLA_API_KEY" | $WRANGLER secret put ARGILLA_API_KEY --name vessel-ner-pipeline

# Set secrets for OCR processor
echo "🔑 Setting secrets for vessel-ner-ocr-processor..."
echo "$MOTHERDUCK_TOKEN" | $WRANGLER secret put MOTHERDUCK_TOKEN --name vessel-ner-ocr-processor
echo "$HF_TOKEN" | $WRANGLER secret put HF_TOKEN --name vessel-ner-ocr-processor

# Set secrets for entity extractor
echo "🔑 Setting secrets for vessel-ner-entity-extractor..."
echo "$MOTHERDUCK_TOKEN" | $WRANGLER secret put MOTHERDUCK_TOKEN --name vessel-ner-entity-extractor

# Set secrets for Argilla sync
echo "🔑 Setting secrets for vessel-ner-argilla-sync..."
echo "$MOTHERDUCK_TOKEN" | $WRANGLER secret put MOTHERDUCK_TOKEN --name vessel-ner-argilla-sync
echo "$ARGILLA_API_KEY" | $WRANGLER secret put ARGILLA_API_KEY --name vessel-ner-argilla-sync

echo "✅ All secrets configured!"
