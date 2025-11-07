#!/usr/bin/env python3
"""
Load Parquet into PostgreSQL (CrunchyBridge) using DuckDB's Postgres extension.

Inputs
- Arg1: path to Parquet file (e.g., data/mvp/vessels_mvp.parquet)
- Optional flags:
  --table <name>      Target table name (default: vessels)
  --stage             Load into stage.vessels_load with batch tracking

Environment
- POSTGRES_DSN: SQLAlchemy-style DSN (postgresql+psycopg2://user:pass@host:port/db)
  - For CrunchyBridge: postgresql+psycopg2://user:pass@host:5432/db?sslmode=require

Behavior
- Creates or replaces the target table in PostgreSQL from the Parquet file.
- Adds a surrogate PK and indexes (entity_id, imo, mmsi).
- In --stage mode, loads to stage.vessels_load with batch metadata for EBISU processing.
"""

import argparse
import os
import shlex
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


def _sql_quote(s: str) -> str:
    """Escape a Python string for single-quoted SQL literal."""
    return s.replace("'", "''")


def parse_postgres_dsn(dsn: str):
    """Parse a postgresql(+psycopg2) DSN into connection parts for DuckDB attach."""
    u = urlparse(dsn)
    if not u.scheme.startswith("postgresql"):
        raise ValueError("POSTGRES_DSN must use postgresql scheme")

    # Strip optional +driver (e.g., +psycopg2)
    # urlparse already handled it; we just need components
    username = u.username or "postgres"
    password = u.password or ""
    hostname = u.hostname or "localhost"
    port = u.port or 5432
    database = (u.path.lstrip("/") or "postgres")
    return {
        "user": username,
        "password": password,
        "host": hostname,
        "port": port,
        "database": database,
    }


def run(cmd: list[str]) -> None:
    """Run a command, raising on failure."""
    subprocess.run(cmd, check=True)


def duckdb_ctas(parquet_path: Path, table: str, conn: dict) -> None:
    """Use DuckDB CLI to CTAS Parquet -> PostgreSQL table.

    Prefer CONNECTION URL for DuckDB Postgres attach to avoid option-name drift across versions.
    """
    from urllib.parse import quote_plus

    host = conn["host"]
    user = conn["user"] or "postgres"
    pwd = conn["password"] or ""
    db = conn["database"] or "postgres"
    port = int(conn["port"]) if conn.get("port") else 5432

    user_enc = quote_plus(user)
    pwd_enc = quote_plus(pwd)
    conn_url = f"postgresql://{user_enc}:{pwd_enc}@{host}:{port}/{db}?sslmode=require"

    # Build a single SQL script for DuckDB
    # DuckDB 1.4.1 syntax: ATTACH '<connection_url>' AS alias (TYPE POSTGRES);
    sql = (
        "INSTALL postgres; "
        "LOAD postgres; "
        f"ATTACH '{_sql_quote(conn_url)}' AS pg (TYPE POSTGRES); "
        f"CREATE OR REPLACE TABLE pg.{table} AS SELECT * FROM read_parquet('{_sql_quote(str(parquet_path))}'); "
        f"SELECT COUNT(*) AS rows_loaded FROM pg.{table};"
    )

    # Run DuckDB CLI with the command. Avoid printing secrets.
    run(["duckdb", "-c", sql])


def _psql_available() -> bool:
    from shutil import which
    return which("psql") is not None


def _psql_exec(conn: dict, sql: str) -> None:
    env = os.environ.copy()
    env["PGPASSWORD"] = conn["password"]
    cmd = [
        "psql",
        "-h",
        conn["host"],
        "-p",
        str(conn["port"]),
        "-U",
        conn["user"],
        "-d",
        conn["database"],
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
        "-c",
        sql,
    ]
    subprocess.run(cmd, check=True, env=env)

def normalize_column_names(conn: dict, table: str) -> None:
    """Rename columns in `public.table` to lowercase to avoid quoted identifiers.

    Uses psql if available; otherwise attempts psycopg2.
    """
    block = (
        "DO $$ DECLARE r record; BEGIN "
        "FOR r IN SELECT column_name FROM information_schema.columns "
        f"WHERE table_schema='public' AND table_name='{_sql_quote(table)}' LOOP "
        "IF r.column_name <> lower(r.column_name) THEN "
        f"EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', '{_sql_quote(table)}', r.column_name, lower(r.column_name)); "
        "END IF; END LOOP; END $$;"
    )
    # Try psql first
    if _psql_available():
        _psql_exec(conn, block)
        return
    # Fallback to psycopg2
    try:
        import psycopg2  # type: ignore
        dsn = (
            f"postgresql://{conn['user']}:{conn['password']}@{conn['host']}:{conn['port']}/{conn['database']}"
        )
        if "sslmode=" not in dsn:
            dsn += "?sslmode=require"
        with psycopg2.connect(dsn) as c:
            c.autocommit = True
            with c.cursor() as cur:
                cur.execute(block)
    except Exception as e:
        print(f"Column normalization failed (non-fatal): {e}", file=sys.stderr)


