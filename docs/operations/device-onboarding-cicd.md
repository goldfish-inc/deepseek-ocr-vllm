# Device Onboarding via CI/CD

This playbook standardizes how we add new physical/edge devices (e.g. DGX, VPS, lab nodes) to the Oceanid network without breaking existing tunnels or leaking secrets.

## 1. Prerequisites

- Device reachable via SSH with sudo access.
- Cloudflare account + zone IDs for both boathou.se and goldfish.io (see `cloud/src/index.ts`).
- Pulumi ESC configured per `docs/SECRETS_MANAGEMENT.md`.
- Self-hosted GitHub runner installed on the device (label it after the device, e.g. `spark`).

## 2. Secrets and Cloudflare Service Token

1. Create a dedicated Cloudflare Tunnel + service token for the device.
2. Store secrets in ESC (never GitHub secrets):
   ```bash
   esc env set default/oceanid-cluster pulumiConfig.oceanid-cloud:<devicePrefix>CloudflareTunnelToken "<token>" --secret
   esc env set default/oceanid-cluster pulumiConfig.oceanid-cloud:<devicePrefix>AccessServiceTokenId "<uuid>" --secret
   esc env set default/oceanid-cluster pulumiConfig.oceanid-cloud:<devicePrefix>AccessClientId "<client_id.access>" --secret
   esc env set default/oceanid-cluster pulumiConfig.oceanid-cloud:<devicePrefix>AccessClientSecret "<client_secret>" --secret
   ```
3. Rotate API tokens immediately if they were shared outside ESC (see incident response in `docs/SECRETS_MANAGEMENT.md`).

## 3. Pulumi Cloud Stack Updates (`cloud/`)

For every device we expose via Cloudflare:

1. Add config keys (`oceanid-cloud:deviceAccessServiceTokenId`, tunnel tokens, etc.) to `cloud/Pulumi.prod.yaml` referencing ESC placeholders.
2. In `cloud/src/index.ts`, define:
   - `AccessApplication` per hostname (example: Spark `ollama.goldfish.io`).
   - `AccessPolicy` with `decision: "bypass"` including the service token list.
3. Run `pnpm --filter @oceanid/cloud build` locally, then `pulumi preview --cwd cloud` (or rely on `cloud-infrastructure.yml`).
4. Never use “allow everyone” or `non_identity` policies in production; rely on explicit service tokens or Access groups.

## 4. K3s Integration (if the device joins the cluster)

Some devices (e.g. new GPU/VPS nodes) need to appear in the Oceanid K3s fleet. In those cases:

1. Update `cluster/src/config.ts` with the new `NodeConfig` entry (hostnames, IPs, roles).
2. Ensure SSH keys/secrets for the node exist in ESC (`pulumiConfig.oceanid-cluster:<node>_ssh_key`).
3. Run `pnpm --filter @oceanid/cluster build` and `pulumi preview --cwd cluster` to confirm node provisioning logic.
4. If the device hosts DaemonSets or tunnels managed by the cluster stack (e.g. `node-tunnels`, `tailscale`), verify the Helm release or manifests include the new node selectors/taints.
5. After cluster Pulumi deploy, confirm the node joins via `kubectl get nodes` and Flux sync in `clusters/tethys/` remains healthy.

If the device is standalone (like DGX Spark) leave K3s untouched but document the rationale in the device README.

## 5. Infrastructure Scripts (`infrastructure/<device>/`)

Each device gets:

- `README.md` documenting tunnel intent, Access IDs, verification steps, and CI linkage.
- `cloudflared.service` (systemd template) with hardened settings.
- `deploy.sh` fetching tunnel token from Pulumi config/ESC (`pulumi config get <prefix>:cloudflareTunnelToken --cwd cloud`).

The scripts must avoid embedding secrets directly. Reference ESC or environment overrides only.

## 6. GitHub Workflow (`.github/workflows/<device>.yml`)

1. Trigger on changes to the device’s infrastructure directory and manual dispatch.
2. `runs-on: [self-hosted, <deviceLabel>]` to ensure commands execute on the target host.
3. Steps:
   - Checkout repo.
   - Install Pulumi CLI (if missing).
   - Run the device’s deploy script (which calls ESC via `pulumi config`).
   - Local smoke test (curl localhost, journalctl, etc.).
   - Optional remote probe using the Access credentials pulled from ESC.
4. Document required runner labels in `.github/actionlint.yaml` so linting passes.

## 7. CI/CD Verification Flow

1. **Pulumi preview** (auto via `cloud-infrastructure.yml` for PRs touching `cloud/`). Attach preview logs to PR (see `pr-gates.yml`).
2. **Device workflow dry run**: use workflow dispatch with `skip_access_probe=true` until Access policy is live, then re-run with probe.
3. **Post-deploy audit**:
   - `systemctl status cloudflared` on device.
   - `journalctl -u cloudflared --since '10 min ago'` for tunnel registrations.
   - Remote `curl -i https://<hostname>/health` with `CF-Access-*` headers to ensure 200 (no 302).

## 8. Policy Rules

1. Secrets live in ESC; GitHub only stores `PULUMI_CONFIG_PASSPHRASE`.
2. Every exposed hostname must have IaC-managed Access apps/policies.
3. Use dedicated tunnels per device—do not reuse the cluster tunnel.
4. Runner label must match the device name; disable default `ubuntu-latest` access to sensitive scripts.
5. Document every change (README + linked issue) and include manual rollback steps.
6. If Access fails (302/403), treat it as an incident: do not bypass with public policies.

## 9. Onboarding Checklist

- [ ] Service token + tunnel created and stored in ESC
- [ ] Pulumi config updated (stack + ESC)
- [ ] `cloud/src/index.ts` includes Access app/policy
- [ ] Infrastructure directory + deploy script committed
- [ ] GitHub workflow added + actionlint updated
- [ ] Preview + workflow runs attached to PR
- [ ] Production deployment verified (local + remote probes)

Follow the DGX Spark implementation (`infrastructure/spark/`, `.github/workflows/spark-ollama.yml`) as the canonical template for future devices.
