# WARP Setup - Complete! ✅

**Status**: Fully operational
**Last Updated**: 2025-10-09

## Quick Summary

Cloudflare WARP is fully configured and kubectl works without SSH tunnels! 🎉

- ✅ Cloudflared tunnel has WARP routing enabled
- ✅ Tunnel routes advertised for all oceanid networks
- ✅ WARP client installed and enrolled in Zero Trust
- ✅ Split tunnel policy updated with oceanid CIDRs via API
- ✅ Kubeconfig ready at `~/.kube/k3s-warp.yaml`
- ✅ kubectl verified working: `kubectl get nodes` succeeds

**No more SSH tunnels needed!**

## Daily Usage

```bash
# Verify WARP is connected
warp-cli status

# Set environment variable (or add to ~/.zshrc)
export KUBECONFIG=~/.kube/k3s-warp.yaml

# Use kubectl normally
kubectl get nodes
kubectl get pods -n apps

# Run full verification if needed
./scripts/complete-warp-setup.sh
```

## Configuration Details

### Split Tunnel Policy (✅ Configured)

The Zero Trust split tunnel policy has been configured with all required CIDRs:

**Manowar Networks** (pre-existing, preserved):
- `172.21.0.0/16` - Entire Manowar Local Docker Network including PostgresDB
- `172.20.0.0/16` - KeyCloak Postgres DB

**Oceanid Cluster Networks** (added via API):
- `10.42.0.0/16` - K8s Pod Network
- `10.43.0.0/16` - K8s Service Network (API endpoint at 10.43.0.1)
- `192.168.2.0/24` - Calypso GPU local network

**Configuration method**: Updated via Cloudflare API using Zero Trust-scoped token
**API endpoint**: `PUT /accounts/{account_id}/devices/policy/include`
**Policy mode**: Include (only listed CIDRs go through WARP tunnel)

### WARP Client Details

- **Organization**: `goldfishinc.cloudflareaccess.com`
- **Account Type**: Team (Zero Trust)
- **Mode**: Gateway with WARP
- **Tunnel**: `oceanid-cluster` (6ff4dfd7-2b77-4a4f-84d9-3241bea658dc)
- **Connectors**: 2 active (running on tethys)

### Network Architecture

```
Local Machine (WARP client)
  ↓
  kubectl → 10.43.0.1:443
  ↓
  WARP Split Tunnel Check → 10.43.0.0/16 in include list ✅
  ↓
  WARP Tunnel → Cloudflare Edge
  ↓
  cloudflared connectors (tethys)
  ↓
  K8s API Server (kubernetes.default.svc.cluster.local)
```

**Key benefit**: Client certificates work end-to-end (Layer 4 routing, no TLS termination)

## Verification Output

```bash
$ ./scripts/complete-warp-setup.sh

🔧 Cloudflare WARP Setup - Final Steps
========================================

📡 WARP Status: Status update: Connected
✅ WARP is connected
📝 Kubeconfig server: https://10.43.0.1:443

✅ Kubeconfig is correctly configured

🧪 Testing kubectl access...

✅ SUCCESS! kubectl is working via WARP

NAME        STATUS   ROLES                  AGE   VERSION
calypso     Ready    gpu                    12d   v1.33.4+k3s1
srv712429   Ready    control-plane,master   13d   v1.33.4+k3s1
srv712695   Ready    <none>                 13d   v1.33.4+k3s1

🎉 WARP setup complete!
```

## Troubleshooting

### WARP Not Connected

```bash
# Check status
warp-cli status

# Reconnect if needed
warp-cli disconnect && warp-cli connect

# Verify mode is correct (not consumer)
warp-cli settings | grep mode
# Should show: mode: Gateway with WARP
```

### kubectl Connection Issues

```bash
# Verify kubeconfig is correct
echo $KUBECONFIG
# Should be: /Users/rt/.kube/k3s-warp.yaml

# Verify server URL
grep server ~/.kube/k3s-warp.yaml
# Should show: https://10.43.0.1:443

# Test with explicit kubeconfig
KUBECONFIG=~/.kube/k3s-warp.yaml kubectl get nodes
```

### Split Tunnel Policy Not Applied

```bash
# Wait 60 seconds for policy propagation
sleep 60

# Reconnect WARP to refresh policy
warp-cli disconnect && sleep 2 && warp-cli connect

# Verify policy via API (requires Zero Trust token)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/8fa97474778c8a894925c148ca829739/devices/policy" \
  -H "Authorization: Bearer <ZT_TOKEN>" | jq '.result.include'
```

## Files

- **WARP Kubeconfig**: `~/.kube/k3s-warp.yaml`
- **Verification Script**: `scripts/complete-warp-setup.sh`
- **Installation Script**: `scripts/install-warp.sh`
- **Architecture Docs**: `docs/cloudflare-warp-setup.md`
- **Troubleshooting**: `docs/warp-setup-blocked.md` (historical)

## API Configuration (For Reference)

If split tunnel policy needs to be updated in the future:

```bash
# 1. Get Zero Trust token from 1Password
export ZT_TOKEN=$(op item get "Cloudflare Max Permission" --reveal --fields label=credential)

# 2. Update split tunnel include list
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/8fa97474778c8a894925c148ca829739/devices/policy/include" \
  -H "Authorization: Bearer $ZT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"address": "172.21.0.0/16", "description": "Entire Manowar Local Docker Network including PostgresDB"},
    {"address": "172.20.0.0/16", "description": "KeyCloak Postgres DB"},
    {"address": "10.42.0.0/16", "description": "K8s Pod Network - oceanid"},
    {"address": "10.43.0.0/16", "description": "K8s Service Network - oceanid API"},
    {"address": "192.168.2.0/24", "description": "Calypso GPU - oceanid"}
  ]'

# 3. Reconnect WARP
warp-cli disconnect && warp-cli connect
```

## Next Steps

- ✅ WARP setup complete
- ✅ kubectl access verified
- 📝 Update `~/.zshrc` to make WARP kubeconfig default (optional)
- 📝 Remove SSH tunnel aliases/scripts (deprecated)
- 📝 Update team documentation with WARP as primary access method

---

**Success!** Cloudflare WARP provides stable, secure kubectl access without SSH tunnels. 🚀
