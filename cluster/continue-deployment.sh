#!/bin/bash
# Oceanid Cluster - Continue Deployment Script
# Run this after Talos servers are ready (usually 5-10 minutes after reboot)

echo "🌊 Oceanid Cluster Deployment Continuation Script"
echo "================================================"

# Configuration
TALOSCONFIG="./talos-configs/talosconfig"
TETHYS_IP="157.173.210.123"
STYX_IP="191.101.1.3"

# Step 1: Check if servers are ready
echo "1️⃣ Checking if servers are ready..."
nc -zv -w 5 $TETHYS_IP 50000 2>&1 | grep -q succeeded && echo "✅ tethys ready" || echo "❌ tethys not ready"
nc -zv -w 5 $STYX_IP 50000 2>&1 | grep -q succeeded && echo "✅ styx ready" || echo "❌ styx not ready"

# Step 2: Apply configurations
echo "2️⃣ Applying Talos configurations..."
talosctl --talosconfig $TALOSCONFIG apply-config --insecure --nodes $TETHYS_IP --file ./talos-configs/controlplane.yaml
talosctl --talosconfig $TALOSCONFIG apply-config --insecure --nodes $STYX_IP --file ./talos-configs/worker.yaml

# Step 3: Bootstrap Kubernetes
echo "3️⃣ Bootstrapping Kubernetes cluster..."
talosctl --talosconfig $TALOSCONFIG bootstrap --nodes $TETHYS_IP

# Step 4: Get kubeconfig
echo "4️⃣ Getting kubeconfig..."
talosctl --talosconfig $TALOSCONFIG kubeconfig

# Step 5: Wait for cluster
echo "5️⃣ Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Step 6: Deploy Cloudflare Tunnels
echo "6️⃣ Deploying Cloudflare Tunnels..."
kubectl apply -f k3s-cloudflare.yml

# Step 7: Deploy Vault + 1Password
echo "7️⃣ Deploying Vault + 1Password Connect..."
kubectl apply -f vault-1password-k8s.yml

echo "✅ Deployment complete!"
echo ""
echo "Check status with:"
echo "  talosctl --talosconfig $TALOSCONFIG dashboard --nodes $TETHYS_IP"
echo "  kubectl get nodes"
echo "  kubectl get pods --all-namespaces"