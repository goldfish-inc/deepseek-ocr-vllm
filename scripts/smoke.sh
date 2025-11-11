#!/usr/bin/env bash
set -euo pipefail

# Basic validation checks for Oceanid minimal deployment

echo "==> Checking kube access"
if ! kubectl version --short >/dev/null 2>&1; then
  echo "kubectl not available or cannot reach cluster. If remote, run scripts/k3s-ssh-tunnel.sh tethys first." >&2
else
  kubectl get nodes -o wide || true
  kubectl -n node-tunnels get ds,po || true
  kubectl -n apps get deploy,svc argilla || true
fi

echo "==> HTTP checks (external)"
ARGILLA_HOST=${ARGILLA_HOST:-label.boathou.se}
UPLOAD_HOST=${UPLOAD_HOST:-upload.goldfish.io}

echo "== Argilla (via Cloudflare tunnel) =="
curl -skI https://${ARGILLA_HOST} | sed -n '1,5p' || true

echo "== Upload Portal (Cloudflare Worker) =="
curl -skI https://${UPLOAD_HOST}/health | sed -n '1,5p' || true

echo "==> Done. Review output above for errors."
