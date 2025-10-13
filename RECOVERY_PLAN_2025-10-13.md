# Recovery Plan - October 13, 2025

## Immediate Recovery (Next 30 Minutes)

### Goal
Restore both worker nodes (srv712695/styx, calypso) to Ready state with minimal downtime.

---

## Step 1: Force Cleanup Tailscale Pods

**Problem**: Tailscale worker pods stuck in Terminating state, preventing namespace deletion and keeping networking corrupted.

**Solution**: Force delete pods and namespace:

```bash
export KUBECONFIG=/Users/rt/.kube/k3s-warp.yaml

# Force delete terminating pods (if any remain)
kubectl -n tailscale-system delete pod --all --force --grace-period=0

# Force delete namespace to clean up all resources
kubectl delete namespace tailscale-system --force --grace-period=0 --timeout=10s

# If namespace still stuck, remove finalizers
kubectl get namespace tailscale-system -o json | \
  jq '.spec.finalizers = []' | \
  kubectl replace --raw /api/v1/namespaces/tailscale-system/finalize -f -
```

**Expected Outcome**: Namespace and all resources deleted within 30 seconds.

---

## Step 2: Recover srv712695 (Styx) via Hostinger API

**Why This Node First**:
- Cloud VPS with API access
- Can be rebooted remotely without physical intervention
- Reboot clears in-memory routing tables

**Commands**:

```bash
# Get API token from 1Password
STYX_TOKEN=$(op read 'op://Infrastructure/Hostinger VPS - srv712695 (styx)/api_token')

# Get VPS details
curl -s -X GET "https://api.hostinger.com/vps/v1/virtual-machines" \
  -H "Authorization: Bearer $STYX_TOKEN" \
  -H "Content-Type: application/json" | jq '.'

# Extract VM ID (should be in response)
VM_ID="<from-response>"

# Reboot VPS
curl -X POST "https://api.hostinger.com/vps/v1/virtual-machines/$VM_ID/reboot" \
  -H "Authorization: Bearer $STYX_TOKEN" \
  -H "Content-Type: application/json"

# Wait 2-3 minutes for reboot
sleep 180

# Verify node rejoins cluster
kubectl get nodes
```

**Expected Outcome**:
- VPS reboots cleanly
- K3s agent starts automatically on boot
- Node rejoins cluster within 5 minutes
- STATUS: Ready

**If Reboot Fails**:
- Option A: Try soft restart via SSH (if accessible after namespace cleanup)
- Option B: Recreate VPS (Phase 1 procedure)

---

## Step 3: Recover Calypso (GPU Node)

**Challenge**: Local node, requires network/physical access.

### Option A: SSH Access After Namespace Cleanup (Preferred)

After Step 1 completes, attempt SSH:

```bash
# Wait 30 seconds after namespace deletion
sleep 30

# Test SSH connectivity
ssh root@192.168.2.80 "hostname"
```

**If SSH works**:

```bash
# SSH to calypso
ssh root@192.168.2.80

# On calypso:
# 1. Stop k3s agent
sudo systemctl stop k3s-agent

# 2. Clean up any Tailscale remnants
sudo pkill tailscaled 2>/dev/null || true
sudo rm -rf /var/lib/tailscale-worker /var/run/tailscale-worker 2>/dev/null || true

# 3. Reset network routing (CAREFUL - this is aggressive)
sudo iptables -F
sudo iptables -t nat -F
sudo iptables -t mangle -F
sudo iptables -X

# 4. Flush routing rules
sudo ip route flush cache

# 5. Restart k3s agent
sudo systemctl start k3s-agent

# 6. Verify service status
sudo systemctl status k3s-agent

# 7. Check node appears in cluster
exit
kubectl get nodes
```

**Expected Outcome**: Node returns to Ready within 2 minutes.

### Option B: Physical/IPMI Access (If SSH Fails)

**You'll need to provide**:
1. How to access calypso console (IPMI? Physical keyboard/monitor?)
2. Network path to reach 192.168.2.80 (VPN? Local network?)

**Once console access available**:
- Log in as root
- Run same cleanup commands as Option A
- Or reboot: `sudo reboot`

### Option C: Temporary - Drain and Ignore (Last Resort)

If calypso cannot be recovered quickly:

```bash
# Mark node as unschedulable
kubectl cordon calypso

# Drain workloads (Label Studio doesn't need GPU)
kubectl drain calypso --ignore-daemonsets --delete-emptydir-data --force

# Delete node from cluster
kubectl delete node calypso
```

