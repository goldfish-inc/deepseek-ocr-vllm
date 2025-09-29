#!/usr/bin/env bash
set -euo pipefail

# Basic validation checks for Oceanid minimal deployment

echo "==> Checking kube access"
if ! kubectl version --short >/dev/null 2>&1; then
  echo "kubectl not available or cannot reach cluster. If remote, run scripts/k3s-ssh-tunnel.sh tethys first." >&2
else
  kubectl get nodes -o wide || true
  kubectl -n node-tunnels get ds,po || true
  kubectl -n apps get deploy,svc label-studio || true
fi

echo "==> HTTP checks (external)"
LABEL_HOST=${LABEL_HOST:-label.boathou.se}
GPU_HOST=${GPU_HOST:-gpu.boathou.se}

curl -skI https://${LABEL_HOST} | sed -n '1,5p' || true
curl -sk https://${GPU_HOST}/ | head -n 3 || true
curl -sk https://${GPU_HOST}/gpu | head -n 10 || true

echo "==> Done. Review output above for errors."

