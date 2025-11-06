# Cloudflare Tunnel QUIC Re-enablement Runbook

**Status**: HTTP/2 mode (permanent, by design)
**Last Updated**: 2025-11-06
**Related**: [Issue #270](https://github.com/goldfish-inc/oceanid/issues/270)

---

## Current State

Cloudflare Tunnel runs in **forced HTTP/2 mode** due to QUIC connectivity failures traced to provider-level packet filtering.

**Configuration**: `cluster/src/components/cloudflareTunnel.ts:67`
```yaml
protocol: http2  # Forced; auto/quic both fail
edge-ip-version: "4"
```

**Why HTTP/2?**
- ✅ Stable and performant for server-to-server tunnel
- ✅ QUIC benefits (faster mobile reconnection, congestion control) don't apply to our use case
- ✅ Extensive diagnostics proved QUIC blocked at provider/upstream level

---

## Investigation Summary (2025-11-06)

**Phase 3 UDP Validation** confirmed network path is healthy:
- ✅ UDP to Cloudflare QUIC port (7844): **WORKS**
- ✅ Packet sizes 500-1400 bytes: **ALL SUCCEED** (fragmentation OK)
- ✅ NAT/MASQUERADE: **FUNCTIONING**
- ✅ ICMP/PMTU discovery: **ENABLED**
- ✅ Conntrack capacity: **608/131,072 (no exhaustion)**

**NOTRACK Test** (iptables bypass) had **zero effect**:
- Applied rules to bypass conntrack for QUIC traffic
- Same error: `"failed to dial to edge with quic: timeout: no recent network activity"`
- **Conclusion**: Blocker is BEFORE iptables/conntrack layer

**Root Cause**: Provider-level QUIC filtering
- Simple UDP packets pass
- QUIC Initial packets (specific structure) are inspected/dropped
- Likely OVH or upstream ISP DPI policy

**Commits**:
- `b51526d` - Initial HTTP/2 force (Oct 2025)
- `fd7829e` - Attempted QUIC re-enable (failed)
- `1ada4a2` - Final HTTP/2 lock (Nov 2025)

---

## Re-enable QUIC Playbook

### When to Attempt

Only attempt if:
1. **Provider path changed** (e.g., migrated to Hetzner, AWS, etc.)
2. **OVH confirms QUIC unblocked** (after support ticket with diagnostics)
3. **Network path updated** (e.g., moved to non-VXLAN CNI like Calico/Cilium)

### Prerequisites

```bash
# Verify UDP path is still healthy
ssh tethys 'nc -uzv 162.159.192.1 7844'  # Should succeed

# Check current MTU (should be ≥1200 for QUIC)
ssh tethys 'cat /run/flannel/subnet.env | grep MTU'

# Verify UDP buffers
ssh tethys 'sysctl net.core.rmem_max net.core.wmem_max'
# Should show: 7500000 (set during investigation)
```

### Steps

1. **Update configuration**:
   ```typescript
   // cluster/src/components/cloudflareTunnel.ts:67
   protocol: auto  // Change from http2 to auto
   ```

2. **Commit and push**:
   ```bash
   git add cluster/src/components/cloudflareTunnel.ts
   git commit -m "feat(cloudflared): attempt QUIC re-enable after provider change"
   git push origin main
   ```

3. **Monitor deployment**:
   ```bash
   gh run watch $(gh run list --workflow=cluster-selfhosted.yml --limit=1 --json databaseId --jq '.[0].databaseId')
   ```

4. **Validate QUIC connection**:
   ```bash
   # Wait 2 minutes for pods to stabilize
   kubectl -n cloudflared logs -l app.kubernetes.io/name=cloudflared --tail=50 | grep -E "protocol|Connection|registered"
   ```

5. **Expected success indicators**:
   ```
   INF Initial protocol quic
   INF Registered tunnel connection connIndex=0 ... protocol=quic
   ```

6. **If QUIC fails (fallback to HTTP/2)**:
   ```
   INF Switching to fallback protocol http2
   INF Registered tunnel connection connIndex=0 ... protocol=http2
   ```
   - This is acceptable if HTTP/2 fallback works
   - But if tunnel stays down for >30s, revert immediately

### Rollback

If tunnel fails and doesn't recover to HTTP/2:

```bash
# Immediate revert
git revert HEAD
git push origin main

# OR manual fix
# Edit cluster/src/components/cloudflareTunnel.ts
# Change protocol: auto → protocol: http2
git add cluster/src/components/cloudflareTunnel.ts
git commit -m "fix(cloudflared): revert to HTTP/2 after QUIC failure"
git push origin main
```

### Validation Tests

After QUIC is enabled, run diagnostics:

```bash
# Test tunnel connectivity
curl -sS -X POST https://graph.boathou.se/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{__typename}"}' | jq

# Check connection metrics
kubectl -n cloudflared port-forward svc/cloudflared-metrics 2000:2000 &
curl -s http://localhost:2000/metrics | grep cloudflared_tunnel_
```

---

## Provider Support Ticket Template

If requesting OVH to unblock QUIC:

```
Subject: QUIC/UDP Protocol Filtering on VPS srv712429

Hello,

I'm experiencing QUIC protocol connectivity issues on VPS srv712429 (157.173.210.123).

Evidence:
- Generic UDP packets to Cloudflare edge (162.159.192.1:7844) succeed
- QUIC handshake packets fail with "timeout: no recent network activity"
- Verified with both host and containerized tests
- iptables/conntrack bypass (NOTRACK) had no effect

This suggests upstream/provider-level inspection is dropping QUIC Initial packets.

Request:
- Confirm if QUIC/UDP DPI filtering is active on my VPS or upstream path
- If yes, request allowlist for Cloudflare QUIC endpoints:
  - 162.159.192.0/24
  - 162.159.193.0/24
  - 198.41.192.0/24
  - 198.41.200.0/24
  - Port: 7844/UDP

Diagnostic artifacts available on request.

Thank you
```

---

## Monitoring

**Current monitoring** (HTTP/2 mode):
- Cloudflare dashboard: Tunnel active/inactive status
- Grafana: `cloudflared_tunnel_*` metrics
- Synthetic test: `curl https://graph.boathou.se/graphql` (every 5min via UptimeRobot)

**Additional for QUIC mode**:
- Alert on protocol fallback: `cloudflared_tunnel_protocol != "quic"`
- Alert on handshake failures: `cloudflared_tunnel_connection_failures > 0`

---

## References

- [Issue #270](https://github.com/goldfish-inc/oceanid/issues/270) - Full investigation
- [Phase 3 Diagnostics](/tmp/quic-diagnostics/phase3/FINDINGS.md) - UDP validation results
- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- Commits: `b51526d`, `fd7829e`, `1ada4a2`
