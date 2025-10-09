#!/usr/bin/env bash
# Install Cloudflare WARP client and complete setup
# This script requires sudo access

set -euo pipefail

echo "🔧 Installing Cloudflare WARP Client"
echo "===================================="
echo ""
echo "This installation requires sudo password."
echo ""

# Install WARP client
echo "📦 Installing WARP client..."
brew install --cask cloudflare-warp

echo ""
echo "✅ WARP client installed!"
echo ""
echo "📱 Next Steps:"
echo ""
echo "1. Open the 'Cloudflare WARP' application from /Applications"
echo ""
echo "2. Initial setup:"
echo "   - Accept terms and conditions"
echo "   - Settings (gear icon) → Account → Login with Cloudflare Zero Trust"
echo ""
echo "3. Get your team name:"
echo "   - Visit: https://one.dash.cloudflare.com/"
echo "   - Look at the URL, it will be: https://<team-name>.cloudflareaccess.com/"
echo "   - Enter the <team-name> in WARP app"
echo ""
echo "4. Authenticate:"
echo "   - Email: ryan@goldfish.io"
echo "   - Complete email OTP authentication"
echo ""
echo "5. Configure mode:"
echo "   - In WARP app, set mode to: Gateway with WARP"
echo "   - NOT: 1.1.1.1 (consumer mode)"
echo "   - NOT: Gateway with DoH"
echo ""
echo "6. Verify connection:"
echo "   - Status should show: Connected"
echo "   - Green checkmark icon in menu bar"
echo ""
echo "7. Test kubectl access:"
echo "   cd ~/Developer/oceanid"
echo "   ./scripts/complete-warp-setup.sh"
echo ""
echo "Expected: kubectl works without SSH tunnel! 🎉"
echo ""
