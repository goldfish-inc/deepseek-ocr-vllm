#!/usr/bin/env python3
"""
Convert country vessel registry files from various formats to standardized CSV
"""

import os
import sys
import pandas as pd
import logging
from pathlib import Path
import argparse
from typing import Dict, List, Optional
import re

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Base paths
BASE_DIR = Path("/app/import/missing-registered-vessels-2025-09-08")
OUTPUT_DIR = Path("/app/import/vessels/vessel_data/COUNTRY/cleaned")

def clean_column_name(col: str) -> str:
    """Standardize column names"""
    # Convert to lowercase and replace spaces/special chars with underscore
    col = re.sub(r'[^\w\s]', '', col.lower())
    col = re.sub(r'\s+', '_', col.strip())
    return col

def convert_chile_rpa(file_path: Path, region: str) -> pd.DataFrame:
    """Convert Chile RPA Excel files to standardized format"""
    try:
        # Read Excel file
        df = pd.read_excel(file_path, engine='openpyxl')

        # Standardize column names
        df.columns = [clean_column_name(col) for col in df.columns]

        # Add metadata columns
        df['source_date'] = '2025-09-08'
        df['source_region'] = region
        df['source_country'] = 'CHL'
        df['original_source'] = f'CHL_RPA_{region}'

        # Map common fields
        field_mapping = {
            'nombre_nave': 'vessel_name',
            'nombre_embarcacion': 'vessel_name',
            'matricula': 'registration_number',
            'rpa': 'rpa_number',
            'señal_llamada': 'ircs',
            'eslora': 'length_value',
            'trb': 'gross_tonnage',
            'año_construccion': 'year_built',
            'material_casco': 'hull_material',
            'tipo_nave': 'vessel_type',
            'puerto_base': 'home_port',
            'armador': 'owner_name'
        }

        # Rename columns based on mapping
        for old_col, new_col in field_mapping.items():
            if old_col in df.columns:
                df[new_col] = df[old_col]

        # Ensure required columns exist
        required_cols = ['vessel_name', 'registration_number', 'source_date', 'original_source']
        for col in required_cols:
            if col not in df.columns:
                df[col] = ''

        # Clean vessel names
        if 'vessel_name' in df.columns:
            df['vessel_name'] = df['vessel_name'].astype(str).str.strip().str.upper()

        # Add vessel_flag
        df['vessel_flag_alpha3'] = 'CHL'

        logger.info(f"Converted {len(df)} vessels from Chile Region {region}")
        return df

    except Exception as e:
        logger.error(f"Error converting Chile RPA file {file_path}: {str(e)}")
        return pd.DataFrame()

def convert_chile_ltp_pep(file_path: Path) -> pd.DataFrame:
    """Convert Chile LTP-PEP Excel file to standardized format"""
    try:
        df = pd.read_excel(file_path, engine='openpyxl')
        df.columns = [clean_column_name(col) for col in df.columns]

        # Add metadata
        df['source_date'] = '2025-09-08'
        df['source_country'] = 'CHL'
        df['original_source'] = 'CHL_LTP_PEP'
        df['vessel_flag_alpha3'] = 'CHL'

        # Map fields (adjust based on actual column names)
        field_mapping = {
            'nombre': 'vessel_name',
            'matricula': 'registration_number',
            'rpa': 'rpa_number',
            'eslora': 'length_value',
            'trb': 'gross_tonnage',
            'armador': 'owner_name'
        }

        for old_col, new_col in field_mapping.items():
            if old_col in df.columns:
                df[new_col] = df[old_col]

        logger.info(f"Converted {len(df)} vessels from Chile LTP-PEP")
        return df

    except Exception as e:
        logger.error(f"Error converting Chile LTP-PEP file: {str(e)}")
        return pd.DataFrame()

def convert_peru_vessels(file_path: Path) -> pd.DataFrame:
    """Convert Peru vessel Excel file to standardized format"""
    try:
        df = pd.read_excel(file_path)
        df.columns = [clean_column_name(col) for col in df.columns]

        # Add metadata
        df['source_date'] = '2025-09-08'
        df['source_country'] = 'PER'
        df['original_source'] = 'PER_VESSELS'
        df['vessel_flag_alpha3'] = 'PER'

        # Map common Spanish field names
        field_mapping = {
            'nombre_embarcacion': 'vessel_name',
            'nombre': 'vessel_name',
            'matricula': 'registration_number',
            'señal_llamada': 'ircs',
            'eslora': 'length_value',
            'trb': 'gross_tonnage',
            'año_construccion': 'year_built',
            'armador': 'owner_name',
            'propietario': 'owner_name'
        }

        for old_col, new_col in field_mapping.items():
            if old_col in df.columns:
                df[new_col] = df[old_col]

        logger.info(f"Converted {len(df)} vessels from Peru")
        return df

    except Exception as e:
        logger.error(f"Error converting Peru vessels file: {str(e)}")
        return pd.DataFrame()

