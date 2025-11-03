#!/usr/bin/env python3
import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

BASELINE_DIR = Path("tests/reconciliation/baseline/vessels/RFMO/cleaned")
CURRENT_DIR = Path("tests/reconciliation/current")
DIFF_DIR = Path("tests/reconciliation/diffs")
DIFF_DIR.mkdir(parents=True, exist_ok=True)

if not BASELINE_DIR.exists():
    sys.exit(f"Missing baseline directory: {BASELINE_DIR}")
if not CURRENT_DIR.exists():
    sys.exit(f"Missing current directory: {CURRENT_DIR}")

baseline_files = sorted(BASELINE_DIR.glob('*.csv'))
if not baseline_files:
    sys.exit("No baseline CSVs found. Run Phase A first.")

def baseline_to_long(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str).fillna('')
    records = []
    for idx, row in df.iterrows():
        for col, value in row.items():
            records.append({
                'row_index': idx,
                'column_name': str(col).strip().upper(),
                'baseline_value': str(value).strip()
            })
    return pd.DataFrame(records)

def find_current_file(slug: str) -> Path:
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
    df['column_name'] = df['column_name'].astype(str).str.upper()
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

    mismatched = both[both['baseline_value'] != both['pipeline_value']]
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
