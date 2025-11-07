# ✅ Local PostGraphile Setup - READY TO USE

**Date:** 2025-11-06

## What's Running

```
✅ PostgreSQL 17.6  → localhost:5433
✅ PostGraphile API → http://localhost:5001/graphiql
✅ 36,122 vessels loaded
```

## Quick Test

GraphQL endpoint working:
```bash
curl http://localhost:5001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ allVessels(first: 5) { nodes { vesselName imo mmsi } } }"}'
```

**Result:** ✅ Returns vessel data!

## For @ocean Platform

Add to your `.env.local`:
```bash
VITE_GRAPHQL_ENDPOINT=http://localhost:5001/graphql
```

### Example Queries

**Search vessels:**
```graphql
query SearchVessels {
  allVessels(
    first: 10
    condition: { vesselName: "PACIFIC" }
  ) {
    nodes {
      vesselName
      imo
      mmsi
      vesselFlag
    }
  }
}
```

**Get specific vessel:**
```graphql
query GetVessel {
  allVessels(
    condition: { imo: "9086758" }
  ) {
    nodes {
      vesselName
      imo
      mmsi
      vesselFlag
      entityId
    }
  }
}
```

## Container Management

```bash
# Stop
docker-compose down

# Start
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs postgraphile
docker-compose logs postgres
```

## Reload Data

If you need to reload:
```bash
# Load fresh parquet
duckdb -c "INSTALL postgres; LOAD postgres; \
  ATTACH 'postgresql://postgres:postgres@localhost:5433/vessels' AS pg (TYPE POSTGRES); \
  CREATE OR REPLACE TABLE pg.vessels AS SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet');"
```

## Notes

- **Port changes:** Postgres on 5433 (not 5432), PostGraphile on 5001 (not 5000)
- **No SSL:** Local setup doesn't require SSL
- **EBISU views:** Not loaded yet (not needed for basic vessel queries)
- **Data:** 36,122 vessels from MVP dataset

## Next Steps for @ocean

Now you can build components in @ocean that:
1. Query `http://localhost:5001/graphql`
2. Display vessel search results
3. Show vessel detail pages
4. All with clean, real data!

No need to touch @oceanid - data is loaded and API is serving! 🚀
