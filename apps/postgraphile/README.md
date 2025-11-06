# PostGraphile GraphQL API

Auto-generates a GraphQL API from PostgreSQL schema (vessels table).

## Production Deployment

**Infrastructure**: K3s cluster (tethys) → apps namespace → ClusterIP service
**Database**: Crunchy Bridge (ebisu cluster, us-east-2)
**Secrets**: Managed via Pulumi ESC (`postgraphileDatabaseUrl`, `postgraphileCorsOrigins`)
**Image**: Built by CI, pushed to `ghcr.io/goldfish-inc/oceanid/postgraphile:latest`

### TLS Configuration

- **Crunchy Bridge**: Strict TLS verification (`rejectUnauthorized: true`)
- **Hostname required**: Uses `p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com` (not IP)
- System CA bundle validates certificate chain

### Deployment Flow

1. Code change to `apps/postgraphile/**`
2. GitHub Actions builds multi-platform image (amd64, arm64)
3. Pushes to GHCR with tags: `latest` and `<git-sha>`
4. Pulumi updates K8s secret from ESC
5. K8s deployment pulls new image (`:latest` tag)
6. Pods restart automatically on config change

### Available Queries

```graphql
# Search vessels by name (trigram similarity)
query {
  searchVesselsList(q: "TAISEI", limitN: 5) {
    id
    entityId
    vesselName
    imo
    mmsi
  }
}

# Get entity summary
query {
  vesselReport(pEntityId: "JK:9086758") {
    entityId
    imos
    mmsis
    names
    rowCount
  }
}

# Browse all vessels
query {
  allVessels(first: 10) {
    nodes {
      entityId
      vesselName
      imo
      mmsi
    }
  }
}
```

## Local Development

### Using Crunchy Bridge

```bash
# Get credentials from ESC
export CB_HOST=p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com
export CB_PORT=5432
export CB_USER=postgres
export CB_PASS=$(pulumi config get postgresPassword --path cluster)
export CB_DB=postgres

# Run PostGraphile locally
make graphql.cb
# → http://localhost:5000/graphql
```

### Using Local Postgres

```bash
# Start local Postgres + load data
make pg.dev.up
make pg.dev.load PARQUET=data/mvp/vessels_mvp.parquet

# Apply schema (extensions, indexes, functions, views)
export POSTGRES_DSN="postgresql+psycopg2://postgres:postgres@localhost:5432/postgres"
python3 scripts/load_supabase.py data/mvp/vessels_mvp.parquet --table vessels

# Start PostGraphile
make graphql.up
# → http://localhost:5000/graphql
```

## Schema Management

### Full Pipeline (Crunchy Bridge)

```bash
export CB_HOST=p.3x4xvkn3xza2zjwiklcuonpamy.db.postgresbridge.com
export CB_PORT=5432
export CB_USER=postgres
export CB_PASS=<from-esc>
export CB_DB=postgres

# Complete setup: load → normalize → schema
make cb.full PARQUET=data/mvp/vessels_mvp.parquet
```

### Individual Steps

```bash
# Load parquet via DuckDB CTAS
make cb.load.parquet PARQUET=data/mvp/vessels_mvp.parquet

# Normalize column names to lowercase (PostGraphile compatibility)
make cb.normalize

# Apply sql/vessels_lookup.sql (extensions, indexes, functions, views)
make cb.schema
```

## Production Operations

### Update Database Schema

1. Edit `sql/vessels_lookup.sql`
2. Apply to Crunchy Bridge: `make cb.schema`
3. Restart PostGraphile pods to refresh introspection cache

### Rotate Database Credentials

1. Update password in Crunchy Bridge console
2. Update ESC: `esc env set default/oceanid-cluster --secret pulumiConfig.oceanid-cluster:postgraphileDatabaseUrl "postgresql://..."`
3. Trigger Pulumi deployment (updates K8s secret)
4. Pods restart automatically

### Check Logs

```bash
# From cluster
kubectl logs -n apps -l app=postgraphile --tail=50

# From local (via SSH)
sshpass -p "TaylorRules" ssh root@157.173.210.123 'kubectl logs -n apps -l app=postgraphile --tail=50'
```

## Configuration

### Environment Variables

- `PORT`: HTTP listen port (default: 8080)
- `DATABASE_URL`: PostgreSQL connection string (from K8s secret)
- `CORS_ORIGINS`: Comma-separated allowed origins (from K8s secret)

### PostGraphile Options

- `dynamicJson: true`: Allow JSON/JSONB fields
- `graphiql: false`: Disabled in production
- `disableDefaultMutations: true`: Read-only API
- `ignoreRBAC: false`: Respect PostgreSQL RLS/grants

## Notes

- GraphiQL disabled in production for security
- CORS configured for `ocean-goldfish.vercel.app` and `ocean.boathou.se`
- All secrets managed via Pulumi ESC (never hardcoded)
- Multi-platform Docker images built by CI (enforced by pre-commit hook)
