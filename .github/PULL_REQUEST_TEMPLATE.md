## Summary

- What change does this PR make and why?
- Link the issue (e.g. #211, #212) and describe scope clearly.

## Required Gates (check all that apply)

- [ ] Attached `pulumi preview --diff` output (or mark N/A with reason)
- [ ] `pnpm --filter @oceanid/policy test` passes (policy touched or N/A)
- [ ] `go test ./...` passes for touched apps (or N/A)
- [ ] `make smoke` output attached for runtime changes (or N/A)

## How to Verify

- Commands run locally:
  - `pnpm --filter @oceanid/cluster build`
  - `pnpm --filter @oceanid/policy test`
  - `go test ./...` (from each touched `apps/<name>`)
  - `make preview STACK=ryan-taylor/oceanid-cluster/prod`

## Notes

- No secrets in code. Use Pulumi ESC for credentials.
- Keep PRs surgical and tied to one issue. Include smoke steps when relevant.
