Parquet → MotherDuck Ingestion
==============================

Objectives
----------
- Standardize Parquet outputs (schema.json + partitions)
- Load Parquet to MD tables and expose curated views
- Maintain per‑org authorized views for access control

R2 Layout
---------
- s3://ocean/<dataset>/y=YYYY/m=MM/d=DD/*.parquet
- schema.json at dataset root with field types and version
- Compression: zstd; target file size 128–512 MB

Ingestion Patterns
------------------
- External read (httpfs/r2): create external views; materialize for performance as needed
- CTAS: CREATE TABLE AS SELECT FROM read_parquet('r2://…')
- Refresh: append partitions; recompute materialized aggregates periodically

Curated Views
-------------
- curated.<dataset> — canonical, versioned views over base tables
- Include stable, documented columns; hide internals

Authorized Views
----------------
- org_<id>_<dataset> — SELECT from curated.<dataset> with row‑filters/limits per plan
- Only these views are listed in org_access; ocean UI never sees base tables

Registry
--------
- dataset_registry(name, schema_version, r2_base_uri, last_updated)
- view_registry(view_name, description, dataset_name)

Ops
---
- Validate schema.json on ingest; reject incompatible changes
- Partition compaction when small files proliferate
- Row estimates and last_updated fed to Catalog API
