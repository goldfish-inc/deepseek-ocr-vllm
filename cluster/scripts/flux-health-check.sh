#!/usr/bin/env bash
set -euo pipefail

# Flux controller health check
# Automatically reapplies the Flux Helm template if controllers are missing.

# Require KUBECONFIG to be provided by the workflow environment
if [ -z "${KUBECONFIG:-}" ]; then
  echo "❌ KUBECONFIG is not set. The CI workflow must provide a kubeconfig via environment or ESC."
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "❌ kubectl CLI not found in PATH"
  exit 1
fi

FLUX_CHART_VERSION="${FLUX_CHART_VERSION:-2.16.4}"
FLUX_CLI_IMAGE="${FLUX_CLI_IMAGE:-ghcr.io/fluxcd/flux-cli}"
FLUX_CLI_TAG="${FLUX_CLI_TAG:-v2.6.4}"
HELM_REPO_NAME="${HELM_REPO_NAME:-fluxcd-community}"
HELM_REPO_URL="${HELM_REPO_URL:-https://fluxcd-community.github.io/helm-charts}"
REAPPLY_WAIT_SECONDS="${REAPPLY_WAIT_SECONDS:-30}"

# Expected Flux controllers
EXPECTED_CONTROLLERS=(
  "source-controller"
  "kustomize-controller"
  "helm-controller"
  "notification-controller"
  "image-automation-controller"
  "image-reflector-controller"
)

MISSING_CONTROLLERS=()
MISSING_NAMESPACE=0
ISSUES_FOUND=0

apply_flux_controllers() {
  echo "🔄 Applying Flux controllers manifest via Helm template..."

  if ! command -v helm >/dev/null 2>&1; then
    echo "❌ helm CLI not found; cannot reinstall Flux controllers automatically"
    return 1
  fi

  helm repo add "$HELM_REPO_NAME" "$HELM_REPO_URL" --force-update >/dev/null 2>&1
  helm repo update >/dev/null 2>&1

  if ! helm template flux2 "${HELM_REPO_NAME}/flux2" \
    --namespace flux-system \
    --create-namespace \
    --version "$FLUX_CHART_VERSION" \
    --include-crds \
    --set installCRDs=true \
    --set cli.image="$FLUX_CLI_IMAGE" \
    --set cli.tag="$FLUX_CLI_TAG" \
    --set sourceController.create=true \
    --set kustomizeController.create=true \
    --set helmController.create=true \
    --set notificationController.create=true \
    --set imageAutomationController.create=true \
    --set imageReflectorController.create=true \
    | kubectl apply -f -; then
    echo "❌ Failed to apply Flux manifest"
    return 1
  fi

  return 0
}

perform_health_check() {
  echo "🔍 Checking Flux controller health..."

  MISSING_CONTROLLERS=()
  MISSING_NAMESPACE=0
  ISSUES_FOUND=0

  if ! kubectl get namespace flux-system >/dev/null 2>&1; then
    echo "⚠️  flux-system namespace not found"
    MISSING_NAMESPACE=1
    MISSING_CONTROLLERS=("${EXPECTED_CONTROLLERS[@]}")
    ISSUES_FOUND=1
  else
    for controller in "${EXPECTED_CONTROLLERS[@]}"; do
      if ! kubectl get deployment "$controller" -n flux-system >/dev/null 2>&1; then
        echo "❌ Deployment $controller not found"
        MISSING_CONTROLLERS+=("$controller")
        ISSUES_FOUND=1
        continue
      fi

      READY=$(kubectl get deployment "$controller" -n flux-system \
        -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null || echo "Unknown")

      if [[ "$READY" != "True" ]]; then
        echo "❌ Deployment $controller is not ready (status: $READY)"
        ISSUES_FOUND=1
      else
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
  fi

  echo ""
  if [[ $MISSING_NAMESPACE -eq 0 ]]; then
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

    echo ""
    echo "Checking Kustomization reconciliation..."
    KUST_READY=$(kubectl get kustomization flux-system -n flux-system \
      -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")

    if [[ "$KUST_READY" != "True" ]]; then
      KUST_MSG=$(kubectl get kustomization flux-system -n flux-system \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "Unknown")
      echo "⚠️  Kustomization not ready: $KUST_MSG"
    else
      echo "✅ Kustomization reconciled successfully"
    fi
  else
    echo "Skipping GitRepository/Kustomization checks until flux-system namespace exists."
  fi

  if [[ $ISSUES_FOUND -eq 0 ]]; then
    return 0
  fi

  return 1
}

if perform_health_check; then
  echo ""
  echo "✅ All Flux controllers are healthy"
  exit 0
fi

if [[ ${#MISSING_CONTROLLERS[@]} -gt 0 || $MISSING_NAMESPACE -eq 1 ]]; then
  echo ""
  echo "⚠️  Missing Flux controllers detected. Applying Helm workaround..."
  if apply_flux_controllers; then
    echo "✅ Flux manifest applied via Helm"
    echo "Waiting ${REAPPLY_WAIT_SECONDS}s for controllers to stabilize..."
    sleep "$REAPPLY_WAIT_SECONDS"

    if perform_health_check; then
      echo ""
      echo "✅ All Flux controllers are healthy"
      exit 0
    fi
  else
    echo "❌ Unable to apply Flux controllers automatically"
  fi
fi

echo ""
echo "❌ Flux health check failed"
exit 1
