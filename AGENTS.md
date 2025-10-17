# Repository Guidelines

## Project Structure & Module Organization
- `cluster/`: TypeScript Pulumi program that manages K3s in-cluster resources; entry point `src/index.ts`.
- `cloud/`: Pulumi stacks for Cloudflare, CrunchyBridge, and custom SDKs in `cloud/sdks/`.
- `clusters/`: Flux overlays; `clusters/tethys/` is the production sync target.
- `apps/`: Go services and adapters with Dockerfiles per service.
- `policy/`: OPA policies plus helpers that enforce guardrails in CI.
- `scripts/`, `sql/`, `docs/`: Operational tooling, migrations, and incident playbooks.

## Build, Test, and Development Commands
Install deps with `pnpm install --frozen-lockfile`. Core loops:
```bash
pnpm --filter @oceanid/cluster build      # Transpile Pulumi program to ./cluster/bin
pnpm --filter @oceanid/policy test        # OPA regression suite (requires opa CLI)
go test ./...                             # Run Go unit tests inside an app directory
make preview STACK=ryan-taylor/oceanid-cluster/prod
```
Use `make deploy-simple` to validate tunnels without host provisioning. Always preview before `pulumi up`.

## Coding Style & Naming Conventions
- TypeScript: 4-space indentation, `strict` `tsconfig.json`, prefer `const` and explicit return types.
- Go: keep services module-scoped (e.g. `apps/csv-ingestion-worker`), run `gofmt`/`goimports`.
- Rego: extend `policy/opa-policies.rego`; shared helpers belong in `validation.ts`.
- Filenames mirror resource intent (`HostCloudflared`, `NodeTunnels`); tests end with `_test`.

## Testing Guidelines
- TypeScript stacks rely on `tsc --noEmit` (`pnpm --filter @oceanid/cluster lint`) for static checks.
- OPA rules need coverage in `policy/opa-policies_test.rego`; add one assertion per scenario.
- Go services use table-driven `_test.go` files and must pass `go test ./...`; reusable fixtures live in `apps/*/test`.
- After deploys run `make smoke` for tunnel and health verification.

## Commit & Pull Request Guidelines
- Commit subjects follow `<type>: <summary>` (see `git log` for `feat`, `ops`, `docs`) in imperative mood.
- PRs attach `pulumi preview --diff` output and `opa test` results; optionally add `make preview` logs.
- Reference runbooks when editing `scripts/` or `docs/`.
- Add screenshots or curl traces for ingress, tunnel, or Access UI tweaks.

## Security & Configuration Tips
- Never commit secrets; rely on Pulumi ESC (`Pulumi.prod.yaml`) or `pulumi config set --secret`.
- Regenerate kubeconfig from `cluster/kubeconfig.yaml` templates and keep SSH keys only in ESC (`tethys_ssh_key`, etc.).
- When tuning tunnels, update `cloud/` DNS records in the same PR to protect `label.` and `gpu.` endpoints.
