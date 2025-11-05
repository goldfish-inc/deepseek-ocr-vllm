#!/usr/bin/env python3
"""
Debug CCSBT composite key engagement.

Analyzes why composite keys didn't align any cells while row_index aligned 18,436.
Checks for duplicates, column presence, and canonicalization gaps.
"""

import pandas as pd
import sys
import os
import re
from pathlib import Path
from collections import Counter


def canon_col_name(s: str) -> str:
    """Canonicalize column name (matches phase_b_diff.py logic).

    - Uppercase all characters
    - Replace any run of non-alphanumeric characters with a single underscore
    - Trim leading/trailing underscores
    """
    s = (s or "").upper()
    s = re.sub(r"[^A-Z0-9]+", "_", s)
    s = s.strip("_")
    return s


def canonicalize_value(val):
    """Apply same canonicalization as diff harness."""
    if pd.isna(val):
        return None
    s = str(val).strip().upper()
    return s if s else None


def analyze_composite_keys(baseline_path: Path, pipeline_path: Path):
    """Diagnose composite key issues for CCSBT."""

    # Load baseline (wide format)
    baseline_wide = pd.read_csv(baseline_path, dtype=str).fillna("")

    # Canonicalize baseline column names
    baseline_wide.columns = [canon_col_name(str(col).strip()) for col in baseline_wide.columns]

    # Load pipeline (long format) and pivot to wide
    pipeline_long = pd.read_csv(pipeline_path, dtype=str, keep_default_na=False)
    pipeline_wide = pipeline_long.pivot_table(
        index='row_index',
        columns='column_name',
        values='cleaned_value',
        aggfunc='first'
    ).fillna("")
    pipeline_wide = pipeline_wide.reset_index(drop=True)

    print("=" * 80)
    print("CCSBT COMPOSITE KEY DIAGNOSTIC")
    print("=" * 80)
    print(f"\nBaseline: {len(baseline_wide)} rows")
    print(f"Pipeline: {len(pipeline_wide)} rows")
    print(f"\nBaseline columns (canonicalized): {sorted(baseline_wide.columns)[:10]}...")
    print(f"Pipeline columns: {sorted(pipeline_wide.columns)[:10]}...")

    # Composite key sets from diff_config.yaml
    composite_sets = [
        ["VESSEL_REGISTRATION_NUMBER", "VESSEL_NAME"],
        ["CCSBT_REGISTRATION_NUMBER", "VESSEL_NAME"],
        ["IMO", "VESSEL_NAME"]
    ]

    for idx, composite_cols in enumerate(composite_sets, 1):
        print(f"\n{'=' * 80}")
        print(f"COMPOSITE SET {idx}: {composite_cols}")
        print("=" * 80)

        # Check column presence
        baseline_missing = [c for c in composite_cols if c not in baseline_wide.columns]
        pipeline_missing = [c for c in composite_cols if c not in pipeline_wide.columns]

        if baseline_missing:
            print(f"❌ BASELINE MISSING: {baseline_missing}")
            continue
        if pipeline_missing:
            print(f"❌ PIPELINE MISSING: {pipeline_missing}")
            continue

        print("✅ Columns present in both sides")

        # Analyze baseline
        print("\n--- BASELINE ---")
        baseline_valid = baseline_wide.copy()
        for col in composite_cols:
            baseline_valid[f"{col}_canon"] = baseline_valid[col].apply(canonicalize_value)

        baseline_valid = baseline_valid.dropna(subset=[f"{col}_canon" for col in composite_cols])
        baseline_valid["_composite"] = baseline_valid[[f"{col}_canon" for col in composite_cols]].apply(
            lambda row: "||".join(row.astype(str)), axis=1
        )

        print(f"Rows with non-null composite: {len(baseline_valid)}/{len(baseline_wide)}")

        composite_counts = Counter(baseline_valid["_composite"])
        duplicates = [(k, v) for k, v in composite_counts.items() if v > 1]

        print(f"Unique composites: {len(composite_counts)}")
        print(f"Duplicates: {len(duplicates)}")

        if duplicates:
            print("\nTop 5 duplicate composites:")
            for comp, count in sorted(duplicates, key=lambda x: x[1], reverse=True)[:5]:
                print(f"  {comp}: {count} occurrences")

        # Analyze pipeline
        print("\n--- PIPELINE ---")
        pipeline_valid = pipeline_wide.copy()
        for col in composite_cols:
            pipeline_valid[f"{col}_canon"] = pipeline_valid[col].apply(canonicalize_value)

        pipeline_valid = pipeline_valid.dropna(subset=[f"{col}_canon" for col in composite_cols])
        pipeline_valid["_composite"] = pipeline_valid[[f"{col}_canon" for col in composite_cols]].apply(
            lambda row: "||".join(row.astype(str)), axis=1
        )

        print(f"Rows with non-null composite: {len(pipeline_valid)}/{len(pipeline_wide)}")

        composite_counts = Counter(pipeline_valid["_composite"])
        duplicates = [(k, v) for k, v in composite_counts.items() if v > 1]

        print(f"Unique composites: {len(composite_counts)}")
        print(f"Duplicates: {len(duplicates)}")

        if duplicates:
            print("\nTop 5 duplicate composites:")
            for comp, count in sorted(duplicates, key=lambda x: x[1], reverse=True)[:5]:
                print(f"  {comp}: {count} occurrences")

        # Check overlap
        baseline_composites = set(baseline_valid["_composite"])
        pipeline_composites = set(pipeline_valid["_composite"])

        overlap = baseline_composites & pipeline_composites
        baseline_only = baseline_composites - pipeline_composites
        pipeline_only = pipeline_composites - baseline_composites

        print("\n--- OVERLAP ANALYSIS ---")
        print(f"Matching composites: {len(overlap)}")
        print(f"Baseline-only: {len(baseline_only)}")
        print(f"Pipeline-only: {len(pipeline_only)}")

        if baseline_only:
            print("\nSample baseline-only composites (first 5):")
            for comp in sorted(baseline_only)[:5]:
                print(f"  {comp}")

        if pipeline_only:
            print("\nSample pipeline-only composites (first 5):")
            for comp in sorted(pipeline_only)[:5]:
                print(f"  {comp}")

        # Harness rejection check
        baseline_has_dupes = len(duplicates) > 0 or len(baseline_valid) < len(baseline_df)
        pipeline_has_dupes = len(duplicates) > 0 or len(pipeline_valid) < len(pipeline_df)

        print("\n--- HARNESS VERDICT ---")
        if baseline_has_dupes or pipeline_has_dupes:
            print("❌ REJECTED: Duplicates or nulls detected")
            print(f"   Baseline duplicates: {baseline_has_dupes}")
            print(f"   Pipeline duplicates: {pipeline_has_dupes}")
        elif len(overlap) == 0:
            print("❌ REJECTED: No matching composites between sides")
        else:
            print(f"✅ SHOULD ENGAGE: {len(overlap)} matching composites")


