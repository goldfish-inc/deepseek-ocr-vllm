#!/usr/bin/env python3
"""
ENHANCED WoRMS Partitioned Processor - Data Quality + Preparation for Partitioned Table
Processes WoRMS data for optimal import into PostgreSQL partitioned table
"""

import os
import shutil
import glob
import re
import logging
from collections import defaultdict

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def find_worms_folder():
    """Find and validate WoRMS folder"""
    # Use environment variables for proper data organization
    raw_root = os.environ.get("EBISU_RAW_ROOT", "data/raw")
    worms_folders = glob.glob(f"{raw_root}/WoRMS_download_*")

    if not worms_folders:
        # Check for legacy locations
        legacy_paths = ["/import/WoRMS_download_*", "/import/WoRMS"]
        for pattern in legacy_paths:
            if '*' in pattern:
                legacy_folders = glob.glob(pattern)
                if legacy_folders:
                    worms_folders = legacy_folders
                    break
            elif os.path.exists(pattern):
                worms_folders = [pattern]
                break

        if not worms_folders:
            raise Exception(f"No WoRMS download folders found in {raw_root}/ or legacy locations!")

    raw_worms = sorted(worms_folders)[-1]

    folder_name = os.path.basename(raw_worms)
    date_match = re.search(r'WoRMS_download_(\d{4}-\d{2}-\d{2})', folder_name)
    worms_date = date_match.group(1) if date_match else "2025-07-01"

    logger.info(f"📁 Using WoRMS data from: {raw_worms}")
    logger.info(f"📅 WoRMS download date: {worms_date}")
    return raw_worms, worms_date

# Initialize paths
RAW_WORMS, WORMS_DOWNLOAD_DATE = find_worms_folder()
# Use environment variables for proper data organization
raw_root = os.environ.get("EBISU_RAW_ROOT", "data/raw")
FIXED_OUT = f"{raw_root}/WoRMS_cleaned_rawfix"

os.makedirs(FIXED_OUT, exist_ok=True)

def normalize_columns(line, expected_cols):
    """Normalize line to have exactly expected_cols columns with data cleaning"""
    parts = line.strip().split('\t')

    # Clean each part to handle problematic characters
    cleaned_parts = []
    for part in parts:
        # Remove non-printable characters except tabs and newlines
        cleaned_part = ''.join(char for char in part if char.isprintable() or char in '\t\n')
        # Handle problematic quotes - replace them with single quotes or remove
        cleaned_part = cleaned_part.replace('"', "'").replace('\r', '').replace('\n', ' ')
        cleaned_parts.append(cleaned_part)

    # If we have fewer columns, pad with empty strings
    while len(cleaned_parts) < expected_cols:
        cleaned_parts.append('')

    # If we have more columns, truncate to expected count
    if len(cleaned_parts) > expected_cols:
        cleaned_parts = cleaned_parts[:expected_cols]

    return "\t".join(cleaned_parts)

def clean_file_with_spacing_fix(input_path, output_path, expected_cols):
    """Clean file with proper spacing fixes and data quality enhancements"""
    logger.info(f"🧼 Cleaning with enhanced spacing fix: {os.path.basename(input_path)} (expecting {expected_cols} cols)")

    if not os.path.exists(input_path):
        logger.error(f"❌ Input file not found: {input_path}")
        return False

    try:
        lines_processed = 0
        with open(input_path, 'r', encoding='utf-8', errors='replace') as infile:
            with open(output_path, 'w', encoding='utf-8') as outfile:

                # Process header first
                header_line = infile.readline()
                if not header_line:
                    logger.error(f"❌ Empty file: {input_path}")
                    return False

                # Normalize header to expected columns
                header = normalize_columns(header_line, expected_cols)
                outfile.write(header + '\n')

                actual_cols = len(header_line.strip().split('\t'))
                logger.info(f"   📊 Header: {actual_cols} columns (normalized to {expected_cols})")

                if actual_cols != expected_cols:
                    logger.info(f"   🔧 Column normalization applied: {actual_cols} → {expected_cols}")

                # Process data lines with enhanced column normalization
                for line_num, line in enumerate(infile, start=2):
                    if line.strip():  # Skip empty lines
                        try:
                            # Apply column normalization with data cleaning
                            normalized_line = normalize_columns(line, expected_cols)
                            outfile.write(normalized_line + '\n')
                            lines_processed += 1

                            # Progress indicator for large files
                            if lines_processed % 100000 == 0:
                                logger.info(f"   📊 Processed {lines_processed:,} lines...")

                        except Exception as e:
                            logger.warning(f"   ⚠️ Line {line_num}: Normalization failed - {e}")
                            # Write normalized line as fallback
                            normalized_line = normalize_columns(line, expected_cols)
                            outfile.write(normalized_line + '\n')
                            lines_processed += 1

        logger.info(f"✅ Enhanced cleaning complete: {lines_processed:,} lines → {output_path}")
        return True

    except Exception as e:
        logger.error(f"❌ Error cleaning {input_path}: {e}")
        return False

