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
  jq -r '.items[] | select((.metadata.annotations["meta.helm.sh/release-name"] // "") | test("^gitops-flux-")) |
  "\(.kind)/\(.metadata.name) (release: \(.metadata.annotations["meta.helm.sh/release-name"]))"' 2>/dev/null || true)

if [[ -n "$OLD_FLUX_RESOURCES" ]]; then
  echo "  Found cluster-scoped resources with stale Flux Helm metadata:"
  COUNT=0
  while IFS= read -r resource; do
    [[ -z "$resource" ]] && continue
    echo "    $resource"
    KIND=$(echo "$resource" | cut -d'/' -f1 | awk '{print tolower($1)}')
    KIND=${KIND// (release:*/}
    NAME_WITH_RELEASE=${resource#*/}
    NAME=${NAME_WITH_RELEASE%% (*}
    if ! kubectl delete "$KIND" "$NAME" --ignore-not-found >/dev/null 2>&1; then
      echo "    ⚠️  Failed to delete $KIND/$NAME"
      ISSUES_FOUND=1
    else
      COUNT=$((COUNT + 1))
    fi
  done <<< "$OLD_FLUX_RESOURCES"
  if [[ $COUNT -gt 0 ]]; then
    echo "  ✅ Cleaned up $COUNT cluster-scoped Flux resources"
  fi
fi

# Check for CRDs managed by Flux
echo "Checking for CRD ownership conflicts..."
FLUX_CRDS=$(kubectl get crd -o json | \
  jq -r '.items[] | select((.metadata.annotations["meta.helm.sh/release-name"] // "") | test("^gitops-flux-")) |
  .metadata.name' 2>/dev/null || true)

if [[ -n "$FLUX_CRDS" ]]; then
  echo "  Found Flux CRDs (Helm will manage these):"
  while IFS= read -r crd; do
    [[ -z "$crd" ]] && continue
    echo "    $crd"
  done <<< "$FLUX_CRDS"
  echo "  ℹ️  CRDs are cluster-wide and managed by Helm (skipCrds: false)"
  echo "  ℹ️  No action needed - Helm will reconcile CRD ownership"
fi

# Check for namespace-scoped Flux resources with stale Helm metadata
echo "Checking for namespace-scoped Flux conflicts..."

# Check if flux-system namespace exists first
if kubectl get namespace flux-system &>/dev/null; then
  # Find the CURRENT Flux Helm release name (most recent)
  CURRENT_RELEASE=$(kubectl get secret -n flux-system -l owner=helm \
    -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | \
    tr ' ' '\n' | grep '^sh.helm.release.v1.gitops-flux-' | sort -V | tail -1 | \
    sed 's/sh.helm.release.v1.\(gitops-flux-[^.]*\)\..*/\1/' || true)

  if [[ -n "$CURRENT_RELEASE" ]]; then
    echo "  Current Flux Helm release: $CURRENT_RELEASE"
    echo "  Scanning for resources with STALE Flux Helm metadata..."

    # Resource types that commonly have Helm ownership conflicts
    RESOURCE_TYPES="networkpolicy,serviceaccount,secret,configmap,service,deployment"

    ALL_RESOURCES=$(kubectl get $RESOURCE_TYPES -n flux-system -o name 2>/dev/null || true)

    CLEANED=0
    if [[ -n "$ALL_RESOURCES" ]]; then
      while IFS= read -r resource; do
        if [[ -n "$resource" ]]; then
          RELEASE_NAME=$(kubectl get "$resource" -n flux-system \
            -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}' 2>/dev/null || true)

          # Only delete if it's a Flux resource BUT NOT the current release
          if [[ "$RELEASE_NAME" == gitops-flux-* && "$RELEASE_NAME" != "$CURRENT_RELEASE" ]]; then
            echo "    Found $resource with STALE Helm release: $RELEASE_NAME"
            echo "    Deleting to prevent ownership conflict..."
            kubectl delete "$resource" -n flux-system --ignore-not-found || true
            CLEANED=$((CLEANED + 1))
          fi
        fi
      done <<< "$ALL_RESOURCES"

      if [[ $CLEANED -gt 0 ]]; then
        echo "  ✅ Cleaned up $CLEANED Flux resources with stale Helm metadata"
      else
        echo "  ✅ No stale Flux resources found"
      fi
    fi
  else
    echo "  No existing Flux Helm release found (first deployment)"
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
