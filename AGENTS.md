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

## GitHub Issues & Progress Management

Goal: Never lose context, ideas, steps, or progress. Treat GitHub Issues as the system of record for work — from ideas to delivery.

When to create/update issues
- New idea, bug, or scope emerges during implementation.
- Before starting a medium/large task, create/update an issue with a short plan and acceptance criteria.
- When you pause/finish a session, leave a final comment summarizing what changed and the next steps.

Issue structure (use templates if present; otherwise follow this skeleton)
- Title: concise, actionable (e.g., "Docling PDF pre-labels via Triton Python backend").
- Body sections:
  - Background: why this matters, current blockers.
  - Goal/Scope: 2–3 bullets of what will be delivered.
  - Checklist: task list with verifiable items (use [ ] / [x]).
  - Validation: commands, endpoints, or screenshots to prove done.
  - Risks/Rollback: brief note when applicable.
  - Links: PRs, files, lines (e.g., `cluster/src/components/lsTritonAdapter.ts:1`).

Labels (apply as appropriate)
- type: feat, fix, docs, chore, refactor
- area: gpu, adapter, sink, calypso, cloudflared, triton, label-studio, db, policy, infra, ops
- priority: p0, p1, p2
- status: blocked, needs-info, ready

Working conventions
- Reference issues from commits/PRs: include `Refs #<id>` or `Closes #<id>`.
- Maintain the issue checklist as you progress; check items off as they are completed.
- For multi-PR work, link each PR in the issue and keep a running "Progress" section.
- If GitHub is unavailable, mirror updates in `STATUS_SUMMARY.md` or `ISSUES_SUMMARY.md` with the same checklist format, then backfill the issue later.

CLI helpers (optional)
- Use GitHub CLI when convenient:
  - `gh issue create -t "Title" -b "Body..." -l feat,adapter`
  - `gh issue comment <id> -b "Update: ..."`
  - `gh issue close <id> --comment "Fixed via #<PR>"`

Quality bar for “done”
- Issue has: clear scope, validation steps, and is linked to the merged PR(s).
- Any follow-ups are split into new issues and linked in a "Next steps" section.
