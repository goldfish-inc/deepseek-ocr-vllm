#!/usr/bin/env bash
set -euo pipefail

NS=${NS:-apps}
APP=${APP:-project-bootstrapper}

echo "🔎 Debugging $APP in namespace $NS"

echo "== Deployment (head) =="
kubectl -n "$NS" get deploy "$APP" -o yaml | sed -n '1,160p' || true

echo
echo "== Container image & env =="
kubectl -n "$NS" get deploy "$APP" -o json \
  | jq -r '.spec.template.spec.containers[0] | "image: \(.image)\n--- env ---\n" + ( .env[] | "\(.name)=\(.value // (\"<secret>\"))" )' || true

echo
echo "== Mounted code (ConfigMap) =="
if kubectl -n "$NS" get cm ${APP}-code >/dev/null 2>&1; then
  kubectl -n "$NS" get cm ${APP}-code -o yaml | sed -n '1,200p'
else
  echo "ConfigMap ${APP}-code not found"
fi

echo
echo "== Pod logs & events =="
POD=$(kubectl -n "$NS" get pods -l app="$APP" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [ -n "${POD}" ]; then
  echo "pod: ${POD}"
  echo "-- logs (tail) --"
  kubectl -n "$NS" logs "$POD" --tail=200 || true
  echo "-- describe events --"
  kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p' || true
else
  echo "No pod found for app=$APP"
fi

echo "✅ Debug complete"
