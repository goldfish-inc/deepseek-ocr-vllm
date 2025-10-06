#!/usr/bin/env bash
set -euo pipefail

# Remove Flux finalizers from stuck resources
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config.yaml}"
export KUBECONFIG

echo "🧹 Removing Flux finalizers from stuck resources..."

# Kustomization
echo "Removing finalizer from gitops-kustomization..."
kubectl -n flux-system patch kustomization flux-system --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || echo "  Already removed or doesn't exist"

# ImagePolicies
echo "Removing finalizers from ImagePolicy resources..."
kubectl -n flux-system patch imagepolicy cert-manager --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || echo "  cert-manager: Already removed or doesn't exist"
kubectl -n flux-system patch imagepolicy cloudflared --type=json -p='[{"op": "remove", "path": "/metadata/finalizers"}]' 2>/dev/null || echo "  cloudflared: Already removed or doesn't exist"

echo ""
echo "✅ Finalizers removed. Resources should now delete."
echo ""
echo "Checking remaining Flux resources:"
kubectl get kustomization,imagepolicy -A 2>/dev/null || echo "No Flux CRDs remaining"
