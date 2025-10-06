#!/usr/bin/env bash
# Install GitHub self-hosted runner on tethys for oceanid cluster deployments
#
# Prerequisites:
# - Runner registration token from GitHub UI
# - SSH access to tethys
#
# Usage:
#   1. Get registration token from GitHub:
#      https://github.com/goldfish-inc/oceanid/settings/actions/runners/new
#   2. Run: ./scripts/setup-github-runner.sh <REGISTRATION_TOKEN>

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <REGISTRATION_TOKEN>"
    echo ""
    echo "Get token from: https://github.com/goldfish-inc/oceanid/settings/actions/runners/new"
    exit 1
fi

REGISTRATION_TOKEN="$1"
RUNNER_VERSION="2.328.0"

echo "🚀 Setting up GitHub self-hosted runner on tethys..."

# shellcheck disable=SC2087
ssh tethys bash <<EOF
set -euo pipefail

# Create runner directory
mkdir -p ~/actions-runner
cd ~/actions-runner

# Download runner
echo "📥 Downloading GitHub Actions runner ${RUNNER_VERSION}..."
curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz -L \
    https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# Extract
echo "📦 Extracting runner..."
tar xzf ./actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
rm ./actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# Configure runner
echo "⚙️  Configuring runner..."
./config.sh \\
    --url https://github.com/goldfish-inc/oceanid \\
    --token ${REGISTRATION_TOKEN} \\
    --name tethys \\
    --work _work \\
    --labels self-hosted,linux,x64 \\
    --unattended \\
    --replace

# Install as service
echo "🔧 Installing runner service..."
sudo ./svc.sh install

# Start service
echo "▶️  Starting runner service..."
sudo ./svc.sh start

# Check status
echo "📊 Runner status:"
sudo ./svc.sh status

echo ""
echo "✅ GitHub runner installed and started on tethys!"
echo ""
echo "Verify at: https://github.com/goldfish-inc/oceanid/settings/actions/runners"
EOF

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Verify runner is online: https://github.com/goldfish-inc/oceanid/settings/actions/runners"
echo "  2. Test deployment: gh workflow run cluster-selfhosted.yml"
echo "  3. Monitor: https://github.com/goldfish-inc/oceanid/actions/workflows/cluster-selfhosted.yml"
