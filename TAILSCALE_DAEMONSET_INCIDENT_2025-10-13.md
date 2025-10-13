# Tailscale DaemonSet Incident Report - October 13, 2025

## Incident Summary
**Severity**: CRITICAL
**Start Time**: 2025-10-13 15:19 UTC
**Duration**: Ongoing
**Impact**: 2/3 worker nodes (calypso, srv712695) offline, cluster at 33% capacity

---

## Root Cause
Deploying Tailscale DaemonSet with `hostNetwork: true` corrupted networking on worker nodes, causing:
- Kubelet unable to communicate with API server
- SSH connectivity lost to both worker nodes
- K3s agent unable to restart

---

## Timeline

### 15:00 UTC - Phase 2 Stabilization Begins
- Started work on completing Tailscale exit node configuration per #110
- Goal: Route all egress traffic through srv712429 (157.173.210.123)

### 15:19 UTC - DaemonSet Deployment
- Applied `/Users/rt/Developer/oceanid/infrastructure/tailscale-daemonset.yaml`
- Configuration:
  ```yaml
  hostNetwork: true  # ⚠️ CRITICAL MISTAKE
  hostPID: true
  TS_EXTRA_ARGS: "--exit-node=100.121.150.65 --exit-node-allow-lan-access"
  ```

### 15:20 UTC - Worker Pods CrashLoopBackOff
- tailscale-worker pods failing with "invalid value for --exit-node"
- Tried multiple fixes:
  1. Exit node by hostname (`srv712429`) - failed
  2. Exit node by Tailscale hostname (`srv712429-oceanid`) - failed
  3. Exit node by Tailscale IP (`100.121.150.65`) - pods started but never became Ready

### 15:22 UTC - Nodes Go NotReady
- calypso: `Kubelet stopped posting node status`
- srv712695: `Kubelet stopped posting node status`
- Kubelet logs via kubectl: `502 Bad Gateway`

### 15:25 UTC - Emergency Rollback Initiated
- `kubectl delete -f tailscale-daemonset.yaml` (completed after 2min timeout)
- Nodes remain NotReady after Tailscale removal

### 15:27 UTC - Connectivity Lost
- SSH to calypso: `Network is unreachable`
- SSH to srv712695: Timeout
- Kubelets not recovering

---

## Technical Analysis

### What Went Wrong

**1. hostNetwork: true Breaks K8s Networking**
- Tailscale interfered with CNI (Flannel) routing
- iptables rules conflicted with K3s networking
- IP forwarding changes broke kubelet → API server connectivity

**2. Exit Node Configuration Issues**
- Tailscale CLI requires either:
  - Fully qualified domain name (not short hostname)
  - Tailscale IP address (100.x.x.x)
  - MagicDNS name
- Our attempts:
  - `srv712429` ❌ (short hostname)
  - `srv712429-oceanid` ❌ (not the actual Tailscale hostname)
  - `100.121.150.65` ✅ (accepted but caused networking corruption)

**3. Readiness Probes Never Passed**
- `tailscale status` command worked but reported connection issues
- Pods stuck in Running/NotReady state
- No obvious error in logs

### Why Nodes Didn't Recover

**Network State Corruption**:
- Tailscale modified iptables/routing tables at host level
- K3s-agent couldn't reach API server (10.43.0.1:443)
- SSH daemon unable to accept connections (network unreachable)

**Persistent State**:
- Tailscale state persisted on host (`/var/lib/tailscale-worker`, `/var/run/tailscale-worker`)
- Even after DaemonSet deletion, Tailscale daemon may still be running
- Routing rules not automatically cleaned up

---

## Current Status

### Cluster Health
```
NAME        STATUS     ROLES                  AGE   VERSION
calypso     NotReady   gpu                    16d   v1.33.4+k3s1
srv712429   Ready      control-plane,master   18d   v1.33.4+k3s1
srv712695   NotReady   <none>                 91m   v1.33.5+k3s1
```

### Accessibility
- ✅ srv712429 (tethys): SSH working, K8s API accessible
- ❌ calypso: SSH unreachable (`Network is unreachable`)
- ❌ srv712695 (styx): SSH timeout

### Service Impact
- Label Studio: ✅ Running on tethys
- project-bootstrapper: ✅ Running on tethys
- CSV workers: ❌ Offline (scheduled on worker nodes)
- Triton adapter: ❌ Offline (requires calypso GPU)

---

## Recovery Options

### Option 1: VPS Console Access (Recommended for calypso - GPU node)
**Calypso is on local network** - requires physical/IPMI access or VPN routing fix

1. Access calypso via local network tools (if available)
2. Clean up Tailscale state:
   ```bash
   sudo systemctl stop tailscaled || true
   sudo rm -rf /var/lib/tailscale-worker /var/run/tailscale-worker
   sudo iptables -F
   sudo iptables -t nat -F
   sudo ip rule flush
   sudo ip route flush cache
   ```
