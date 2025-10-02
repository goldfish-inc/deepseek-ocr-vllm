# Oceanid Infrastructure

Pulumi-powered GitOps stack for operating the Oceanid K3s fleet behind Cloudflare Zero Trust.

## Overview

Oceanid serves as the **data processing + ML pipeline layer** that cleans and validates data before promotion to the **@ebisu globalDB** (maritime intelligence platform).

## Infrastructure Architecture

| Project | Manages | Runs Where | Triggered By |
|---------|---------|------------|--------------|
| **[cloud/](cloud/)** | Cloudflare DNS/Access, CrunchyBridge PostgreSQL, ESC secrets | GitHub Actions (OIDC) | Push to `cloud/**` |
| **[cluster/](cluster/)** | K3s bootstrap, Flux, PKO, Cloudflare tunnels | Local / Self-hosted runner | Manual `pulumi up` |
| **[clusters/](clusters/)** | Application workloads (Label Studio, etc.) | Flux CD in-cluster | Push to `clusters/**` |
| **[policy/](policy/)** | OPA security policies, TypeScript helpers | GitHub Actions CI | All PRs |

**Key Principle:** Cloud resources (DNS, DB) are automated via CI. Cluster bootstrap requires kubeconfig and runs locally. Applications deploy via GitOps.

## Data Pipeline

```
Raw CSV/PDF → Docling-Granite → ML Cleaning → Human Review
     ↓              ↓                ↓             ↓
Label Studio   Structure      csv-repair     Corrections
             Extraction       -bert

                     ↓ Promotion (audited)

              @ebisu GlobalDB (Production)
```

## Components

- **Triton Inference (Calypso GPU)**: ML models for NER and PDF extraction
- **Label Studio**: Annotation + review UI
- **Staging DB**: Document versions + cleaning audit
- **Ingestion Worker**: Automated CSV processing

## Quick Links

- [Architecture Overview](./docs/architecture/overview.md)
- [Operations Guide](./docs/operations/overview.md)
- [SME Guide](./@docs/guides/SME/index.mdx)
- [Architecture Decisions](./adr/)

## Documentation

- **Setup Guides**: `/docs/guides/setup/` - ESC, GitHub tokens, secrets management
- **Operations**: `/docs/operations/` - ML backend, SQL playground setup
- **SME Guides**: `/@docs/guides/SME/` - Subject matter expert documentation
- **ADRs**: `/docs/adr/` - Architecture decision records
