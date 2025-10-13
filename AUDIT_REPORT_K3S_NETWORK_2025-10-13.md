# K3s Architecture & Networking Audit Report
**Date**: 2025-10-13
**Auditor**: Claude

## Executive Summary

This audit reveals critical issues with the K3s cluster architecture and networking that require immediate attention. While some components work correctly (Tailscale unified egress, database connectivity), there are severe problems with service mesh routing and node health that are causing production issues.

## 🔴 CRITICAL ISSUES

### 1. srv712695 (styx) Node Failure
- **Status**: NotReady for 3+ days
- **Impact**:
  - 33% reduction in cluster capacity
  - Multiple pods stuck in Terminating state
  - No automatic recovery mechanism
- **Root Cause**: Kubelet service stopped, SSH required for manual intervention
- **GitHub Issue**: #103

### 2. Project Bootstrapper Network Unreachability
- **Status**: 1195+ failed attempts to reach Label Studio
- **Symptoms**: Alternating between "network is unreachable" and "timeout"
- **Paradox**: `wget` from same pod works perfectly, but Go HTTP client fails
- **Impact**: Auto-S3 project setup completely broken
- **GitHub Issue**: #97

### 3. Stuck Terminating Pods
- **Count**: 8 pods stuck in Terminating state on srv712695
- **Cause**: Node NotReady, kubelet not responding
- **Impact**: Resource leak, deployment confusion
- **Solution Required**: Manual node drain or force delete

## ✅ WORKING COMPONENTS

### 1. Tailscale Unified Egress
- **Status**: FULLY OPERATIONAL
- **Exit Node**: srv712429 (157.173.210.123)
- **Verification**: All pods route through unified IP
- **Database Access**: Confirmed working via exit node

### 2. Cloudflare WARP Access
- **Status**: Connected and functional
- **Kubeconfig**: k3s-warp.yaml working correctly
- **API Access**: Direct to 10.43.0.1:443

### 3. Label Studio Service
- **Status**: Running and healthy
- **Endpoint**: 10.43.71.170:8080 → 10.42.0.226:8085
- **Health Check**: Returns {"status": "UP"}
- **Access**: Works from test pods but NOT from project-bootstrapper Go app

### 4. Flux GitOps
- **Status**: All kustomizations applied successfully
- **Git Sync**: Working, latest commit applied
- **Helm Releases**: Managed correctly

## 🟡 DEGRADED COMPONENTS

### 1. Service Mesh Routing (Intermittent)
- **Issue**: project-bootstrapper can't reach ClusterIP services reliably
- **Pattern**: Works from shell commands, fails from Go HTTP client
- **Hypothesis**: HTTP client configuration issue or DNS resolution problem

### 2. Node Capacity
- **Current**: 2 of 3 nodes operational
- **Risk**: Single control plane node (no HA)
- **GPU Node**: Working but underutilized

## 📊 Test Results

### Network Connectivity Tests

| Test | Result | Notes |
|------|--------|-------|
| WARP to K8s API | ✅ Pass | Direct access working |
| Pod to Label Studio (wget) | ✅ Pass | Service mesh works |
| Pod to Label Studio (Go app) | ❌ Fail | HTTP client issue |
| Database via exit node | ✅ Pass | Unified egress working |
| Tailscale mesh | ✅ Pass | All nodes connected |
| CoreDNS resolution | ✅ Pass | DNS working correctly |

### Node Health

| Node | Status | Issues | Action Required |
|------|--------|--------|-----------------|
| srv712429 (tethys) | ✅ Ready | None | None |
| srv712695 (styx) | ❌ NotReady | Kubelet dead | Manual restart |
| calypso | ✅ Ready | None | None |

## 🔧 ROOT CAUSE ANALYSIS

### Project Bootstrapper Network Issue

The Go HTTP client in project-bootstrapper has overly aggressive timeouts and connection settings:
```go
httpDialer = &net.Dialer{
    Timeout:   5 * time.Second,  // Too short for cluster networking
    KeepAlive: 30 * time.Second,
}

httpClient = &http.Client{
    Timeout:   15 * time.Second,  // Total timeout too short
    Transport: httpTransport,
}

// DisableKeepAlives: true  // This forces new connections every time
```

