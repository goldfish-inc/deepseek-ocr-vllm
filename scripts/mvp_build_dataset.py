#!/usr/bin/env python3
"""
Build a single, cleaned MVP dataset from CSV inputs — no destructive merges.

Inputs (read-only):
  - --in-dir <path> pointing to CSV directory (default: baselines)
    * defaults to tests/reconciliation/baseline/vessels/RFMO/cleaned
    * optionally: data/raw/vessels/RFMO/raw
  - tests/reconciliation/diff_config.yaml (aliases, composite keys, unicode)

Outputs:
  - CSV:    --out data/mvp/vessels_mvp.csv (optional)
  - Parquet --parquet data/mvp/vessels_mvp.parquet (recommended)
  - SQLite: --sqlite data/mvp/vessels_mvp.sqlite (optional)

Notes:
  - Preserves all rows and values; adds provenance + identity keys
  - No dedupe unless --dedupe is passed
  - Identity keys support grouping in the UI without losing conflicts
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from typing import List
import hashlib

import pandas as pd

try:
    import yaml  # type: ignore
except Exception:
    yaml = None

ROOT = Path(__file__).resolve().parents[1]
BASELINE_DIR = ROOT / "tests/reconciliation/baseline/vessels/RFMO/cleaned"
CONFIG_PATH = ROOT / "tests/reconciliation/diff_config.yaml"
DEFAULT_OUT = ROOT / "data/mvp/vessels_mvp.csv"
DEFAULT_PARQUET = ROOT / "data/mvp/vessels_mvp.parquet"


def canon_col_name(s: str, aliases: dict[str, str]) -> str:
    s = (s or "").upper()
    s = re.sub(r"[^A-Z0-9]+", "_", s)
    s = s.strip("_")
    return aliases.get(s, s)


def load_config() -> dict:
    cfg: dict = {
        "join_key": "IMO",
        "aliases": {},
        "unicode": {"normalize": None},
        "value_mappings": {},
        "composite_keys": [],
        "composite_overrides": {},
    }
    if CONFIG_PATH.exists() and yaml:
        with CONFIG_PATH.open("r") as fh:
            doc = yaml.safe_load(fh) or {}
            if isinstance(doc, dict):
                for k in cfg.keys():
                    if k in doc:
                        cfg[k] = doc[k]
    # Canonicalize alias dict to upper-case
    aliases = cfg.get("aliases", {}) or {}
    cfg["aliases"] = {str(k).upper(): str(v).upper() for k, v in aliases.items()}
    return cfg


def composite_sets_for(cfg: dict, slug: str) -> List[List[str]]:
    ov = cfg.get("composite_overrides", {}) or {}
    if isinstance(ov, dict) and slug.upper() in ov:
        sets = ov[slug.upper()] or []
        if sets and all(isinstance(x, (str, int, float)) for x in sets):
            return [[str(x).upper() for x in sets]]
        return [[str(x).upper() for x in s] for s in sets]
    keys = cfg.get("composite_keys", []) or []
    if keys and isinstance(keys[0], list):
        return [[str(x).upper() for x in s] for s in keys]
    if keys and all(isinstance(x, (str, int, float)) for x in keys):
        return [[str(x).upper() for x in keys]]
    return []


def nfc_normalize(df: pd.DataFrame, norm: str | None) -> pd.DataFrame:
    if norm is None:
        return df
    import unicodedata

    def _norm(x):
        try:
            return unicodedata.normalize(norm, x) if isinstance(x, str) else x
        except Exception:
            return x

    for c in df.columns:
        df[c] = df[c].map(_norm)
    return df


def build_keys(df: pd.DataFrame, join_key: str | None, comp_sets: List[List[str]]) -> pd.DataFrame:
    # JOIN_KEY
    if join_key and join_key in df.columns:
        df['JOIN_KEY'] = df[join_key].astype(str).str.strip()
    else:
        df['JOIN_KEY'] = ""

    # COMPOSITE_KEY (first complete set)
    comp_val = pd.Series([""] * len(df), index=df.index, dtype="object")
    for cols in comp_sets:
        if not all(c in df.columns for c in cols):
            continue
        key = None
        for i, c in enumerate(cols):
            part = df[c].astype(str).str.strip()
            key = part if i == 0 else key.str.cat(part, sep="||")
        comp_val = key.fillna("")
        break
    df['COMPOSITE_KEY'] = comp_val

    # ENTITY_ID label
    def _entity_id(row):
        if row['JOIN_KEY']:
            return 'JK:' + row['JOIN_KEY']
        if row['COMPOSITE_KEY']:
            return 'CK:' + row['COMPOSITE_KEY']
        raw = f"{row.get('RFMO','')}:{row.get('SOURCE_ROW','')}"
        return 'ROW:' + hashlib.sha1(raw.encode('utf-8', errors='ignore')).hexdigest()[:16]

    df['ENTITY_ID'] = df.apply(_entity_id, axis=1)
    return df


def dedupe_rfmo(df: pd.DataFrame, join_key: str | None, comp_sets: List[List[str]]) -> pd.DataFrame:
    if join_key and join_key in df.columns:
        jk = df[join_key].astype(str).str.strip()
        mask = jk != ""
        if mask.any():
            keep = ~jk.duplicated(keep="first")
            return df[keep | ~mask].reset_index(drop=True)
    for cols in comp_sets:
        if not all(c in df.columns for c in cols):
            continue
        key = None
        for i, c in enumerate(cols):
            part = df[c].astype(str).str.strip()
            key = part if i == 0 else key.str.cat(part, sep="||")
        mask = key != ""
        if mask.any():
            keep = ~key.duplicated(keep="first")
            return df[keep | ~mask].reset_index(drop=True)
    return df.reset_index(drop=True)


def main() -> int:
    p = argparse.ArgumentParser(description="Build MVP dataset from CSVs")
    p.add_argument("--in-dir", type=Path, default=BASELINE_DIR, help="Input directory containing CSVs")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT, help="Optional CSV output path")
    p.add_argument("--parquet", type=Path, help="Optional Parquet output path (recommended)")
    p.add_argument("--sqlite", type=Path, help="Optional SQLite output path")
    p.add_argument("--dedupe", action="store_true", help="Collapse rows per RFMO by join/composite keys")
    args = p.parse_args()

    cfg = load_config()
    aliases = cfg.get("aliases", {})
    join_key = (cfg.get("join_key") or "").upper() or None
    unicode_norm = (cfg.get("unicode", {}) or {}).get("normalize")

    in_dir: Path = args.in_dir
    frames: list[pd.DataFrame] = []
    for path in sorted(in_dir.glob("*.csv")):
        slug = path.stem.split("_")[0].upper()
        df = pd.read_csv(path, dtype=str).fillna("")
        df = df.reset_index().rename(columns={'index': 'SOURCE_ROW'})
        new_cols = [canon_col_name(str(c), aliases) for c in df.columns]
        df.columns = new_cols
        df = nfc_normalize(df, unicode_norm)
        df["RFMO"] = slug
        df["SOURCE_FILE"] = path.name
        comp_sets = composite_sets_for(cfg, slug)
        df = build_keys(df, join_key, comp_sets)
        if args.dedupe:
            df = dedupe_rfmo(df, join_key, comp_sets)
        frames.append(df)

    if not frames:
        print(f"No CSVs found under {in_dir}")
        return 1

    # Union columns across frames
    all_cols: list[str] = sorted({c for f in frames for c in f.columns})
    unified = []
    for f in frames:
        missing = [c for c in all_cols if c not in f.columns]
        if missing:
            for c in missing:
                f[c] = ""
        unified.append(f[all_cols])

    out_df = pd.concat(unified, ignore_index=True)

    # CSV
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        out_df.to_csv(args.out, index=False)
        print(f"Wrote CSV: {args.out} ({len(out_df)} rows)")

    # Parquet
    pq_path = args.parquet or (DEFAULT_PARQUET if os.getenv("WRITE_PARQUET") else None)
    if pq_path:
        try:
            pq_path.parent.mkdir(parents=True, exist_ok=True)
            engine = None
            try:
                import pyarrow  # noqa: F401
                engine = "pyarrow"
            except Exception:
                try:
                    import fastparquet  # noqa: F401
                    engine = "fastparquet"
                except Exception:
                    engine = None
            if engine is None:
                raise RuntimeError("Install 'pyarrow' or 'fastparquet' to write Parquet")
            out_df.to_parquet(pq_path, index=False, engine=engine)
            print(f"Wrote Parquet: {pq_path} (engine={engine})")
        except Exception as e:
            print(f"[WARN] Failed to write Parquet: {e}")

    # SQLite
    if args.sqlite:
        try:
            import sqlite3
            args.sqlite.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(args.sqlite)
            out_df.to_sql("vessels", conn, if_exists="replace", index=False)
            conn.close()
            print(f"Wrote SQLite: {args.sqlite} (table: vessels)")
        except Exception as e:
            print(f"[WARN] Failed to write SQLite: {e}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
