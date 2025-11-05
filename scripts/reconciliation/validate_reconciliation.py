#!/usr/bin/env python3
"""CI guard for reconciliation metrics: prevent regressions and coverage drops.

Usage:
    python scripts/reconciliation/validate_reconciliation.py [--threshold-file YAML]

Exit codes:
    0: All checks passed
    1: Critical failures (null_aware_match_rate regression > threshold)
    2: Warnings (coverage drops detected but within tolerance)
"""
import argparse
import sys
from pathlib import Path

import pandas as pd
try:
    import yaml  # type: ignore
except Exception:
    yaml = None


DEFAULT_THRESHOLDS = {
    # Critical: null_aware_match_rate regression threshold (%)
    "max_match_rate_drop_pct": 5.0,  # Fail if any RFMO drops >5%

    # Warning: per-column coverage drop threshold (%)
    "max_coverage_drop_pct": 10.0,  # Warn if pipeline coverage drops >10% for any column

    # Baseline match rates (from 2025-11-04 null-aware run)
    "baseline_match_rates": {
        "CCSBT": 0.9905,
        "FFA": 0.9998,
        "IATTC": 1.0000,
        "ICCAT": 0.9999,
        "IOTC": 0.4425,
        "NAFO": 0.9750,
        "NEAFC": 0.9294,
        "NPFC": 0.9998,
        "PNA": 0.9966,
        "SPRFMO": 0.9995,
        "WCPFC": 0.9992,
    },

    # Key columns where coverage drops are critical
    "critical_columns": ["IMO", "NAME", "FLAG_STATE_CODE", "FLAG"],

    # Alignment guard: required columns in summary
    "alignment_required_columns": [
        "aligned_by_join_key",
        "aligned_by_composite",
        "aligned_by_row_index",
    ],

    # Alignment guard: max allowed row_index-aligned cells per RFMO
    # Flags regressions where composite/join alignment should be engaging
    "alignment_row_index_thresholds": {
        "CCSBT": 1000,  # currently ~598
        "IOTC": 100,    # currently 0
        "PNA": 50,      # currently 20
    },

    # Alignment guard: minimum composite engagement per RFMO
    # Ensures composite keys continue to engage
    "alignment_composite_min": {
        "CCSBT": 15000,  # currently ~18630
        "IOTC": 70000,   # currently ~80316
    },
}


def load_thresholds(path: Path | None) -> dict:
    """Load thresholds from YAML or use defaults."""
    thresholds = DEFAULT_THRESHOLDS.copy()
    if path and path.exists() and yaml:
        try:
            with path.open("r") as fh:
                custom = yaml.safe_load(fh) or {}
                thresholds.update(custom)
        except Exception as e:
            print(f"[WARN] Failed to load thresholds from {path}: {e}", file=sys.stderr)
    return thresholds


def validate_summary(summary_path: Path, thresholds: dict) -> tuple[bool, list[str], list[str]]:
    """Validate _summary.csv for match rate regressions.

    Returns:
        (passed, errors, warnings)
    """
    if not summary_path.exists():
        return (False, [f"Summary file not found: {summary_path}"], [])

    df = pd.read_csv(summary_path, skiprows=1)  # Skip "Generated:" header
    errors = []
    warnings = []

    baseline_rates = thresholds.get("baseline_match_rates", {})
    max_drop_pct = thresholds.get("max_match_rate_drop_pct", 5.0)

    for _, row in df.iterrows():
        baseline_file = row.get("baseline_file", "")
        rfmo = baseline_file.split("_")[0].upper() if baseline_file else "UNKNOWN"

        current_rate = float(row.get("null_aware_match_rate", 0.0))
        baseline_rate = baseline_rates.get(rfmo)

        if baseline_rate is not None:
            drop_pct = (baseline_rate - current_rate) * 100

            if drop_pct > max_drop_pct:
                errors.append(
                    f"{rfmo}: null_aware_match_rate dropped {drop_pct:.2f}% "
                    f"({baseline_rate:.4f} → {current_rate:.4f}), "
                    f"threshold: {max_drop_pct}%"
                )
            elif drop_pct > 0:
                warnings.append(
                    f"{rfmo}: null_aware_match_rate dropped {drop_pct:.2f}% "
                    f"({baseline_rate:.4f} → {current_rate:.4f})"
                )

    return (len(errors) == 0, errors, warnings)


