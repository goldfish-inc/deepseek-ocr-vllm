## Summary
- cloudflare tunnel deployment still uses `cloudflare/cloudflared:latest`

## Details
- pin to `cloudflare/cloudflared:2025.9.1` (or other tested tag)
- expose config value via Pulumi config/ESC

## Checks
- [ ] Update `cluster/src/config.ts`
- [ ] Update documentation
- [ ] `pulumi preview`
- [ ] `pulumi up`
