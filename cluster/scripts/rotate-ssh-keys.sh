#!/bin/bash
# Automatic SSH Key Rotation Script
# Rotates SSH keys every 90 days (industry best practice)

set -e

echo "🔄 Starting SSH Key Rotation..."
echo "================================"

# Configuration
ROTATION_DAYS=90
KEY_TYPE="ed25519"
BACKUP_DIR="/tmp/ssh-key-backup-$(date +%Y%m%d-%H%M%S)"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Function to generate new SSH key
generate_ssh_key() {
    local node_name=$1
    local key_path="/tmp/${node_name}_new_key"

    echo "  → Generating new ${KEY_TYPE} key for ${node_name}..."
    ssh-keygen -t ${KEY_TYPE} -f "$key_path" -N "" -C "${node_name}-oceanid-$(date +%Y%m%d)" -q

    echo "$key_path"
}

# Function to deploy key to node
deploy_key_to_node() {
    local node_name=$1
    local node_ip=$2
    local new_key_path=$3
    local old_key_path="/tmp/${node_name}_ssh_key.pem"

    echo "  → Deploying new key to ${node_name} (${node_ip})..."

    # First, add new key using old key
    ssh -o StrictHostKeyChecking=no -i "$old_key_path" root@"$node_ip" "
        # Add new public key
        echo '$(cat ${new_key_path}.pub)' >> ~/.ssh/authorized_keys

        # Remove duplicates and sort
        sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys

        # Ensure proper permissions
        chmod 700 ~/.ssh
        chmod 600 ~/.ssh/authorized_keys

        echo 'New key deployed successfully'
    "

    # Test new key
    echo "  → Testing new key..."
    if ssh -o StrictHostKeyChecking=no -i "$new_key_path" root@"$node_ip" "echo 'New key works'" &>/dev/null; then
        echo "    ✓ New key verified"

        # Remove old key
        echo "  → Removing old key from ${node_name}..."
        local old_pub_key
        old_pub_key=$(ssh-keygen -y -f "$old_key_path" 2>/dev/null)
        ssh -i "$new_key_path" root@"$node_ip" "
            grep -v '$old_pub_key' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp
            mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys
            chmod 600 ~/.ssh/authorized_keys
        "
        return 0
    else
        echo "    ✗ New key failed - keeping old key"
        return 1
    fi
}

# Get current keys from ESC for backup
echo "📦 Backing up current keys..."
esc env get default/oceanid-cluster | grep -A1 "tethys_private_key_base64" | tail -1 | tr -d ' ' | base64 -d > "$BACKUP_DIR/tethys_old.pem"
esc env get default/oceanid-cluster | grep -A1 "styx_private_key_base64" | tail -1 | tr -d ' ' | base64 -d > "$BACKUP_DIR/styx_old.pem"
esc env get default/oceanid-cluster | grep -A1 "calypso_private_key_base64" | tail -1 | tr -d ' ' | base64 -d > "$BACKUP_DIR/calypso_old.pem"

# Copy to temp for use
cp "$BACKUP_DIR/tethys_old.pem" /tmp/tethys_ssh_key.pem
cp "$BACKUP_DIR/styx_old.pem" /tmp/styx_ssh_key.pem
cp "$BACKUP_DIR/calypso_old.pem" /tmp/calypso_ssh_key.pem
chmod 600 /tmp/*_ssh_key.pem

echo ""
echo "🔑 Generating new SSH keys..."

# Generate new keys
TETHYS_NEW=$(generate_ssh_key "tethys")
STYX_NEW=$(generate_ssh_key "styx")
CALYPSO_NEW=$(generate_ssh_key "calypso")

echo ""
echo "🚀 Deploying new keys to nodes..."

# Deploy keys to nodes
deploy_key_to_node "tethys" "157.173.210.123" "$TETHYS_NEW" || exit 1
deploy_key_to_node "styx" "191.101.1.3" "$STYX_NEW" || exit 1
# Note: Calypso uses different user and might be offline
# deploy_key_to_node "calypso" "192.168.2.68" "$CALYPSO_NEW" || echo "Warning: Calypso rotation skipped"

echo ""
echo "📝 Updating ESC with new keys..."

# Update ESC with new keys
TETHYS_KEY_B64=$(base64 < "${TETHYS_NEW}" | tr -d '\n')
STYX_KEY_B64=$(base64 < "${STYX_NEW}" | tr -d '\n')
CALYPSO_KEY_B64=$(base64 < "${CALYPSO_NEW}" | tr -d '\n')

esc env set default/oceanid-cluster "ssh.tethys_private_key_base64" "$TETHYS_KEY_B64" --secret
esc env set default/oceanid-cluster "ssh.styx_private_key_base64" "$STYX_KEY_B64" --secret
esc env set default/oceanid-cluster "ssh.calypso_private_key_base64" "$CALYPSO_KEY_B64" --secret

# Store rotation metadata
ROTATION_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
esc env set default/oceanid-cluster "ssh.last_rotation" "$ROTATION_DATE" --plaintext
esc env set default/oceanid-cluster "ssh.next_rotation" "$(date -u -d "+${ROTATION_DAYS} days" +"%Y-%m-%dT%H:%M:%SZ")" --plaintext
esc env set default/oceanid-cluster "ssh.rotation_interval_days" "$ROTATION_DAYS" --plaintext

echo ""
echo "✅ SSH Key Rotation Complete!"
echo "================================"
echo "Backup location: $BACKUP_DIR"
echo "Next rotation: $(date -d "+${ROTATION_DAYS} days" +"%Y-%m-%d")"
echo ""
echo "To verify: ssh -i ${TETHYS_NEW} root@157.173.210.123 'hostname'"
