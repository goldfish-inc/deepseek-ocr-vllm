#!/bin/bash
# Setup Cloudflare WARP on calypso for bidirectional connectivity

echo "Installing Cloudflare WARP on calypso..."

# Add Cloudflare GPG key
curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | sudo gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg

# Add repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflare-client.list

# Update and install
sudo apt-get update
sudo apt-get install -y cloudflare-warp

# Register and connect
warp-cli register
warp-cli set-mode warp+doh
warp-cli set-families-mode off
warp-cli connect

# Verify connection
warp-cli warp-stats

echo "WARP installed. Checking connectivity..."
curl -s https://www.cloudflare.com/cdn-cgi/trace/ | grep warp

# Configure K3s to use WARP DNS
echo "Configuring K3s to use WARP DNS..."
sudo tee /etc/systemd/resolved.conf.d/cloudflare.conf <<EOF
[Resolve]
DNS=1.1.1.1
FallbackDNS=1.0.0.1
Domains=~.
EOF

sudo systemctl restart systemd-resolved

echo "Setup complete! Calypso now has bidirectional connectivity through Cloudflare."