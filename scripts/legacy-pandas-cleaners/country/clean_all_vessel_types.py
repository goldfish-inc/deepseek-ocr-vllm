#!/usr/bin/env python3
"""
Universal Vessel Data Cleaner
Extends the RFMO cleaner pattern to handle all vessel registry types:
- CIVIL_SOCIETY (ISSF_*)
- COUNTRY (national registries)
- COUNTRY_EU (EU fleet registries)
- INTERGOV (PNA_*, etc.)
"""
import csv
import os
import sys
from pathlib import Path
from typing import Dict, List

RAW_ROOT = Path(os.environ.get("EBISU_RAW_ROOT", "data/raw")).expanduser().resolve()
PROCESSED_ROOT = Path(os.environ.get("EBISU_PROCESSED_ROOT", RAW_ROOT)).expanduser().resolve()

# Vessel registry types to process
VESSEL_TYPES = ["CIVIL_SOCIETY", "COUNTRY", "COUNTRY_EU", "INTERGOV"]

def collapse_whitespace(value: str) -> str:
    """Normalize whitespace in data values"""
    return " ".join(value.split())

def clean_csv(raw_file: Path, vessel_type: str, source_name: str):
    """Clean a single vessel CSV file using RFMO cleaner pattern"""
    # Output directory based on vessel type
    out_dir = PROCESSED_ROOT / "vessels" / vessel_type / "cleaned"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Generate output filename: source_vessels_cleaned.csv
    output_name = f"{source_name.lower()}_vessels_cleaned.csv"
    output_path = out_dir / output_name

    # Handle different CSV dialects
    delimiter = ',' if raw_file.suffix.lower() == '.csv' else ';'
    if vessel_type == "COUNTRY_EU":
        delimiter = ';'  # EU data uses semicolon separator

    with raw_file.open('r', newline='', encoding='utf-8-sig') as infile:
        # Detect delimiter from first line
        sample = infile.read(1024)
        infile.seek(0)
        if sample.count(';') > sample.count(','):
            delimiter = ';'

        reader = csv.DictReader(infile, delimiter=delimiter)

        # Standardize field names: spaces to underscores, strip whitespace
        fieldnames = []
        for name in reader.fieldnames:
            clean_name = name.strip().replace(' ', '_').replace('(', '').replace(')', '').replace('.', '')
            fieldnames.append(clean_name)

        with output_path.open('w', newline='', encoding='utf-8') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()

            for row in reader:
                cleaned = {}
                for original, cleaned_name in zip(reader.fieldnames, fieldnames):
                    value = row.get(original, '')
                    if isinstance(value, str):
                        value = collapse_whitespace(value.strip())
                    cleaned[cleaned_name] = value
                writer.writerow(cleaned)

    print(f"✅ Cleaned {raw_file.name} → {vessel_type}/{output_name}")
    return output_path

def process_vessel_type(vessel_type: str):
    """Process all sources for a given vessel type"""
    base_dir = RAW_ROOT / "vessels" / "vessel_data" / vessel_type

    if not base_dir.exists():
        print(f"⚠️ Skipping {vessel_type} - directory not found: {base_dir}")
        return

    # Find all sources (subdirectories or direct files)
    if vessel_type in ["COUNTRY_EU"]:
        # EU data is directly in raw/ folder
        raw_dir = base_dir / "raw"
        if raw_dir.exists():
            csv_files = list(raw_dir.glob("*.csv"))
            for csv_file in sorted(csv_files):
                # Extract source name from filename: ITA_vessels_2025-09-08.csv → ITA
                source_name = csv_file.name.split('_')[0]
                clean_csv(csv_file, vessel_type, source_name)
    else:
        # Other types have source subdirectories
        for source_dir in sorted(base_dir.iterdir()):
            if source_dir.is_dir() and source_dir.name not in ['cleaned', 'raw', 'stage']:
                raw_dir = source_dir / "raw"
                if raw_dir.exists():
                    csv_files = list(raw_dir.glob("*.csv"))
                    for csv_file in sorted(csv_files):
                        clean_csv(csv_file, vessel_type, source_dir.name)

def main():
    """Process all vessel registry types"""
    if len(sys.argv) > 1:
        # Process specific type if provided
        vessel_type = sys.argv[1].upper()
        if vessel_type in VESSEL_TYPES:
            print(f"🧹 Cleaning {vessel_type} vessel data...")
            process_vessel_type(vessel_type)
        else:
            print(f"❌ Unknown vessel type: {vessel_type}")
            print(f"Available types: {', '.join(VESSEL_TYPES)}")
            sys.exit(1)
    else:
        # Process all types
        print("🧹 Cleaning all vessel registry data...")
        for vessel_type in VESSEL_TYPES:
            print(f"\n=== Processing {vessel_type} ===")
            process_vessel_type(vessel_type)

    print(f"\n✅ Vessel data cleaning complete!")
    print(f"📁 Outputs in: {PROCESSED_ROOT}/vessels/[TYPE]/cleaned/")

if __name__ == "__main__":
    main()
