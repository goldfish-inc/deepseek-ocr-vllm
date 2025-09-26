#!/bin/bash
# Script to rotate k3s token and sync between ESC and 1Password
set -e

echo "🔄 K3s Token Rotation Script"
echo "============================"

# Configuration
MASTER_IP="157.173.210.123"
MASTER_SSH_KEY="$HOME/.ssh/oceanid/tethys_key"
OP_ITEM_ID="c5s7qr6dvpzqpluqok2a7gfmzu"
ESC_ENV="default/oceanid-cluster"

# Step 1: Generate new token on master
echo "📝 Generating new k3s token on master..."
NEW_TOKEN=$(ssh -i $MASTER_SSH_KEY root@$MASTER_IP "
    # Generate new random token
    NEW_TOKEN=\"K10\$(openssl rand -hex 32)::server:\$(openssl rand -hex 16)\"

    # Update the token file
    echo \$NEW_TOKEN | sudo tee /var/lib/rancher/k3s/server/token > /dev/null

    # Restart k3s server to apply new token
    sudo systemctl restart k3s

    # Wait for k3s to be ready
    sleep 10

    # Return the new token
    echo \$NEW_TOKEN
")

if [ -z "$NEW_TOKEN" ]; then
    echo "❌ Failed to generate new token"
    exit 1
fi

echo "✅ New token generated: ${NEW_TOKEN:0:20}..."

# Step 2: Update Pulumi ESC
echo "📤 Updating Pulumi ESC..."
esc env set $ESC_ENV k3s.token "$NEW_TOKEN" --secret
esc env set $ESC_ENV k3s.token_rotated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Step 3: Update 1Password
echo "🔐 Updating 1Password..."
op item edit $OP_ITEM_ID --vault Infrastructure \
    "k3s.token[text]=$NEW_TOKEN" \
    "k3s.token_rotated[text]=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Step 4: Update Pulumi config
echo "📦 Updating Pulumi configuration..."
cd /Users/rt/Developer/oceanid/cluster
pulumi config set k3s_token "$NEW_TOKEN" --secret

# Step 5: Update worker nodes
echo "🔄 Updating worker nodes..."
WORKER_NODES=("191.101.1.3" "192.168.2.80")
WORKER_KEYS=("$HOME/.ssh/oceanid/styx_key" "$HOME/.ssh/oceanid/calypso_key")
WORKER_USERS=("root" "oceanid")

for i in ${!WORKER_NODES[@]}; do
    NODE_IP=${WORKER_NODES[$i]}
    NODE_KEY=${WORKER_KEYS[$i]}
    NODE_USER=${WORKER_USERS[$i]}

    echo "  Updating node $NODE_IP..."
    ssh -i $NODE_KEY $NODE_USER@$NODE_IP "
        sudo sed -i \"s/K3S_TOKEN=.*/K3S_TOKEN='$NEW_TOKEN'/\" /etc/systemd/system/k3s-agent.service.env
        sudo systemctl daemon-reload
        sudo systemctl restart k3s-agent
    " || echo "  ⚠️  Failed to update $NODE_IP - manual intervention required"
done

# Step 6: Verify cluster health
echo "🏥 Verifying cluster health..."
export KUBECONFIG="/Users/rt/Developer/oceanid/cluster/kubeconfig.yaml"
sleep 30  # Wait for nodes to reconnect

NODES_STATUS=$(kubectl get nodes --no-headers | awk '{print $1": "$2}')
echo "$NODES_STATUS"

# Check if all nodes are Ready
if echo "$NODES_STATUS" | grep -v "Ready" | grep -q ":"; then
    echo "⚠️  Some nodes are not ready. Please check manually."
else
    echo "✅ All nodes are ready!"
fi

echo ""
echo "🎉 Token rotation complete!"
echo "Next rotation recommended in 90 days: $(date -v +90d +%Y-%m-%d)"