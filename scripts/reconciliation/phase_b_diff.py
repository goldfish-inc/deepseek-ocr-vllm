#!/usr/bin/env python3
import json
import os
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

BASELINE_DIR = Path("tests/reconciliation/baseline/vessels/RFMO/cleaned")
CURRENT_DIR = Path("tests/reconciliation/current")
DIFF_DIR = Path("tests/reconciliation/diffs")
CONFIG_PATH = Path("tests/reconciliation/diff_config.yaml")
DIFF_DIR.mkdir(parents=True, exist_ok=True)

if not BASELINE_DIR.exists():
    sys.exit(f"Missing baseline directory: {BASELINE_DIR}")
if not CURRENT_DIR.exists():
    sys.exit(f"Missing current directory: {CURRENT_DIR}")

baseline_files = sorted(BASELINE_DIR.glob('*.csv'))
if not baseline_files:
    sys.exit("No baseline CSVs found. Run Phase A first.")


DEFAULT_ALIAS_MAP = {
    # Reasonable defaults; overridden by YAML config if present
    "IMO_NUMBER": "IMO",
    "IMO_NO": "IMO",
    "IMO_NO_": "IMO",
}


def load_config():
    cfg = {
        "join_key": "IMO",  # Global default join key for row alignment
        "aliases": DEFAULT_ALIAS_MAP.copy(),
        "case_insensitive_columns": ["FLAG"],
        "date_columns": [],  # Restrict date parsing to these columns (empty = all)
        "value_mappings": {},  # Per-column value mappings
        "unicode": {
            "normalize": None,  # None, "NFC", "NFD", "NFKC", "NFKD"
            "accent_insensitive_columns": [],  # Temporary: compare without accents
        },
        "numeric": {},  # Per-column precision: {"BEAM_M": 2, "DEPTH_M": 2}
        "ignore_transformations": {
            "date_formats": False,
            "float_precision": None,
            "whitespace": True,
        },
        "null_values": ["", "N/A", "NA", "NONE", "NULL", "—", "-"],  # Default null tokens
        "null_categories": {},  # Map null tokens to semantic categories
        "null_policy": {
            "count_match_null_as_positive": True,
            "count_info_gain_as_positive": True,
            "count_info_loss_as_negative": True,
        },
        # Phase D: composite key support
        # Global default composite key columns (uppercase, canonicalized names)
        # and optional per-RFMO overrides
        # Composite keys can be a single set [A,B] or list of sets [[A,B],[C,D]]
        "composite_keys": [],  # e.g., ["IMO", "VESSEL_NAME"] or [["IMO","VESSEL_NAME"],["VESSEL_NAME","FLAG_STATE_CODE"]]
        "composite_overrides": {},  # e.g., {"PNA": ["IMO", "VESSEL_NAME"], "CCSBT": [["VESSEL_REGISTRATION_NUMBER","VESSEL_NAME"],["IMO","VESSEL_NAME"]]}
    }
    if CONFIG_PATH.exists() and yaml is not None:
        try:
            with CONFIG_PATH.open("r") as fh:
                doc = yaml.safe_load(fh) or {}
                if isinstance(doc, dict):
                    if "join_key" in doc:
                        # Allow null to disable join_key, otherwise canonicalize
                        jk = doc["join_key"]
                        cfg["join_key"] = str(jk).upper() if jk is not None else None
                    if "aliases" in doc and isinstance(doc["aliases"], dict):
                        cfg["aliases"].update({str(k).upper(): str(v).upper() for k, v in doc["aliases"].items()})
                    if "case_insensitive_columns" in doc and isinstance(doc["case_insensitive_columns"], list):
                        cfg["case_insensitive_columns"] = [str(x).upper() for x in doc["case_insensitive_columns"]]
                    if "date_columns" in doc and isinstance(doc["date_columns"], list):
                        cfg["date_columns"] = [str(x).upper() for x in doc["date_columns"]]
                    if "value_mappings" in doc and isinstance(doc["value_mappings"], dict):
                        cfg["value_mappings"] = doc["value_mappings"]
                    if "unicode" in doc and isinstance(doc["unicode"], dict):
                        uc = doc["unicode"]
                        if "normalize" in uc and uc["normalize"] in ["NFC", "NFD", "NFKC", "NFKD"]:
                            cfg["unicode"]["normalize"] = uc["normalize"]
                        if "accent_insensitive_columns" in uc and isinstance(uc["accent_insensitive_columns"], list):
                            cfg["unicode"]["accent_insensitive_columns"] = [str(x).upper() for x in uc["accent_insensitive_columns"]]
                    if "numeric" in doc and isinstance(doc["numeric"], dict):
                        cfg["numeric"] = {str(k).upper(): int(v) for k, v in doc["numeric"].items() if isinstance(v, (int, float))}
                    if "ignore_transformations" in doc and isinstance(doc["ignore_transformations"], dict):
                        it = doc["ignore_transformations"]
                        cfg["ignore_transformations"]["date_formats"] = bool(it.get("date_formats", cfg["ignore_transformations"]["date_formats"]))
                        fp = it.get("float_precision", cfg["ignore_transformations"]["float_precision"])
                        if fp is not None:
                            try:
                                cfg["ignore_transformations"]["float_precision"] = int(fp)
                            except Exception:
                                pass
                        cfg["ignore_transformations"]["whitespace"] = bool(it.get("whitespace", cfg["ignore_transformations"]["whitespace"]))
                    if "null_values" in doc and isinstance(doc["null_values"], list):
                        cfg["null_values"] = [str(v) for v in doc["null_values"]]
                    if "null_categories" in doc and isinstance(doc["null_categories"], dict):
                        cfg["null_categories"] = {str(k): str(v) for k, v in doc["null_categories"].items()}
                    if "null_policy" in doc and isinstance(doc["null_policy"], dict):
                        np = doc["null_policy"]
                        cfg["null_policy"]["count_match_null_as_positive"] = bool(np.get("count_match_null_as_positive", cfg["null_policy"]["count_match_null_as_positive"]))
                        cfg["null_policy"]["count_info_gain_as_positive"] = bool(np.get("count_info_gain_as_positive", cfg["null_policy"]["count_info_gain_as_positive"]))
                        cfg["null_policy"]["count_info_loss_as_negative"] = bool(np.get("count_info_loss_as_negative", cfg["null_policy"]["count_info_loss_as_negative"]))
                    # Composite keys configuration (Phase D)
                    if "composite_keys" in doc and isinstance(doc["composite_keys"], list):
                        # Accept [A,B] or [[A,B],[C,D]]
                        if doc["composite_keys"] and all(isinstance(x, (str, int, float)) for x in doc["composite_keys"]):
                            cfg["composite_keys"] = [[str(x).upper() for x in doc["composite_keys"]]]
                        else:
                            sets = []
                            for s in doc["composite_keys"]:
                                if isinstance(s, list):
                                    sets.append([str(x).upper() for x in s])
                            cfg["composite_keys"] = sets
                    # Support either specific key name or generic 'overrides' for compatibility with prompt
                    if "composite_overrides" in doc and isinstance(doc["composite_overrides"], dict):
                        norm: dict[str, list[list[str]]] = {}
                        for k, v in doc["composite_overrides"].items():
                            key = str(k).upper()
                            if isinstance(v, list):
                                # Either [A,B] or [[A,B],[C,D]]
                                if v and all(isinstance(x, (str, int, float)) for x in v):
                                    norm[key] = [[str(x).upper() for x in v]]
                                else:
                                    sets = []
                                    for s in v:
                                        if isinstance(s, list):
                                            sets.append([str(x).upper() for x in s])
                                    norm[key] = sets
                            else:
                                norm[key] = []
                        cfg["composite_overrides"] = norm
                    elif "overrides" in doc and isinstance(doc["overrides"], dict):
                        # Treat top-level 'overrides' as composite key overrides if present
                        norm: dict[str, list[list[str]]] = {}
                        for k, v in doc["overrides"].items():
                            key = str(k).upper()
                            if isinstance(v, list):
                                if v and all(isinstance(x, (str, int, float)) for x in v):
                                    norm[key] = [[str(x).upper() for x in v]]
                                else:
                                    sets = []
                                    for s in v:
                                        if isinstance(s, list):
                                            sets.append([str(x).upper() for x in s])
                                    norm[key] = sets
                            else:
                                norm[key] = []
                        cfg["composite_overrides"] = norm
        except Exception:
            # Ignore config errors; proceed with defaults
            pass

    # Env overrides
    cis = os.getenv("CASE_INSENSITIVE_COLUMNS")
    if cis:
        cfg["case_insensitive_columns"] = [s.strip().upper() for s in cis.split(",") if s.strip()]

    if os.getenv("IGNORE_DATE_FORMATS"):
        cfg["ignore_transformations"]["date_formats"] = True

    if os.getenv("ROUND_FLOATS"):
        try:
            cfg["ignore_transformations"]["float_precision"] = int(os.getenv("ROUND_FLOATS", "0"))
        except Exception:
            pass

    if os.getenv("IGNORE_WHITESPACE"):
        cfg["ignore_transformations"]["whitespace"] = True

    return cfg


