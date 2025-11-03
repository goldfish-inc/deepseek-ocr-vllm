#!/usr/bin/env python3
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

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

    only_baseline = merged[merged['_merge'] == 'left_only']
    only_pipeline = merged[merged['_merge'] == 'right_only']
    both = merged[merged['_merge'] == 'both']

    # Build comparison columns with normalization per config/env
    merged['cmp_baseline'] = merged['baseline_value'].astype(str)
    merged['cmp_pipeline'] = merged['pipeline_value'].astype(str)

    # Whitespace trimming
    if CONFIG["ignore_transformations"].get("whitespace", False):
        merged['cmp_baseline'] = merged['cmp_baseline'].str.strip()
        merged['cmp_pipeline'] = merged['cmp_pipeline'].str.strip()

    # Case-insensitive columns
    if CONFIG.get("case_insensitive_columns"):
        mask = merged['column_name'].isin([c.upper() for c in CONFIG["case_insensitive_columns"]])
        merged.loc[mask, 'cmp_baseline'] = merged.loc[mask, 'cmp_baseline'].str.upper()
        merged.loc[mask, 'cmp_pipeline'] = merged.loc[mask, 'cmp_pipeline'].str.upper()

    # Date normalization
    if CONFIG["ignore_transformations"].get("date_formats", False):
        def _norm_date(series: pd.Series) -> pd.Series:
            dt = pd.to_datetime(series, errors='coerce', infer_datetime_format=True)
            out = series.copy()
            mask = dt.notna()
            out.loc[mask] = dt.loc[mask].dt.strftime('%Y-%m-%d')
            return out
        merged['cmp_baseline'] = _norm_date(merged['cmp_baseline'])
        merged['cmp_pipeline'] = _norm_date(merged['cmp_pipeline'])

    # Float precision rounding
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
