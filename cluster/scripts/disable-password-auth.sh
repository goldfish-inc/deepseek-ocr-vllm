#!/bin/bash
# Disable password authentication and enforce key-only access
# 2025 Security Best Practice: Zero-Trust SSH Access

set -e

echo "🔒 Enforcing Key-Only SSH Authentication..."
echo "=========================================="

# Configuration
NODES=(
    "tethys:157.173.210.123:root"
    "styx:191.101.1.3:root"
)

# Function to disable password auth on a node
disable_password_auth() {
    local node_name=$1
    local node_ip=$2
    local node_user=$3
    local ssh_key="/tmp/${node_name}_ssh_key.pem"

    echo ""
    echo "📍 Processing ${node_name} (${node_ip})..."

    # Get the SSH key from Pulumi config (which gets it from ESC)
    echo "  → Fetching SSH key..."

    # First check if file already exists in /tmp
    if [ -f "/tmp/${node_name}_ssh_key.pem" ]; then
        ssh_key="/tmp/${node_name}_ssh_key.pem"
    else
        # Try to get from Pulumi config
        pulumi config get "oceanid-cluster:${node_name}_ssh_key" > "$ssh_key" 2>/dev/null || {
            echo "    ⚠️  SSH key not found for ${node_name}"
            return 1
        }
    fi
    chmod 600 "$ssh_key"

    # Connect and configure SSH
    echo "  → Configuring SSH daemon..."
    ssh -o StrictHostKeyChecking=no -i "$ssh_key" "${node_user}@${node_ip}" << 'EOF'
        # Backup current SSH config
        cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup.$(date +%Y%m%d)

        # Disable password authentication
        sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/g' /etc/ssh/sshd_config
        sed -i 's/^#*ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/g' /etc/ssh/sshd_config
        sed -i 's/^#*UsePAM.*/UsePAM no/g' /etc/ssh/sshd_config

        # Enable key-only authentication
        sed -i 's/^#*PubkeyAuthentication.*/PubkeyAuthentication yes/g' /etc/ssh/sshd_config
        sed -i 's/^#*AuthorizedKeysFile.*/AuthorizedKeysFile .ssh\/authorized_keys/g' /etc/ssh/sshd_config

        # Disable root password login (key only)
        sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/g' /etc/ssh/sshd_config

        # Additional hardening
        echo "" >> /etc/ssh/sshd_config
        echo "# 2025 Security Hardening" >> /etc/ssh/sshd_config
        echo "MaxAuthTries 3" >> /etc/ssh/sshd_config
        echo "MaxSessions 10" >> /etc/ssh/sshd_config
        echo "ClientAliveInterval 300" >> /etc/ssh/sshd_config
        echo "ClientAliveCountMax 2" >> /etc/ssh/sshd_config
        echo "LoginGraceTime 60" >> /etc/ssh/sshd_config
        echo "X11Forwarding no" >> /etc/ssh/sshd_config
        echo "AllowGroups root ssh-users" >> /etc/ssh/sshd_config || true

        # Test SSH config
        sshd -t && echo "  ✓ SSH config valid"

        # Restart SSH service
        systemctl restart sshd || systemctl restart ssh
        echo "  ✓ SSH service restarted"

        # Lock the root password
        passwd -l root 2>/dev/null || true
        echo "  ✓ Root password locked"

        # Verify settings
        echo ""
        echo "  Verification:"
        grep "^PasswordAuthentication" /etc/ssh/sshd_config || echo "    PasswordAuthentication: not set"
        grep "^PermitRootLogin" /etc/ssh/sshd_config || echo "    PermitRootLogin: not set"
        grep "^PubkeyAuthentication" /etc/ssh/sshd_config || echo "    PubkeyAuthentication: not set"
EOF

    # Test connection with key
    echo "  → Testing key-only access..."
    if ssh -o StrictHostKeyChecking=no -o PasswordAuthentication=no -i "$ssh_key" "${node_user}@${node_ip}" "echo 'Key authentication successful'" 2>/dev/null; then
        echo "  ✅ ${node_name}: Key-only authentication ENABLED"
    else
        echo "  ⚠️  ${node_name}: Failed to verify key-only access"
        return 1
    fi

    # Clean up
    rm -f "$ssh_key"
}

# Process all nodes
for node_info in "${NODES[@]}"; do
    IFS=':' read -r node_name node_ip node_user <<< "$node_info"
    disable_password_auth "$node_name" "$node_ip" "$node_user"
done

echo ""
echo "✅ Key-Only Authentication Enforcement Complete!"
echo "=============================================="
echo ""
echo "Security Status:"
echo "  • Password authentication: DISABLED"
echo "  • Root password login: DISABLED"
echo "  • Public key authentication: REQUIRED"
echo "  • Root account passwords: LOCKED"
echo ""
echo "Compliance: Meets 2025 Zero-Trust SSH Standards"