def maybe_finalize_db(dsn: str, table: str, conn: dict) -> None:
    """Create extensions, PK, indexes, and UI views.

    Tries psycopg2 first, falls back to psql if available; otherwise prints SQL hints.
    """
    sql_statements = [
        # Extensions (optional but recommended for search)
        "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
        "CREATE EXTENSION IF NOT EXISTS unaccent;",
        # PK + lookup indexes
        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS id bigserial PRIMARY KEY;",
        f"CREATE INDEX IF NOT EXISTS {table}_entity_id_idx ON {table}(entity_id);",
        f"CREATE INDEX IF NOT EXISTS {table}_imo_idx ON {table}(imo);",
        f"CREATE INDEX IF NOT EXISTS {table}_mmsi_idx ON {table}(mmsi);",
        # Trigram index for name search (requires pg_trgm)
        f"CREATE INDEX IF NOT EXISTS {table}_vname_trgm_idx ON {table} USING gin (vessel_name gin_trgm_ops);",
        # UI Views
        "CREATE OR REPLACE VIEW ui_entity_summary AS "
        "SELECT entity_id, "
        "array_agg(DISTINCT imo) FILTER (WHERE COALESCE(imo,'') <> '') AS imos, "
        "array_agg(DISTINCT mmsi) FILTER (WHERE COALESCE(mmsi,'') <> '') AS mmsis, "
        "array_agg(DISTINCT vessel_name) FILTER (WHERE COALESCE(vessel_name,'') <> '') AS names, "
        "COUNT(*) AS row_count "
        f"FROM {table} GROUP BY entity_id;",
        "CREATE OR REPLACE VIEW ui_vessel_conflicts AS "
        f"SELECT imo, array_agg(DISTINCT mmsi) AS mmsis, COUNT(DISTINCT mmsi) AS mmsi_count FROM {table} "
        "WHERE COALESCE(imo,'') <> '' AND COALESCE(mmsi,'') <> '' GROUP BY imo HAVING COUNT(DISTINCT mmsi) > 1;",
    ]

    # Try psycopg2 first
    try:
        import psycopg2  # type: ignore

        psy_dsn = dsn.replace("postgresql+psycopg2://", "postgresql://")
        if "sslmode=" not in psy_dsn:
            sep = "&" if "?" in psy_dsn else "?"
            psy_dsn = f"{psy_dsn}{sep}sslmode=require"
        conn_psy = psycopg2.connect(psy_dsn)
        conn_psy.autocommit = True
        try:
            with conn_psy.cursor() as cur:
                for stmt in sql_statements:
                    try:
                        cur.execute(stmt)
                    except Exception as e:
                        print(f"Non-fatal SQL error: {e} while executing: {stmt}", file=sys.stderr)
        finally:
            conn_psy.close()
        return
    except Exception:
        pass

    # Fallback to psql if available
    if _psql_available():
        for stmt in sql_statements:
            try:
                _psql_exec(conn, stmt)
            except subprocess.CalledProcessError as e:
                print(f"psql error (non-fatal): {e}", file=sys.stderr)
        return

    # Final fallback: print SQL for manual execution
    print(
        "psycopg2/psql not available; run these on PostgreSQL to finalize indexes + views:\n" +
        "\n".join(sql_statements),
        file=sys.stderr,
    )


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("parquet", help="Path to Parquet file")
    ap.add_argument("--table", default="vessels", help="Target table (default: vessels)")
    ap.add_argument("--stage", action="store_true", help="Load into stage.vessels_load (batch-aware)")
    args = ap.parse_args(argv)

    parquet_path = Path(args.parquet)
    if not parquet_path.exists():
        print(f"Parquet not found: {parquet_path}", file=sys.stderr)
        return 2

    dsn = os.environ.get("POSTGRES_DSN")
    if not dsn:
        print("POSTGRES_DSN not set (e.g., postgresql+psycopg2://user:pass@host:5432/db?sslmode=require)", file=sys.stderr)
        print("For CrunchyBridge: set CB_HOST, CB_USER, CB_PASS, CB_DB and use Makefile targets", file=sys.stderr)
        return 2

    try:
        conn = parse_postgres_dsn(dsn)
    except Exception as e:
        print(f"Invalid POSTGRES_DSN: {e}", file=sys.stderr)
        return 2

    target_table = args.table
    if args.stage:
        # We first CTAS into public.vessels_stage then move to stage.vessels_load via psql
        target_table = "vessels_stage"
    print(f"Loading {parquet_path} -> table '{target_table}' …")
    try:
        duckdb_ctas(parquet_path, target_table, conn)
    except subprocess.CalledProcessError as e:
        print("DuckDB load failed (see stderr above)", file=sys.stderr)
        return e.returncode or 1

    # Normalize column names to lowercase for PostGraphile and SQL ergonomics
    try:
        normalize_column_names(conn, target_table)
    except Exception as e:
        print(f"Column normalization warning: {e}", file=sys.stderr)

    # If stage mode, move table to stage schema and append batch metadata
    if args.stage:
        try:
            _psql_exec(conn, "CREATE SCHEMA IF NOT EXISTS stage; CREATE EXTENSION IF NOT EXISTS pgcrypto;")
            _psql_exec(conn, "CREATE TABLE IF NOT EXISTS stage.load_batches (batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), loaded_at timestamptz NOT NULL DEFAULT now(), source TEXT, artifact_checksum TEXT, notes TEXT);")
            _psql_exec(conn, "DROP TABLE IF EXISTS stage.vessels_load; ALTER TABLE public.vessels_stage SET SCHEMA stage; ALTER TABLE stage.vessels_stage RENAME TO vessels_load;")
            # Stamp batch_id and loaded_at
            _psql_exec(conn, "UPDATE stage.vessels_load SET loaded_at = now() WHERE TRUE;")
            _psql_exec(conn, "ALTER TABLE stage.vessels_load ADD COLUMN IF NOT EXISTS batch_id uuid DEFAULT gen_random_uuid();")
        except Exception as e:
            print(f"Stage move error: {e}", file=sys.stderr)

    try:
        maybe_finalize_db(dsn, args.table, conn)
    except Exception as e:
        # Non-fatal: table is loaded; indexes can be added later
        print(f"Index creation error: {e}", file=sys.stderr)

    print("PostgreSQL load complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
