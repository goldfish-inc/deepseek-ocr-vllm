#!/bin/bash
set -e

echo "🔐 Migrating SSH keys to Pulumi ESC..."

# Base64 encode the SSH keys for safe transport
TETHYS_KEY_B64=$(base64 < /tmp/tethys_ssh_key.pem | tr -d '\n')
STYX_KEY_B64=$(base64 < /tmp/styx_ssh_key.pem | tr -d '\n')
CALYPSO_KEY_B64=$(base64 < /tmp/calypso_ssh_key.pem | tr -d '\n')

# Set each key individually in ESC
echo "  → Setting tethys SSH key in ESC..."
esc env set default/oceanid-cluster "ssh.tethys_private_key_base64" "$TETHYS_KEY_B64" --secret

echo "  → Setting styx SSH key in ESC..."
esc env set default/oceanid-cluster "ssh.styx_private_key_base64" "$STYX_KEY_B64" --secret

echo "  → Setting calypso SSH key in ESC..."
esc env set default/oceanid-cluster "ssh.calypso_private_key_base64" "$CALYPSO_KEY_B64" --secret

# Update the Pulumi config mappings
echo "  → Updating Pulumi config mappings..."
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:tethysIp" '${cluster.tethys_ip}' --plaintext
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:styxIp" '${cluster.styx_ip}' --plaintext
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:k3s_token" '${k3s.token}' --plaintext
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:k3s_server_url" '${k3s.server_url}' --plaintext

# Map the base64 keys to decoded versions for Pulumi
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:tethys_ssh_key" '${fn::fromBase64(ssh.tethys_private_key_base64)}' --plaintext
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:styx_ssh_key" '${fn::fromBase64(ssh.styx_private_key_base64)}' --plaintext
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:calypso_ssh_key" '${fn::fromBase64(ssh.calypso_private_key_base64)}' --plaintext

echo "✅ SSH keys successfully migrated to ESC!"
echo ""
echo "To verify the configuration:"
echo "  esc env get default/oceanid-cluster"
echo ""
echo "To rotate keys in the future:"
echo "  1. Generate new SSH keys"
echo "  2. Update them in ESC using this script"
echo "  3. Deploy to nodes with: pulumi up"
