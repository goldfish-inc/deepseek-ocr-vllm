# Cloudflare WARP Setup - RESOLVED ✅

**Status**: 100% Complete - All Issues Resolved
**Last Updated**: 2025-10-09
**Resolution**: Split tunnel policy updated via API with Zero Trust-scoped token

> **Note**: This document is kept for historical reference. For current WARP usage, see `docs/warp-next-action.md`

## Problem Summary

Cloudflare WARP is successfully installed and enrolled in the Zero Trust organization (`goldfishinc`), but kubectl cannot reach the K8s API because the required IP ranges are not included in the split tunnel policy.

**Why kubectl times out**: WARP treats traffic to `10.43.0.1:443` (K8s API) as "local" and bypasses the tunnel because `10.43.0.0/16` is not in the split tunnel include list. Once those three CIDRs are added, all kubectl traffic will stay on the WARP backbone and client certificates will work end-to-end.

### Current State

✅ **Completed**:
- Cloudflared tunnel configured with WARP routing enabled
- Private network routes advertised via tunnel:
  - `10.42.0.0/16` → oceanid-cluster (K8s Pod Network)
  - `10.43.0.0/16` → oceanid-cluster (K8s Service Network - K8s API)
  - `192.168.2.0/24` → oceanid-cluster (Calypso GPU local network)
- WARP client installed via Homebrew
- Device enrolled in Zero Trust organization "goldfishinc"
- Account type: Team (not Free)
- Kubeconfig created at `~/.kube/k3s-warp.yaml` pointing to `https://10.43.0.1:443`

❌ **Blocked**:
- Split tunnel policy only includes Manowar networks (`172.21.0.0/16`, `172.20.0.0/16`)
- Oceanid cluster CIDRs NOT in the include list
- kubectl connection times out because traffic to `10.43.0.1` is not routed through WARP

### Error Symptoms

```bash
$ KUBECONFIG=~/.kube/k3s-warp.yaml kubectl get nodes
E1008 14:23:45.678901   12345 request.go:1058] Waited for 1.234567890s due to client-side throttling
Unable to connect to the server: net/http: TLS handshake timeout
```

**Root cause**: Traffic to `10.43.0.0/16` is not being sent through the WARP tunnel because that CIDR is not in the split tunnel "Include" list.

## Technical Details

### Network Architecture

```
Local Machine (WARP client)
  ↓
  10.43.0.1:443 (kubectl target)
  ↓
  WARP Split Tunnel Policy Check
  ↓
  ❌ NOT in include list → Direct connection attempted (fails)
  ✅ IN include list → WARP tunnel → Cloudflare edge → cloudflared connectors → K8s API
```

### Required Configuration

**Split Tunnel Mode**: Include (current)
**Current Include List** (managed by Zero Trust):
- `172.21.0.0/16` (Manowar network - DO NOT MODIFY)
- `172.20.0.0/16` (Manowar network - DO NOT MODIFY)

**MUST ADD** (oceanid cluster - new entries):
- `10.42.0.0/16` (K8s Pod Network)
- `10.43.0.0/16` (K8s Service Network - K8s API endpoint)
- `192.168.2.0/24` (Calypso GPU local network)

### Key Infrastructure IDs

- **Account ID**: `8fa97474778c8a894925c148ca829739`
- **Tunnel ID**: `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc`
- **Tunnel Name**: `oceanid-cluster`
- **Team Domain**: `goldfishinc.cloudflareaccess.com`
- **Device ID**: `56c338f3-a4ac-11f0-98ce-0ad271a69d3d`
- **K8s API Endpoint**: `10.43.0.1:443` (kubernetes.default.svc.cluster.local)

## Attempted Solutions

### 1. Cloudflare API (Failed)

**Tried**:
- Multiple API endpoints: `/devices/policy`, `/devices/policies`, `/devices/settings_policy`
- Two different API tokens:
  - Admin token: `XlYNisvd114YzU8Im5tIKzfoP6zhf_g1B5dVXJMC` (from ESC)
  - Max perms token: `apx4puf-ajp8EHM_etg`
- Both Bearer and Global API Key authentication methods

**Result**: All attempts returned `{"success": false, "errors": [{"code": 10001, "message": "Unable to authenticate request"}]}`

**Root cause (CONFIRMED)**:
- Tokens are missing **Zero Trust: Read** and **Zero Trust: Write** scopes
- Split tunnel policy is a Zero Trust organization setting, not infrastructure
- The `/devices/settings` endpoint is correct, but requires ZT-scoped tokens

### 2. warp-cli Local Configuration (Incomplete)

**Discovery**: `warp-cli` has `tunnel ip` subcommands:
```
warp-cli tunnel ip --help
Configure split tunnel IPs
```

**Not attempted yet**:
- `warp-cli tunnel ip add` or similar commands
- May be disabled for Zero Trust managed policies (organization-controlled)
- Need to check if local overrides are allowed for Team accounts

### 3. WARP Client UI Reconnection (Failed)

**Tried**: Disconnected and reconnected WARP to force policy refresh
**Result**: Policy did not update with tunnel routes

## Next Steps

### Option 1: Manual Dashboard Configuration (RECOMMENDED)

**Why**: Guaranteed to work, takes 2 minutes

**Steps**:
1. Open Cloudflare Zero Trust Dashboard: https://one.dash.cloudflare.com/8fa97474778c8a894925c148ca829739/settings/devices
2. Navigate to: Settings → WARP Client → Device settings → Split Tunnels
3. Click "Manage" on the Split Tunnel configuration
4. Verify mode is "Include IPs and domains" (should be current setting)
5. Click "+ Add" and add three new entries:
   - `10.42.0.0/16` (description: "K8s Pod Network - oceanid")
   - `10.43.0.0/16` (description: "K8s Service Network - oceanid API")
   - `192.168.2.0/24` (description: "Calypso GPU - oceanid")
