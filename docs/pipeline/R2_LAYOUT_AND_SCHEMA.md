R2 Layout and Schema Contracts
==============================

Layout
------
- s3://ocean/<dataset>/schema.json
- s3://ocean/<dataset>/y=YYYY/m=MM/d=DD/*.parquet

Schema Contract (schema.json)
-----------------------------
{
  "version": "1.0.0",
  "fields": [
    { "name": "event_id", "type": "string" },
    { "name": "vessel_id", "type": "string" },
    { "name": "event_ts", "type": "timestamp" },
    { "name": "lat", "type": "float" },
    { "name": "lon", "type": "float" }
  ]
}

Rules
-----
- Types must be stable per field; no mixed unions
- Partition keys should be derived from event_ts (y/m/d) when applicable
- Compression: zstd; appropriate row group size for MD/duckdb
- Validate Parquet against schema.json on each ingest