def main():
    # Paths to CCSBT exports
    baseline_path = Path("tests/reconciliation/baseline/vessels/RFMO/cleaned/ccsbt_vessels_cleaned.csv")

    # Find current/pipeline export (prefer XLSX if PREFER_EXT=xlsx)
    current_dir = Path("tests/reconciliation/current")
    prefer_ext = os.getenv("PREFER_EXT", "csv")

    # Try to find pipeline export matching CCSBT (case-insensitive)
    pipeline_candidates = list(current_dir.glob(f"*CCSBT*{prefer_ext}_stage.csv"))
    if not pipeline_candidates:
        # Fallback to any CCSBT file
        pipeline_candidates = list(current_dir.glob("*CCSBT*.csv"))
        if not pipeline_candidates:
            pipeline_candidates = list(current_dir.glob("*ccsbt*.csv"))

    if not baseline_path.exists():
        print(f"❌ Baseline export not found: {baseline_path}", file=sys.stderr)
        sys.exit(1)

    if not pipeline_candidates:
        print(f"❌ Pipeline export not found in {current_dir}", file=sys.stderr)
        print(f"   Searched for: *ccsbt*{prefer_ext}_stage.csv", file=sys.stderr)
        sys.exit(1)

    pipeline_path = pipeline_candidates[0]
    print(f"Using pipeline export: {pipeline_path.name}\n")

    analyze_composite_keys(baseline_path, pipeline_path)


if __name__ == "__main__":
    main()