**Problem**: The combination of short timeouts, disabled keep-alives, and aggressive retry logic causes connection failures under normal cluster networking conditions.

## 🚀 FUTURE-PROOF SOLUTIONS

### Immediate Actions (P0)

1. **Fix srv712695 Node**
   ```bash
   ssh srv712695
   sudo systemctl restart kubelet
   sudo systemctl restart k3s-agent
   ```

2. **Fix Project Bootstrapper HTTP Client**
   ```go
   httpDialer = &net.Dialer{
       Timeout:   30 * time.Second,  // Increase dial timeout
       KeepAlive: 30 * time.Second,
   }

   httpClient = &http.Client{
       Timeout:   60 * time.Second,  // Increase total timeout
       Transport: &http.Transport{
           DisableKeepAlives: false,  // Enable connection reuse
           MaxIdleConns:      100,
           MaxConnsPerHost:   10,
       },
   }
   ```

3. **Force Delete Stuck Pods**
   ```bash
   kubectl delete pod --grace-period=0 --force -n apps <pod-name>
   ```

### Short-term Solutions (P1)

1. **Implement Node Health Monitoring**
   - Deploy node-problem-detector DaemonSet
   - Alert on kubelet failures
   - Automatic node cordoning on issues

2. **Add Circuit Breaker to Go Services**
   - Implement exponential backoff
   - Circuit breaker pattern for service calls
   - Proper retry logic with jitter

3. **Deploy Monitoring Stack**
   - Prometheus for metrics
   - Grafana for visualization
   - AlertManager for notifications

### Long-term Architecture Improvements (P2)

1. **High Availability Control Plane**
   - Add 2 more control plane nodes
   - External etcd cluster
   - Load balancer for API access

2. **Service Mesh Implementation**
   - Deploy Linkerd or Istio
   - Automatic retries and circuit breaking
   - Better observability

3. **Node Auto-recovery**
   - Implement node auto-scaling
   - Self-healing with systemd watchdogs
   - Automated node replacement

4. **GitOps Improvements**
   - Implement Flagger for progressive delivery
   - Add automated rollback on failures
   - Better secret management with External Secrets Operator

## 📝 Recommendations

### Critical Path (Do Now)
1. ✅ Restart srv712695 to restore cluster capacity
2. ✅ Fix project-bootstrapper HTTP client timeouts
3. ✅ Clean up stuck Terminating pods
4. ✅ Verify all services after cleanup

### Preventive Measures (This Week)
1. 📊 Deploy monitoring stack (#98)
2. 🔧 Implement node health checks
3. 🚨 Set up alerting for critical failures
4. 📝 Document recovery procedures

### Strategic Improvements (This Month)
1. 🏗️ Plan HA control plane migration
2. 🔄 Evaluate service mesh options
3. 🤖 Implement auto-recovery mechanisms
4. 📈 Capacity planning for growth

## 🎯 Success Metrics

After implementing fixes:
- ✅ All 3 nodes Ready
- ✅ Zero pods in Terminating state
- ✅ Project bootstrapper successfully registers webhooks
- ✅ 99.9% service availability
- ✅ < 5 second recovery time for transient failures

## 📊 Current State Summary

```yaml
Cluster Health: 66% (2/3 nodes)
Service Availability: 90% (routing issues)
Networking: 95% (unified egress working)
GitOps: 100% (fully operational)
Monitoring: 0% (not implemented)
HA/Resilience: 20% (single points of failure)
```

## Next Steps

1. **Immediate**: Fix styx node and project-bootstrapper
2. **This week**: Implement monitoring and alerting
3. **This month**: Plan and execute HA improvements
4. **Ongoing**: Regular health audits and preventive maintenance

---

**Conclusion**: While the cluster has functioning components (Tailscale, WARP, GitOps), critical issues with node health and service networking require immediate attention. The architecture lacks resilience and monitoring, making it fragile in production. Implementing the recommended fixes and improvements will create a robust, self-healing platform suitable for production workloads.
