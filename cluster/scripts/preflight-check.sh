#!/usr/bin/env bash
set -euo pipefail

# Pre-flight checks for cluster deployment
# Catches ownership conflicts before Pulumi/Helm deployment

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config.yaml}"
export KUBECONFIG

echo "🔍 Running pre-flight checks..."

# Track if we found any issues
ISSUES_FOUND=0

# Check for old Flux Helm releases with mismatched metadata
echo "Checking for Flux Helm ownership conflicts..."
OLD_FLUX_RESOURCES=$(kubectl get clusterrole,clusterrolebinding -o json | \
  jq -r '.items[] | select(.metadata.annotations["meta.helm.sh/release-name"] | startswith("gitops-flux-")) |
  select(.metadata.annotations["meta.helm.sh/release-name"] != "gitops-flux-283b7f22") |
  "\(.kind)/\(.metadata.name) (release: \(.metadata.annotations["meta.helm.sh/release-name"]))"' 2>/dev/null || true)

if [[ -n "$OLD_FLUX_RESOURCES" ]]; then
  echo "❌ Found resources with old Flux Helm metadata:"
  echo "$OLD_FLUX_RESOURCES"
  echo ""
  echo "Run: kubectl delete clusterrole,clusterrolebinding -l 'app.kubernetes.io/instance!=gitops-flux-283b7f22' -l 'app.kubernetes.io/name=flux'"
  ISSUES_FOUND=1
fi

# Check for CRDs managed by Flux that should be owned by Helm
echo "Checking for CRD ownership conflicts..."
FLUX_CRDS=$(kubectl get crd -o json | \
  jq -r '.items[] | select(.metadata.labels["app.kubernetes.io/managed-by"] == "Helm") |
  select(.metadata.labels["app.kubernetes.io/instance"] | startswith("gitops-flux-")) |
  select(.metadata.labels["app.kubernetes.io/instance"] != "gitops-flux-283b7f22") |
  .metadata.name' 2>/dev/null || true)

if [[ -n "$FLUX_CRDS" ]]; then
  echo "❌ Found CRDs with old Flux ownership:"
  echo "$FLUX_CRDS"
  echo ""
  echo "These will block Helm installation. Consider deleting or re-labeling."
  ISSUES_FOUND=1
fi

# Check for namespace-scoped Flux resources with stale Helm metadata
echo "Checking for namespace-scoped Flux conflicts..."

# Check if flux-system namespace exists first
if kubectl get namespace flux-system &>/dev/null; then
  # Find and delete any NetworkPolicy with gitops-flux-* Helm release annotation
  # These always conflict when refactoring changes the Helm release name hash
  echo "  Scanning for NetworkPolicy resources with Flux Helm metadata..."

  NETWORKPOLICIES=$(kubectl get networkpolicy -n flux-system -o name 2>/dev/null || true)

  if [[ -n "$NETWORKPOLICIES" ]]; then
    while IFS= read -r policy; do
      if [[ -n "$policy" ]]; then
        RELEASE_NAME=$(kubectl get "$policy" -n flux-system \
          -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}' 2>/dev/null || true)

        if [[ "$RELEASE_NAME" == gitops-flux-* ]]; then
          echo "    Found $policy with Helm release: $RELEASE_NAME"
          echo "    Deleting to prevent ownership conflict..."
          kubectl delete "$policy" -n flux-system --ignore-not-found || true
        fi
      fi
    done <<< "$NETWORKPOLICIES"
    echo "  ✅ Cleaned up Flux NetworkPolicy resources"
  fi
else
  echo "  flux-system namespace does not exist yet (first deployment)"
fi

# Check for crashlooping pods that would block deployment
echo "Checking for crashlooping pods..."
CRASHLOOP_PODS=$(kubectl get pods -A -o json | \
  jq -r '.items[] | select(.status.containerStatuses[]?.state.waiting?.reason == "CrashLoopBackOff") |
  "\(.metadata.namespace)/\(.metadata.name)"' 2>/dev/null || true)

if [[ -n "$CRASHLOOP_PODS" ]]; then
  echo "⚠️  Found crashlooping pods (non-blocking):"
  echo "$CRASHLOOP_PODS"
  echo ""
  echo "These may be fixed by this deployment."
fi

# Check connectivity to cluster
echo "Checking cluster connectivity..."
if ! kubectl cluster-info &>/dev/null; then
  echo "❌ Cannot connect to cluster"
  exit 1
fi

# Summary
echo ""
if [[ $ISSUES_FOUND -eq 0 ]]; then
  echo "✅ All pre-flight checks passed"
  exit 0
else
  echo "❌ Pre-flight checks found issues. Fix them before deploying."
  exit 1
fi
