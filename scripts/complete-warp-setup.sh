#!/usr/bin/env bash
# Complete Cloudflare WARP setup for kubectl access
# Run this after installing WARP client and enrolling your device

set -euo pipefail

echo "🔧 Cloudflare WARP Setup - Final Steps"
echo "========================================"
echo ""

# Check if WARP is installed
if ! [ -d "/Applications/Cloudflare WARP.app" ]; then
    echo "❌ WARP client not installed"
    echo ""
    echo "Install with:"
    echo "  brew install --cask cloudflare-warp"
    echo ""
    echo "Then open the app and:"
    echo "  1. Settings → Account → Login with Cloudflare Zero Trust"
    echo "  2. Enter your team name from: https://one.dash.cloudflare.com/"
    echo "  3. Authenticate with: ryan@goldfish.io"
    echo "  4. Set mode to: Gateway with WARP"
    echo "  5. Verify status: Connected"
    echo ""
    exit 1
fi

# Check if WARP CLI is available
if command -v warp-cli &> /dev/null; then
    WARP_STATUS=$(warp-cli status 2>&1 || echo "disconnected")
    echo "📡 WARP Status: $WARP_STATUS"

    if echo "$WARP_STATUS" | grep -q "Connected"; then
        echo "✅ WARP is connected"
    else
        echo "⚠️  WARP is not connected"
        echo "Open Cloudflare WARP app and ensure it's in 'Gateway with WARP' mode"
        echo ""
    fi
else
    echo "ℹ️  WARP CLI not found (this is optional)"
    echo "Assuming WARP app is managing connection"
    echo ""
fi

# Verify kubeconfig exists
if [ ! -f "$HOME/.kube/k3s-warp.yaml" ]; then
    echo "❌ WARP kubeconfig not found at ~/.kube/k3s-warp.yaml"
    echo ""
    echo "This should have been created automatically. Creating it now..."
    cp "$HOME/.kube/k3s-config.yaml" "$HOME/.kube/k3s-warp.yaml"
    kubectl config set-cluster default --server=https://10.43.0.1:443 --kubeconfig="$HOME/.kube/k3s-warp.yaml"
    echo "✅ Created ~/.kube/k3s-warp.yaml"
    echo ""
fi

# Show kubeconfig server
SERVER_URL=$(kubectl config view --kubeconfig="$HOME/.kube/k3s-warp.yaml" --minify -o jsonpath='{.clusters[0].cluster.server}')
echo "📝 Kubeconfig server: $SERVER_URL"

if [ "$SERVER_URL" != "https://10.43.0.1:443" ]; then
    echo "❌ Incorrect server URL!"
    echo "Expected: https://10.43.0.1:443"
    echo "Got: $SERVER_URL"
    exit 1
fi

echo ""
echo "✅ Kubeconfig is correctly configured"
echo ""

# Test kubectl access
echo "🧪 Testing kubectl access..."
echo ""

export KUBECONFIG="$HOME/.kube/k3s-warp.yaml"

if kubectl get nodes &>/dev/null; then
    echo "✅ SUCCESS! kubectl is working via WARP"
    echo ""
    kubectl get nodes
    echo ""
    echo "🎉 WARP setup complete!"
    echo ""
    echo "To make this permanent, add to ~/.zshrc:"
    echo '  export KUBECONFIG="$HOME/.kube/k3s-warp.yaml"'
    echo ""
    echo "Aliases for switching:"
    echo '  alias kube-warp="export KUBECONFIG=$HOME/.kube/k3s-warp.yaml"'
    echo '  alias kube-ssh="export KUBECONFIG=$HOME/.kube/k3s-config.yaml"'
    echo ""
    echo "Next: Verify Label Studio deployment"
    echo "  kubectl get helmrelease -n apps"
    echo "  kubectl get pods -n apps"
    echo ""
else
    echo "❌ kubectl failed to connect"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Verify WARP is connected (check app status)"
    echo "  2. Check private network routes in Zero Trust dashboard:"
    echo "     https://one.dash.cloudflare.com/ → Networks → Routes"
    echo "  3. Verify split tunnels include:"
    echo "     - 10.42.0.0/16"
    echo "     - 10.43.0.0/16"
    echo "     - 192.168.2.0/24"
    echo "  4. Check logs:"
    echo "     kubectl get nodes -v=8"
    echo ""
    exit 1
fi
