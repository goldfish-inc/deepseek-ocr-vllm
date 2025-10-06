#!/usr/bin/env bash
# Create Pulumi Deployments agent pool via REST API and store token in ESC
#
# Requirements:
# - 1Password CLI authenticated (op)
# - Pulumi CLI installed
# - jq installed

set -euo pipefail

ORG_NAME="ryan-taylor"
POOL_NAME="oceanid-cluster"
POOL_DESC="Self-hosted agent for oceanid-cluster stack with kubeconfig access"

echo "🔧 Creating Pulumi Deployments agent pool: ${POOL_NAME}"

# Get Pulumi access token from environment or 1Password
if [[ -z "${PULUMI_ACCESS_TOKEN:-}" ]]; then
    echo "📦 Retrieving Pulumi access token from 1Password..."
    PULUMI_ACCESS_TOKEN=$(op read "op://Infrastructure/Pulumi Cloud API Token/credential" 2>/dev/null || echo "")

    if [[ -z "$PULUMI_ACCESS_TOKEN" ]]; then
        echo "❌ Error: PULUMI_ACCESS_TOKEN not set and not found in 1Password"
        echo ""
        echo "Please authenticate 1Password CLI:"
        echo "  eval \$(op signin)"
        echo ""
        echo "Or set PULUMI_ACCESS_TOKEN environment variable:"
        echo "  export PULUMI_ACCESS_TOKEN=pul-..."
        exit 1
    fi
fi

echo "✅ Pulumi access token retrieved"

# Create agent pool via REST API
echo "🚀 Creating agent pool via Pulumi Cloud API..."

# Note: The Pulumi Service REST API endpoint for creating agent pools
# is not publicly documented yet. Using pulumi-service provider approach instead.
echo ""
echo "⚠️  Pulumi Cloud REST API for agent pools is not publicly available yet."
echo ""
echo "Please create agent pool manually:"
echo "  1. Visit: https://app.pulumi.com/${ORG_NAME}/settings/agents/pools"
echo "  2. Click 'Create new pool'"
echo "  3. Name: ${POOL_NAME}"
echo "  4. Description: ${POOL_DESC}"
echo "  5. Copy the generated token"
echo ""
echo "Then run this command to store token in ESC:"
echo "  esc env set default/oceanid-cluster \"pulumi.agentToken\" \"pul-...\""
echo ""
echo "After storing token, run:"
echo "  ./scripts/setup-agent.sh"
exit 1
