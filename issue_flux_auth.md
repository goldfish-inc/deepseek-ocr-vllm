## Summary
- Flux bootstrap rewrites repo URL to SSH regardless of credentials

## Details
- Detect scheme and only rewrite to SSH if `flux-system-ssh` secret exists
- Ensure HTTPS + PAT works unchanged

## Checks
- [ ] Update `cluster/src/components/fluxBootstrap.ts`
- [ ] `pnpm --filter @oceanid/cluster build`
- [ ] Validate Flux bootstrap with HTTPS
- [ ] Validate Flux bootstrap with SSH
