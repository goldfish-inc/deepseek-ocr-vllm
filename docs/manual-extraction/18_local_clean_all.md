# Manual Pattern Extraction: local_clean_all.py

**Source**: `scripts/legacy-pandas-cleaners/rfmo/local_clean_all.py`
**Source Type**: RFMO (Regional Fisheries Management Organizations)
**Source Name**: ALL (universal RFMO cleaner)
**Purpose**: Lightweight universal CSV cleaner for all RFMO vessel registries

---

## Pattern 1: File Encoding Strategy (BOM Handling)
**Line**: 20
**Type**: `encoding_strategy`
**Code**: `raw_file.open('r', newline='', encoding='utf-8-sig')`
**Pattern**: `encoding=utf-8-sig`
**Comment**: UTF-8 with BOM removal - handles Excel exports from RFMO websites
**Priority**: 100

---

## Pattern 2: Header Space-to-Underscore Normalization
**Line**: 22
**Type**: `string_replace`
**Code**: `fieldnames = [name.strip().replace(' ', '_') for name in reader.fieldnames]`
**Pattern**: ` ` (space in headers)
**Replacement**: `_` (underscore)
**Comment**: Standardize RFMO CSV column names for database compatibility
**Priority**: 150

---

## Pattern 3: Whitespace Collapse Function
**Lines**: 12-13
**Type**: `regex_replace` (functional transformation)
**Code**:
```python
def collapse_whitespace(value: str) -> str:
    return " ".join(value.split())
```
**Pattern**: `\s+` (multiple whitespace - implicit in split())
**Replacement**: ` ` (single space)
**Comment**: Collapse multiple whitespace characters into single space
**Priority**: 100

---

## Pattern 4: Value Whitespace Stripping + Collapse
**Line**: 34
**Type**: `string_replace` (combined operation)
**Code**: `value = collapse_whitespace(value.strip()) if isinstance(value, str) else value`
**Pattern**: Combined:
1. Strip leading/trailing whitespace
2. Collapse internal whitespace (calls Pattern 3)
**Comment**: Clean all RFMO vessel data values
**Priority**: 100

---

## Pattern 5: Output Encoding Strategy
**Line**: 25
**Type**: `encoding_strategy`
**Code**: `output_path.open('w', newline='', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Comment**: Write cleaned data with UTF-8 encoding (no BOM)
**Priority**: 100

---

## Pattern 6: Output Filename Generation
**Lines**: 16-18
**Type**: `string_transformation`
**Code**:
```python
prefix = raw_file.name.split('_')[0].lower()
output_name = f"{prefix}_vessels_cleaned.csv"
```
**Pattern**: Extract RFMO prefix from filename
**Comment**: Generate standardized output filenames (e.g., ICCAT_vessels_2025.csv → iccat_vessels_cleaned.csv)
**Priority**: 100
**Example**:
- `ICCAT_vessels_2025-09-08.csv` → `iccat_vessels_cleaned.csv`
- `IATTC_vessels_2025-09-08.csv` → `iattc_vessels_cleaned.csv`

---

## Summary
**Total Patterns**: 6
**Critical Patterns**: 2 (header normalization, whitespace collapse)
**Simple Replacements**: 2 (spaces in headers, whitespace in values)
**Complex Logic**: 0
**Encoding Rules**: 2
**Filename Transformation**: 1

## Data Quality Impact
- **High Impact**: Patterns 2, 3, 4 (header standardization, whitespace normalization)
- **Low Impact**: Patterns 1, 5, 6 (infrastructure)

## Key Characteristics
1. **Universal**: Works for ALL RFMO vessel registries (ICCAT, IATTC, WCPFC, etc.)
2. **Lightweight**: Only whitespace handling and header normalization
3. **No RFMO-specific logic**: Same cleaning for all organizations
4. **Batch processing**: Processes all CSV files in raw directory
5. **BOM-safe**: Handles Excel UTF-8 exports with BOM

## Comparison with Other Universal Cleaners

### Similarities with clean_all_vessel_types.py:
- Both use `utf-8-sig` encoding
- Both normalize headers (spaces → underscores)
- Both collapse whitespace in values
- Both are "universal" cleaners

### Similarities with clean_msc_fishery_light.py:
- **Nearly identical** - same patterns, same logic
- Only difference: directory structure (RFMO vs MSC)

### Differences from clean_all_vessel_types.py:
- clean_all_vessel_types.py also removes parentheses and dots from headers
- clean_all_vessel_types.py has delimiter detection logic
- local_clean_all.py is simpler (fewer transformations)

## SQL-Friendly Patterns
All patterns are SQL-compatible:

### Pattern 2 (Header normalization):
```sql
-- During table creation or COPY
-- Column names standardized at schema level
```

### Pattern 3 & 4 (Whitespace normalization):
```sql
SELECT regexp_replace(TRIM(value), '\s+', ' ', 'g');
```

## RFMOs Processed
This script processes vessel data from multiple RFMOs:
1. ICCAT - International Commission for the Conservation of Atlantic Tunas
2. IATTC - Inter-American Tropical Tuna Commission
3. WCPFC - Western and Central Pacific Fisheries Commission
4. IOTC - Indian Ocean Tuna Commission
5. CCSBT - Commission for the Conservation of Southern Bluefin Tuna
6. NAFO - Northwest Atlantic Fisheries Organization
7. NEAFC - North East Atlantic Fisheries Commission
8. SEAFO - South East Atlantic Fisheries Organisation
9. SPRFMO - South Pacific Regional Fisheries Management Organisation
10. CCAMLR - Commission for the Conservation of Antarctic Marine Living Resources
11. GFCM - General Fisheries Commission for the Mediterranean

## Implementation Notes
**This is the simplest universal cleaner** - only does:
1. UTF-8 BOM handling
2. Header normalization (spaces → underscores)
3. Value whitespace normalization
4. Output filename standardization

**No RFMO-specific logic** - assumes all RFMOs have similar CSV formats (which is generally true for vessel registries).

**Suitable for SQL implementation** - all operations can be done in SQL during COPY or as transformations.

**Nearly identical to clean_msc_fishery_light.py** - could be consolidated into a single universal CSV cleaner.