#!/usr/bin/env bash
set -euo pipefail

# Cancel stuck Pulumi update lock
# Run this when deployments fail with "Another update is currently in progress"

STACK="${1:-ryan-taylor/oceanid-cluster/prod}"

echo "🔓 Canceling stuck Pulumi update for stack: $STACK"
echo ""

cd "$(dirname "$0")/.."

# Check if we have access to Pulumi
if ! command -v pulumi &> /dev/null; then
  echo "❌ pulumi CLI not found"
  echo "Install: curl -fsSL https://get.pulumi.com | sh"
  exit 1
fi

# Check if we're logged in
if ! pulumi whoami &> /dev/null; then
  echo "❌ Not logged in to Pulumi"
  echo "Run: pulumi login"
  exit 1
fi

# Cancel the update
echo "Canceling update..."
pulumi cancel --stack "$STACK" --yes || {
  echo ""
  echo "⚠️  Cancel failed. Possible reasons:"
  echo "  - No update is actually in progress"
  echo "  - Update already completed"
  echo "  - Permission issue"
  echo ""
  echo "Check stack status:"
  echo "  pulumi stack --stack $STACK"
  exit 1
}

echo ""
echo "✅ Lock canceled successfully"
echo ""
echo "You can now trigger a new deployment:"
echo "  gh workflow run cluster-selfhosted.yml --ref main"
