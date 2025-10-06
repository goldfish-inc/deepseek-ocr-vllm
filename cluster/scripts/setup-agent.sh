#!/usr/bin/env bash
# Setup Pulumi Deployments agent on tethys
#
# Usage:
#   1. Create agent token in Pulumi Cloud UI:
#      https://app.pulumi.com/ryan-taylor/settings/agents/pools
#   2. Store token in ESC: esc env set default/oceanid-cluster "pulumi.agentToken" "pul-..."
#   3. Run this script: ./setup-agent.sh

set -euo pipefail

echo "🔧 Setting up Pulumi Deployments agent on tethys..."

# Get agent token from ESC
echo "📦 Retrieving agent token from ESC..."
AGENT_TOKEN=$(esc env get default/oceanid-cluster --value "pulumi.agentToken" 2>/dev/null || echo "")

if [[ -z "$AGENT_TOKEN" ]]; then
    echo "❌ Error: Agent token not found in ESC"
    echo ""
    echo "Please create agent token and store in ESC:"
    echo "  1. Create token: https://app.pulumi.com/ryan-taylor/settings/agents/pools"
    echo "  2. Store in ESC: esc env set default/oceanid-cluster \"pulumi.agentToken\" \"pul-...\""
    exit 1
fi

echo "✅ Agent token retrieved from ESC"

# SSH to tethys and install agent
echo "🚀 Deploying agent to tethys..."

ssh tethys bash << 'REMOTE_SCRIPT'
set -euo pipefail

echo "📥 Installing Pulumi Deployments agent..."

# Download and install agent
curl -fsSL https://get.pulumi.com/releases/plugins/pulumi-resource-deployment-agent-v0.0.40-linux-amd64.tar.gz \
    | sudo tar -xz -C /usr/local/bin

# Create systemd service
sudo tee /etc/systemd/system/pulumi-agent.service > /dev/null << 'SERVICE'
[Unit]
Description=Pulumi Deployments Agent
After=network.target

[Service]
Type=simple
User=rt
Environment="PULUMI_ACCESS_TOKEN=AGENT_TOKEN_PLACEHOLDER"
Environment="PULUMI_AGENT_POOL_ID=oceanid-cluster"
ExecStart=/usr/local/bin/pulumi-deployment-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

echo "✅ Agent service file created"
REMOTE_SCRIPT

# Update service file with actual token via SSH
echo "🔑 Configuring agent token..."
ssh tethys "sudo sed -i 's|AGENT_TOKEN_PLACEHOLDER|${AGENT_TOKEN}|g' /etc/systemd/system/pulumi-agent.service"

# Start agent
echo "▶️  Starting agent service..."
ssh tethys bash << 'START_SCRIPT'
set -euo pipefail
sudo systemctl daemon-reload
sudo systemctl enable pulumi-agent.service
sudo systemctl start pulumi-agent.service
sudo systemctl status pulumi-agent.service --no-pager
START_SCRIPT

echo ""
echo "✅ Pulumi Deployments agent setup complete!"
echo ""
echo "Next steps:"
echo "  1. Verify agent is online: https://app.pulumi.com/ryan-taylor/settings/agents"
echo "  2. Check agent logs: ssh tethys sudo journalctl -u pulumi-agent.service -f"
echo "  3. Trigger deployment: git push (triggers Pulumi Deployments run)"