CONFIG = load_config()


def composite_key_sets(slug: str) -> list[list[str]]:
    """Return ordered list of composite key sets for a given RFMO slug.

    Each set is a list of canonical column names. Uses overrides if present,
    otherwise the global default. Returns [] if none configured.
    """
    overrides = CONFIG.get("composite_overrides", {}) or {}
    if isinstance(overrides, dict) and slug.upper() in overrides:
        ov = overrides.get(slug.upper()) or []
        if isinstance(ov, list):
            return [[str(x).upper() for x in s] for s in ov]
    keys = CONFIG.get("composite_keys", []) or []
    if keys and isinstance(keys[0], list):
        return [[str(x).upper() for x in s] for s in keys]
    return []


def canonicalize_null(value: str) -> tuple[bool, str, str | None]:
    """Canonicalize null values to detect and classify missing data.

    Returns:
        (is_null, canonical_value, null_reason)
        - is_null: True if value represents null/missing
        - canonical_value: Either NULL_TOKEN or the original value
        - null_reason: Semantic category (not_applicable, unknown, etc.) or None
    """
    NULL_TOKEN = "<NULL>"
    value_str = str(value).strip()

    # Check if value matches any configured null token
    null_values = CONFIG.get("null_values", [])
    if value_str in null_values or value_str == "":
        null_categories = CONFIG.get("null_categories", {})
        null_reason = null_categories.get(value_str, "unknown" if value_str else "empty")
        return (True, NULL_TOKEN, null_reason)

    return (False, value_str, None)


