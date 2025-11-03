#!/usr/bin/env bash
set -euo pipefail

# Rebuild csv-ingestion-worker with a fresh, version-stamped binary and bring up the local stack.
#
# Notes:
# - This script does not run `docker system prune -a` (destructive). Run it yourself beforehand if desired.
# - Requires Docker and Docker Compose (v2) available on PATH.

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
APP_DIR="$ROOT_DIR/apps/csv-ingestion-worker"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found on PATH." >&2
  exit 1
fi

BUILD_SHA=$(git -C "$ROOT_DIR" rev-parse --short HEAD)
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "== Building csv-ingestion-worker image (no cache) =="
docker build --no-cache \
  --build-arg BUILD_SHA="$BUILD_SHA" \
  --build-arg BUILD_DATE="$BUILD_DATE" \
  -t csv-ingestion-worker:latest \
  "$APP_DIR"

echo "== Bringing up local stack (db, minio, worker) =="
docker compose -f "$APP_DIR/docker-compose.yml" up -d --build

echo "Rebuild complete. Worker should print BuildVersion on startup."
