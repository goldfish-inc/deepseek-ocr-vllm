## Summary
- GitOps bootstrap script still prompts for Pulumi tokens instead of reading ESC

## Details
- Modify `scripts/bootstrap-gitops.sh` to fetch credentials from Pulumi ESC or stack config
- Update docs to avoid manual secret entry

## Checks
- [ ] Update script to pull secrets via `pulumi config get --secret`
- [ ] Update README / docs
- [ ] Test bootstrap script end-to-end
