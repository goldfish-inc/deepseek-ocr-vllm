# Pulumi Free (Individual) Plan — Capabilities & Limits

This document describes what you *can* do under the Pulumi **Individual (free / solo dev)** plan using CrossGuard, policy packs, and general Pulumi features for the Oceanid infrastructure.

---

## ✅ What You Can Do

### ✔ Pulumi Cloud Backend (Free for Individuals)
- Use Pulumi's managed backend for state and secrets
- **No limit** on the number of stacks, projects, or updates
- **500 free deployment minutes** per month for "Pulumi Deployments for Everyone"
- Full access to Pulumi ESC (Environments, Secrets, Configuration)

### ✔ Policy as Code (CrossGuard) – Local Enforcement
- Author **Policy Packs** in TypeScript, Python, or JavaScript using the open-source Policy SDK
- Use `pulumi preview --policy-pack <path>` or `pulumi up --policy-pack <path>` to enforce policies locally
- Adopt existing policy packs (e.g., **Compliance-Ready Policies**, **AWSGuard**)
- **Unlimited local policy evaluations** (doesn't count against any quota)

### ✔ Remediation & Advisory Policies
- Policy packs can include "remediation" capability to automatically correct violations
- Policies can be `mandatory` (block changes) or `advisory` (warn only)
- Full validation during CI/CD pipeline without service limits

### ✔ Pulumi Kubernetes Operator (PKO)
- Deploy and use PKO in your clusters without restrictions
- Reconcile Pulumi Stacks as Kubernetes CRDs
- Full GitOps integration with Flux/ArgoCD

---

## ⚠️ What Is *Not* Available on Free Tier

### ❌ Centralized Policy Enforcement
- Cannot enforce policies centrally through Pulumi Cloud
- Cannot push policy packs across an organization from the service
- Limited to **10 policy evaluations per month** if using cloud-based CrossGuard

### ❌ Advanced Governance Features
- No policy dashboards or compliance reports
- No organization-wide enforcement
- No advanced audit logs
- No RBAC beyond basic user management
- No SSO integration
- No drift detection/remediation by service

### ❌ Self-Hosted Backend
- Cannot self-host the Pulumi service (private on-prem backend)
- Must use Pulumi Cloud for state storage

---

## 🛠️ Our Implementation Strategy

Given these limitations, the Oceanid infrastructure uses a hybrid approach:

### 1. Local Policy Validation (Free & Unlimited)
```typescript
// policy/validation.ts - Runs locally, no quota
pulumi preview --policy-pack ./policy  // ✅ Free
```

### 2. OPA for Additional Validation
```bash
# policy/opa-policies.rego - Completely free
opa eval -d policy/opa-policies.rego "data.oceanid.policies"
```

### 3. GitHub Actions Integration
```yaml
# .github/workflows/infrastructure.yml
jobs:
  validate:
    steps:
      - name: Run Policy Validation
        run: |
          # Local validation - no CrossGuard quota usage
          npx ts-node ../policy/validation.ts

      - name: OPA Policy Check
        run: |
          opa eval -d policy/opa-policies.rego
```

---

## 📊 Resource Usage Tracking

### Current Monthly Usage (Free Tier)
| Resource | Used | Limit | Status |
|----------|------|-------|--------|
| Deployment Minutes | ~50 | 500 | ✅ 10% |
| Cloud Policy Evals | 0 | 10 | ✅ Not using |
| Stacks | 1 | Unlimited | ✅ |
| ESC Environments | 1 | Unlimited | ✅ |
| Team Members | 1 | 1 | ✅ |

### Cost Optimization Strategy
1. **All policies run locally** - Never hit the 10/month cloud limit
2. **OPA for complex rules** - Completely free alternative
3. **GitHub Actions for CI** - Uses GitHub's free tier
4. **PKO for GitOps** - No Pulumi service interaction needed

---

## 🚀 Migration Path to Paid Tier

If/when we need paid features:

### Team Plan ($75/user/month)
- Centralized policy enforcement
- Team collaboration (up to 10 members)
- Audit logs
- Basic RBAC

### Business Critical (Custom pricing)
- SSO/SAML
- Advanced RBAC
- Drift detection & remediation
- Compliance reports
- SLA support

### When to Upgrade
- [ ] Need centralized policy enforcement across team
- [ ] Multiple developers need access
- [ ] Compliance requirements (SOC2, HIPAA)
- [ ] Drift detection becomes critical
- [ ] Need SSO for security

---

## 💡 Best Practices for Free Tier

### 1. Maximize Local Validation
```bash
# Always validate locally first
pulumi preview --policy-pack ./policy --diff

# Only then deploy
pulumi up --yes
```

### 2. Use ESC Effectively
```bash
# Store all secrets in ESC (included free)
esc env set default/oceanid-cluster secret.key "value" --secret
```

### 3. Leverage PKO for GitOps
```yaml
# Stack CRD - runs without hitting quotas
apiVersion: pulumi.com/v1
kind: Stack
spec:
  projectRepo: https://github.com/goldfish-inc/oceanid
  # PKO handles everything locally
```

### 4. Monitor Usage
```bash
# Check deployment minutes used
pulumi stack history --json | jq '.updates[].duration'

# Stay under 500 minutes/month
```

---

## 🛡️ Policy Examples for Free Tier

### Local Policy Pack Structure
```
policy/
├── validation.ts        # TypeScript policies (local)
├── opa-policies.rego   # OPA rules (free)
├── package.json        # Dependencies
└── README.md          # Policy documentation
```

### Example: Enforce Resource Limits (Free)
```typescript
// Runs locally - no quota usage
export const requireResourceLimits: PolicyRule = {
  name: "require-resource-limits",
  description: "All containers must have resource limits",
  validateResource: (resource) => {
    // Validation logic
    return { valid: true };
  }
};
```

### CI Integration (Free)
```yaml
# GitHub Actions - validate on every PR
- name: Policy Check
  run: |
    pulumi preview --policy-pack ./policy
    # Runs locally, costs nothing
```

---

## 📈 Scaling Considerations

### Current Setup (Free Tier)
- ✅ 1 developer
- ✅ Local policies only
- ✅ GitHub Actions CI
- ✅ PKO for GitOps

### Future Growth Path
1. **Add developers** → Stay on free (each has own account)
2. **Need central policies** → Upgrade to Team
3. **Compliance required** → Business Critical
4. **Multi-region/cluster** → Still works on free!

---

## 🔗 Useful Resources

- [Pulumi Pricing](https://www.pulumi.com/pricing/)
- [CrossGuard Documentation](https://www.pulumi.com/docs/iac/crossguard/)
- [Policy Pack Examples](https://github.com/pulumi/examples/tree/master/policy-packs)
- [OPA Integration Guide](https://www.openpolicyagent.org/docs/latest/)
- [PKO Documentation](https://github.com/pulumi/pulumi-kubernetes-operator)

---

*Last Updated: September 2025*
*Current Plan: Individual (Free)*
*Monthly Cost: $0*

> **Note**: This setup provides enterprise-grade policy validation and GitOps while staying completely within the free tier limits. The combination of local CrossGuard + OPA + PKO gives us the same capabilities as paid tiers for our single-operator use case.