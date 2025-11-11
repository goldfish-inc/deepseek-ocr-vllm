#!/bin/bash
set -euo pipefail

# DGX Spark Cloudflare Tunnel Deployment Script
# Deploys cloudflared systemd service to DGX Spark

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARK_HOST="spark-291b"
SPARK_USER="sparky"

echo "🚀 Deploying Cloudflare Tunnel to DGX Spark..."

# Get tunnel token from Pulumi ESC
echo "📦 Retrieving tunnel token from Pulumi ESC..."
TUNNEL_TOKEN=$(pulumi config get dgx-spark:cloudflareTunnelToken --cwd "${SCRIPT_DIR}/../../cloud")

if [ -z "$TUNNEL_TOKEN" ]; then
  echo "❌ Error: Tunnel token not found in Pulumi config"
  echo "Run: pulumi config set --secret dgx-spark:cloudflareTunnelToken <token>"
  exit 1
fi

# Create temporary service file with token
TEMP_SERVICE=$(mktemp)
trap 'rm -f "$TEMP_SERVICE"' EXIT

cat > "$TEMP_SERVICE" <<EOF
[Unit]
Description=Cloudflare Tunnel - DGX Spark Ollama API
After=network.target
Documentation=https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

[Service]
Type=simple
User=${SPARK_USER}
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
Restart=always
RestartSec=5s

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
EOF

# Copy service file to Spark
echo "📤 Copying systemd service to ${SPARK_HOST}..."
scp "$TEMP_SERVICE" "${SPARK_HOST}:/tmp/cloudflared.service"

# Install and enable service
echo "⚙️  Installing and enabling service..."
ssh "${SPARK_HOST}" << 'ENDSSH'
  set -euo pipefail

  # Install service
  sudo mv /tmp/cloudflared.service /etc/systemd/system/

  # Reload systemd
  sudo systemctl daemon-reload

  # Enable and start service
  sudo systemctl enable cloudflared
  sudo systemctl restart cloudflared

  # Wait for service to start
  sleep 3

  # Check status
  sudo systemctl status cloudflared --no-pager | head -20
ENDSSH

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Verification:"
echo "  SSH: ssh ${SPARK_HOST} 'systemctl status cloudflared'"
echo "  Logs: ssh ${SPARK_HOST} 'journalctl -u cloudflared -f'"
echo "  Test: curl -s http://localhost:11434/api/tags | jq"
