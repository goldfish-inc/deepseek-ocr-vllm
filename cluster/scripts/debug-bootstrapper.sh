#!/usr/bin/env bash
set -euo pipefail

# Debug project-bootstrapper deployment
KUBECONFIG="${KUBECONFIG:-$HOME/.kube/k3s-config.yaml}"
export KUBECONFIG

echo "🔍 Debugging project-bootstrapper..."
echo ""

# Get pod status
echo "📦 Pod Status:"
kubectl -n apps get pods -l app=project-bootstrapper -o wide

echo ""
echo "📝 Recent Logs:"
POD=$(kubectl -n apps get pods -l app=project-bootstrapper -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -n "$POD" ]]; then
  kubectl -n apps logs "$POD" --tail=50
else
  echo "⚠️  No pod found"
fi

echo ""
echo "🗂️  ConfigMap Content (first 30 lines of main.py):"
kubectl -n apps get configmap project-bootstrapper-code -o jsonpath='{.data.main\.py}' | head -30

echo ""
echo "⚙️  Deployment Env Vars:"
kubectl -n apps get deploy project-bootstrapper -o jsonpath='{.spec.template.spec.containers[0].env[*]}' | jq -r '.name' 2>/dev/null || kubectl -n apps get deploy project-bootstrapper -o json | jq -r '.spec.template.spec.containers[0].env[] | "\(.name)=\(.value // "<from secret>")"'
