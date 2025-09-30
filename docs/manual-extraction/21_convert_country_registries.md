# Manual Pattern Extraction: convert_country_registries.py

**Source**: `scripts/legacy-pandas-cleaners/converters/convert_country_registries.py`
**Source Type**: CONVERTER
**Source Name**: Multiple countries (format standardization)
**Purpose**: Convert various country registry formats to standardized CSV schema

## Key Patterns:
1. **Column name cleaning** (lines 25-29): Regex-based standardization
   - Remove special characters: `[^\w\s]` → ``
   - Replace spaces with underscore: `\s+` → `_`
   - Lowercase all

2. **Field mapping dictionary** (lines 48-60): Spanish/local → English standard
   - nombre_nave → vessel_name
   - matricula → registration_number
   - eslora → length_value
   - trb → gross_tonnage
   - etc. (12 mappings)

3. **Metadata addition** (lines 44-47): Add source tracking fields
   - source_date
   - source_region
   - source_country
   - original_source

4. **Vessel name normalization** (lines 72-73): `.str.strip().str.upper()`

5. **Required field enforcement** (lines 66-69): Ensure required columns exist

## Implementation: Converter + cleaner hybrid for multi-country standardization