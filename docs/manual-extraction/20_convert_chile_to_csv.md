# Manual Pattern Extraction: convert_chile_to_csv.py

**Source**: `scripts/legacy-pandas-cleaners/converters/convert_chile_to_csv.py`
**Source Type**: CONVERTER
**Source Name**: Chile (Excel → CSV with column mapping)
**Purpose**: Convert Chile Excel with Spanish headers to CSV with English standardized column names

## Key Patterns:
1. **Multi-engine Excel reading** (lines 16-24): Try openpyxl → xlrd → default
2. **Spanish column name mapping** (lines 27-50): 21 column mappings (Spanish → English snake_case)
   - RPA → registro_pesquero_artesanal
   - RUT → rut
   - NOMBRE → nombre
   - MATRICULA → matricula
   - etc. (21 total mappings)
3. **Case normalization** (line 53): `.upper()` for matching, `.lower()` for unmapped columns
4. **UTF-8 encoding** (line 56): Standard UTF-8 output

## Implementation: SQL lookup table for Spanish→English column mapping