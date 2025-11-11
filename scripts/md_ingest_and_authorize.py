#!/usr/bin/env python3
"""
MotherDuck Ingest + Authorized Views (Week 1)
--------------------------------------------

Purpose
- Load Parquet into curated tables (or views) in a MotherDuck database
- Create per‑org authorized views for a dataset (org_<id>_<dataset>)
- Optionally upsert an entry into a simple catalog table used by ocean's /api/catalog

Requirements
- Python 3.10+
- duckdb>=1.0.0 with MotherDuck extension available
- Environment:
  - MOTHERDUCK_TOKEN        (required to run; otherwise DRY_RUN)
  - MD_DATABASE             (e.g., vessel_intelligence or md_annotated)
  - DATASET                 (e.g., vessel_events)
  - PARQUET_GLOB            (e.g., s3://bucket/path/*.parquet or local glob)
  - ORG_IDS                 (comma‑separated org IDs to authorize, e.g., "org_1,org_2")
  - MATERIALIZE             (optional: "table" (default) or "view")
  - CATALOG_ENABLE          (optional: "1" to write to catalog table)

Usage
  $ export MOTHERDUCK_TOKEN=... MD_DATABASE=vessel_intelligence \
           DATASET=vessel_events PARQUET_GLOB='s3://bucket/ds/*.parquet' \
           ORG_IDS='org_abc,org_def'
  $ python scripts/md_ingest_and_authorize.py

Notes
- When MOTHERDUCK_TOKEN is not set, the script prints SQL (DRY_RUN) instead of executing.
- The authorized view predicate is conservative: exposes full curated dataset, but you can
  edit the WHERE clause to add plan‑gating (e.g., time windows).
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone


def env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    return v if (v is not None and v != "") else default


def build_sql(md_db: str, dataset: str, parquet_glob: str, materialize: str, org_ids: list[str]) -> list[str]:
    ds = dataset.strip()
    stmts: list[str] = []
    stmts.append("CREATE SCHEMA IF NOT EXISTS curated;")
    stmts.append("CREATE SCHEMA IF NOT EXISTS authorized;")

    if materialize.lower() == "view":
        stmts.append(
            f"CREATE OR REPLACE VIEW curated.{ds} AS SELECT * FROM read_parquet('{parquet_glob}');"
        )
    else:
        stmts.append(
            f"CREATE OR REPLACE TABLE curated.{ds} AS SELECT * FROM read_parquet('{parquet_glob}');"
        )

    for org in org_ids:
        safe_org = org.strip().replace("-", "_")
        view_name = f"authorized.org_{safe_org}_{ds}"
        stmts.append(
            (
                f"CREATE OR REPLACE VIEW {view_name} AS\n"
                f"SELECT * FROM curated.{ds};"
            )
        )
        # To gate by plan or org column, replace the SELECT with:
        # SELECT * FROM curated.{ds} WHERE org_id = '{org}'
        # or add time window: AND event_time >= now() - INTERVAL 90 DAY

    # Optional catalog entry upsert (minimal)
    stmts.append(
        (
            "CREATE TABLE IF NOT EXISTS catalog (\n"
            "  view_name TEXT PRIMARY KEY,\n"
            "  title TEXT,\n"
            "  description TEXT,\n"
            "  schema_version TEXT,\n"
            "  last_updated TIMESTAMPTZ,\n"
            "  row_estimate BIGINT,\n"
            "  sample_columns JSON\n"
            ");"
        )
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    for org in org_ids:
        safe_org = org.strip().replace("-", "_")
        vname = f"authorized.org_{safe_org}_{ds}"
        stmts.append(
            (
                "INSERT INTO catalog(view_name, title, description, schema_version, last_updated)\n"
                f"VALUES ('{vname}', '{ds.replace('_', ' ').title()}', NULL, 'v1', '{now_iso}')\n"
                "ON CONFLICT (view_name) DO UPDATE SET last_updated=EXCLUDED.last_updated;"
            )
        )
    return stmts


def run_duckdb(sql_stmts: list[str], md_db: str) -> None:
    import duckdb  # type: ignore

    con = duckdb.connect(database=":memory:")
    con.execute("INSTALL motherduck; LOAD motherduck;")
    token = env("MOTHERDUCK_TOKEN")
    if not token:
        raise RuntimeError("MOTHERDUCK_TOKEN not set; refusing to execute")
    con.execute("SET motherduck_token = ?;", [token])
    con.execute(f"ATTACH 'md:{md_db}' AS md (READ_WRITE);")
    con.execute("SET schema 'md.main';")
    for stmt in sql_stmts:
        con.execute(stmt)
    con.close()


def main() -> int:
    md_db = env("MD_DATABASE") or "vessel_intelligence"
    dataset = env("DATASET") or "vessel_events"
    parquet_glob = env("PARQUET_GLOB") or "./data/*.parquet"
    orgs_raw = env("ORG_IDS") or ""
    org_ids = [o.strip() for o in orgs_raw.split(",") if o.strip()]
    materialize = env("MATERIALIZE", "table") or "table"
    catalog_enable = env("CATALOG_ENABLE", "1") == "1"

    sql_stmts = build_sql(md_db, dataset, parquet_glob, materialize, org_ids)
    if not catalog_enable:
        # strip catalog statements
        sql_stmts = [s for s in sql_stmts if not s.lower().startswith("create table if not exists catalog") and not s.lower().startswith("insert into catalog")]  # noqa: E501

    token = env("MOTHERDUCK_TOKEN")
    if not token:
        print("-- DRY_RUN (no MOTHERDUCK_TOKEN); printing SQL --")
        for s in sql_stmts:
            print(s)
        return 0

    try:
        run_duckdb(sql_stmts, md_db)
        print(f"Ingestion + authorization completed for dataset '{dataset}' in DB '{md_db}'.")
        return 0
    except Exception as e:  # pragma: no cover
        print(f"ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
