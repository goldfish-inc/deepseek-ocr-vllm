#!/bin/bash
# Script to sync credentials between Pulumi ESC and 1Password
set -e

echo "🔄 Credential Sync: ESC ↔️ 1Password"
echo "===================================="

# 1Password item IDs
OP_ITEM_TETHYS="c5s7qr6dvpzqpluqok2a7gfmzu"
OP_ITEM_STYX="6c75oaaly7mgfdme35gwwpakhq"

# Function to get value from ESC
get_esc_value() {
    local path=$1
    esc env get default/oceanid-cluster | grep -A1 "^  $path:" | tail -1 | sed 's/.*: //' | tr -d '"'
}

# Function to get value from 1Password
get_op_value() {
    local item_id=$1
    local field=$2
    op item get $item_id --vault Infrastructure --fields "label=$field" --reveal 2>/dev/null || echo ""
}

# Step 1: Get k3s token from ESC (source of truth)
echo "📥 Getting k3s token from ESC..."
K3S_TOKEN=$(esc env get default/oceanid-cluster | grep -A2 'k3s:' | grep -A1 'token:' | grep 'ciphertext:' | head -1 | sed 's/.*ciphertext: //')

if [ -z "$K3S_TOKEN" ]; then
    # Token is not encrypted, get it directly
    K3S_TOKEN=$(ssh -i /tmp/tethys_new_key root@157.173.210.123 "cat /var/lib/rancher/k3s/server/node-token")
    echo "  Got token from master node"
fi

# Step 2: Sync to 1Password
echo "🔐 Syncing to 1Password..."

# Update tethys with k3s token
echo "  Updating tethys (${OP_ITEM_TETHYS:0:8}...)"
op item edit $OP_ITEM_TETHYS --vault Infrastructure \
    "k3s.token[text]=$K3S_TOKEN" \
    "k3s.last_sync[text]=$(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null || \
    echo "    ⚠️  Could not update k3s token"

# Update styx
echo "  Updating styx (${OP_ITEM_STYX:0:8}...)"
op item edit $OP_ITEM_STYX --vault Infrastructure \
    "k3s.last_sync[text]=$(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null || \
    echo "    ⚠️  Could not update styx"

# Step 3: Verify SSH keys are documented
echo "🔑 Verifying SSH keys..."
SSH_KEYS=(
    "tethys:cm2z67lskn7lddqgrghd7dvn6m"
    "styx:46scrxz74mmujzn7yuh2g7iisa"
)

for key_pair in "${SSH_KEYS[@]}"; do
    NODE="${key_pair%%:*}"
    KEY_ID="${key_pair##*:}"

    # Verify key exists in 1Password
    if op document get $KEY_ID --vault Infrastructure > /dev/null 2>&1; then
        echo "  ✅ $NODE SSH key verified: $KEY_ID"
    else
        echo "  ❌ $NODE SSH key missing: $KEY_ID"
    fi
done

# Step 4: Sync node information
echo "📊 Syncing node information..."
NODES=("tethys:157.173.210.123:srv712429" "styx:191.101.1.3:srv712695" "calypso:192.168.2.80:calypso")

for node_info in "${NODES[@]}"; do
    IFS=':' read -r NAME IP HOSTNAME <<< "$node_info"

    # Update ESC
    esc env set default/oceanid-cluster nodes.$NAME.ip "$IP" 2>/dev/null
    esc env set default/oceanid-cluster nodes.$NAME.hostname "$HOSTNAME" 2>/dev/null
    echo "  Updated $NAME in ESC"
done

# Step 5: Verify cluster connectivity
echo "🏥 Verifying cluster health..."
export KUBECONFIG="/Users/rt/Developer/oceanid/cluster/kubeconfig.yaml"

if kubectl get nodes --no-headers > /dev/null 2>&1; then
    NODE_COUNT=$(kubectl get nodes --no-headers | wc -l)
    READY_COUNT=$(kubectl get nodes --no-headers | grep " Ready" | wc -l)

    if [ "$NODE_COUNT" -eq "$READY_COUNT" ]; then
        echo "  ✅ All $NODE_COUNT nodes are ready"
    else
        echo "  ⚠️  Only $READY_COUNT of $NODE_COUNT nodes are ready"
    fi
else
    echo "  ❌ Cannot connect to cluster"
fi

# Step 6: Generate sync report
echo ""
echo "📋 Sync Report"
echo "=============="
echo "ESC Environment: default/oceanid-cluster"
echo "Last sync: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""
echo "Credentials synced:"
echo "  - k3s token: ${K3S_TOKEN:0:20}..."
echo "  - Master node: tethys (157.173.210.123)"
echo "  - Worker nodes: styx, calypso"
echo ""
echo "Next steps:"
echo "  - Run 'pulumi up' to apply any infrastructure changes"
echo "  - Rotate k3s token in 90 days using ./scripts/rotate-k3s-token.sh"
echo ""
echo "✅ Sync complete!"