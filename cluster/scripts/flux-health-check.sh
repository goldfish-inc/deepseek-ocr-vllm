#!/usr/bin/env bash
set -euo pipefail

# Flux controller health check
# Exits 1 if any Flux controllers are missing or unhealthy

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config.yaml}"
export KUBECONFIG

echo "🔍 Checking Flux controller health..."

# Expected Flux controllers
EXPECTED_CONTROLLERS=(
  "source-controller"
  "kustomize-controller"
  "helm-controller"
  "notification-controller"
  "image-automation-controller"
  "image-reflector-controller"
)

ISSUES_FOUND=0

# Check if flux-system namespace exists
if ! kubectl get namespace flux-system &>/dev/null; then
  echo "❌ flux-system namespace not found"
  exit 1
fi

# Check each controller deployment
for controller in "${EXPECTED_CONTROLLERS[@]}"; do
  if ! kubectl get deployment "$controller" -n flux-system &>/dev/null; then
    echo "❌ Deployment $controller not found"
    ISSUES_FOUND=1
    continue
  fi

  # Check if deployment is ready
  READY=$(kubectl get deployment "$controller" -n flux-system \
    -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null || echo "Unknown")

  if [[ "$READY" != "True" ]]; then
    echo "❌ Deployment $controller is not ready (status: $READY)"
    ISSUES_FOUND=1
  else
    # Check pod status
    POD_STATUS=$(kubectl get pods -n flux-system -l app="$controller" \
      -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo "Unknown")

    if [[ "$POD_STATUS" != "Running" ]]; then
      echo "❌ Pod for $controller is not running (status: $POD_STATUS)"
      ISSUES_FOUND=1
    else
      echo "✅ $controller is healthy"
    fi
  fi
done

# Check GitRepository status
echo ""
echo "Checking GitRepository reconciliation..."
GIT_READY=$(kubectl get gitrepository flux-system -n flux-system \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")

if [[ "$GIT_READY" != "True" ]]; then
  GIT_MSG=$(kubectl get gitrepository flux-system -n flux-system \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "Unknown")
  echo "❌ GitRepository not ready: $GIT_MSG"
  ISSUES_FOUND=1
else
  REVISION=$(kubectl get gitrepository flux-system -n flux-system \
    -o jsonpath='{.status.artifact.revision}' 2>/dev/null || echo "Unknown")
  echo "✅ GitRepository ready at $REVISION"
fi

# Check Kustomization status
echo ""
echo "Checking Kustomization reconciliation..."
KUST_READY=$(kubectl get kustomization flux-system -n flux-system \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")

if [[ "$KUST_READY" != "True" ]]; then
  KUST_MSG=$(kubectl get kustomization flux-system -n flux-system \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "Unknown")
  echo "⚠️  Kustomization not ready: $KUST_MSG"
  # Don't fail on Kustomization issues - they may be transient
else
  echo "✅ Kustomization reconciled successfully"
fi

echo ""
if [[ $ISSUES_FOUND -eq 0 ]]; then
  echo "✅ All Flux controllers are healthy"
  exit 0
else
  echo "❌ Flux health check failed"
  exit 1
fi