def validate_kingdom_distribution(input_path):
    """Validate kingdom distribution in the cleaned taxon file"""
    logger.info("🔍 Validating kingdom distribution for partitioning...")

    kingdom_stats = defaultdict(int)
    total_records = 0

    try:
        with open(input_path, 'r', encoding='utf-8', errors='replace') as f:
            # Skip header
            header_line = f.readline().strip()
            header_cols = header_line.split('\t')

            # Find kingdom column index
            try:
                kingdom_index = header_cols.index('kingdom')
                logger.info(f"📊 Kingdom column found at index: {kingdom_index}")
            except ValueError:
                logger.error("❌ Kingdom column not found!")
                return False

            # Count kingdoms
            for line_num, line in enumerate(f, start=2):
                if line.strip():
                    cols = line.strip().split('\t')
                    if kingdom_index < len(cols):
                        kingdom_value = cols[kingdom_index].strip()
                        if kingdom_value:
                            kingdom_stats[kingdom_value] += 1
                        else:
                            kingdom_stats['<empty>'] += 1
                    else:
                        kingdom_stats['<missing>'] += 1
                    total_records += 1

                    # Progress indicator
                    if total_records % 100000 == 0:
                        logger.info(f"   📊 Analyzed {total_records:,} records...")

        # Report kingdom distribution
        logger.info("📊 Kingdom distribution for partitioning:")
        for kingdom, count in sorted(kingdom_stats.items(), key=lambda x: x[1], reverse=True):
            percentage = (count / total_records * 100) if total_records > 0 else 0
            logger.info(f"   {kingdom:<25} | {count:>8,} records | {percentage:5.1f}%")

        logger.info(f"📈 Total records for partitioned table: {total_records:,}")

        # Validate we have reasonable kingdoms for partitioning
        main_kingdoms = ['Animalia', 'Bacteria', 'Plantae', 'Fungi', 'Archaea', 'Chromista', 'Protozoa']
        found_main_kingdoms = [k for k in main_kingdoms if k in kingdom_stats and kingdom_stats[k] > 0]

        logger.info(f"✅ Found {len(found_main_kingdoms)} main kingdoms: {found_main_kingdoms}")

        if len(found_main_kingdoms) < 3:
            logger.warning(f"⚠️ Only {len(found_main_kingdoms)} main kingdoms found - data may be incomplete")

        return total_records > 50000  # Reasonable threshold

    except Exception as e:
        logger.error(f"❌ Error validating kingdom distribution: {e}")
        return False

def clean_and_fix_all_files():
    """Clean spacing issues in ALL WoRMS files for partitioned table import"""
    logger.info("🧼 Cleaning ALL WoRMS files for PARTITIONED TABLE import...")

    # File specifications for partitioned approach
    files_to_process = {
        "taxon.txt": 32,            # Main table for partitioning
        "identifier.txt": 6,        # Supporting table with FK to main
        "speciesprofile.txt": 6,    # Supporting table with FK to main
        "vernacularname.txt": 5     # Optional supporting table
    }

    files_processed = 0

    for filename, expected_cols in files_to_process.items():
        input_path = os.path.join(RAW_WORMS, filename)
        output_path = os.path.join(FIXED_OUT, filename.replace(".txt", "_spaced.txt"))

        if not os.path.exists(input_path):
            if filename in ["taxon.txt", "identifier.txt", "speciesprofile.txt"]:
                logger.error(f"❌ Required file missing: {filename}")
                return False
            else:
                logger.info(f"ℹ️ Optional file missing: {filename}")
                continue

        if clean_file_with_spacing_fix(input_path, output_path, expected_cols):
            files_processed += 1

            # Special validation for main taxon file
            if filename == "taxon.txt":
                if not validate_kingdom_distribution(output_path):
                    logger.error("❌ Kingdom distribution validation failed")
                    return False
        else:
            logger.error(f"❌ Failed to process {filename}")
            return False

    logger.info(f"📁 Successfully processed {files_processed} WoRMS files for partitioned import")
    return files_processed > 0

