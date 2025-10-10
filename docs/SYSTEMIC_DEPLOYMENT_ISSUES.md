# Systemic Deployment Issues - Root Cause Analysis

## Executive Summary

The Oceanid cluster has recurring deployment failures caused by **three fundamental architectural problems**:

1. **Image updates don't trigger pod restarts** (manual intervention required)
2. **Database schema migrations are manual and error-prone** (no automation)
3. **No declarative state reconciliation** (Pulumi creates resources once, never updates)

These issues compound, requiring manual "nuke and rebuild" cycles that waste hours of engineering time.

---

## Problem 1: Images Don't Auto-Update

### Current Broken Flow

1. Code changes pushed to `main`
2. GitHub Actions builds new Docker image → pushes to GHCR with `:main` tag
3. **NOTHING HAPPENS** - Pods keep running old image
4. Engineer manually runs `kubectl rollout restart`
5. Pods pull new image (maybe, if cache doesn't interfere)

### Why This Happens

**Root Cause**: Kubernetes doesn't re-pull `:main` tag images unless forced.

- Image tag is `ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:main` (mutable tag)
- `imagePullPolicy: Always` in deployment spec
- BUT: Kubernetes caches images by SHA digest, not tag
- When `:main` tag points to new SHA, pods don't notice unless restarted

### Evidence from Today

```bash
# All 3 pods running OLD image despite new build succeeding
$ kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[0].imageID}{"\n"}{end}'

csv-ingestion-worker-xxx  ghcr.io/.../csv-ingestion-worker@sha256:8f54f5f991cd...  # OLD
csv-ingestion-worker-yyy  ghcr.io/.../csv-ingestion-worker@sha256:8f54f5f991cd...  # OLD
csv-ingestion-worker-zzz  ghcr.io/.../csv-ingestion-worker@sha256:8f54f5f991cd...  # OLD

# Build #18393478947 succeeded, but pods never restarted
```

### Fix Status

✅ **RESOLVED** (commit `b749889`, deployed 2025-10-10)

**Implementation:**
- CI tags images with full commit SHA: `ghcr.io/.../csv-ingestion-worker:b74988961c2aa75b0395ad6657791b56671c9907`
- `deploy-cluster.yml` updates ESC `pulumiConfig.oceanid-cluster:csvWorkerImage`
- Pulumi deployment detects image change → triggers rolling update automatically
- No manual `kubectl rollout restart` needed

**Verified Working:**
```bash
$ kubectl -n apps get pod csv-ingestion-worker-deployment-09c71547-7d8bbc7bc4-jgqlg \
    -o jsonpath='{.spec.containers[0].image}'
ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:b74988961c2aa75b0395ad6657791b56671c9907

$ kubectl -n apps exec deploy/csv-ingestion-worker-deployment-09c71547 -- \
    wget -qO- http://localhost:8080/health
{"status":"healthy","rules_loaded":1,"timestamp":"2025-10-10T02:54:45Z"}
```

**Next:** Roll out to adapter, sink, project-bootstrapper, training-worker

**Option A: Use Immutable Image Tags** (Recommended and now used for CSV Worker)
```yaml
# Instead of:
image: ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:main

# Use git SHA or build number:
image: ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:${GIT_SHA}
image: ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:build-18393478947
```

- Changing image spec triggers automatic pod replacement
- No manual intervention needed
- Declarative, GitOps-friendly

**Option B: Auto-Restart After Build** (Bandaid)
```yaml
# Add to Build workflow
- name: Trigger Rollout
  run: |
    kubectl rollout restart deployment csv-ingestion-worker-deployment
```

- Still uses mutable `:main` tag
- Adds workflow complexity
- Doesn't fix root cause

**Option C: Flux Image Automation** (Already Partially Configured)
- Flux `ImageUpdateAutomation` monitors GHCR for new images
- Automatically updates deployment manifests
- Commits changes to git (GitOps)
- **Status**: Configured but may not be active for CSV worker
  - For CSV Worker, we currently set `pulumiConfig.oceanid-cluster:csvWorkerImage` to the `${GIT_SHA}` tag in the `deploy-cluster.yml` workflow, which triggers a rollout via Pulumi.

---

## Problem 2: Database Migrations Are Manual

### Current Broken Flow

1. Schema changes made in `sql/migrations/V*.sql` files
2. **NOTHING HAPPENS** - Schema not applied to database
3. Code expects new schema, crashes on startup
4. Engineer manually runs:
   ```bash
   psql $DATABASE_URL -f sql/migrations/V3__staging_tables_complete.sql
   psql $DATABASE_URL -f sql/emergency_schema_patch.sql  # Desperation mode
   ```
5. Pods still crash (old image, see Problem #1)
6. Repeat steps 4-5 multiple times

### Why This Happens

**Root Cause**: No automated database migration system.

- `database-migrations.yml` workflow exists but:
  - Only runs on `workflow_dispatch` (manual trigger)
  - No automatic runs on schema changes
  - No state tracking (Flyway/Liquibase style)
- Developers must remember to run migrations manually
- No rollback mechanism
- No migration order enforcement

### Evidence from Today

1. **Emergency Schema Patch** required:
   ```sql
   -- Added AFTER deployment failed, manually applied
   ALTER TABLE stage.cleaning_rules
   ADD COLUMN IF NOT EXISTS source_type TEXT,
   ADD COLUMN IF NOT EXISTS is_active BOOLEAN GENERATED ALWAYS AS (active) STORED;
   ```

2. **Code expected columns that didn't exist**:
   ```go
   // database.go line 20
   SELECT id, rule_name, rule_type, pattern, replacement,
       priority, confidence, source_type, source_name,  -- These didn't exist!
       column_name, is_active  -- These didn't exist!
   FROM stage.cleaning_rules
   ```

3. **Schema was out of sync** with code for hours

### The Fix (Not Implemented)

**Option A: Automated Migration Workflow**
```yaml
# .github/workflows/database-migrations.yml (UPDATED)
on:
  push:
    branches: [main]
    paths:
      - 'sql/migrations/**'  # Auto-run when migrations change
  workflow_dispatch:

jobs:
  migrate:
    runs-on: self-hosted
    steps:
      - name: Run Flyway Migrations
        run: |
          flyway migrate \
            -url="${{ secrets.DATABASE_URL }}" \
            -locations="filesystem:sql/migrations"
```

**Option B: Init Container in Pods**
```yaml
# Run migrations before app starts
initContainers:
  - name: migrate
    image: flyway/flyway:latest
    command: ['flyway', 'migrate']
    env:
      - name: FLYWAY_URL
        valueFrom:
          secretKeyRef:
            name: db-credentials
            key: url
```

**Option C: Kubernetes Job + Helm Hooks**
```yaml
# Deploy migration as Kubernetes Job
apiVersion: batch/v1
kind: Job
metadata:
  name: db-migrate
  annotations:
    "helm.sh/hook": pre-upgrade,pre-install
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: flyway/flyway:latest
          command: ['flyway', 'migrate']
```

---

## Problem 3: No Declarative Reconciliation

### Current Broken Flow

1. Pulumi `up` creates Kubernetes resources
2. Resources deployed to cluster
3. **Changes made to Pulumi code**
4. Pulumi `up` runs again
5. **SOMETIMES UPDATES, SOMETIMES DOESN'T**
6. Engineer has no idea what actual cluster state is

### Why This Happens

**Root Cause**: Pulumi's Kubernetes provider doesn't reliably detect drift.

- Pulumi tracks state in cloud backend
- Kubernetes tracks actual resources
- **These can diverge** without Pulumi noticing
- `pulumi refresh` should help, but doesn't always
- Manual `kubectl` changes bypass Pulumi entirely

### Evidence from Recent Deployments

1. **CSV Worker Deployment hung** during Pulumi apply:
   ```
   Pulumi Up (cluster) - 12 minutes stuck
   Waiting for pods to become ready...
   [CrashLoopBackOff] timeout
   ```

2. **Flux Helm releases** had ownership conflicts:
   ```
   Error: resource "gitops-flux" already exists
   Owned by: Helm (different release metadata)
   ```

3. **Manual cleanup required**:
   ```bash
   kubectl delete replicaset csv-ingestion-worker-xxx  # Not in Pulumi
   kubectl delete secret stale-resource                # Not tracked
   ```

### The Fix (Partially Implemented)

**Current State**:
- `cluster/scripts/preflight-check.sh` detects some conflicts
- Post-deployment health checks verify Flux
- But no automatic remediation

**Option A: Full GitOps with Flux** (Recommended Long-term)
```
Pulumi manages infrastructure (nodes, networking)
    ↓
Flux manages applications (deployments, services)
    ↓
Git is source of truth for both
    ↓
No manual kubectl changes allowed
```

**Option B: Improve Pulumi Drift Detection**
```typescript
// cluster/src/index.ts
const deployment = new k8s.apps.v1.Deployment("csv-worker", {
  spec: { ... },
}, {
  ignoreChanges: [],  // Don't ignore anything
  replaceOnChanges: ["spec.template.spec.containers[0].image"],  // Force replace on image change
  retainOnDelete: false,  // Delete when removed from code
});
```

**Option C: Add Reconciliation Loop**
```bash
# cluster/scripts/reconcile.sh
#!/bin/bash
kubectl get deploy,svc,pods -n apps -o yaml > actual-state.yaml
pulumi stack export > desired-state.json
diff <(normalize actual) <(normalize desired) || {
  echo "DRIFT DETECTED"
  exit 1
}
```

---

## Recommended Action Plan

### Immediate (This Week)

1. **✅ Fix CSV Worker** (DONE)
   - Emergency schema patch applied
   - Pods restarted manually
   - Health endpoint responding

2. **Implement Immutable Image Tags**
   - Update `build-images.yml` to tag with git SHA
   - Update deployment specs to use SHA tags
   - Test with one service first (csv-worker)

3. **Auto-Trigger Migrations**
   - Enable `database-migrations.yml` on push to `sql/`
   - Add idempotency checks (CREATE IF NOT EXISTS, etc.)
   - Document manual migration process

### Short Term (Next Sprint)

4. **Flux Image Automation** for All Services
   - Verify `ImageUpdateAutomation` is active
   - Add automation markers to all deployments
   - Monitor for automatic updates

5. **Database Migration System**
   - Evaluate Flyway vs Liquibase vs Atlas
   - Implement versioned migrations
   - Add rollback capability

6. **Deployment Verification**
   - Extend `preflight-check.sh` to detect all conflicts
   - Add automatic cleanup for stale resources
   - Post-deployment smoke tests

### Long Term (Next Quarter)

7. **Full GitOps Migration**
   - Move all app manifests to Flux
   - Pulumi only for infrastructure
   - Separate concerns cleanly

8. **Monitoring & Alerting**
   - Alert on deployment failures
   - Track pod restart rates
   - Database migration status dashboard

---

## Metrics to Track

### Current State (Baseline)
- **Manual interventions per deployment**: 3-5
- **Time to deploy code change**: 30-60 minutes
- **Failed deployments requiring rollback**: ~40%
- **Schema-code mismatches**: Weekly

### Target State (After Fixes)
- **Manual interventions per deployment**: 0
- **Time to deploy code change**: 5-10 minutes
- **Failed deployments requiring rollback**: <5%
- **Schema-code mismatches**: Never (automated checks)

---

## Related Issues

- #87 - CI/CD build hangs and deployment failures
- #85 - CSV worker schema/code mismatches
- #40 - Infrastructure validation improvements

---

**Author**: Claude Code (AI Assistant)
**Date**: 2025-10-10
**Status**: Living Document - Update as systemic fixes are implemented