def canon_col_name(s: str) -> str:
    """Canonicalize column names to align baseline and pipeline headers.

    - Uppercase all characters
    - Replace any run of non-alphanumeric characters with a single underscore
    - Trim leading/trailing underscores
    """
    s = (s or "").upper()
    s = re.sub(r"[^A-Z0-9]+", "_", s)
    s = s.strip("_")
    # Apply alias mapping
    return CONFIG["aliases"].get(s, s)


def baseline_to_long(path: Path, slug: str) -> pd.DataFrame:
    """Convert baseline CSV to long format with optional join_key extraction.

    If CONFIG["join_key"] is set, extracts that column's value for each row
    before melting to enable row alignment by stable identifier instead of row_index.
    """
    df = pd.read_csv(path, dtype=str).fillna("")

    # Extract join_key column if configured
    join_key_col = CONFIG.get("join_key")
    join_key_values = {}  # row_index → join_key value
    if join_key_col:
        # Find the join_key column in the wide baseline (after canonicalization)
        for col in df.columns:
            if canon_col_name(str(col).strip()) == join_key_col.upper():
                # Build row_index → join_key mapping
                for idx, val in df[col].items():
                    val_str = str(val).strip()
                    join_key_values[idx] = val_str if val_str else None
                break

    # Extract composite_key if configured (supports multiple key sets; use first complete)
    composite_sets = composite_key_sets(slug)
    composite_values = {}  # row_index → composite_key string
    if composite_sets:
        canon_to_orig = {canon_col_name(c): c for c in df.columns}
        for idx in df.index:
            key_value = None
            for set_cols in composite_sets:
                # Ensure all columns exist
                if not all(c in canon_to_orig for c in set_cols):
                    continue
                parts: list[str] = []
                missing = False
                for c in set_cols:
                    orig = canon_to_orig.get(c)
                    v = "" if orig is None else str(df.at[idx, orig]).strip()
                    is_null, _, _ = canonicalize_null(v)
                    if (v == "") or is_null:
                        missing = True
                        break
                    parts.append(v)
                if not missing and parts:
                    key_value = "||".join(parts)
                    break
            composite_values[idx] = key_value

    records = []
    for idx, row in df.iterrows():
        for col, value in row.items():
            record = {
                'row_index': idx,
                'column_name': canon_col_name(str(col).strip()),
                'baseline_value': str(value),
            }
            # Add join_key if available for this row
            if join_key_values:
                record['join_key'] = join_key_values.get(idx)
            # Add composite_key if available for this row
            if composite_values:
                record['composite_key'] = composite_values.get(idx)
            records.append(record)

    return pd.DataFrame(records)


def find_current_file(slug: str) -> Path:
    """Find appropriate pipeline export for a given baseline slug.

    Preference order:
      1) PREFER_EXT environment variable (csv|xlsx): {slug}*_{prefer}_stage.csv
      2) Any staged export: {slug}*_stage.csv
      3) Fallback: any CSV starting with slug
    """
    prefer_ext = os.getenv("PREFER_EXT", "xlsx").lower().strip()
    if prefer_ext in {"csv", "xlsx"}:
        matches = sorted(p for p in CURRENT_DIR.glob(f"{slug}*_{prefer_ext}_stage.csv"))
        if matches:
            return matches[0]

    matches = sorted(p for p in CURRENT_DIR.glob(f"{slug}*_stage.csv"))
    if matches:
        return matches[0]

    matches = sorted(p for p in CURRENT_DIR.glob(f"{slug}*.csv"))
    if matches:
        return matches[0]
    return None


summary_lines = []
summary_lines.append(f"Generated: {datetime.utcnow().isoformat()}Z\n")
summary_lines.append("baseline_file,current_file,total_cells,matched,baseline_only,pipeline_only,mismatched,match_rate,null_aware_match_rate,count_match_value,count_match_null,count_info_gain,count_info_loss,count_changed_value,aligned_by_join_key,aligned_by_composite,aligned_by_row_index\n")


def normalize_pipeline(df: pd.DataFrame, slug: str) -> pd.DataFrame:
    """Normalize pipeline export and extract join_key if configured.

    If CONFIG["join_key"] is set, builds row_index → join_key mapping
    from the long-form data where column_name matches the join_key.
    """
    df = df.copy()
    df['row_index'] = df['row_index'].astype(int)
    df['column_name'] = df['column_name'].astype(str).map(lambda s: canon_col_name(s.strip()))
    df['cleaned_value'] = df['cleaned_value'].astype(str).fillna('')
    df['confidence'] = pd.to_numeric(df['confidence'], errors='coerce')
    df['needs_review'] = df['needs_review'].astype(str)
    df['rule_chain'] = df['rule_chain'].astype(str)

    # Extract join_key from pipeline long data if configured
    join_key_col = CONFIG.get("join_key")
    if join_key_col:
        # Build row_index → join_key mapping from rows where column_name == join_key
        join_key_rows = df[df['column_name'] == join_key_col.upper()]
        if not join_key_rows.empty:
            join_key_map = join_key_rows.set_index('row_index')['cleaned_value'].to_dict()
            # Add join_key column to all rows
            df['join_key'] = df['row_index'].map(lambda idx: join_key_map.get(idx))
        else:
            # Join key column not found in pipeline data; fallback to row_index
            df['join_key'] = None

    # Extract composite_key if configured (supports multiple key sets; use first complete)
    comp_sets = composite_key_sets(slug)
    if comp_sets:
        # Subset to rows for union of composite columns
        union_cols = sorted({c for s in comp_sets for c in s})
        subset = df[df['column_name'].isin([c.upper() for c in union_cols])]
        if not subset.empty:
            try:
                wide = subset.pivot_table(index='row_index', columns='column_name', values='cleaned_value', aggfunc='first')
                wide = wide.fillna("")
                composite_map: dict[int, str | None] = {}
                for ridx, row in wide.iterrows():
                    value = None
                    for set_cols in comp_sets:
                        parts: list[str] = []
                        missing = False
                        for c in set_cols:
                            v = str(row.get(c, "")).strip()
                            is_null, _, _ = canonicalize_null(v)
                            if (v == "") or is_null:
                                missing = True
                                break
                            parts.append(v)
                        if not missing and parts:
                            value = "||".join(parts)
                            break
                    composite_map[int(ridx)] = value
                df['composite_key'] = df['row_index'].map(lambda idx: composite_map.get(int(idx)))
            except Exception as e:
                print(f"[ERROR] {slug}: Failed to build composite_key: {e}")
                df['composite_key'] = None
        else:
            df['composite_key'] = None

    return df


