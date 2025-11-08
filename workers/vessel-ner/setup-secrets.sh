#!/bin/bash
# Setup secrets from Pulumi ESC to Wrangler
set -e

echo "🔐 Setting up secrets from Pulumi ESC..."

cd /Users/rt/Developer/oceanid

# Get secrets from Pulumi ESC
echo "📥 Fetching secrets from Pulumi ESC..."
MOTHERDUCK_TOKEN=$(pulumi config get --cwd cloud oceanid-cloud:motherduckToken)
CLAUDE_API_KEY=$(pulumi config get --cwd cloud claudeApiKey)
HF_TOKEN=$(pulumi config get --cwd cloud oceanid-cluster:huggingFaceToken)
ARGILLA_API_KEY=$(pulumi config get --cwd cloud argillaApiKey)

cd workers/vessel-ner

# Set secrets for main worker
echo "🔑 Setting secrets for vessel-ner-pipeline..."
echo "$MOTHERDUCK_TOKEN" | wrangler secret put MOTHERDUCK_TOKEN --name vessel-ner-pipeline
echo "$CLAUDE_API_KEY" | wrangler secret put ANTHROPIC_API_KEY --name vessel-ner-pipeline
echo "$HF_TOKEN" | wrangler secret put HF_TOKEN --name vessel-ner-pipeline
echo "$ARGILLA_API_KEY" | wrangler secret put ARGILLA_API_KEY --name vessel-ner-pipeline

# Set secrets for OCR processor
echo "🔑 Setting secrets for vessel-ner-ocr-processor..."
echo "$MOTHERDUCK_TOKEN" | wrangler secret put MOTHERDUCK_TOKEN --name vessel-ner-ocr-processor
echo "$HF_TOKEN" | wrangler secret put HF_TOKEN --name vessel-ner-ocr-processor

# Set secrets for entity extractor
echo "🔑 Setting secrets for vessel-ner-entity-extractor..."
echo "$MOTHERDUCK_TOKEN" | wrangler secret put MOTHERDUCK_TOKEN --name vessel-ner-entity-extractor
echo "$CLAUDE_API_KEY" | wrangler secret put ANTHROPIC_API_KEY --name vessel-ner-entity-extractor

# Set secrets for Argilla sync
echo "🔑 Setting secrets for vessel-ner-argilla-sync..."
echo "$MOTHERDUCK_TOKEN" | wrangler secret put MOTHERDUCK_TOKEN --name vessel-ner-argilla-sync
echo "$ARGILLA_API_KEY" | wrangler secret put ARGILLA_API_KEY --name vessel-ner-argilla-sync

echo "✅ All secrets configured!"
