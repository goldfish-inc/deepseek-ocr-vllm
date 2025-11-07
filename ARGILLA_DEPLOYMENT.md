# Argilla NER Annotation Platform - Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ K3s Cluster (apps namespace)                                    │
│                                                                  │
│  ┌────────────────┐     ┌──────────────────┐                   │
│  │ Argilla Server │────▶│ PostgreSQL       │                   │
│  │ (label.        │     │ (StatefulSet)    │                   │
│  │  boathou.se)   │     │ Workspace DB     │                   │
│  └────────┬───────┘     └──────────────────┘                   │
│           │                                                      │
│           │ Cloudflare Tunnel (existing)                        │
│           ▼                                                      │
│  label.boathou.se (external access)                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Export Worker (Phase 2 - CronJob)                      │    │
│  │  - Queries Argilla API                                 │    │
│  │  - Uses DuckDB to transform annotations → parquet      │    │
│  │  - Pushes to HF: goldfish-inc/argilla-annotated        │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

External:
  └─▶ HuggingFace Datasets: goldfish-inc/argilla-annotated
       └─▶ Your pipeline: DuckDB → EBISU PostgreSQL
```

## Components Deployed

### Phase 1 (Now): Argilla Server
- **Argilla Server**: v2.8.0, port 6900
- **PostgreSQL**: 17-alpine, 10Gi PVC (workspace only)
- **Cloudflare Tunnel**: Existing `label.boathou.se` routing configured
- **HF OAuth**: Integrated authentication

### Phase 2 (Later): Export Worker
- **CronJob**: Daily export at 2am
- **DuckDB**: Embedded SQL engine for parquet transformation
- **HuggingFace**: Auto-push to `goldfish-inc/argilla-annotated`

## Prerequisites

### 1. Pulumi ESC Secrets

Add these secrets to **Pulumi ESC** under the `oceanid-cluster` environment:

```bash
# In Pulumi ESC (https://app.pulumi.com/goldfish-inc/oceanid-cluster/settings)

# PostgreSQL workspace password (generate random)
argillaPostgresPassword: "<random-password>"

# Argilla auth secret (generate random 32+ chars)
argillaAuthSecret: "<random-secret-key>"

# Admin account credentials
argillaAdminPassword: "<secure-password>"
argillaAdminApiKey: "<random-api-key>"
```

**Generate secrets:**
```bash
# PostgreSQL password
openssl rand -base64 32

# Auth secret key
openssl rand -base64 48

# Admin password (secure, memorable)
openssl rand -base64 24

# Admin API key
openssl rand -hex 32
```

### 2. HuggingFace Dataset Repo

Create the output dataset repo:
```bash
hf auth login
huggingface-cli repo create goldfish-inc/argilla-annotated --type dataset --organization goldfish-inc
```

## Deployment

### Step 1: Configure Cloudflare Tunnel (Already Done ✅)
```typescript
// cloud/src/index.ts - Tunnel ingress rule added
{
    hostname: "label.boathou.se",
    service: "http://argilla.apps.svc.cluster.local:6900",
}
```

### Step 2: Add Secrets to ESC
```bash
# Add all 4 secrets listed above to Pulumi ESC
# via https://app.pulumi.com/goldfish-inc/oceanid-cluster/settings
```

### Step 3: Deploy via CI/CD
```bash
# Commit and push - GitHub Actions will deploy
git add cloud/src/index.ts cluster/src/index.ts clusters/tethys/apps/
git commit -m "feat: deploy Argilla NER annotation platform at label.boathou.se"
git push origin main
```

GitHub Actions will:
1. Deploy Cloudflare tunnel config (cloud stack)
2. Deploy Argilla secrets from ESC (cluster stack)
3. Deploy Argilla + PostgreSQL via Flux (GitOps)

### Step 4: Verify Deployment
```bash
# Check pod status
kubectl get pods -n apps -l app=argilla
kubectl get pods -n apps -l app=argilla-postgres

# Check service
kubectl get svc -n apps argilla

# Check Cloudflare tunnel routing
kubectl logs -n cloudflared -l app.kubernetes.io/name=cloudflared | grep label
```

Access: **https://label.boathou.se**

## Initial Setup

### First Login
1. Navigate to **https://label.boathou.se**
2. Login with admin credentials:
   - **Username**: `admin`
   - **Password**: (from Pulumi ESC `argillaAdminPassword`)
3. Create additional user accounts via UI:
   - Settings → Users → Invite User
   - Add team members with email addresses

### Import Dataset
```python
import argilla as rg

