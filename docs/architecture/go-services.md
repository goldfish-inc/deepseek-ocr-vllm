# Go Services Architecture

## Overview

Oceanid application services have been migrated from Python to Go for extreme resource efficiency on limited hardware. This migration achieved a **98.5% reduction in memory usage** while maintaining full functionality.

**Note**: As of November 2025, Oceanid has migrated from Label Studio to Argilla for annotations. Some legacy services (annotations-sink) remain deployed for historical data processing.

## Service Architecture

### 1. Annotations Sink (`annotations-sink`)

**Status**: ⚠️ **Legacy Service** - Still deployed for historical data processing, but NOT in new Argilla pipeline.

**Purpose**: Persists Label Studio annotations to PostgreSQL and HuggingFace Hub (legacy).

**Specifications**:
- **Language**: Go (lib/pq for PostgreSQL)
- **Image**: `ghcr.io/goldfish-inc/oceanid/annotations-sink:main`
- **Base**: `scratch`
- **Size**: ~10MB
- **Memory**: ~5Mi
- **CPU**: ~10m
- **Startup**: <100ms
- **Port**: 8080

**Endpoints**:
- `GET /health` - Health check with DB connectivity status
- `POST /webhook` - Label Studio webhook receiver (legacy)
- `POST /ingest` - Bulk task ingestion (legacy)

**Environment Variables**:
- `DATABASE_URL` - PostgreSQL connection string
- `HF_TOKEN` - HuggingFace API token
- `HF_REPO` - Default HuggingFace dataset repository (fallback)
- `HF_REPO_NER` - NER annotations dataset repository
- `HF_REPO_DOCLING` - Docling annotations dataset repository
- `SCHEMA_VERSION` - Schema version identifier
- `SUBDIR_TEMPLATE` - HF storage path template

The sink routes by task type and vertical, storing outbox shards under:

```
vertical=<vertical>/schema-<version>/project-<id>/YYYY/MM/DD/HH/batch-<uuid>.jsonl

Audit Reference
- Outbox payloads include `source_ref` with the original source URL (if present) and derived S3 location fields: `s3_bucket`, `s3_key`, `s3_version_id`.
- A stable `source_tag` is stored in the outbox table to allow exact lookup of records by S3 object (e.g., `s3://bucket/key#version`).
```

## Resource Comparison (Historical)

| Service | Python | Go | Reduction | Status |
|---------|--------|-------|-----------|--------|
| **Project Bootstrapper** | 50MB RAM / 50m CPU | 1Mi RAM / 1m CPU | 98% / 98% | ❌ Removed (Label Studio deprecated) |
| **Triton Adapter** | 500MB RAM / 100m CPU | 5Mi RAM / 10m CPU | 99% / 90% | ❌ Removed (replaced by vessel-ner Workers) |
| **Annotations Sink** | 200MB RAM / 50m CPU | 5Mi RAM / 10m CPU | 97.5% / 80% | ⚠️ Legacy (still deployed) |
| **Total** | 750MB RAM | 11Mi RAM | **98.5%** | |

## Image Architecture

All services use multi-stage builds:

```dockerfile
# Build stage - compile Go binary
FROM golang:1.23-alpine AS builder
RUN CGO_ENABLED=0 go build -ldflags '-extldflags "-static"'

# Runtime stage - scratch image
FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /build/binary /binary
USER 65534:65534
ENTRYPOINT ["/binary"]
```

Benefits:
- **No OS layer**: Scratch base means no vulnerabilities
- **Static binaries**: No runtime dependencies
- **Non-root**: Runs as nobody user
- **CA certificates**: HTTPS support included

## Deployment Configuration

### Pulumi ESC Settings (Legacy)

Historical configuration (no longer required for new architecture):
```bash
# Deprecated - ls-triton-adapter removed November 2025
# esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:useExternalAdapter" "true"
# esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:adapterImage" "ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:main"

# Legacy - annotations-sink still deployed but not in new pipeline
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:useExternalSink" "true"
esc env set default/oceanid-cluster "pulumiConfig.oceanid-cluster:sinkImage" "ghcr.io/goldfish-inc/oceanid/annotations-sink:main"
```

### Kubernetes Resources

All services include:
- `imagePullSecrets: [{name: "ghcr-creds"}]` for private registry access
- Minimal resource requests/limits
- Health check probes
- ClusterIP services

## Build Pipeline

GitHub Actions workflow (`build-images.yml`) builds active Go services:
- Triggered on push to `apps/annotations-sink/` and other active directories
- Multi-stage Docker builds
- Pushes to GHCR with `:main` and `:sha` tags
- Build cache optimization
- **Note**: `ls-triton-adapter` removed from build pipeline (November 2025)

## Migration Benefits

1. **Resource Efficiency**: 98.5% memory reduction enables deployment on resource-constrained hardware
2. **Fast Startup**: <100ms cold starts vs 3-5s for Python
3. **Predictable Performance**: No GC pauses, consistent latency
4. **Security**: Scratch-based images have no OS vulnerabilities
5. **Simplicity**: Stdlib-only approach reduces dependencies
6. **Operational**: Lower CPU usage means more headroom for ML workloads

## Monitoring

Check active service health:
```bash
# In-cluster
kubectl -n apps get pods
kubectl -n apps top pods

# Health endpoints (legacy services)
curl http://annotations-sink.apps.svc.cluster.local:8080/health

# New architecture (Argilla + vessel-ner Workers)
curl http://argilla.apps.svc.cluster.local/api/health
```

## New Architecture (November 2025)

The Oceanid pipeline has migrated to:
- **Annotation Tool**: Argilla (FastAPI + React, replaces Label Studio)
- **OCR Processing**: Cloudflare Workers (vessel-ner stack) + DeepSeek-OCR vLLM
- **Data Warehouse**: MotherDuck (SQL-based, replaces Label Studio internal DB)
- **Entity Extraction**: Serverless Workers (replaces Triton Adapter)

See:
- `docs/architecture/ocr-argilla-motherduck.md` - New architecture
- `docs/operations/pipeline-overview.md` - End-to-end flow
- `workers/vessel-ner/ARCHITECTURE.md` - Cloudflare Workers design

## Future Considerations

For remaining Go services:
- **Deprecation**: Remove annotations-sink once historical data processing complete
- **Metrics**: Add Prometheus metrics to remaining services
- **Monitoring**: Update dashboards for new Argilla-based pipeline

The Go migration demonstrated that modern cloud-native applications can run efficiently even on severely resource-constrained infrastructure through careful architectural choices and implementation. The new serverless architecture (Cloudflare Workers) continues this philosophy with global edge deployment and automatic scaling.
