# Infrastructure Status - 2025-10-12 22:45 UTC

> Archived: includes debugging notes for the retired Label Studio/bootstrapper stack.

## Summary

**DaemonSet-based Tailscale implementation DEPLOYED but blocked by node failure.**

## Progress Today

✅ **Completed**:
1. Fixed Pulumi Kubernetes Operator (PodSecurity issue) - Flux reconciliation working
2. Configured tethys exit node manually (temporary, will be replaced by DaemonSet)
3. Created comprehensive architecture documentation (`ARCHITECTURE_FIXES_2025-10-12.md`)
4. Implemented Kubernetes-native DaemonSet solution (no SSH required)
5. Deployed DaemonSet manifests via Flux GitOps

❌ **Blocked**:
- Styx node (srv712695) **DOWN** - Kubelet stopped 2 days ago
- Cannot deploy Tailscale DaemonSet to failed node
- Worker pods cannot connect to services without Tailscale networking

## Current Infrastructure State

### Nodes
| Node | Status | Role | IP | Issue |
|------|---------|------|-----|-------|
| srv712429 (tethys) | ✅ Ready | Control plane + exit node | 157.173.210.123 | None |
| srv712695 (styx) | ❌ **NotReady** | Worker | 191.101.1.3 | **Kubelet stopped since Oct 10** |
| calypso | ✅ Ready | GPU worker | 192.168.2.80 | None |

### Tailscale DaemonSet Status
| Component | Desired | Current | Ready | Issue |
|-----------|---------|---------|-------|-------|
| tailscale-exit-node (tethys) | 1 | 1 | 0/1 | Hostname validation error (fixed in pending commit) |
| tailscale-worker (styx) | - | - | - | **Node down** |
| tailscale-worker (calypso) | 1 | 1 | 0/1 | CrashLoopBackOff |

## Critical Issue: Styx Node Down

**Symptoms**:
```
srv712695   NotReady   <none>   17d   v1.33.4+k3s1
```

**Node conditions**:
```
MemoryPressure   Unknown   Kubelet stopped posting node status
DiskPressure     Unknown   Kubelet stopped posting node status
PIDPressure      Unknown   Kubelet stopped posting node status
Ready            Unknown   Kubelet stopped posting node status
```

**Last heartbeat**: Fri, 10 Oct 2025 23:45:03 (2 days ago)

**Impact**:
- 40+ pods on styx are in Unknown/Terminating state
- Worker capacity reduced by 33%
- Cannot complete Tailscale rollout
- project-bootstrapper may be on dead node

**Required Action**: Investigate why styx kubelet stopped:
1. SSH to styx: `ssh root@191.101.1.3`
2. Check kubelet: `systemctl status k3s-agent`
3. Check logs: `journalctl -u k3s-agent -n 100`
4. Restart if needed: `systemctl restart k3s-agent`
5. If node is toast: Consider removing and reprovisioning

## DaemonSet Implementation (Almost Working)

**Design**: Kubernetes-native approach eliminating SSH anti-pattern

**Architecture**:
- Exit node DaemonSet (tethys only) - advertises routes, acts as exit node
- Worker DaemonSet (all other nodes) - uses exit node for egress
- HostNetwork + privileged containers (required for TUN device)
- State persistence via hostPath volumes

**Current Error** (fixed in pending commit):
```
"$(NODE_NAME)-oceanid" is not a valid DNS label: must start with a letter or number
```

**Fix**: Removed `--hostname` flag, let Tailscale auto-generate from node name

**Pending Deployment**:
```bash
git add infrastructure/tailscale-daemonset.yaml
git commit -m "fix(tailscale): remove invalid hostname flag with variable expansion"
git push
```

## Next Steps (In Order)

### 1. URGENT: Fix Styx Node ⏱️ 15-30 min
```bash
# SSH to styx
ssh root@191.101.1.3

# Diagnose kubelet
systemctl status k3s-agent
journalctl -u k3s-agent --since "2 days ago" | tail -100

# If fixable, restart
systemctl restart k3s-agent

# If not fixable, drain and remove
kubectl drain srv712695 --ignore-daemonsets --delete-emptydir-data
kubectl delete node srv712695
# Then re-provision or remove from cluster config
```