# Connect to self-hosted instance
client = rg.Argilla(
    api_url="https://label.boathou.se",
    api_key="<from-ESC-argillaAdminApiKey>"
)

# Load OCR dataset from HuggingFace
from datasets import load_dataset
ocr_data = load_dataset("goldfish-inc/deepseekocr-output")

# Configure NER dataset
settings = rg.Settings(
    fields=[rg.TextField(name="text", title="OCR Text")],
    questions=[
        rg.SpanQuestion(
            name="entities",
            labels=[
                "VESSEL_NAME", "IMO_NUMBER", "MMSI", "IRCS", "FLAG_STATE",
                "PREVIOUS_NAME", "PREVIOUS_FLAG", "PREVIOUS_OWNER",
                "OWNER", "OPERATOR",
                "IUU_ACTIVITY", "LISTING_DATE", "SANCTIONING_AUTHORITY"
            ]
        )
    ]
)

# Create dataset
dataset = rg.Dataset(
    name="iuu-vessel-ner",
    settings=settings,
    records=[
        rg.Record(fields={"text": item["text"]}, metadata=item)
        for item in ocr_data
    ]
)
dataset.create()
```

## Data Flow

### Input: Raw OCR Text
```python
# Load from HuggingFace
from datasets import load_dataset

ocr_data = load_dataset("goldfish-inc/deepseekocr-output")
```

### Human Annotation in Argilla
- Access https://label.boathou.se
- Login with HuggingFace OAuth
- Annotate with 19 NER entity types:
  - VESSEL_NAME, IMO_NUMBER, MMSI, IRCS, FLAG_STATE
  - PREVIOUS_NAME, PREVIOUS_FLAG, PREVIOUS_OWNER
  - OWNER, OPERATOR
  - IUU_ACTIVITY, LISTING_DATE, DELISTING_DATE
  - SANCTIONING_AUTHORITY, ENFORCEMENT_ACTION
  - VESSEL_TYPE, TONNAGE, LENGTH, GEAR_TYPE

### Output: Structured Parquet (Phase 2)
```python
# Export worker transforms to parquet
# goldfish-inc/argilla-annotated/
#   ├── ner_spans.parquet       # NER training data
#   └── entities.parquet         # Structured for EBISU
```

### Your Pipeline: HF → DuckDB → EBISU
```bash
# Download from HuggingFace
duckdb vessels.db "
  CREATE TABLE entities AS
  SELECT * FROM read_parquet('hf://goldfish-inc/argilla-annotated/entities.parquet')
"

# Load to EBISU PostgreSQL (your existing Makefile)
make ebisu.load.annotations
```

## Phase 2: Export Worker (TODO)

Create `apps/argilla-export-worker/` with:
- **Dockerfile**: Python + DuckDB + Argilla SDK + HuggingFace
- **export.py**: Query Argilla → DuckDB → parquet → HF push
- **CronJob**: Daily at 2am UTC
- **Secret**: HF token from ESC

## Troubleshooting

### Argilla pod not starting
```bash
kubectl describe pod -n apps -l app=argilla
kubectl logs -n apps -l app=argilla
```

Common issues:
- Secrets not synced from ESC (check cluster stack deployment)
- PostgreSQL not ready (check statefulset)

### PostgreSQL issues
```bash
kubectl logs -n apps -l app=argilla-postgres
kubectl exec -it -n apps argilla-postgres-0 -- psql -U argilla -d argilla
```

### Cloudflare tunnel not routing
```bash
# Check tunnel config
kubectl get configmap -n cloudflared cloudflared-config -o yaml

# Check tunnel logs
kubectl logs -n cloudflared -l app.kubernetes.io/name=cloudflared
```

## Security

- **Admin Account**: Username/password authentication, manually invite users
- **Workspace DB**: Internal cluster only, not exposed externally
- **Cloudflare Tunnel**: TLS encrypted, proxied through Cloudflare
- **Secrets**: All managed via Pulumi ESC, never committed to git
- **API Keys**: Unique per-user API keys for programmatic access

## Resources

- **Argilla Docs**: https://docs.argilla.io/
- **HF OAuth**: https://huggingface.co/docs/hub/oauth
- **Pulumi ESC**: https://www.pulumi.com/docs/pulumi-cloud/esc/
