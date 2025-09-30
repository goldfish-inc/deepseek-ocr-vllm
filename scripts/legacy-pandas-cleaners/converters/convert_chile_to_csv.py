#!/usr/bin/env python3
"""
Convert Chile regional vessel Excel files to CSV format
Handles the specific structure of Chilean vessel registries
"""

import pandas as pd
import os
import sys
from pathlib import Path

def convert_chile_excel_to_csv(input_file, output_file):
    """Convert Chile Excel file to CSV with proper handling"""
    try:
        # Read Excel file with different engines to handle formatting issues
        try:
            df = pd.read_excel(input_file, engine='openpyxl')
        except Exception:
            # Fallback to xlrd engine if openpyxl fails
            try:
                df = pd.read_excel(input_file, engine=None)
            except Exception:
                # Try reading without engine specification
                df = pd.read_excel(input_file)
        
        # Standardize column names (Chilean registries use Spanish headers)
        column_mapping = {
            'RPA': 'registro_pesquero_artesanal',
            'RUT': 'rut',
            'NOMBRE': 'nombre',
            'MATRICULA': 'matricula',
            'REGIÓN': 'region',
            'TIPO': 'tipo',
            'TAMAÑO': 'tamano',
            'ESLORA': 'eslora',
            'MANGA': 'manga',
            'PUNTAL': 'puntal',
            'TON.REG.GRUESO': 'ton_reg_grueso',
            'CAPAC.BODEGA(M3)': 'capac_bodega_m3',
            'POTENCIA MOTOR': 'potencia_motor',
            'ARTES': 'artes',
            'ARMADOR': 'armador',
            'RUT_ARM': 'rut_arm',
            'TIPO_ARM': 'tipo_arm',
            'DOMICILIO_ARMADOR': 'domicilio_armador',
            'TELEFONO_ARMADOR': 'telefono_armador',
            'PUERTO_DESEMBARQUE': 'puerto_desembarque',
            'PROVINCIA': 'provincia',
            'CALETA': 'caleta'
        }
        
        # Rename columns to lowercase standardized names
        df.columns = [column_mapping.get(col.upper(), col.lower()) for col in df.columns]
        
        # Save as CSV
        df.to_csv(output_file, index=False, encoding='utf-8')
        print(f"✓ Converted {input_file} → {output_file}")
        print(f"  Records: {len(df)}")
        return True
        
    except Exception as e:
        print(f"✗ Error converting {input_file}: {str(e)}")
        return False

def main():
    # Define source and destination directories
    source_dir = Path("/import/missing-registered-vessels-2025-09-08")
    
    # Process each Chile Excel file
    chile_files = list(source_dir.glob("CHL_*.xlsx"))
    
    if not chile_files:
        print("No Chile Excel files found")
        return 1
    
    print(f"Found {len(chile_files)} Chile Excel files to convert")
    
    successful = 0
    for excel_file in chile_files:
        # Extract region info from filename
        # e.g., CHL_region_III_RPA_2025-09-08.xlsx → CHILE_III
        filename = excel_file.stem
        parts = filename.split('_')
        
        if 'region' in parts:
            region_idx = parts.index('region') + 1
            if region_idx < len(parts):
                region = parts[region_idx]
                dest_name = f"CHILE_{region}"
            else:
                # Handle special cases like CHL_vessels_LTP-PEP
                dest_name = filename.replace('CHL_vessels_', 'CHILE_').split('_20')[0]
        else:
            # Handle CHL_vessels_LTP-PEP format
            dest_name = filename.replace('CHL_vessels_', 'CHILE_').split('_20')[0]
        
        # Create destination directory
        dest_dir = Path(f"/import/vessels/vessel_data/COUNTRY/{dest_name}/raw")
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        # Define output CSV file
        csv_filename = f"{dest_name}_vessels_2025-09-08.csv"
        output_file = dest_dir / csv_filename
        
        # Convert
        if convert_chile_excel_to_csv(excel_file, output_file):
            successful += 1
    
    print(f"\nConversion complete: {successful}/{len(chile_files)} files converted successfully")
    return 0 if successful == len(chile_files) else 1

if __name__ == "__main__":
    sys.exit(main())