# Oceanid Infrastructure Fixes - Full Pulumi IaC & ESC

## 🚨 Critical Issues to Fix

### 1. Node Provisioning (Currently Manual)
**Problem**: k3s installation done via SSH scripts
**Solution**: Use Pulumi Command provider to automate node provisioning

### 2. Security Issues
**Problem**: Direct k3s API exposure, root passwords, keys in wrong places
**Solution**:
- Route k3s API through Cloudflare tunnel
- Use SSH keys only (no passwords)
- Store all secrets in Pulumi ESC

### 3. Cloudflare Tunnel Not Working
**Problem**: Tunnel running but not proxying k3s API
**Solution**: Configure ingress rules for k3s API endpoint

### 4. Not Everything in IaC
**Problem**: Manual node setup, DNS, networking
**Solution**: Define everything in Pulumi TypeScript

## 📋 Implementation Plan

### Phase 1: Secure Existing Infrastructure
- [x] Move SSH keys from /tmp to ~/.ssh/oceanid
- [ ] Remove root passwords, enforce key-only auth
- [ ] Configure Cloudflare tunnel for k3s API
- [ ] Add network policies

### Phase 2: Full Pulumi IaC Implementation
- [ ] Create Pulumi resources for node provisioning
- [ ] Add Cloudflare DNS management
- [ ] Implement secret rotation with ESC
- [ ] Add health checks and monitoring

### Phase 3: GitOps Workflow
- [ ] GitHub Actions for Pulumi deployments
- [ ] Automated secret rotation
- [ ] Compliance scanning

## 🔧 Technical Implementation

### Node Provisioning with Pulumi
```typescript
// Use Pulumi Command provider for remote provisioning
import * as command from "@pulumi/command";

// Provision k3s on nodes
const k3sInstall = new command.remote.Command("install-k3s", {
    connection: {
        host: nodeIp,
        user: "root",
        privateKey: config.requireSecret("ssh_private_key")
    },
    create: `curl -sfL https://get.k3s.io | K3S_TOKEN='${k3sToken}' sh -s - agent`
});
```

### Cloudflare Tunnel Configuration
```typescript
// Configure tunnel ingress for k3s API
const tunnelIngress = new cloudflare.TunnelConfig("k3s-tunnel", {
    tunnelId: config.require("tunnel_id"),
    config: {
        ingress: [{
            hostname: "tethys.boathou.se",
            service: "https://157.173.210.123:6443",
            originRequest: {
                noTLSVerify: true
            }
        }]
    }
});
```

### ESC Secret Management
```yaml
# Pulumi ESC configuration
values:
  ssh:
    private_keys:
      fn::secret:
        fn::file: ~/.ssh/oceanid/tethys_key
  k3s:
    token:
      fn::secret:
        fn::invoke:
          function: aws:secretsmanager:getSecretVersion
          arguments:
            secretId: oceanid-k3s-token
```

## 🎯 Success Criteria
- [ ] All infrastructure defined in Pulumi code
- [ ] No manual SSH commands needed
- [ ] k3s API only accessible through Cloudflare tunnel
- [ ] All secrets in ESC with rotation
- [ ] GitHub Actions for continuous deployment
- [ ] Zero hardcoded credentials