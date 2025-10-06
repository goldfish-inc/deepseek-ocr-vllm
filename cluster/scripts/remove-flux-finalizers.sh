#!/usr/bin/env bash
set -euo pipefail

# Remove finalizers from Flux resources that may block deletion or Helm ownership.
# Safe to run multiple times; only patches objects that have finalizers.

NS=${1:-flux-system}
echo "🔧 Removing Flux finalizers in namespace: ${NS}"

types=(
  "kustomizations.kustomize.toolkit.fluxcd.io"
  "gitrepositories.source.toolkit.fluxcd.io"
  "helmrepositories.source.toolkit.fluxcd.io"
  "helmreleases.helm.toolkit.fluxcd.io"
  "buckets.source.toolkit.fluxcd.io"
  "imagerepositories.image.toolkit.fluxcd.io"
  "imagepolicies.image.toolkit.fluxcd.io"
  "imageupdateautomations.image.toolkit.fluxcd.io"
)

for t in "${types[@]}"; do
  if ! kubectl api-resources | awk '{print $1"."$2}' | grep -q "^${t}$"; then
    continue
  fi
  echo "-- Scanning ${t}"
  mapfile -t items < <(kubectl -n "$NS" get "$t" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
  for name in "${items[@]:-}"; do
    [ -z "$name" ] && continue
    fins=$(kubectl -n "$NS" get "$t" "$name" -o jsonpath='{.metadata.finalizers}' 2>/dev/null || echo "")
    if [[ -n "$fins" && "$fins" != "[]" ]]; then
      echo "   Patching finalizers on ${t}/${name}"
      kubectl -n "$NS" patch "$t" "$name" --type=merge -p '{"metadata":{"finalizers":[]}}' || true
    fi
  done
done

echo "✅ Finalizer cleanup complete"
