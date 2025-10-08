# Cloudflare WARP Setup for Zero-Friction kubectl Access

This guide configures Cloudflare Zero Trust with WARP routing to provide stable, secure kubectl access without SSH tunneling.

## Architecture

**Before (SSH Tunneling)**:
```
Laptop → SSH tunnel → K8s API (unstable, requires manual reconnection)
```

**After (WARP + Private Routing)**:
```
Laptop ⇄ WARP ⇄ Cloudflare backbone ⇄ cloudflared ⇄ K8s API
```

**Key Benefit**: Mutual TLS client certificates work end-to-end (no termination at Cloudflare edge).

## Prerequisites

- ✅ Cloudflare tunnel already deployed (oceanid-cluster: 6ff4dfd7)
- ✅ WARP routing enabled in cloudflared config
- ⏳ Cloudflare Zero Trust account configured
- ⏳ WARP client installed on laptop

## Network Information

### K3s Cluster CIDRs
- **Pod CIDR**: `10.42.0.0/16` (default K3s)
- **Service CIDR**: `10.43.0.0/16` (default K3s)
- **Calypso (GPU node)**: `192.168.2.80/32` (local network)

### Control Plane Access
- **Public IPs**:
  - Tethys: `157.173.210.123` (primary control plane)
  - Styx: (get from config - secondary control plane)
- **K8s API**: Accessible via `kubernetes.default.svc.cluster.local` (10.43.0.1:443)

## Step 1: Enable WARP Routing in Tunnel

✅ **Already done** - Updated `cluster/src/components/cloudflareTunnel.ts` with:

```yaml
warp-routing:
  enabled: true
```

This change will deploy when you push to main (via GitHub Actions).

## Step 2: Configure Private Networks in Cloudflare Zero Trust

### Access the Dashboard
1. Go to: https://one.dash.cloudflare.com/
2. Navigate to: **Networks** → **Tunnels**
3. Select tunnel: **oceanid-cluster** (6ff4dfd7-2b77-4a4f-84d9-3241bea658dc)

### Add Private Network Routes

Click **Private Networks** and add these routes:

| Network CIDR       | Description                  | Priority |
|--------------------|------------------------------|----------|
| `10.42.0.0/16`     | K3s Pod Network              | 1        |
| `10.43.0.0/16`     | K3s Service Network          | 1        |
| `192.168.2.0/24`   | Local network (Calypso GPU)  | 2        |

**Important**: Make sure "Split Tunnels" is configured to **include** these ranges (not exclude).

### Alternative: Use Cloudflare API

```bash
# Get account and tunnel IDs
ACCOUNT_ID="<your-cloudflare-account-id>"
TUNNEL_ID="6ff4dfd7-2b77-4a4f-84d9-3241bea658dc"
API_TOKEN="<your-cloudflare-api-token>"

# Add private network routes
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/teamnet/routes" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "network": "10.42.0.0/16",
    "comment": "K3s Pod Network",
    "tunnel_id": "'"$TUNNEL_ID"'"
  }'

curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/teamnet/routes" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "network": "10.43.0.0/16",
    "comment": "K3s Service Network",
    "tunnel_id": "'"$TUNNEL_ID"'"
  }'

curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/teamnet/routes" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "network": "192.168.2.0/24",
    "comment": "Local network (Calypso GPU)",
    "tunnel_id": "'"$TUNNEL_ID"'"
  }'
```

## Step 3: Configure Zero Trust Device Enrollment

### Enable WARP Enrollment
1. Go to: **Settings** → **WARP Client**
2. Click **Manage** under "Device enrollment permissions"
3. Add a rule to allow enrollment:
   - **Rule name**: "Allow Ryan's devices"
   - **Criteria**: Email equals `ryan@goldfish.io`
   - **Action**: Allow

### Configure Split Tunnels (Critical!)
1. Go to: **Settings** → **WARP Client** → **Device Settings**
2. Find "Split Tunnels" section
3. Mode: **Include IPs and domains** (or **Exclude** if you want all traffic through WARP)
4. Add the following ranges to **Include**:
   - `10.42.0.0/16` (K3s pods)
   - `10.43.0.0/16` (K3s services)
   - `192.168.2.0/24` (Calypso local network)

**Note**: This ensures only cluster traffic goes through WARP, not all your internet traffic.

## Step 4: Install and Configure WARP Client

### macOS Installation
```bash
# Install via Homebrew
brew install --cask cloudflare-warp

# Or download from Cloudflare
# https://install.appcenter.ms/orgs/cloudflare/apps/1.1.1.1-macos/distribution_groups/release
```

