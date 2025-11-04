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
    }
    if CONFIG_PATH.exists() and yaml is not None:
        try:
            with CONFIG_PATH.open("r") as fh:
                doc = yaml.safe_load(fh) or {}
                if isinstance(doc, dict):
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


def baseline_to_long(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str).fillna("")
    records = []
    for idx, row in df.iterrows():
        for col, value in row.items():
            records.append({
                'row_index': idx,
                'column_name': canon_col_name(str(col).strip()),
                'baseline_value': str(value),
            })
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
summary_lines.append("baseline_file,current_file,total_cells,matched,baseline_only,pipeline_only,mismatched,match_rate\n")


def normalize_pipeline(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['row_index'] = df['row_index'].astype(int)
    df['column_name'] = df['column_name'].astype(str).map(lambda s: canon_col_name(s.strip()))
    df['cleaned_value'] = df['cleaned_value'].astype(str).fillna('')
    df['confidence'] = pd.to_numeric(df['confidence'], errors='coerce')
    df['needs_review'] = df['needs_review'].astype(str)
    df['rule_chain'] = df['rule_chain'].astype(str)
    return df


def compare_files(baseline_path: Path):
    slug = baseline_path.stem.split('_')[0].upper()
    current_path = find_current_file(slug)
    if not current_path:
        print(f"[WARN] No pipeline output for {baseline_path.name} (slug {slug})")
        return

    base_long = baseline_to_long(baseline_path)
    pipe_df = pd.read_csv(current_path, dtype=str, keep_default_na=False)
    pipe_df = normalize_pipeline(pipe_df)

    merged = base_long.merge(
        pipe_df,
        on=['row_index', 'column_name'],
        how='outer',
        indicator=True,
        suffixes=('_baseline', '_pipeline')
    )

    merged['pipeline_value'] = merged['cleaned_value'].fillna('')

    # Build comparison columns with normalization per config/env
    merged['cmp_baseline'] = merged['baseline_value'].astype(str)
    merged['cmp_pipeline'] = merged['pipeline_value'].astype(str)

    # Whitespace trimming
    if CONFIG["ignore_transformations"].get("whitespace", False):
        merged['cmp_baseline'] = merged['cmp_baseline'].str.strip()
        merged['cmp_pipeline'] = merged['cmp_pipeline'].str.strip()

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
    only_baseline = merged[merged['_merge'] == 'left_only']
    only_pipeline = merged[merged['_merge'] == 'right_only']
    both = merged[merged['_merge'] == 'both']

    mismatched = both[both['cmp_baseline'] != both['cmp_pipeline']]
    matched = both.shape[0] - mismatched.shape[0]
    total = merged.shape[0]

    summary_lines.append(
        f"{baseline_path.name},{current_path.name},{total},{matched},{only_baseline.shape[0]},{only_pipeline.shape[0]},{mismatched.shape[0]},{matched/total if total else 0:.4f}\n"
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


for baseline_file in baseline_files:
    compare_files(baseline_file)

with (DIFF_DIR / "_summary.csv").open('w') as fh:
    fh.writelines(summary_lines)

print("Diff generation complete.")
