# CSV Ingestion Worker

## Overview

The CSV Ingestion Worker is a Go microservice that processes CSV/Excel files uploaded to Label Studio, performing data cleaning and extraction with confidence scoring. It's part of Phase 1 of the Oceanid Intelligence Staging pipeline.

## Architecture

```mermaid
flowchart LR
    LS[Label Studio] -->|Webhook| CW[CSV Worker]
    CW -->|Download| S3[S3/MinIO]
    CW -->|Write| DB[(cleandata DB)]
    CW -->|Notify| RM[Review Manager]

    subgraph cleandata Database
        DB --> stage.documents
        DB --> stage.csv_extractions
        DB --> stage.cleaning_rules
        DB --> stage.review_queue
    end
```

## Features

- **Webhook Processing**: Listens for Label Studio TASK_CREATED events
- **File Support**: CSV, XLSX, XLS, TSV formats
- **Confidence Scoring**: Field-level confidence based on data quality
- **Rule Engine**: Database-driven cleaning rules with priority ordering
- **Bulk Inserts**: Efficient PostgreSQL writes using `pq.CopyInSchema`
- **Review Queue**: Flags low-confidence data for human validation
- **Metrics**: Prometheus-compatible metrics endpoint

## Configuration

### Environment Variables

```yaml
DATABASE_URL: postgresql://postgres:***@host:5432/cleandata
S3_BUCKET: labelstudio-goldfish-uploads
S3_REGION: us-east-2
AWS_ACCESS_KEY_ID: ***
AWS_SECRET_ACCESS_KEY: ***
LABEL_STUDIO_URL: http://label-studio.apps.svc.cluster.local:8080
REVIEW_MANAGER_URL: http://review-queue-manager.apps.svc.cluster.local:8080
WEBHOOK_SECRET: (optional) for signature verification
```

### Confidence Configuration

Field-specific confidence thresholds are configured via ConfigMap:

```json
{
  "IMO": { "base": 0.98, "trusted_bonus": 0.02, "untrusted_malus": -0.02 },
  "MMSI": { "base": 0.98, "trusted_bonus": 0.02, "untrusted_malus": -0.02 },
  "VESSEL_NAME": { "base": 0.90, "trusted_bonus": 0.02, "untrusted_malus": -0.02 },
  "DEFAULT": { "base": 0.85, "trusted_bonus": 0.02, "untrusted_malus": -0.02 }
}
```

## Database Schema

### stage.documents
- Tracks processed files with metadata
- Links to Label Studio task IDs

### stage.csv_extractions
- Stores individual cell values with confidence scores
- Contains both raw and cleaned values
- Records applied cleaning rules

### stage.cleaning_rules
- Database-driven rule definitions
- Types: regex_replace, validator, type_coercion, format_standardizer
- Priority-based application

### stage.review_queue
- Human validation queue for low-confidence data
- Tracks review status and corrections

## Deployment

### Kubernetes Resources

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: csv-ingestion-worker
  namespace: apps
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: csv-worker
        image: ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:main
        resources:
          requests:
            memory: "64Mi"
            cpu: "100m"
          limits:
            memory: "128Mi"
            cpu: "500m"
```

### Health Checks

- **Readiness**: `/health` endpoint
- **Liveness**: `/health` endpoint
- **Metrics**: `/metrics` endpoint (Prometheus format)

## Processing Flow

1. **Webhook Receipt**: Label Studio sends TASK_CREATED event
2. **Task Validation**: Verify it's a CSV/Excel file
3. **File Download**: Fetch from S3 using task metadata
4. **Parse File**: Extract headers and rows
5. **Process Cells**:
   - Apply cleaning rules by priority
   - Calculate confidence scores
   - Flag for review if below threshold
6. **Bulk Insert**: Write to PostgreSQL using COPY
7. **Notify Review**: Alert Review Manager if needed

## Cleaning Rules

### Rule Types

- **regex_replace**: Pattern-based text replacement
- **validator**: Pattern validation (affects confidence)
- **type_coercion**: Convert to specific data types
- **format_standardizer**: Apply formatting (uppercase, trim, etc.)

### Default Rules

```sql
-- Trim whitespace
INSERT INTO stage.cleaning_rules (rule_name, rule_type, pattern, replacement, confidence, priority)
VALUES ('trim_whitespace', 'regex_replace', '^\s+|\s+$', '', 0.95, 10);

-- Normalize IMO numbers
VALUES ('normalize_imo', 'regex_replace', '^IMO\s*', '', 0.95, 20);

-- Validate IMO format
VALUES ('validate_imo_format', 'validator', '^\d{7}$', NULL, 0.85, 50);
```

## Monitoring

### Metrics

- `csv_worker_webhooks_received_total`: Webhook count by action/status
- `csv_worker_processed_total`: Processed cells by status/source
- `csv_worker_processing_duration_seconds`: Processing time histogram
- `csv_worker_confidence_score`: Confidence distribution by field type
- `csv_worker_review_queue_size`: Current review queue depth
- `csv_worker_database_errors_total`: Database operation errors

### Logging

Structured JSON logging to stdout:
- Webhook events
- Processing errors
- Database operations
- Review notifications

## Testing

### Local Testing

```bash
# Build and run locally
cd apps/csv-ingestion-worker
go build -o csv-worker
./csv-worker

# Run test script
./test/test-webhook.sh
```

### Verification Script

```bash
# Verify database connection from deployed pod
./test/verify-cleandata-connection.sh
```

## Troubleshooting

### Common Issues

1. **Database Connection Failures**
   - Check DATABASE_URL formatting
   - Verify password URL encoding
   - Confirm network connectivity

2. **S3 Download Errors**
   - Verify AWS credentials
   - Check bucket permissions
   - Confirm file exists in S3

3. **Low Memory**
   - Monitor with `kubectl top pods`
   - Increase limits if processing large files
   - Consider batch size tuning

4. **Review Queue Backlog**
   - Check Review Manager status
   - Adjust confidence thresholds
   - Add more cleaning rules

## Future Enhancements

- [ ] Streaming large file processing
- [ ] Machine learning for confidence scoring
- [ ] Custom rule creation UI
- [ ] Real-time progress updates
- [ ] Data profiling statistics
- [ ] Automatic rule learning from corrections