### Enroll Device
1. Open Cloudflare WARP application
2. Click **Settings** (gear icon)
3. Go to **Account** → **Login with Cloudflare Zero Trust**
4. Enter your team name (check Zero Trust dashboard URL: `https://<team-name>.cloudflareaccess.com`)
5. Complete authentication (email OTP for `ryan@goldfish.io`)

### Switch to Gateway Mode
1. In WARP settings, select mode: **Gateway with WARP**
2. Verify connection: Status should show "Connected"

## Step 5: Create kubeconfig for WARP Access

### Get K8s API Server IP
```bash
# From inside cluster (via SSH for now)
ssh tethys "kubectl get svc kubernetes -o jsonpath='{.spec.clusterIP}'"
# Output: 10.43.0.1
```

### Create New kubeconfig
```bash
# Copy existing kubeconfig
cp ~/.kube/k3s-config.yaml ~/.kube/k3s-warp.yaml

# Update server URL to use private IP
kubectl config set-cluster default \
  --server=https://10.43.0.1:443 \
  --kubeconfig=~/.kube/k3s-warp.yaml

# Or manually edit ~/.kube/k3s-warp.yaml:
# Change: server: https://localhost:16443
# To:     server: https://10.43.0.1:443
```

**Important**: Keep the existing `certificate-authority-data` and client cert/key. These will work through WARP!

### Test Connection
```bash
# Set KUBECONFIG to use WARP config
export KUBECONFIG=~/.kube/k3s-warp.yaml

# Test kubectl access (no SSH tunnel needed!)
kubectl get nodes

# Expected output:
# NAME      STATUS   ROLES                  AGE   VERSION
# tethys    Ready    control-plane,master   XXd   v1.33.4+k3s1
# styx      Ready    control-plane,master   XXd   v1.33.4+k3s1
# calypso   Ready    worker                 XXd   v1.33.4+k3s1
```

## Step 6: Update Shell Configuration

Add to `~/.zshrc`:

```bash
# Cloudflare WARP kubeconfig (no SSH tunneling required)
export KUBECONFIG="$HOME/.kube/k3s-warp.yaml"

# Alias for switching between configs
alias kube-warp="export KUBECONFIG=$HOME/.kube/k3s-warp.yaml"
alias kube-ssh="export KUBECONFIG=$HOME/.kube/k3s-config.yaml"
```

## Troubleshooting

### WARP not routing to private IPs
```bash
# Check WARP status
warp-cli status

# Verify routes are configured
warp-cli settings

# Check if split tunnels include your cluster CIDRs
warp-cli settings | grep -A5 "Split Tunnels"
```

### kubectl still failing with TLS errors
```bash
# Verify you're using private IP, not public hostname
kubectl config view | grep server:
# Should show: https://10.43.0.1:443
# NOT: https://k3s.boathou.se:443

# Check client certificate is present
kubectl config view --raw | grep client-certificate-data
```

### No route to host / connection timeout
```bash
# Verify WARP is connected
warp-cli status
# Should show: Status update: Connected

# Check private network routes in Zero Trust dashboard
# https://one.dash.cloudflare.com/ → Networks → Routes

# Verify tunnel is advertising routes
cloudflared tunnel info oceanid-cluster
```

### Can't enroll device in Zero Trust
```bash
# Get your team name from Zero Trust dashboard URL
# https://<team-name>.cloudflareaccess.com/

# Check device enrollment rules allow your email
# Zero Trust → Settings → WARP Client → Device enrollment permissions
```

## Benefits After Setup

✅ **No SSH tunnels** - WARP provides stable L4 routing
✅ **Mutual TLS works** - Client certificates pass through end-to-end
✅ **Auto-reconnect** - WARP client handles network changes
✅ **Zero Trust** - Device posture checks + authentication
✅ **Multi-device** - Enroll laptop, desktop, phone, etc.
✅ **Fast** - Cloudflare's global backbone routing

## Reverting to SSH Tunnel (if needed)

```bash
# Use old kubeconfig
export KUBECONFIG=~/.kube/k3s-config.yaml

# Re-establish SSH tunnel
ssh -L 16443:localhost:6443 tethys -N &

# kubectl works as before
kubectl get nodes
```

## Next Steps

Once WARP is working:

1. **Retire SSH tunnel scripts** - No longer needed
2. **Update CLAUDE.md** - Document WARP as primary access method
3. **Enable node tunnels** - Set `enableNodeTunnels: true` for direct node access via `*.nodes.boathou.se`
4. **Configure device policies** - Add posture checks (OS version, disk encryption, etc.)

## References

- [Cloudflare WARP Client](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/)
- [Private Network Routing](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/private-net/)
- [Tunnel Configuration](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/)
- [Split Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/configure-warp/route-traffic/split-tunnels/)
