#!/usr/bin/env bash
set -euo pipefail

# Keep a resilient local port forward to the K3s API on the control-plane node.
# Usage: scripts/k3s-ssh-tunnel.sh tethys [local_port] [remote_port]

HOST="${1:-tethys}"
LPORT="${2:-16443}"
RPORT="${3:-6443}"

echo "Ensuring no conflicting tunnel on :$LPORT..."
if lsof -i ":${LPORT}" >/dev/null 2>&1; then
  pkill -f "ssh.*:${LPORT}:localhost:${RPORT}" || true
  sleep 1
fi

echo "Starting resilient SSH tunnel: localhost:${LPORT} -> ${HOST}:localhost:${RPORT}"

exec ssh -f -N \
  -L "${LPORT}:localhost:${RPORT}" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=20 \
  -o ServerAliveCountMax=3 \
  -o TCPKeepAlive=yes \
  "${HOST}"

