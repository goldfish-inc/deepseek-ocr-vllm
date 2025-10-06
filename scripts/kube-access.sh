#!/usr/bin/env bash
set -euo pipefail

# Simple helper to open a Cloudflare Access TCP tunnel for the K8s API
# Usage: scripts/kube-access.sh api.<base> [local_port]

HOSTNAME="${1:-api.example.com}"
LPORT="${2:-6443}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed" >&2
  exit 1
fi

echo "Opening CF Access TCP to ${HOSTNAME} on 127.0.0.1:${LPORT}..."
cloudflared access tcp --hostname "${HOSTNAME}" --url "127.0.0.1:${LPORT}" &
sleep 2
echo "Set KUBECONFIG and point your kubeconfig server to https://127.0.0.1:${LPORT}"