def create_partition_info():
    """Create information about expected partitions"""
    logger.info("📋 Creating partition information for PostgreSQL...")

    partition_info = {
        'Animalia': 'Marine and terrestrial animals',
        'Archaea': 'Single-celled prokaryotic organisms',
        'Bacteria': 'Single-celled prokaryotic organisms',
        'Biota incertae sedis': 'Organisms of uncertain taxonomic position',
        'Chromista': 'Diverse group including algae and protozoa',
        'Fungi': 'Fungi including yeasts, molds, and mushrooms',
        'Monera': 'Legacy kingdom, mostly bacteria',
        'Plantae': 'Land plants and some algae',
        'Protozoa': 'Single-celled eukaryotic organisms',
        'Viruses': 'Viruses and virus-like organisms'
    }

    info_file = os.path.join(FIXED_OUT, "partition_info.txt")
    with open(info_file, 'w', encoding='utf-8') as f:
        f.write("# WoRMS Partition Information for PostgreSQL\n")
        f.write("# Expected partitions based on kingdom values\n\n")

        for kingdom, description in partition_info.items():
            partition_name = kingdom.lower().replace(' ', '_')
            f.write(f"Partition: worms_taxonomic_units_{partition_name}\n")
            f.write(f"Kingdom: {kingdom}\n")
            f.write(f"Description: {description}\n\n")

    logger.info(f"📋 Partition information saved to: {info_file}")

def main():
    """Main execution function for partitioned approach"""
    logger.info("🛡️ Starting ENHANCED WoRMS Partitioned Processor")
    logger.info("🎯 PARTITIONED APPROACH: Preparing data for single partitioned table")
    logger.info("🔧 ENHANCED: Data quality handling, column normalization, partition preparation")
    logger.info("=" * 80)

    try:
        # Validate source files
        taxon_source = os.path.join(RAW_WORMS, "taxon.txt")
        if not os.path.exists(taxon_source):
            logger.error("❌ taxon.txt not found!")
            return False

        # Clean ALL files for partitioned table import
        if not clean_and_fix_all_files():
            logger.error("❌ Failed to clean WoRMS files for partitioned import")
            return False

        # Create partition information
        create_partition_info()

        # Verify final output
        taxon_cleaned = os.path.join(FIXED_OUT, "taxon_spaced.txt")
        if os.path.exists(taxon_cleaned):
            file_size = os.path.getsize(taxon_cleaned) / (1024 * 1024)
            with open(taxon_cleaned, 'r') as f:
                line_count = sum(1 for _ in f) - 1  # Subtract header

            logger.info("=" * 80)
            logger.info("🎉 ENHANCED WoRMS Partitioned Processing Complete!")
            logger.info("✅ READY FOR PARTITIONED TABLE: Single table with automatic partition routing")
            logger.info("✅ DATA QUALITY: Advanced cleaning and validation applied")
            logger.info("✅ COLUMN NORMALIZATION: All files prepared for PostgreSQL import")
            logger.info("✅ PARTITION READY: Kingdom distribution validated")
            logger.info(f"📁 Main file: taxon_spaced.txt ({file_size:.1f} MB, {line_count:,} records)")
            logger.info(f"📁 Files ready in: {FIXED_OUT}")
            logger.info("🔗 PostgreSQL will automatically route records to correct partitions!")

            return True
        else:
            logger.error("❌ Main taxon file not created successfully")
            return False

    except Exception as e:
        logger.error(f"❌ Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
