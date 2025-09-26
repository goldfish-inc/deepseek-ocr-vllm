# Oceanid Audit & Test Backlog

## Current State
- Infrastructure refactored around typed Pulumi components and pnpm workspace.
- GitHub Actions workflow defined but not yet executed against live infrastructure.
- Pulumi ESC environment expected to provide Cloudflare + kubeconfig secrets; not verified.
- Legacy TypeScript modules archived under `cluster/legacy/` pending migration.

## Required Testing Before Any Deployment

1. **Policy & Type Checks (CI)**
   - `pnpm --filter @oceanid/cluster build`
   - `pnpm --filter @oceanid/policy lint`
   - `pnpm --filter @oceanid/policy test` (requires OPA CLI; run in CI or install locally)

2. **Pulumi Stack Validation**
   - Populate ESC environment `default/oceanid-cluster` with the keys listed in README.
   - `pulumi stack select ryan-taylor/oceanid-cluster/prod`
   - `pulumi preview --diff`

3. **Flux / PKO GitOps Pipeline**
   - Apply the kustomizations under `clusters/` to a test k3s cluster.
   - Confirm the Pulumi Kubernetes Operator reconciles the `Stack` resource.
   - Validate Flux controllers report healthy status via `flux get kustomizations -A`.

4. **Cloudflare Tunnel**
   - Ensure tunnel token is valid and matches the configured tunnel ID.
   - Deploy `CloudflareTunnel` component and verify the DNS record resolves to `tunnelTarget`.
   - Confirm k3s API reachable only through Cloudflare Zero Trust policies.

## Follow-up GitHub Issues (Created)

- [#35](https://github.com/goldfish-inc/oceanid/issues/35) "Validate Policy and Type Checks CI Pipeline" – TypeScript build and OPA policy validation
- [#36](https://github.com/goldfish-inc/oceanid/issues/36) "Populate Pulumi ESC Environment for Oceanid Stack" – track filling in real credentials
- [#37](https://github.com/goldfish-inc/oceanid/issues/37) "Run Pulumi Preview with New Component Stack" – ensure resource diffs match expectations
- [#38](https://github.com/goldfish-inc/oceanid/issues/38) "Validate Flux and PKO GitOps Pipeline on Test Cluster" – confirm GitOps flow end-to-end
- [#39](https://github.com/goldfish-inc/oceanid/issues/39) "Verify Cloudflare Tunnel and DNS Configuration" – smoke test tunnel access

Keep this document in sync with actual test executions and update issue status as validation progresses.
