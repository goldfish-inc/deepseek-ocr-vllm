# Flux Helm v4 Rebuild Plan

We decided to rebuild the Flux installation from scratch so Pulumi can manage it via `k8s.helm.v4.Chart` without inheriting client-side apply state.

## Desired End State
- `cluster/src/gitops/fluxBootstrap.ts` uses Helm v4 with hook-stripping transformations.
- Flux components run at the v2.7.0 release levels (controller tags: source/kustomize v1.7.0, helm v1.4.0, notification v1.7.1, image automation/reflection v1.0.1, CLI v2.7.0).
- Pulumi owns SSA for all Flux resources (namespace, CRDs, controller workloads, GitRepository, Kustomization).
- No legacy `kubectl-client-side-apply` managers remain on the Flux CRDs.

## Rebuild Procedure
1. **Preparation**
   - Announce maintenance window; Flux reconciliation will be down until redeploy finishes.
   - Ensure Pulumi config secrets (`flux.ssh_private_key`, `github.token`, etc.) are present and up to date.
   - Capture any critical Flux-managed secrets or configmaps from the cluster if they are required immediately after reinstall.

2. **Remove Existing Flux Installation**
   - `kubectl delete namespace flux-system --ignore-not-found`
   - `kubectl delete crd $(kubectl get crd -o name | grep '\.toolkit\.fluxcd\.io') --ignore-not-found`
   - Confirm the namespace and CRDs are gone: `kubectl get namespaces | grep flux-system` and `kubectl get crd | grep fluxcd` should return no results.

3. **Pulumi Deployment**
   - Verify `cluster/src/gitops/fluxBootstrap.ts` imports `k8s.helm.v4.Chart` and retains the hook-stripping transformation.
   - Run `pnpm --filter @oceanid/cluster build`.
   - Execute `pulumi preview --diff` (optional but recommended).
   - Run `pulumi up` for the `oceanid-cluster` stack.
   - Monitor the Pulumi output to ensure CRDs and controller deployments are created successfully.

4. **Validation**
   - Use `kubectl get deployments -n flux-system` to confirm all six controllers are running.
   - Run `flux check --pre --namespace flux-system` if the Flux CLI is available on the runner.
   - Verify GitRepository and Kustomization are Ready: `kubectl get gitrepository,kustomization -n flux-system`.
   - Trigger the post-deployment health check (`cluster/scripts/flux-health-check.sh`) to ensure the Helm fallback path isn’t needed anymore.

5. **Post-Migration Cleanup**
   - Document the maintenance completion time and outcome in the cluster runbook.
   - Keep this plan handy in case we need to rebuild again or share context with SRE/ops.
   - Track Pulumi issue `pulumi/pulumi-kubernetes#555` for eventual Helm SDK upgrades that may allow removing the hook transformation.
