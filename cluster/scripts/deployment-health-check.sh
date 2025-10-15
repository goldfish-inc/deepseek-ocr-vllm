#!/usr/bin/env bash
set -euo pipefail

# Deployment Health Check
# Verifies all critical deployments are healthy after Pulumi apply
# Exit codes: 0 = healthy, 1 = unhealthy

NAMESPACE="${1:-apps}"
TIMEOUT="${2:-300}"  # 5 minutes default
STABILIZATION_DELAY="${3:-30}"  # 30 seconds to allow image pulls

echo "=================================================="
echo "🏥 Deployment Health Check"
echo "=================================================="
echo "Namespace: $NAMESPACE"
echo "Timeout: ${TIMEOUT}s per deployment"
echo "Stabilization delay: ${STABILIZATION_DELAY}s"
echo ""

# Give deployments time to stabilize (image pulls, pod scheduling)
if [ "$STABILIZATION_DELAY" -gt 0 ]; then
    echo "⏱️  Waiting ${STABILIZATION_DELAY}s for deployments to stabilize..."
    sleep "$STABILIZATION_DELAY"
    echo ""
fi

# Critical deployments to verify (in order of dependency)
CRITICAL_DEPLOYMENTS=(
    "label-studio-ls-app"
    "ls-triton-adapter"
    "annotations-sink"
    "csv-ingestion-worker-deployment"
    "project-bootstrapper"
)

# Track failures
FAILED_DEPLOYMENTS=()
TOTAL_DEPLOYMENTS=${#CRITICAL_DEPLOYMENTS[@]}
HEALTHY_COUNT=0

echo "📋 Checking $TOTAL_DEPLOYMENTS critical deployments..."
echo ""

for deployment in "${CRITICAL_DEPLOYMENTS[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔍 Checking: $deployment"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Check if deployment exists
    if ! kubectl -n "$NAMESPACE" get deployment "$deployment" >/dev/null 2>&1; then
        # Try without deployment suffix (handle dynamic names)
        matching=$(kubectl -n "$NAMESPACE" get deployments -o name | grep -i "$deployment" | head -1 || echo "")

        if [ -z "$matching" ]; then
            echo "ℹ️  Deployment not present: $deployment (skipping)"
            echo ""
            continue
        fi

        # Extract deployment name from kubectl output (format: deployment.apps/name)
        deployment="${matching#deployment.apps/}"
        echo "ℹ️  Found matching deployment: $deployment"
    fi

    # Get deployment status
    echo "📊 Status:"
    kubectl -n "$NAMESPACE" get deployment "$deployment" -o wide || {
        echo "❌ Failed to get deployment status"
        FAILED_DEPLOYMENTS+=("$deployment")
        echo ""
        continue
    }
    echo ""

    # Check if deployment has desired replicas configured
    DESIRED=$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
    if [ "$DESIRED" = "0" ]; then
        echo "⚠️  Deployment scaled to 0 replicas (skipping health check)"
        echo ""
        continue
    fi

    # Wait for rollout to complete
    echo "⏳ Waiting for rollout (timeout: ${TIMEOUT}s)..."
    if kubectl -n "$NAMESPACE" rollout status deployment/"$deployment" --timeout="${TIMEOUT}s"; then
        echo "✅ Rollout successful"

        # Additional validation: check pod restart counts
        echo ""
        echo "🔄 Checking pod restart counts..."
        PODS=$(kubectl -n "$NAMESPACE" get pods -l "$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.spec.selector.matchLabels}' | jq -r 'to_entries | map("\(.key)=\(.value)") | join(",")' 2>/dev/null || echo '')" -o name 2>/dev/null || echo "")

        if [ -n "$PODS" ]; then
            RESTART_COUNT=0
            for pod in $PODS; do
                POD_RESTARTS=$(kubectl -n "$NAMESPACE" get "$pod" -o jsonpath='{.status.containerStatuses[*].restartCount}' 2>/dev/null || echo "0")
                for count in $POD_RESTARTS; do
                    RESTART_COUNT=$((RESTART_COUNT + count))
                done
            done

            if [ "$RESTART_COUNT" -gt 3 ]; then
                echo "⚠️  Warning: High restart count detected ($RESTART_COUNT total restarts)"
                echo "   Deployment may be experiencing issues."
            else
                echo "✅ Restart count acceptable ($RESTART_COUNT total restarts)"
            fi
        fi

        HEALTHY_COUNT=$((HEALTHY_COUNT + 1))
    else
        echo "❌ Rollout failed or timed out"
        FAILED_DEPLOYMENTS+=("$deployment")

        # Gather diagnostic info
        echo ""
        echo "🔍 Diagnostic Information:"
        echo ""
        echo "Pod Status:"
        kubectl -n "$NAMESPACE" get pods -l "$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.spec.selector.matchLabels}' | jq -r 'to_entries | map("\(.key)=\(.value)") | join(",")' 2>/dev/null || echo '')" -o wide 2>/dev/null || echo "  Failed to get pods"

        echo ""
        echo "Recent Events:"
        kubectl -n "$NAMESPACE" get events --field-selector involvedObject.name="$deployment" --sort-by='.lastTimestamp' | tail -10 || echo "  Failed to get events"

        echo ""
        echo "Pod Logs (last 20 lines):"
        POD=$(kubectl -n "$NAMESPACE" get pods -l "$(kubectl -n "$NAMESPACE" get deployment "$deployment" -o jsonpath='{.spec.selector.matchLabels}' | jq -r 'to_entries | map("\(.key)=\(.value)") | join(",")' 2>/dev/null || echo '')" -o name | head -1 2>/dev/null || echo "")
        if [ -n "$POD" ]; then
            kubectl -n "$NAMESPACE" logs "$POD" --tail=20 2>/dev/null || echo "  Failed to get logs"
        else
            echo "  No pods found for this deployment"
        fi
    fi

    echo ""
done

# Summary
echo "=================================================="
echo "📊 Health Check Summary"
echo "=================================================="
echo "Total deployments checked: $TOTAL_DEPLOYMENTS"
echo "Healthy deployments: $HEALTHY_COUNT"
echo "Failed deployments: ${#FAILED_DEPLOYMENTS[@]}"
echo ""

if [ "${#FAILED_DEPLOYMENTS[@]}" -gt 0 ]; then
    echo "❌ Failed deployments:"
    for failed in "${FAILED_DEPLOYMENTS[@]}"; do
        echo "   - $failed"
    done
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Review pod logs: kubectl -n $NAMESPACE logs <pod-name>"
    echo "   2. Check events: kubectl -n $NAMESPACE describe deployment <deployment-name>"
    echo "   3. Verify database connectivity if CSV worker or sink failed"
    echo "   4. Check CrunchyBridge firewall allowlist (issue #95)"
    echo ""
    exit 1
fi

echo "✅ All critical deployments are healthy!"
echo ""
exit 0