def compare_files(baseline_path: Path):
    slug = baseline_path.stem.split('_')[0].upper()
    current_path = find_current_file(slug)
    if not current_path:
        print(f"[WARN] No pipeline output for {baseline_path.name} (slug {slug})")
        return

    base_long = baseline_to_long(baseline_path, slug)
    pipe_df = pd.read_csv(current_path, dtype=str, keep_default_na=False)
    pipe_df = normalize_pipeline(pipe_df, slug)

    # Determine merge keys: prefer join_key if available and unique; then composite; else row_index
    join_key_col = CONFIG.get("join_key")
    def _has_key(series: pd.Series) -> pd.Series:
        # Present = non-null, not empty, not canonical null
        return series.notna() & (series != '') & series.map(lambda x: not canonicalize_null(str(x))[0])

    # Stage 1: join_key-based merge with duplicate-aware filtering
    merged_parts: list[pd.DataFrame] = []
    aligned_counts = {"join_key": 0, "composite": 0, "row_index": 0}

    base_remaining = base_long.copy()
    pipe_remaining = pipe_df.copy()

    if (
        join_key_col
        and ('join_key' in base_long.columns)
        and ('join_key' in pipe_df.columns)
        and base_long['join_key'].notna().any()
        and pipe_df['join_key'].notna().any()
    ):
        print(f"[INFO] {slug}: Considering join_key '{join_key_col}' for alignment")

        base_jk = base_remaining[_has_key(base_remaining['join_key'])]
        pipe_jk = pipe_remaining[_has_key(pipe_remaining['join_key'])]

        # Compute duplicates at the row level (unique row_index per join_key)
        base_jk_rows = base_jk[['row_index', 'join_key']].drop_duplicates()
        pipe_jk_rows = pipe_jk[['row_index', 'join_key']].drop_duplicates()
        dup_base_keys = set(base_jk_rows['join_key'][base_jk_rows['join_key'].isin(
            base_jk_rows['join_key'][base_jk_rows['join_key'].duplicated(keep=False)]
        )])
        dup_pipe_keys = set(pipe_jk_rows['join_key'][pipe_jk_rows['join_key'].isin(
            pipe_jk_rows['join_key'][pipe_jk_rows['join_key'].duplicated(keep=False)]
        )])
        dup_any = dup_base_keys.union(dup_pipe_keys)

        # Filter out duplicates from key-based alignment
        base_jk_unique = base_jk[~base_jk['join_key'].isin(dup_any)]
        pipe_jk_unique = pipe_jk[~pipe_jk['join_key'].isin(dup_any)]

        merged_jk = base_jk_unique.merge(
            pipe_jk_unique,
            on=['join_key', 'column_name'],
            how='outer',
            indicator=True,
            suffixes=('_baseline', '_pipeline')
        )
        merged_jk['aligned_by'] = 'join_key'

        # Update aligned count and remaining pools
        aligned_counts["join_key"] = int((merged_jk['_merge'] == 'both').sum())

        # Exclude all rows that participated in the join_key attempt (unique ones only) from remaining
        used_base_rows = set(base_jk_unique['row_index'].unique())
        used_pipe_rows = set(pipe_jk_unique['row_index'].unique())
        base_remaining = base_remaining[~base_remaining['row_index'].isin(used_base_rows)]
        pipe_remaining = pipe_remaining[~pipe_remaining['row_index'].isin(used_pipe_rows)]

        merged_parts.append(merged_jk)

        # Report coverage and duplicates
        jk_baseline_cov = (len(base_jk_rows) / len(base_long[['row_index']].drop_duplicates()) * 100) if len(base_long) > 0 else 0
        jk_pipeline_cov = (len(pipe_jk_rows) / len(pipe_df[['row_index']].drop_duplicates()) * 100) if len(pipe_df) > 0 else 0
        print(
            f"[INFO] {slug}: join_key coverage: baseline={jk_baseline_cov:.1f}%, pipeline={jk_pipeline_cov:.1f}%"
        )
        if dup_any:
            print(
                f"[INFO] {slug}: join_key duplicates excluded: baseline={len(dup_base_keys)}, pipeline={len(dup_pipe_keys)}"
            )
    else:
        if join_key_col:
            print(f"[WARN] {slug}: join_key '{join_key_col}' not available; will try composite/row_index")

    # Stage 2: composite key-based merge with duplicate-aware filtering
    comp_sets = composite_key_sets(slug)
    if comp_sets and ('composite_key' in base_long.columns) and ('composite_key' in pipe_df.columns):
        print(f"[INFO] {slug}: Considering composite key sets {comp_sets} for alignment")
        base_ck = base_remaining[_has_key(base_remaining['composite_key'])]
        pipe_ck = pipe_remaining[_has_key(pipe_remaining['composite_key'])]

        base_ck_rows = base_ck[['row_index', 'composite_key']].drop_duplicates()
        pipe_ck_rows = pipe_ck[['row_index', 'composite_key']].drop_duplicates()
        dup_base_ck = set(base_ck_rows['composite_key'][base_ck_rows['composite_key'].isin(
            base_ck_rows['composite_key'][base_ck_rows['composite_key'].duplicated(keep=False)]
        )])
        dup_pipe_ck = set(pipe_ck_rows['composite_key'][pipe_ck_rows['composite_key'].isin(
            pipe_ck_rows['composite_key'][pipe_ck_rows['composite_key'].duplicated(keep=False)]
        )])
        dup_any_ck = dup_base_ck.union(dup_pipe_ck)

        base_ck_unique = base_ck[~base_ck['composite_key'].isin(dup_any_ck)]
        pipe_ck_unique = pipe_ck[~pipe_ck['composite_key'].isin(dup_any_ck)]

        merged_ck = base_ck_unique.merge(
            pipe_ck_unique,
            on=['composite_key', 'column_name'],
            how='outer',
            indicator=True,
            suffixes=('_baseline', '_pipeline')
        )
        merged_ck['aligned_by'] = 'composite'
        aligned_counts["composite"] = int((merged_ck['_merge'] == 'both').sum())

        used_base_rows_ck = set(base_ck_unique['row_index'].unique())
        used_pipe_rows_ck = set(pipe_ck_unique['row_index'].unique())
        base_remaining = base_remaining[~base_remaining['row_index'].isin(used_base_rows_ck)]
        pipe_remaining = pipe_remaining[~pipe_remaining['row_index'].isin(used_pipe_rows_ck)]

        merged_parts.append(merged_ck)

        # Report composite coverage and duplicates
        comp_baseline_cov = (len(base_ck_rows) / max(1, len(base_long[['row_index']].drop_duplicates())) * 100)
        comp_pipeline_cov = (len(pipe_ck_rows) / max(1, len(pipe_df[['row_index']].drop_duplicates())) * 100)
        print(
            f"[INFO] {slug}: composite_key coverage: baseline={comp_baseline_cov:.1f}%, pipeline={comp_pipeline_cov:.1f}%"
        )
        if dup_any_ck:
            print(
                f"[INFO] {slug}: composite_key duplicates excluded: baseline={len(dup_base_ck)}, pipeline={len(dup_pipe_ck)}"
            )

    # Stage 3: row_index fallback on remaining rows
    merged_idx = base_remaining.merge(
        pipe_remaining,
        on=['row_index', 'column_name'],
        how='outer',
        indicator=True,
        suffixes=('_baseline', '_pipeline')
    )
    merged_idx['aligned_by'] = 'row_index'
    aligned_counts["row_index"] = int((merged_idx['_merge'] == 'both').sum())
    merged_parts.append(merged_idx)

    # Combine all parts
    merged = pd.concat(merged_parts, ignore_index=True)

    merged['pipeline_value'] = merged['cleaned_value'].fillna('')

    # Build comparison columns with normalization per config/env
    merged['cmp_baseline'] = merged['baseline_value'].astype(str)
    merged['cmp_pipeline'] = merged['pipeline_value'].astype(str)

    # Null canonicalization (before all other transformations)
    # Preserves null_reason for reporting, normalizes all null tokens to <NULL>
    null_info_baseline = merged['cmp_baseline'].map(canonicalize_null)
    null_info_pipeline = merged['cmp_pipeline'].map(canonicalize_null)

    merged['is_null_baseline'] = null_info_baseline.map(lambda x: x[0])
    merged['is_null_pipeline'] = null_info_pipeline.map(lambda x: x[0])
    merged['null_reason_baseline'] = null_info_baseline.map(lambda x: x[2])
    merged['null_reason_pipeline'] = null_info_pipeline.map(lambda x: x[2])

    # Apply canonical null tokens for comparison
    merged['cmp_baseline'] = null_info_baseline.map(lambda x: x[1])
    merged['cmp_pipeline'] = null_info_pipeline.map(lambda x: x[1])

    # Whitespace trimming (only for non-null values)
    if CONFIG["ignore_transformations"].get("whitespace", False):
        merged.loc[~merged['is_null_baseline'], 'cmp_baseline'] = merged.loc[~merged['is_null_baseline'], 'cmp_baseline'].str.strip()
        merged.loc[~merged['is_null_pipeline'], 'cmp_pipeline'] = merged.loc[~merged['is_null_pipeline'], 'cmp_pipeline'].str.strip()

    # Unicode normalization
    unicode_norm = CONFIG.get("unicode", {}).get("normalize")
    if unicode_norm in ["NFC", "NFD", "NFKC", "NFKD"]:
        def _normalize_unicode(s: pd.Series) -> pd.Series:
            return s.map(lambda x: unicodedata.normalize(unicode_norm, x) if isinstance(x, str) else x)
        merged['cmp_baseline'] = _normalize_unicode(merged['cmp_baseline'])
        merged['cmp_pipeline'] = _normalize_unicode(merged['cmp_pipeline'])

    # Accent-insensitive columns (temporary workaround while fixing pipeline diacritics)
    accent_insensitive_cols = CONFIG.get("unicode", {}).get("accent_insensitive_columns", [])
    if accent_insensitive_cols:
        def _remove_accents(s: str) -> str:
            if not isinstance(s, str):
                return s
            # Decompose to NFD, filter out combining characters, then recompose
            nfd = unicodedata.normalize('NFD', s)
            return ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')

        mask = merged['column_name'].isin([c.upper() for c in accent_insensitive_cols])
        merged.loc[mask, 'cmp_baseline'] = merged.loc[mask, 'cmp_baseline'].map(_remove_accents)
        merged.loc[mask, 'cmp_pipeline'] = merged.loc[mask, 'cmp_pipeline'].map(_remove_accents)

    # Value mappings (e.g., country codes GBR→GB)
    if CONFIG.get("value_mappings"):
        for column_key, mappings in CONFIG["value_mappings"].items():
            column_name = column_key.upper()
            if isinstance(mappings, dict):
                mask = merged['column_name'] == column_name
                for old_val, new_val in mappings.items():
                    merged.loc[mask & (merged['cmp_baseline'] == str(old_val)), 'cmp_baseline'] = str(new_val)
                    merged.loc[mask & (merged['cmp_pipeline'] == str(old_val)), 'cmp_pipeline'] = str(new_val)

    # Case-insensitive columns
    if CONFIG.get("case_insensitive_columns"):
        mask = merged['column_name'].isin([c.upper() for c in CONFIG["case_insensitive_columns"]])
        merged.loc[mask, 'cmp_baseline'] = merged.loc[mask, 'cmp_baseline'].str.upper()
        merged.loc[mask, 'cmp_pipeline'] = merged.loc[mask, 'cmp_pipeline'].str.upper()

    # Date normalization (restricted to date_columns if specified)
    if CONFIG["ignore_transformations"].get("date_formats", False):
        date_cols = CONFIG.get("date_columns", [])
        # If date_columns is empty, apply to all columns (backward compat)
        # If specified, only apply to those columns
        if not date_cols:
            # Apply to all rows
            def _iso_date(series: pd.Series, dayfirst: bool) -> pd.Series:
                dt = pd.to_datetime(series, errors='coerce', dayfirst=dayfirst)
                iso = pd.Series(pd.NA, index=series.index, dtype='object')
                # Check if dt is actually datetime64 dtype (not object)
                if pd.api.types.is_datetime64_any_dtype(dt):
                    mask = dt.notna()
                    if mask.any():
                        iso.loc[mask] = dt.loc[mask].dt.strftime('%Y-%m-%d')
                return iso

            # Try month-first, then day-first; adopt normalization only when both
            # sides resolve to the same ISO string under one scheme
            b_md = _iso_date(merged['cmp_baseline'], dayfirst=False)
            p_md = _iso_date(merged['cmp_pipeline'], dayfirst=False)
            eq_md = b_md.notna() & p_md.notna() & (b_md == p_md)

            b_dm = _iso_date(merged['cmp_baseline'], dayfirst=True)
            p_dm = _iso_date(merged['cmp_pipeline'], dayfirst=True)
            eq_dm = b_dm.notna() & p_dm.notna() & (b_dm == p_dm)

            merged['cmp_baseline'] = np.where(eq_md, b_md, merged['cmp_baseline'])
            merged['cmp_pipeline'] = np.where(eq_md, p_md, merged['cmp_pipeline'])

            still_unmatched = ~eq_md
            merged['cmp_baseline'] = np.where(still_unmatched & eq_dm, b_dm, merged['cmp_baseline'])
            merged['cmp_pipeline'] = np.where(still_unmatched & eq_dm, p_dm, merged['cmp_pipeline'])
        else:
            # Apply only to specific date columns
            date_mask = merged['column_name'].isin([c.upper() for c in date_cols])
            if date_mask.any():
                def _iso_date(series: pd.Series, dayfirst: bool) -> pd.Series:
                    dt = pd.to_datetime(series, errors='coerce', dayfirst=dayfirst)
                    iso = pd.Series(pd.NA, index=series.index, dtype='object')
                    # Check if dt is actually datetime64 dtype (not object)
                    if pd.api.types.is_datetime64_any_dtype(dt):
                        mask = dt.notna()
                        if mask.any():
                            iso.loc[mask] = dt.loc[mask].dt.strftime('%Y-%m-%d')
                    return iso

                # Extract date column values
                baseline_dates = merged.loc[date_mask, 'cmp_baseline']
                pipeline_dates = merged.loc[date_mask, 'cmp_pipeline']

                # Try month-first, then day-first
                b_md = _iso_date(baseline_dates, dayfirst=False)
                p_md = _iso_date(pipeline_dates, dayfirst=False)
                eq_md = b_md.notna() & p_md.notna() & (b_md == p_md)

                b_dm = _iso_date(baseline_dates, dayfirst=True)
                p_dm = _iso_date(pipeline_dates, dayfirst=True)
                eq_dm = b_dm.notna() & p_dm.notna() & (b_dm == p_dm)

                # Create series for results with correct index
                normalized_baseline = pd.Series(baseline_dates.values, index=baseline_dates.index)
                normalized_pipeline = pd.Series(pipeline_dates.values, index=pipeline_dates.index)

                # Apply normalization where dates match
                normalized_baseline[eq_md] = b_md[eq_md]
                normalized_pipeline[eq_md] = p_md[eq_md]

                # Try day-first for still unmatched
                still_unmatched = ~eq_md
                normalized_baseline[still_unmatched & eq_dm] = b_dm[still_unmatched & eq_dm]
                normalized_pipeline[still_unmatched & eq_dm] = p_dm[still_unmatched & eq_dm]

                # Update back to merged dataframe
                merged.loc[date_mask, 'cmp_baseline'] = normalized_baseline
                merged.loc[date_mask, 'cmp_pipeline'] = normalized_pipeline

    # Per-column numeric precision
    numeric_config = CONFIG.get("numeric", {})
    if numeric_config:
        def _round_float_to(precision: int) -> callable:
            def _rounder(s: pd.Series) -> pd.Series:
                def _try_round(x: str) -> str:
                    try:
                        val = float(x)
                        return (f"{round(val, precision):.{precision}f}").rstrip('0').rstrip('.') if precision > 0 else str(int(round(val)))
                    except Exception:
                        return x
                return s.map(_try_round)
            return _rounder

        for column_name, precision in numeric_config.items():
            mask = merged['column_name'] == column_name.upper()
            if mask.any():
                rounder = _round_float_to(precision)
                merged.loc[mask, 'cmp_baseline'] = rounder(merged.loc[mask, 'cmp_baseline'])
                merged.loc[mask, 'cmp_pipeline'] = rounder(merged.loc[mask, 'cmp_pipeline'])

    # Global float precision rounding (fallback for columns not in numeric config)
    fp = CONFIG["ignore_transformations"].get("float_precision")
    if isinstance(fp, int) and fp is not None:
        def _round_float(s: pd.Series) -> pd.Series:
            def _try_round(x: str) -> str:
                try:
                    val = float(x)
                    return (f"{round(val, fp):.{fp}f}").rstrip('0').rstrip('.') if fp > 0 else str(int(round(val)))
                except Exception:
                    return x
            return s.map(_try_round)
        merged['cmp_baseline'] = _round_float(merged['cmp_baseline'])
        merged['cmp_pipeline'] = _round_float(merged['cmp_pipeline'])

    # Create subsets AFTER building cmp_* so they include normalized columns
    only_baseline = merged[merged['_merge'] == 'left_only'].copy()
    only_pipeline = merged[merged['_merge'] == 'right_only'].copy()
    both = merged[merged['_merge'] == 'both'].copy()

    # Null-aware diff classification
    # For rows present in both datasets, classify based on null status and value equality
    both['diff_class'] = 'unknown'

    # match_value: both non-null and equal
    mask_match_value = both['_merge'] == 'both'
    mask_match_value &= ~both['is_null_baseline'] & ~both['is_null_pipeline']
    mask_match_value &= both['cmp_baseline'] == both['cmp_pipeline']
    both.loc[mask_match_value, 'diff_class'] = 'match_value'

    # match_null: both null (valid signal)
    mask_match_null = both['_merge'] == 'both'
    mask_match_null &= both['is_null_baseline'] & both['is_null_pipeline']
    both.loc[mask_match_null, 'diff_class'] = 'match_null'

    # info_gain: baseline null → pipeline non-null (good)
    mask_info_gain = both['_merge'] == 'both'
    mask_info_gain &= both['is_null_baseline'] & ~both['is_null_pipeline']
    both.loc[mask_info_gain, 'diff_class'] = 'info_gain'

    # info_loss: baseline non-null → pipeline null (bad)
    mask_info_loss = both['_merge'] == 'both'
    mask_info_loss &= ~both['is_null_baseline'] & both['is_null_pipeline']
    both.loc[mask_info_loss, 'diff_class'] = 'info_loss'

    # changed_value: both non-null but different values
    mask_changed_value = both['_merge'] == 'both'
    mask_changed_value &= ~both['is_null_baseline'] & ~both['is_null_pipeline']
    mask_changed_value &= both['cmp_baseline'] != both['cmp_pipeline']
    both.loc[mask_changed_value, 'diff_class'] = 'changed_value'

    # Compute counts for each classification
    count_match_value = (both['diff_class'] == 'match_value').sum()
    count_match_null = (both['diff_class'] == 'match_null').sum()
    count_info_gain = (both['diff_class'] == 'info_gain').sum()
    count_info_loss = (both['diff_class'] == 'info_loss').sum()
    count_changed_value = (both['diff_class'] == 'changed_value').sum()

    # Compute null-aware match rate based on policy
    null_policy = CONFIG.get("null_policy", {})
    positive_count = count_match_value  # Always count exact value matches

    if null_policy.get("count_match_null_as_positive", True):
        positive_count += count_match_null

    if null_policy.get("count_info_gain_as_positive", True):
        positive_count += count_info_gain

    negative_count = count_changed_value  # Always penalize value changes

    if null_policy.get("count_info_loss_as_negative", True):
        negative_count += count_info_loss

    # Traditional metrics (backward compat)
    mismatched = both[both['cmp_baseline'] != both['cmp_pipeline']]
    matched = both.shape[0] - mismatched.shape[0]
    total = merged.shape[0]

    # Null-aware match rate
    null_aware_match_rate = positive_count / both.shape[0] if both.shape[0] > 0 else 0

    # Per-column presence metrics
    presence_records = []
    for col_name in merged['column_name'].unique():
        col_data = merged[merged['column_name'] == col_name]
        col_both = col_data[col_data['_merge'] == 'both']

        baseline_total = len(col_both)
        pipeline_total = len(col_both)
        baseline_non_null = (~col_both['is_null_baseline']).sum() if 'is_null_baseline' in col_both.columns else 0
        pipeline_non_null = (~col_both['is_null_pipeline']).sum() if 'is_null_pipeline' in col_both.columns else 0

        baseline_non_null_pct = (baseline_non_null / baseline_total * 100) if baseline_total > 0 else 0
        pipeline_non_null_pct = (pipeline_non_null / pipeline_total * 100) if pipeline_total > 0 else 0
        delta_pct = pipeline_non_null_pct - baseline_non_null_pct

        # Counts per diff_class for this column
        col_match_value = (col_both['diff_class'] == 'match_value').sum() if 'diff_class' in col_both.columns else 0
        col_match_null = (col_both['diff_class'] == 'match_null').sum() if 'diff_class' in col_both.columns else 0
        col_info_gain = (col_both['diff_class'] == 'info_gain').sum() if 'diff_class' in col_both.columns else 0
        col_info_loss = (col_both['diff_class'] == 'info_loss').sum() if 'diff_class' in col_both.columns else 0
        col_changed_value = (col_both['diff_class'] == 'changed_value').sum() if 'diff_class' in col_both.columns else 0

        # Alignment breakdown for this column (how many cells were aligned by which strategy)
        aligned_by_join_key = int((col_both.get('aligned_by') == 'join_key').sum()) if 'aligned_by' in col_both.columns else 0
        aligned_by_composite = int((col_both.get('aligned_by') == 'composite').sum()) if 'aligned_by' in col_both.columns else 0
        aligned_by_row_index = int((col_both.get('aligned_by') == 'row_index').sum()) if 'aligned_by' in col_both.columns else 0

        presence_records.append({
            'column_name': col_name,
            'baseline_non_null_count': baseline_non_null,
            'baseline_non_null_pct': baseline_non_null_pct,
            'pipeline_non_null_count': pipeline_non_null,
            'pipeline_non_null_pct': pipeline_non_null_pct,
            'delta_pct': delta_pct,
            'match_value': col_match_value,
            'match_null': col_match_null,
            'info_gain': col_info_gain,
            'info_loss': col_info_loss,
            'changed_value': col_changed_value,
            'aligned_by_join_key': aligned_by_join_key,
            'aligned_by_composite': aligned_by_composite,
            'aligned_by_row_index': aligned_by_row_index,
        })

    # Export presence metrics
    if presence_records:
        presence_df = pd.DataFrame(presence_records)
        presence_path = DIFF_DIR / f"{slug.lower()}_presence.csv"
        presence_df.to_csv(presence_path, index=False)

    # Update summary with null-aware metrics and alignment breakdown
    summary_lines.append(
        f"{baseline_path.name},{current_path.name},{total},{matched},{only_baseline.shape[0]},{only_pipeline.shape[0]},{mismatched.shape[0]},{matched/total if total else 0:.4f},{null_aware_match_rate:.4f},{count_match_value},{count_match_null},{count_info_gain},{count_info_loss},{count_changed_value},{aligned_counts['join_key']},{aligned_counts['composite']},{aligned_counts['row_index']}\n"
    )

    if mismatched.empty and only_baseline.empty and only_pipeline.empty:
        print(f"[OK] {slug}: perfect match ({matched}/{total})")
        return

    diff_path = DIFF_DIR / f"{slug.lower()}_diff.csv"
    diff_cols = [
        'row_index', 'column_name', 'baseline_value', 'pipeline_value',
        'confidence', 'needs_review', 'rule_chain'
    ]
    mismatched[diff_cols].to_csv(diff_path, index=False)

    summary_path = DIFF_DIR / f"{slug.lower()}_summary.txt"
    with summary_path.open('w') as fh:
        fh.write(f"Baseline: {baseline_path.name}\n")
        fh.write(f"Pipeline: {current_path.name}\n")
        fh.write(f"Total cells: {total}\n")
        fh.write(f"Matched cells: {matched}\n")
        fh.write(f"Baseline-only cells: {only_baseline.shape[0]}\n")
        fh.write(f"Pipeline-only cells: {only_pipeline.shape[0]}\n")
        fh.write(f"Mismatched cells: {mismatched.shape[0]}\n")
    print(f"[DIFF] {slug}: mismatched={mismatched.shape[0]}, baseline_only={only_baseline.shape[0]}, pipeline_only={only_pipeline.shape[0]}")
    print(
        f"[ALIGN] {slug}: join_key={aligned_counts['join_key']}, composite={aligned_counts['composite']}, row_index={aligned_counts['row_index']}"
    )


for baseline_file in baseline_files:
    compare_files(baseline_file)

with (DIFF_DIR / "_summary.csv").open('w') as fh:
    fh.writelines(summary_lines)

print("Diff generation complete.")
