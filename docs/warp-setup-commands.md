# WARP Setup - Manual Completion Steps

## Status: 90% Complete ✅

- **Commit**: 830af6f - WARP routing enabled in cloudflared
- **Deployment**: Completed successfully at 2025-10-08 23:08:27Z
- **Tunnel**: oceanid-cluster (6ff4dfd7) - 2 connectors active
- **Routes**: Managed via Cloudflare Zero Trust (remote config) ✅
- **Kubeconfig**: Created at ~/.kube/k3s-warp.yaml ✅
- **Issue**: [#84](https://github.com/goldfish-inc/oceanid/issues/84)

## What's Already Done

✅ WARP routing enabled (remote-managed)
✅ Tunnel redeployed with new configuration
✅ Private network routes configured (10.42.0.0/16, 10.43.0.0/16, 192.168.2.0/24)
✅ Kubeconfig created with correct server URL (https://10.43.0.1:443)
✅ Setup completion script created (`scripts/complete-warp-setup.sh`)
✅ Documentation updated (`docs/cloudflare-warp-setup.md`)

## Manual Steps Required (Only WARP Client Installation)

### ~~Step 1: Configure Private Network Routes~~ ✅ DONE

Routes configured via `cloudflared` CLI:
- ✅ `10.42.0.0/16` - K3s Pod Network
- ✅ `10.43.0.0/16` - K3s Service Network (K8s API at 10.43.0.1)
- ✅ `192.168.2.0/24` - Local network (Calypso GPU)

Verify at: https://one.dash.cloudflare.com/ → Networks → Routes

### Step 2: Configure Split Tunnels (Optional - Dashboard)

1. Go to: **Settings** → **WARP Client** → **Device Settings**
2. Find **Split Tunnels** section
3. Click **Manage**
4. Mode: **Include IPs and domains**
5. Add these entries:
   - `10.42.0.0/16`
   - `10.43.0.0/16`
   - `192.168.2.0/24`

### Step 3: Enable Device Enrollment

1. Go to: **Settings** → **WARP Client**
2. Click **Manage** under "Device enrollment permissions"
3. Add rule:
   - **Name**: Allow Ryan's devices
   - **Criteria**: Email equals `ryan@goldfish.io`
   - **Action**: Allow

### Step 4: Install WARP Client

```bash
# Install (requires sudo password)
brew install --cask cloudflare-warp
```

### Step 5: Enroll Device

1. Open **Cloudflare WARP** application from Applications
2. Click **Settings** (gear icon)
3. Go to **Account** → **Login with Cloudflare Zero Trust**
4. Enter team name from Zero Trust URL: `https://<team-name>.cloudflareaccess.com/`
5. Complete authentication (email OTP to `ryan@goldfish.io`)
6. Set mode to: **Gateway with WARP**
7. Verify status shows: **Connected**

### ~~Step 6: Update kubeconfig~~ ✅ DONE

Kubeconfig created at: `~/.kube/k3s-warp.yaml`

To test (after WARP client is installed and enrolled):

```bash
# Switch to WARP config
export KUBECONFIG=~/.kube/k3s-warp.yaml

# Test connection (NO SSH TUNNEL NEEDED!)
kubectl get nodes
```

Or use the automated script:

```bash
./scripts/complete-warp-setup.sh
```

Expected output:
```
NAME      STATUS   ROLES                  AGE   VERSION
tethys    Ready    control-plane,master   XXd   v1.33.4+k3s1
styx      Ready    control-plane,master   XXd   v1.33.4+k3s1
calypso   Ready    worker                 XXd   v1.33.4+k3s1
```

### Step 7: Update Shell Config

Add to `~/.zshrc`:

```bash
# Cloudflare WARP kubeconfig (default)
export KUBECONFIG="$HOME/.kube/k3s-warp.yaml"

# Aliases for switching
alias kube-warp="export KUBECONFIG=$HOME/.kube/k3s-warp.yaml"
alias kube-ssh="export KUBECONFIG=$HOME/.kube/k3s-config.yaml"
```

Then: `source ~/.zshrc`

## Verification Checklist

After completing setup:

- [ ] WARP client shows "Connected" status
- [ ] `kubectl get nodes` works without SSH tunnel
- [ ] No TLS certificate errors
- [ ] Connection survives network changes (WiFi → Ethernet)
- [ ] Reconnects automatically after laptop sleep/wake

## Troubleshooting

### WARP not connecting

Check WARP CLI status:
```bash
# Install CLI (if not already)
brew install cloudflare/cloudflare/cloudflared

# Check status
warp-cli status

# Check settings
warp-cli settings
```

### kubectl connection timeout

Verify routes are advertised:
```bash
# Check Zero Trust dashboard
# https://one.dash.cloudflare.com/ → Networks → Routes

# Should show:
# - 10.42.0.0/16 → oceanid-cluster
# - 10.43.0.0/16 → oceanid-cluster
# - 192.168.2.0/24 → oceanid-cluster
```

### TLS certificate errors

Make sure you're using private IP:
```bash
kubectl config view | grep server:
# Should show: https://10.43.0.1:443
# NOT: https://k3s.boathou.se:443
```

## Account Information

- **Cloudflare Account ID**: `8fa97474778c8a894925c148ca829739`
- **Tunnel ID**: `6ff4dfd7-2b77-4a4f-84d9-3241bea658dc`
- **Tunnel Name**: `oceanid-cluster`
- **Zone**: `boathou.se` (a81f75a1931dcac429c50f2ee5252955)

## After WARP Works

Once kubectl is stable via WARP:

1. **Verify Label Studio deployment**:
   ```bash
   kubectl get helmrelease -n apps
   kubectl get pods -n apps -l app=label-studio
   ```

2. **Update issue #84** with success status

3. **Remove SSH tunnel references** from workflows

4. **Update CLAUDE.md** to document WARP as primary access method

## References

- Full setup guide: `docs/cloudflare-warp-setup.md`
- Tracking issue: [#84](https://github.com/goldfish-inc/oceanid/issues/84)
- Cloudflare Zero Trust: https://one.dash.cloudflare.com/
> Archived: This document references Label Studio flows. Argilla replaces LS; see `docs/operations/pipeline-overview.md` for the current pipeline.