6. Save configuration
7. Wait 30-60 seconds for policy to propagate
8. Disconnect and reconnect WARP client
9. Test: `KUBECONFIG=~/.kube/k3s-warp.yaml kubectl get nodes`

**Important**: DO NOT remove or modify the existing Manowar networks (`172.21.0.0/16`, `172.20.0.0/16`)

### Option 2: API Configuration (Fully Automated)

**Prerequisites**:
1. Create new API token with Zero Trust permissions:
   - Navigate to: https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token" → "Create Custom Token"
   - **Permissions** (CRITICAL):
     - `Zero Trust: Read`
     - `Zero Trust: Write`
   - **Account Resources**: Include → Specific account → goldfishinc (8fa97474778c8a894925c148ca829739)
   - Create token and save to ESC:
     ```bash
     pulumi config set --secret cloudflareZeroTrustToken "<TOKEN>"
     ```

2. Update split tunnel include list (endpoint confirmed):
   ```bash
   curl -X PUT \
     "https://api.cloudflare.com/client/v4/accounts/8fa97474778c8a894925c148ca829739/devices/settings" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "split_tunnel": {
         "mode": "include",
         "tunnels": [
           {"address": "172.21.0.0/16", "description": "Manowar network"},
           {"address": "172.20.0.0/16", "description": "Manowar network"},
           {"address": "10.42.0.0/16", "description": "K3s Pod Network - oceanid"},
           {"address": "10.43.0.0/16", "description": "K3s Service Network - oceanid"},
           {"address": "192.168.2.0/24", "description": "Calypso GPU - oceanid"}
         ]
       }
     }'
   ```

**Why this works**:
- The `/devices/settings` endpoint is correct
- Previous tokens failed because they lacked Zero Trust scopes
- Split tunnel policy is an **organization-wide Zero Trust setting**, not infrastructure
- Must use ZT-scoped tokens, not infrastructure/tunnel tokens

**Reference**: https://developers.cloudflare.com/api/operations/zero-trust-devices-update-device-settings-policy

### Option 3: warp-cli Local Override (Experimental)

**Check if available**:
```bash
warp-cli tunnel ip --help
```

**If supported, try**:
```bash
warp-cli tunnel ip add 10.42.0.0/16
warp-cli tunnel ip add 10.43.0.0/16
warp-cli tunnel ip add 192.168.2.0/24
```

**Risk**: May not work for Zero Trust managed devices (organization policy may override local settings)

## Verification Steps

Once CIDRs are added to split tunnel policy:

1. **Check WARP client UI**:
   - Open WARP app → Settings → Advanced → Split Tunnels
   - Verify all 5 CIDRs are listed in "Include" mode

2. **Test kubectl connection**:
   ```bash
   cd ~/Developer/oceanid
   ./scripts/complete-warp-setup.sh
   ```

3. **Expected output**:
   ```
   ✅ WARP is connected (mode: Gateway with WARP)
   ✅ Using kubeconfig: /Users/rt/.kube/k3s-warp.yaml
   ✅ Server URL: https://10.43.0.1:443

   Testing kubectl connection...
   NAME        STATUS   ROLES                  AGE    VERSION
   srv712429   Ready    control-plane,master   120d   v1.31.4+k3s1
   srv712695   Ready    <none>                 120d   v1.31.4+k3s1
   calypso     Ready    <none>                 120d   v1.31.4+k3s1

   ✅ SUCCESS! kubectl works via WARP tunnel!
   ```

4. **Verify Label Studio**:
   ```bash
   KUBECONFIG=~/.kube/k3s-warp.yaml kubectl get pods,svc -n apps
   ```

## Success Criteria

- [ ] Split tunnel policy includes all 5 CIDRs (2 Manowar + 3 oceanid)
- [ ] `kubectl get nodes` works without SSH tunnel
- [ ] No more "TLS handshake timeout" errors
- [ ] Can access all K8s resources via WARP
- [ ] Label Studio deployment verified and accessible

## Files Created

- `~/.kube/k3s-warp.yaml` - Kubeconfig for WARP-based access
- `/Users/rt/Developer/oceanid/scripts/complete-warp-setup.sh` - Verification script
- `/Users/rt/Developer/oceanid/scripts/install-warp.sh` - Installation guide
- `/Users/rt/Developer/oceanid/docs/cloudflare-warp-setup.md` - Architecture docs
- `/Users/rt/Developer/oceanid/docs/warp-setup-commands.md` - Quick reference
- `/tmp/cf_admin_token.txt` - Cloudflare admin token (for API attempts)
- `/tmp/cf_token_clean.txt` - Cleaned token file

## Code Changes Committed

**Commit**: `830af6f` - "feat(cluster): enable WARP routing for Zero Trust private network access"

**Files modified**:
- `cluster/src/components/cloudflareTunnel.ts` - Added `warp-routing: enabled: true`
- `cluster/Pulumi.prod.yaml` - Added `cloudflareAdminToken` secret

## Related Issues

- GitHub Issue #84: "Enable Cloudflare WARP for kubectl access"

## Recommendations

1. **Immediate**: Use Option 1 (Manual Dashboard) to unblock kubectl access
2. **Future**: Investigate correct Cloudflare API token scopes for automation
3. **Documentation**: Update CLAUDE.md to document WARP as primary access method once working
4. **Monitoring**: Consider Zero Trust Gateway logs for traffic visibility

---

**Bottom Line**: Everything is configured correctly except the split tunnel policy. Adding 3 CIDRs via the dashboard will unblock kubectl access immediately.
