# Argilla Dataset Import

Server-side dataset import from Hugging Face to Argilla.

## Usage

### Manual Import (Run Anytime)

```bash
# Create one-time import job
kubectl create job --from=cronjob/argilla-dataset-importer -n apps argilla-import-$(date +%Y%m%d-%H%M%S)

# Watch job progress
kubectl logs -n apps -l app=argilla-importer -f

# Check job status
kubectl get jobs -n apps -l app=argilla-importer
```

### Scheduled Import (Automatic)

```bash
# Enable daily imports at 2am UTC
kubectl patch cronjob argilla-dataset-importer -n apps -p '{"spec":{"suspend":false}}'

# Disable scheduled imports
kubectl patch cronjob argilla-dataset-importer -n apps -p '{"spec":{"suspend":true}}'

# Check schedule status
kubectl get cronjob argilla-dataset-importer -n apps
```

### Import Different Dataset

```bash
# Override dataset ID
kubectl create job --from=cronjob/argilla-dataset-importer -n apps my-import \
  --dry-run=client -o yaml | \
  sed 's/HF_DATASET_ID: .*/HF_DATASET_ID: "goldfish-inc\/my-other-dataset"/' | \
  kubectl apply -f -
```

## How It Works

1. **ConfigMap** (`argilla-import-scripts`) contains Python import script
2. **CronJob** (`argilla-dataset-importer`) runs scheduled imports
3. **Manual Jobs** created from CronJob template for on-demand imports

**Authentication Flow:**
- HF Token: `argilla-secrets/HF_TOKEN` (from Pulumi ESC)
- Argilla API Key: `argilla-secrets/ADMIN_API_KEY`
- Runs inside cluster, accesses Argilla via `http://argilla:6900`

## Troubleshooting

### Check logs
```bash
kubectl logs -n apps -l app=argilla-importer --tail=100
```

### View failed jobs
```bash
kubectl get jobs -n apps -l app=argilla-importer --field-selector status.successful=0
```

### Delete old jobs
```bash
kubectl delete jobs -n apps -l app=argilla-importer
```

## Configuration

Edit dataset or schedule:
```bash
kubectl edit cronjob argilla-dataset-importer -n apps
```

Default values:
- **Dataset**: `goldfish-inc/deepseekocr-output`
- **Schedule**: Daily at 2am UTC (disabled by default)
- **Workspace**: `argilla`
