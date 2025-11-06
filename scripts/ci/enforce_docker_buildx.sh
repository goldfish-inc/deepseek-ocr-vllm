#!/usr/bin/env bash
# Enforce docker buildx for all Docker builds
# CRITICAL: Always build multi-platform images for production compatibility

set -euo pipefail

# Check git history for direct docker build commands (not buildx)
if git diff --cached --name-only | grep -qE '\.(sh|yml|yaml|Makefile)$'; then
  # Search staged files for docker build commands without buildx
  # Exclude comments (#), quoted strings, and this script itself
  if git diff --cached | grep -E '^\+[^#]*docker build' | grep -vE 'buildx|^\+.*["'\''].*docker build|enforce_docker_buildx' | grep -q .; then
    cat >&2 <<'EOF'
❌ BLOCKED: Direct 'docker build' detected in staged changes

RULE: Always use 'docker buildx build' with --platform flag for multi-arch images.

Why:
  - Local dev (Mac): arm64 (Apple Silicon) or amd64 (Intel)
  - Production cluster: linux/amd64 (VPS nodes)
  - CI builds: linux/amd64,linux/arm64 (both platforms)

Correct usage:
  docker buildx build --platform linux/amd64,linux/arm64 -t IMAGE:TAG --push .

For local testing only:
  docker buildx build --platform linux/amd64 -t IMAGE:TAG --load .

Fix: Replace 'docker build' with 'docker buildx build --platform linux/amd64'
EOF
    exit 1
  fi
fi

# Check for Makefile docker build targets without buildx
if git diff --cached --name-only | grep -q '^Makefile$'; then
  if git diff --cached Makefile | grep -E '^\+[^#]*docker build' | grep -vE 'buildx|["'\''].*docker build' | grep -q .; then
    cat >&2 <<'EOF'
❌ BLOCKED: Makefile contains 'docker build' without buildx

Fix: Use 'docker buildx build --platform linux/amd64' in Makefile targets
EOF
    exit 1
  fi
fi

exit 0