def validate_presence(diffs_dir: Path, thresholds: dict) -> tuple[bool, list[str], list[str]]:
    """Validate per-column coverage from presence CSVs.

    Returns:
        (passed, errors, warnings)
    """
    if not diffs_dir.exists():
        return (False, [f"Diffs directory not found: {diffs_dir}"], [])

    errors = []
    warnings = []

    max_coverage_drop = thresholds.get("max_coverage_drop_pct", 10.0)
    critical_columns = thresholds.get("critical_columns", [])

    for presence_file in sorted(diffs_dir.glob("*_presence.csv")):
        rfmo = presence_file.stem.replace("_presence", "").upper()

        try:
            df = pd.read_csv(presence_file)
        except Exception as e:
            errors.append(f"{rfmo}: Failed to read presence file: {e}")
            continue

        for _, row in df.iterrows():
            column_name = row.get("column_name", "")
            delta_pct = float(row.get("delta_pct", 0.0))
            baseline_pct = float(row.get("baseline_non_null_pct", 0.0))
            pipeline_pct = float(row.get("pipeline_non_null_pct", 0.0))

            # Coverage drop (negative delta)
            if delta_pct < -max_coverage_drop:
                msg = (
                    f"{rfmo}.{column_name}: coverage dropped {abs(delta_pct):.2f}% "
                    f"({baseline_pct:.2f}% → {pipeline_pct:.2f}%)"
                )

                if column_name in critical_columns:
                    errors.append(f"[CRITICAL] {msg}")
                else:
                    warnings.append(msg)

    return (len(errors) == 0, errors, warnings)


def validate_alignment(summary_path: Path, thresholds: dict) -> tuple[bool, list[str], list[str]]:
    """Validate alignment expectations from summary CSV.

    Checks:
      - Required alignment columns exist
      - Row-index alignment not exceeding RFMO-specific thresholds
      - Minimum composite engagement for target RFMOs

    Returns:
        (passed, errors, warnings)
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not summary_path.exists():
        return (False, [f"Summary file not found: {summary_path}"], warnings)

    try:
        df = pd.read_csv(summary_path, skiprows=1)
    except Exception as e:
        return (False, [f"Failed to read summary: {e}"], warnings)

    required_cols = thresholds.get("alignment_required_columns", [])
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        errors.append(
            f"Summary missing alignment columns: {', '.join(missing)}"
        )
        # If required columns are missing, further checks won't work; return early
        return (False, errors, warnings)

    # Build RFMO code from baseline_file first token
    df = df.copy()
    df["rfmo"] = df["baseline_file"].map(lambda s: str(s).split("_")[0].upper() if pd.notna(s) else "")

    # Row-index thresholds
    row_index_limits: dict = thresholds.get("alignment_row_index_thresholds", {}) or {}
    for rfmo, limit in row_index_limits.items():
        sub = df[df["rfmo"] == rfmo]
        if sub.empty:
            continue
        try:
            val = int(sub["aligned_by_row_index"].iloc[0])
        except Exception:
            val = 0
        if val > int(limit):
            errors.append(
                f"{rfmo}: aligned_by_row_index={val} exceeds threshold={limit}"
            )

    # Composite engagement minimums
    comp_mins: dict = thresholds.get("alignment_composite_min", {}) or {}
    for rfmo, minimum in comp_mins.items():
        sub = df[df["rfmo"] == rfmo]
        if sub.empty:
            continue
        try:
            val = int(sub["aligned_by_composite"].iloc[0])
        except Exception:
            val = 0
        if val < int(minimum):
            errors.append(
                f"{rfmo}: aligned_by_composite={val} below minimum={minimum}"
            )

    return (len(errors) == 0, errors, warnings)


def main():
    parser = argparse.ArgumentParser(description="Validate reconciliation metrics")
    parser.add_argument(
        "--threshold-file",
        type=Path,
        help="Path to YAML file with custom thresholds"
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("tests/reconciliation/diffs/_summary.csv"),
        help="Path to summary CSV (default: tests/reconciliation/diffs/_summary.csv)"
    )
    parser.add_argument(
        "--diffs-dir",
        type=Path,
        default=Path("tests/reconciliation/diffs"),
        help="Path to diffs directory (default: tests/reconciliation/diffs)"
    )
    args = parser.parse_args()

    thresholds = load_thresholds(args.threshold_file)

    # Validate summary (match rate regressions)
    summary_passed, summary_errors, summary_warnings = validate_summary(
        args.summary, thresholds
    )

    # Validate presence (coverage drops)
    presence_passed, presence_errors, presence_warnings = validate_presence(
        args.diffs_dir, thresholds
    )

    # Alignment validation (composite/join/row_index expectations)
    align_passed, align_errors, align_warnings = validate_alignment(
        args.summary, thresholds
    )

    # Report results
    all_errors = summary_errors + presence_errors + align_errors
    all_warnings = summary_warnings + presence_warnings + align_warnings

    if all_errors:
        print("❌ CRITICAL FAILURES:", file=sys.stderr)
        for error in all_errors:
            print(f"  - {error}", file=sys.stderr)
        print(file=sys.stderr)

    if all_warnings:
        print("⚠️  WARNINGS:", file=sys.stderr)
        for warning in all_warnings:
            print(f"  - {warning}", file=sys.stderr)
        print(file=sys.stderr)

    if not all_errors and not all_warnings:
        print("✅ All reconciliation checks passed")
        return 0
    elif all_errors:
        print(f"❌ {len(all_errors)} critical failure(s), {len(all_warnings)} warning(s)", file=sys.stderr)
        return 1
    else:
        print(f"⚠️  {len(all_warnings)} warning(s), no critical failures", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
