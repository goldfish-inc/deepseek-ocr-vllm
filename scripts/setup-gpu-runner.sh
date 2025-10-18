#!/usr/bin/env bash
set -euo pipefail

# Self-hosted GitHub Actions runner setup for GPU node (Ubuntu 22.04)
# Usage:
#   sudo bash scripts/setup-gpu-runner.sh \
#     --repo https://github.com/goldfish-inc/oceanid \
#     --token <REG_TOKEN> \
#     [--name calypso-gpu-01] [--labels self-hosted,linux,x64,gpu]

REPO=""
TOKEN=""
NAME="gpu-runner-$(hostname)"
LABELS="self-hosted,linux,x64,gpu"
RUNNER_DIR="/opt/actions-runner"
RUNNER_VER="2.329.0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --labels) LABELS="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

if [[ -z "$REPO" || -z "$TOKEN" ]]; then
  echo "Missing --repo or --token" >&2
  exit 1
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi not found. Install NVIDIA driver (>=535) and CUDA 12.x first." >&2
  exit 1
fi

id gha >/dev/null 2>&1 || useradd -m -s /bin/bash gha
mkdir -p "$RUNNER_DIR"
chown gha:gha "$RUNNER_DIR"

cd "$RUNNER_DIR"
if [[ ! -f ./run.sh ]]; then
  echo "Downloading runner $RUNNER_VER..."
  sudo -u gha bash -lc "curl -fsSL -o runner.tgz https://github.com/actions/runner/releases/download/v${RUNNER_VER}/actions-runner-linux-x64-${RUNNER_VER}.tar.gz"
  sudo -u gha tar xzf runner.tgz
fi

echo "Configuring runner..."
sudo -u gha bash -lc "cd '$RUNNER_DIR' && ./config.sh --url '${REPO}' --token '${TOKEN}' --name '${NAME}' --labels '${LABELS}' --unattended"

echo "Installing as service..."
./svc.sh install
systemctl enable actions.runner.* || true
./svc.sh start

echo "Runner installed and started. Check online status in GitHub → Settings → Actions → Runners."