**Consequence**: Cluster runs at 66% capacity, but all critical services work (they're on tethys).

---

## Step 4: Verify Cluster Health

```bash
export KUBECONFIG=/Users/rt/.kube/k3s-warp.yaml

# Check nodes
kubectl get nodes
# Target: 3/3 Ready (or 2/3 if calypso drained)

# Check pods
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
# Target: 0 failures

# Verify critical services
kubectl -n apps get pods -l app=project-bootstrapper
kubectl -n apps get pods -l app.kubernetes.io/name=ls-app

# Test Label Studio connectivity from project-bootstrapper
kubectl -n apps logs deployment/project-bootstrapper --tail=5
# Should show webhook registration success
```

**Success Criteria**:
- ✅ At least 2/3 nodes Ready (srv712429 + srv712695)
- ✅ All critical pods Running
- ✅ project-bootstrapper connecting to Label Studio
- ✅ No CrashLoopBackOff pods

---

## Step 5: Document and Commit

```bash
cd ~/Developer/oceanid

# Stage incident report
git add RECOVERY_PLAN_2025-10-13.md
git add TAILSCALE_DAEMONSET_INCIDENT_2025-10-13.md
git add FUTURE_NETWORKING_ARCHITECTURE.md

# Commit with clear message
git commit -m "docs: incident recovery plan and future networking architecture

Critical incident recovery from Tailscale DaemonSet breaking worker nodes.

Root cause: Applied exit-node configuration to hostNetwork DaemonSet,
corrupting host routing tables and breaking kubelet connectivity.

Recovery: Namespace cleanup + VPS reboot + manual network cleanup

Future architecture: Pod-based egress gateway with NetworkPolicies
instead of host-level networking manipulation.

Related: #110 (Phase 2 blocked), #99, #95"

# Push to remote
git push origin main
```

---

## Timeline Estimate

| Step | Duration | Cumulative |
|------|----------|------------|
| 1. Force cleanup namespace | 2 min | 2 min |
| 2. Reboot srv712695 via API | 5 min | 7 min |
| 3A. SSH cleanup calypso | 3 min | 10 min |
| 3B. Console access (if needed) | 15 min | 25 min |
| 4. Verify cluster health | 3 min | 13-28 min |
| 5. Document and commit | 5 min | 18-33 min |

**Best Case**: 18 minutes (SSH works for calypso)
**Worst Case**: 33 minutes (need console access)
**Critical Path**: Calypso recovery (may require your intervention)

---

## Risk Mitigation

### What Could Go Wrong

1. **Namespace won't delete**:
   - Symptom: Stuck in Terminating for >2 minutes
   - Fix: Remove finalizers (see Step 1 alternate commands)

2. **Styx reboot fails**:
   - Symptom: VPS doesn't come back after reboot
   - Fix: Recreate VPS (Phase 1 procedure, ~20 minutes)

3. **Calypso network permanently corrupted**:
   - Symptom: SSH never recovers, even after namespace cleanup
   - Fix: Physical reboot via console/IPMI

4. **K3s agent won't start**:
   - Symptom: Service fails to start after cleanup
   - Fix: Check logs (`journalctl -u k3s-agent -n 50`), may need k3s reinstall

### Rollback Plan

If recovery fails completely:
- Keep cluster running with tethys only (33% capacity)
- Schedule calypso/styx recovery during maintenance window
- All critical services (Label Studio, project-bootstrapper) work on tethys alone

---

## Post-Recovery Actions

1. **Verify no Tailscale remnants**:
   ```bash
   kubectl get all -A | grep tailscale
   kubectl get clusterrole,clusterrolebinding | grep tailscale
   ```

2. **Check for corrupted routing** (on each recovered node):
   ```bash
   ssh <node> "ip route show | grep -v '10.42\|10.43\|192.168'"
   # Should only see default gateway and local networks
   ```

3. **Test pod-to-service connectivity**:
   ```bash
   kubectl run nettest --rm -i --image=curlimages/curl:latest --restart=Never -- \
     curl -s --max-time 5 http://label-studio-ls-app.apps.svc.cluster.local:8080/health
   # Should return 200 OK
   ```

4. **Update GitHub issues**:
   - Close #110 as blocked
   - Update #99 with "DaemonSet approach abandoned"
   - Comment on #95 with new architecture plan

---

## Next Steps After Recovery

1. ✅ Cluster operational at 66-100% capacity
2. ⏭️ Review and approve new networking architecture
3. ⏭️ Update Phase 2 plan to exclude dangerous networking changes
4. ⏭️ Focus Phase 2 on safe stabilization (config drift, Flux conflicts)

---

**Owner**: @ryan-taylor
**Priority**: CRITICAL
**Status**: Ready to execute
**Estimated Total Time**: 18-33 minutes