3. Restart k3s-agent:
   ```bash
   sudo systemctl restart k3s-agent
   ```

### Option 2: VPS API Reset (For srv712695/styx only)
Use Hostinger API to reboot VPS:
```bash
# Get VPS ID for srv712695
STYX_TOKEN=$(op read 'op://Infrastructure/Hostinger VPS - srv712695 (styx)/api_token')
curl -X GET "https://api.hostinger.com/vps/v1/virtual-machines" \
  -H "Authorization: Bearer $STYX_TOKEN"

# Reboot VPS
curl -X POST "https://api.hostinger.com/vps/v1/virtual-machines/{vm_id}/reboot" \
  -H "Authorization: Bearer $STYX_TOKEN"
```

### Option 3: Manual Network Recovery (If SSH becomes accessible)
If SSH access is restored:
```bash
# On each affected node
sudo systemctl stop k3s-agent
sudo pkill tailscaled || true
sudo rm -rf /var/lib/tailscale* /var/run/tailscale*
sudo iptables -F
sudo iptables -t nat -F
sudo iptables -X
sudo ip rule flush
sudo ip route flush table all
sudo ip route flush cache
sudo systemctl restart systemd-networkd
sudo systemctl start k3s-agent
```

### Option 4: Node Recreation (Last Resort)
If networking cannot be recovered:
1. Delete node from cluster: `kubectl delete node {nodename}`
2. Recreate VPS via Hostinger API (srv712695 only)
3. Reinstall K3s agent and rejoin cluster
4. Calypso may require physical intervention

---

## Lessons Learned

### What Not To Do
1. ❌ **NEVER use `hostNetwork: true` for Tailscale DaemonSets**
   - Conflicts with CNI networking
   - Breaks kubelet connectivity
   - No clean rollback mechanism

2. ❌ **NEVER deploy untested networking changes to all nodes simultaneously**
   - Should have tested on single worker node first
   - Should have had rollback plan ready
   - Should have verified SSH access before proceeding

3. ❌ **NEVER assume DaemonSet deletion cleans up host state**
   - Tailscale persists routing rules
   - iptables changes survive pod deletion
   - Requires manual cleanup

### What Should Have Been Done
1. ✅ **Test on single node first**
   - Deploy to srv712695 only
   - Verify node stays Ready
   - Test SSH connectivity before proceeding

2. ✅ **Use pod networking, not host networking**
   - Run Tailscale in pod network namespace
   - Use Network Policies for egress control
   - Avoid touching host networking stack

3. ✅ **Have console/OOB access ready**
   - Ensure Hostinger API credentials accessible
   - Document IPMI/console access for local nodes
   - Test emergency access before risky changes

4. ✅ **Implement proper egress routing**
   - Use Kubernetes NetworkPolicies
   - Configure egress gateway pods (not DaemonSets)
   - Route via services, not host networking

---

## Prevention Measures

### Immediate Actions
1. Document this incident in CLAUDE.md
2. Add pre-flight check for `hostNetwork: true` in DaemonSets
3. Create runbook for node network recovery
4. Update Phase 2 plan to exclude DaemonSet approach

### Long-term Solutions
1. Implement proper egress gateway pattern:
   - Dedicated egress pods (not DaemonSets)
   - Service mesh for traffic routing
   - Network policies for pod egress control

2. Improve change management:
   - Require peer review for networking changes
   - Mandate single-node testing first
   - Document rollback procedures before deployment

3. Add monitoring/alerting:
   - Node connectivity checks
   - Kubelet heartbeat monitoring
   - SSH access validation

---

## Next Steps

### Immediate (Next 30 Minutes)
1. ✅ Document incident
2. ⏭️ Attempt VPS reboot for srv712695 via Hostinger API
3. ⏭️ Contact user for calypso physical/network access
4. ⏭️ Update GitHub issue #110 with incident status

### Short-term (Next 24 Hours)
1. Restore both worker nodes to Ready state
2. Clean up Tailscale state on all nodes
3. Re-evaluate egress routing strategy
4. Update Phase 2 plan with alternative approach

### Long-term (Next Week)
1. Implement proper egress gateway solution
2. Add pre-deployment validation checks
3. Create comprehensive node recovery runbook
4. Document prohibited Kubernetes patterns

---

## Related Issues
- #110 - Phase 2: Stabilization (blocked by this incident)
- #99 - Tailscale exit node (DaemonSet approach abandoned)
- #95 - Normalize cluster egress (requires alternative solution)

---

**Status**: ACTIVE INCIDENT - Awaiting user intervention for node recovery
**Owner**: @ryan-taylor
**Last Updated**: 2025-10-13 15:30 UTC
