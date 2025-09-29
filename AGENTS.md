# Repository Guidelines

## Project Structure & Modules
- Root workspace uses pnpm; packages are `cluster/` (Pulumi program) and `policy/` (OPA + TS helpers).
- GitOps manifests live under `clusters/` (e.g., `clusters/tethys/`).
- Operational scripts are in `scripts/`.
- Compiled JS for the Pulumi program goes to `cluster/bin/` (do not commit).

## Build, Test, and Development
- Install deps: `pnpm install --frozen-lockfile` (Node 20, pnpm 9).
- Type-check/build Pulumi program: `pnpm --filter @oceanid/cluster build`.
- Lint policy helpers: `pnpm --filter @oceanid/policy lint`.
- Run OPA tests: `pnpm --filter @oceanid/policy test` (requires `opa`).
- Local preview: `cd cluster && pulumi stack select ryan-taylor/oceanid-cluster/prod && pulumi preview`.

### Makefile Shortcuts
- `make install|lint|test|preview|up|destroy|refresh|clean` map to common workspace tasks.
- Configure Git hooks: `make hooks` (sets `core.hooksPath` to `.githooks`).

## Coding Style & Naming
- Language: TypeScript 5.x, CommonJS modules; 2-space indentation, semicolons on.
- File names: `camelCase.ts` (e.g., `cloudflareTunnel.ts`).
- Classes/Components: `PascalCase` (e.g., `CloudflareTunnel`, `FluxBootstrap`).
- Functions/vars: `camelCase`; constants `UPPER_SNAKE_CASE` when global.
- Keep components pure and configurable; prefer dependency injection (`k8sProvider`, `cloudflareProvider`).
- Avoid editing generated output (`cluster/bin/`).

## Testing Guidelines
- Policies: add/extend Rego in `policy/opa-policies.rego` with tests in `policy/opa-policies_test.rego` (`_test.rego` suffix).
- TS helpers: rely on `tsc --noEmit` for type-safety; add lightweight unit tests only if necessary.
- Pre-push: run `pnpm --filter @oceanid/cluster build` and `pnpm --filter @oceanid/policy test`.

### Pre-commit Hook
- Enable via `make hooks`. On commit it runs TS type-checks and OPA tests.
- To temporarily skip OPA tests: `SKIP_OPA=1 git commit -m "..."`.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:` (see `git log`).
- PRs: include a clear summary, linked issues, risk/rollback notes, and any config changes (Pulumi/ESC keys).
- CI posts Pulumi preview on PRs; ensure it’s green before requesting review.

## Security & Configuration
- Never commit secrets or kubeconfigs. Use Pulumi ESC env `default/oceanid-cluster` and set `PULUMI_CONFIG_PASSPHRASE` in CI.
- Required keys include Cloudflare tunnel IDs/tokens and GitOps repo settings (see `README.md` and `cluster/src/config.ts`).
- Follow least-privilege for Cloudflare tokens and GitHub tokens used by Flux.

## Architecture Notes
- Start with `ARCHITECTURE.md` and `README.md` for context.
- GitOps entrypoint: Flux watches `clusters/` via `FluxBootstrap`; changes there drive reconciliations.