def convert_uk_vessels(file_path: Path, vessel_size: str) -> pd.DataFrame:
    """Convert UK vessel Excel files to standardized format"""
    try:
        df = pd.read_excel(file_path, engine='openpyxl')
        df.columns = [clean_column_name(col) for col in df.columns]

        # Add metadata
        df['source_date'] = '2025-09-08'
        df['source_country'] = 'GBR'
        df['original_source'] = f'GBR_{vessel_size.upper()}'
        df['vessel_flag_alpha3'] = 'GBR'
        df['vessel_size_category'] = vessel_size

        # UK specific mappings
        field_mapping = {
            'vessel_name': 'vessel_name',
            'rss_no': 'registration_number',
            'registry_of_shipping_number': 'registration_number',
            'port_letters_and_number': 'external_marking',
            'imo_number': 'imo',
            'call_sign': 'ircs',
            'vessel_length': 'length_value',
            'gross_tonnage': 'gross_tonnage',
            'construction_year': 'year_built',
            'port': 'home_port'
        }

        for old_col, new_col in field_mapping.items():
            if old_col in df.columns:
                df[new_col] = df[old_col]

        logger.info(f"Converted {len(df)} {vessel_size} vessels from UK")
        return df

    except Exception as e:
        logger.error(f"Error converting UK vessels file: {str(e)}")
        return pd.DataFrame()

def save_cleaned_data(df: pd.DataFrame, output_name: str):
    """Save cleaned data to CSV"""
    if df.empty:
        logger.warning(f"Skipping empty dataframe for {output_name}")
        return

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_path = OUTPUT_DIR / f"{output_name}_vessels_cleaned.csv"

    # Save to CSV
    df.to_csv(output_path, index=False, encoding='utf-8')
    logger.info(f"Saved {len(df)} records to {output_path}")

def main():
    parser = argparse.ArgumentParser(description='Convert country vessel registries to CSV')
    parser.add_argument('--country', help='Specific country to convert (e.g., CHL, PER, GBR)')
    parser.add_argument('--all', action='store_true', help='Convert all available files')
    args = parser.parse_args()

    if not args.all and not args.country:
        parser.error("Either --country or --all must be specified")

    # Process Chile regional files
    if args.all or args.country == 'CHL':
        chile_regions = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
                        'IX', 'X', 'XI', 'XII', 'XIV', 'XV', 'XVI']

        for region in chile_regions:
            file_path = BASE_DIR / f"CHL_region_{region}_RPA_2025-09-08.xlsx"
            if file_path.exists():
                df = convert_chile_rpa(file_path, region)
                save_cleaned_data(df, f"CHL_RPA_{region}")

        # Process LTP-PEP file
        ltp_file = BASE_DIR / "CHL_vessels_LTP-PEP_2025-09-08.xlsx"
        if ltp_file.exists():
            df = convert_chile_ltp_pep(ltp_file)
            save_cleaned_data(df, "CHL_LTP_PEP")

    # Process Peru file
    if args.all or args.country == 'PER':
        peru_file = BASE_DIR / "PER_vessels_2025-09-08.xls"
        if peru_file.exists():
            df = convert_peru_vessels(peru_file)
            save_cleaned_data(df, "PER_VESSELS")

    # Process UK files
    if args.all or args.country == 'GBR':
        uk_large = BASE_DIR / "UK_September_2025_Over_10m_vessel_list.xlsx"
        uk_small = BASE_DIR / "UK_September_2025_Under_10m_vessel_list.xlsx"

        if uk_large.exists():
            df = convert_uk_vessels(uk_large, "large")
            save_cleaned_data(df, "GBR_LARGE")

        if uk_small.exists():
            df = convert_uk_vessels(uk_small, "small")
            save_cleaned_data(df, "GBR_SMALL")

    # Process PNA files (already CSV)
    if args.all or args.country == 'PNA':
        for pna_type in ['FSMA', 'TUNA']:
            pna_file = BASE_DIR / f"PNA_{pna_type}_2025-09-08.csv"
            if pna_file.exists():
                df = pd.read_csv(pna_file)
                df['source_date'] = '2025-09-08'
                df['original_source'] = f'PNA_{pna_type}'
                save_cleaned_data(df, f"PNA_{pna_type}")

    logger.info("Conversion complete")

if __name__ == "__main__":
    main()
