#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH=${KUBECONFIG:-$HOME/.kube/k3s-warp.yaml}
export KUBECONFIG="$KUBECONFIG_PATH"

echo "Using KUBECONFIG=$KUBECONFIG"

echo "== Wait for egress gateway =="
kubectl -n egress-system rollout status deploy/egress-gateway --timeout=180s
kubectl -n egress-system get pods -o wide

echo "== Wait for egress DB proxy =="
kubectl -n apps rollout status deploy/egress-db-proxy --timeout=180s || true
kubectl -n apps get deploy egress-db-proxy || true
kubectl -n apps get svc egress-db-proxy || true

echo "== HTTP egress via proxy (expect unified IP 157.173.210.123) =="
kubectl -n apps run egress-test --rm -i --restart=Never --image=curlimages/curl:8.10.1 \
  -- curl -s https://ipinfo.io/ip || true

echo "== In-cluster service direct (should bypass proxy, return 200) =="
kubectl -n apps run svc-test --rm -i --restart=Never --image=curlimages/curl:8.10.1 \
  -- curl -s -o /dev/null -w '%{http_code}\n' http://argilla.apps.svc.cluster.local/api/health || true

echo "== Annotations Sink env check (proxy vars present) =="
kubectl -n apps exec deploy/annotations-sink -- env | grep -E 'HTTP_PROXY|NO_PROXY' || true

echo "== CSV Worker DB connectivity via proxy (optional) =="
CSV_DEPLOY=$(kubectl -n apps get deploy -l app=csv-ingestion-worker -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -n "${CSV_DEPLOY}" ]]; then
  kubectl -n apps exec "deploy/${CSV_DEPLOY}" -- sh -lc 'apk add -q busybox-extras || true; nc -vz egress-db-proxy.apps.svc.cluster.local 5432'
fi

echo "== Gateway logs tail (5 lines) =="
kubectl -n egress-system logs deploy/egress-gateway --tail=50 | tail -n 5 || true

echo "Smoke tests completed."
