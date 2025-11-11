#!/usr/bin/env python3
"""
Analyze and compare data schemas between:
1. MVP parquet (authorized vessels)
2. HF OCR data (IUU lists from PDFs)
3. EBISU schema (database tables)
"""

import duckdb
import json
from pathlib import Path

def analyze_mvp_parquet():
    """Extract schema from MVP parquet file"""
    print("=" * 80)
    print("MVP PARQUET SCHEMA (Authorized Vessels)")
    print("=" * 80)

    conn = duckdb.connect()
    result = conn.execute("""
        SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet') LIMIT 0
    """).description

    columns = [col[0] for col in result]
    print(f"\nTotal columns: {len(columns)}")
    print("\nColumn names (sorted):")
    for col in sorted(columns):
        print(f"  - {col}")

    # Sample data to understand content
    sample = conn.execute("""
        SELECT * FROM read_parquet('data/mvp/vessels_mvp.parquet') LIMIT 3
    """).fetchdf()

    print(f"\nSample record count: {len(sample)}")
    print("\nKey fields with sample values:")
    key_fields = ['ENTITY_ID', 'IMO', 'MMSI', 'IRCS', 'VESSEL_NAME', 'VESSEL_FLAG', 'RFMO']
    for field in key_fields:
        if field in sample.columns:
            print(f"  {field}: {sample[field].iloc[0] if len(sample) > 0 else 'N/A'}")

    return columns

def analyze_hf_ocr():
    """Extract structure from HF OCR data"""
    print("\n" + "=" * 80)
    print("HUGGING FACE OCR SCHEMA (IUU Watchlists)")
    print("=" * 80)

    conn = duckdb.connect()

    # Get schema
    result = conn.execute("""
        SELECT * FROM read_parquet('/tmp/hf-deepseekocr/*.parquet') LIMIT 0
    """).description

    columns = [col[0] for col in result]
    print(f"\nTotal columns: {len(columns)}")
    print("\nColumn names:")
    for col in columns:
        print(f"  - {col}")

    # Extract table headers from OCR text
    print("\nExtracted table fields from OCR:")
    headers = conn.execute("""
        SELECT DISTINCT
            REGEXP_EXTRACT_ALL(clean_text, '<td>([^<]+)</td>', 1) as fields
        FROM read_parquet('/tmp/hf-deepseekocr/*.parquet')
        WHERE clean_text LIKE '%<table>%'
        LIMIT 100
    """).fetchall()

    unique_fields = set()
    for row in headers:
        if row[0]:
            unique_fields.update(row[0])

    for field in sorted(unique_fields)[:50]:  # Show first 50
        print(f"  - {field}")

    return columns, unique_fields

def compare_schemas(mvp_cols, hf_fields):
    """Compare schemas and identify gaps"""
    print("\n" + "=" * 80)
    print("SCHEMA COMPARISON & GAP ANALYSIS")
    print("=" * 80)

    # Normalize for comparison
    mvp_lower = {col.lower() for col in mvp_cols}
    hf_lower = {field.lower() for field in hf_fields if field and len(field) < 100}

    print("\n📊 Coverage Analysis:")
    print(f"MVP parquet columns: {len(mvp_cols)}")
    print(f"HF unique fields: {len(hf_fields)}")

    print("\n🔴 Fields in HF OCR NOT in MVP parquet (NEW DATA!):")
    new_fields = []
    for field in sorted(hf_lower):
        # Check if this concept exists in MVP
        if not any(mvp_field for mvp_field in mvp_lower if
                   field in mvp_field or mvp_field in field):
            new_fields.append(field)

    for field in new_fields[:30]:  # Show first 30
        print(f"  - {field}")

    return new_fields

def identify_critical_gaps():
    """Identify critical missing fields for intelligence"""
    print("\n" + "=" * 80)
    print("CRITICAL INTELLIGENCE GAPS")
    print("=" * 80)

    critical_fields = {
        "Sanctions & Compliance": [
            "IUU listing date",
            "IUU activities/violations",
            "Sanctioning authority",
            "Removal date",
            "Resolution status"
        ],
        "Ownership Intelligence": [
            "Beneficial owner",
            "Previous owners",
            "Operator",
            "Owning company address",
            "Shell company indicators"
        ],
        "Temporal Tracking": [
            "Previous names",
            "Previous flags",
            "Previous call signs",
            "Name change dates",
            "Flag change dates"
        ],
        "Enforcement": [
            "Actions taken",
            "Port inspection results",
            "Detention records",
            "Penalties imposed"
        ],
        "Risk Indicators": [
            "Summary of activities",
            "Concerns",
            "Crimes",
            "State ownership"
        ]
    }

    for category, fields in critical_fields.items():
        print(f"\n{category}:")
        for field in fields:
            print(f"  - {field}")

if __name__ == "__main__":
    mvp_cols = analyze_mvp_parquet()
    hf_cols, hf_fields = analyze_hf_ocr()
    new_fields = compare_schemas(mvp_cols, hf_fields)
    identify_critical_gaps()

    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)