### 2. Deploy DaemonSet hostname fix ⏱️ 5 min
```bash
git add infrastructure/tailscale-daemonset.yaml
git commit -m "fix(tailscale): remove invalid hostname flag"
GIT_SSH_COMMAND="ssh -i ~/.ssh/claude-code-gh" git push
kubectl -n flux-system annotate gitrepository flux-system reconcile.fluxcd.io/requestedAt="$(date +%s)" --overwrite
```

### 3. Verify Tailscale connectivity ⏱️ 10 min
```bash
# Check DaemonSet pods
kubectl -n tailscale-system get pods -o wide

# Check Tailscale status on each node
kubectl -n tailscale-system exec -it <exit-node-pod> -- tailscale status
kubectl -n tailscale-system exec -it <worker-pod> -- tailscale status

# Verify unified egress IP
kubectl -n tailscale-system exec -it <worker-pod> -- curl -s https://ipinfo.io/ip
# Should return: 157.173.210.123
```

### 4. Test project-bootstrapper ⏱️ 5 min
```bash
# Check if bootstrapper can reach Label Studio
kubectl -n apps logs deploy/project-bootstrapper --tail=20

# Should see successful webhook registration, not "network unreachable"
```

### 5. Update CrunchyBridge firewall ⏱️ 5 min
```bash
# Add unified egress IP
cb network add-firewall-rule \
  --network ooer7tenangenjelkxbkgz6sdi \
  --rule 157.173.210.123/32 \
  --description "Unified K8s egress via Tailscale exit node (tethys)"

# Remove legacy node IPs
cb network list-firewall-rules --network ooer7tenangenjelkxbkgz6sdi
cb network remove-firewall-rule --network ooer7tenangenjelkxbkgz6sdi --rule <OLD_RULE_ID>
```

### 6. Remove temporary manual Tailscale ⏱️ 2 min
```bash
# Already stopped on tethys, just clean up state
ssh tethys "rm -rf /var/lib/tailscale"
```

### 7. Clean up old HostTailscale code ⏱️ 30 min
- Remove `cluster/src/components/hostTailscale.ts`
- Remove references in `cluster/src/index.ts`
- Update `cluster/Pulumi.prod.yaml` to remove `enableHostTailscale`
- Commit with message documenting migration to DaemonSet approach

## Success Criteria

**Immediate** (today):
- [ ] Styx node back online OR removed from cluster
- [ ] DaemonSet pods Running on all healthy nodes
- [ ] All nodes showing unified egress IP (157.173.210.123)
- [ ] project-bootstrapper connecting to Label Studio
- [ ] Worker pods can reach CrunchyBridge database

**Future-proof** (this week):
- [ ] HostTailscale automation code removed
- [ ] Documentation updated with DaemonSet approach
- [ ] External Secrets Operator implemented (next priority)
- [ ] PKO moved to cloud stack (architectural cleanup)

## Lessons Learned

1. ✅ **DaemonSets > SSH automation** - Kubernetes-native approach eliminates connectivity issues
2. ✅ **Pod probes catch errors early** - Readiness/liveness probes prevented cascading failures
3. ✅ **Node monitoring critical** - Styx failure went unnoticed for 2 days
4. ⚠️ **Variable expansion in env vars** - K8s doesn't expand `$(VAR)` in plain strings
5. ⚠️ **Test on dev first** - DaemonSet privilege requirements need validation

## References

- Architecture analysis: `ARCHITECTURE_FIXES_2025-10-12.md`
- DaemonSet manifest: `infrastructure/tailscale-daemonset.yaml`
- Flux GitOps config: `clusters/tethys/infrastructure.yaml`
- Tailscale ACL policy: `policy.hujson`

---

**Status as of 2025-10-12 22:45 UTC**: Proper architecture implemented, blocked by styx node failure. Fix styx, push hostname fix, verify connectivity.
