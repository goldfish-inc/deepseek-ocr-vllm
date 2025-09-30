# Manual Pattern Extraction: clean_reference_data.py

**Source**: `scripts/legacy-pandas-cleaners/reference/clean_reference_data.py`
**Source Type**: REFERENCE (multiple reference tables)
**Source Name**: Multiple (country_iso, fao_areas, gear_types, vessel_types, rfmos, sources)
**Purpose**: Lightweight CSV-only cleaner for all reference data (no pandas dependency)

---

## Global Patterns (all functions)

### Pattern 1: File Encoding Strategy (BOM Handling)
**Line**: 21
**Type**: `encoding_strategy`
**Code**: `path.open("r", newline="", encoding="utf-8-sig")`
**Pattern**: `encoding=utf-8-sig`
**Comment**: UTF-8 with BOM removal - handles Excel exports
**Priority**: 100
**Application**: Applied to ALL input files

### Pattern 2: Value Trimming
**Line**: 25
**Type**: `string_replace`
**Code**: `cleaned = {k: (v.strip() if v is not None else "") for k, v in row.items()}`
**Pattern**: Leading/trailing whitespace
**Replacement**: `` (stripped)
**Comment**: Trim all cell values, convert None to empty string
**Priority**: 100
**Application**: Applied to ALL fields in ALL files

### Pattern 3: Output Encoding Strategy
**Line**: 32
**Type**: `encoding_strategy`
**Code**: `path.open("w", newline="", encoding="utf-8")`
**Pattern**: `encoding=utf-8`
**Comment**: Write with UTF-8 (no BOM)
**Priority**: 100

---

## Function-Specific Patterns

### clean_country_iso() - Lines 38-43

#### Pattern 4: Remove Decimal Suffix from Numeric Code
**Line**: 41
**Type**: `string_replace`
**Code**: `numeric = row.get("numeric_code", "").replace(".0", "").strip()`
**Pattern**: `.0` (decimal suffix from float conversion)
**Replacement**: `` (empty)
**Comment**: Remove .0 suffix from numeric country codes (pandas float artifact)
**Priority**: 150

#### Pattern 5: Zero-Pad Numeric Code
**Line**: 42
**Type**: `string_replace` (padding)
**Code**: `row["numeric_code"] = numeric.zfill(3) if numeric else ""`
**Pattern**: Short numeric codes (e.g., "4" → "004")
**Replacement**: 3-digit zero-padded
**Comment**: ISO 3166-1 numeric codes are always 3 digits
**Priority**: 150

---

### clean_fao_major_areas() - Lines 60-65

#### Pattern 6: Zero-Pad FAO Area Code
**Lines**: 63-64
**Type**: `string_replace` (padding)
**Code**:
```python
code = row.get("fao_major_area", "").replace(".0", "").strip()
row["fao_major_area"] = code.zfill(2) if code else ""
```
**Pattern**: Short FAO codes (e.g., "7" → "07")
**Replacement**: 2-digit zero-padded
**Comment**: FAO major areas are 2 digits (01-88)
**Priority**: 150

---

### clean_gear_types_fao() - Lines 68-79

#### Pattern 7: Zero-Pad FAO Gear Code
**Lines**: 72, 74
**Type**: `string_replace` (padding)
**Code**:
```python
code = row.get("fao_isscfg_code", "").replace(".0", "").strip()
row["fao_isscfg_code"] = code.zfill(2) if code else ""
```
**Pattern**: Short gear codes
**Replacement**: 2-digit zero-padded
**Comment**: FAO ISSCFG codes are 2 digits
**Priority**: 150

#### Pattern 8: Filter Empty Names
**Lines**: 73, 76-78
**Type**: `data_filtering`
**Code**:
```python
name = row.get("fao_isscfg_name", "").strip()
if name:
    row["fao_isscfg_name"] = name
    cleaned_rows.append(row)
```
**Pattern**: Empty gear names
**Comment**: Remove rows with missing gear names
**Priority**: 150

---

### clean_gear_relationship() - Lines 92-106

#### Pattern 9: Semicolon-Delimited List Expansion (Similar to #14)
**Lines**: 96-103
**Type**: `string_split` + row expansion
**Code**:
```python
cbp_codes = row.get("cbp_gear_code", "")
codes = [code.strip() for code in cbp_codes.split(';') if code.strip()]
for code in codes:
    relationships.append({
        "fao_isscfg_code": fao_code.zfill(2) if fao_code else "",
        "cbp_gear_code": code
    })
```
**Pattern**: `;` (semicolon delimiter, no space)
**Transformation**: 1:many → 1:1 (row duplication)
**Comment**: Expand multi-value CBP gear field into separate rows
**Priority**: 200 (critical for normalization)

---

### clean_vessel_hull_material() - Lines 114-124

#### Pattern 10: Column Name Normalization (camelCase → snake_case)
**Lines**: 116, 121-122
**Type**: `string_replace` (column naming)
**Code**:
```python
new_fields = ["hull_material" if f == "hullMaterial" else f for f in fields]
key = "hull_material" if field == "hullMaterial" else field
```
**Pattern**: `hullMaterial` (camelCase)
**Replacement**: `hull_material` (snake_case)
**Comment**: Standardize column name for database
**Priority**: 150

---

### clean_vessel_types() - Lines 127-147

#### Pattern 11: Multiple Column Name Mappings
**Lines**: 129-147
**Type**: `lookup_table` (column name mappings)
**Code**:
```python
mapping = {
    'vesselType_cat': 'vessel_type_cat',
    'vesselType_subcat': 'vessel_type_subcat',
    'vesselType_isscfv_code': 'vessel_type_isscfv_code',
    'vesselType_isscfv_alpha': 'vessel_type_isscfv_alpha'
}
```
**Patterns**:
- `vesselType_cat` → `vessel_type_cat`
- `vesselType_subcat` → `vessel_type_subcat`
- `vesselType_isscfv_code` → `vessel_type_isscfv_code`
- `vesselType_isscfv_alpha` → `vessel_type_isscfv_alpha`

**Comment**: Standardize vessel type column names (camelCase → snake_case)
**Priority**: 150

#### Pattern 12: Zero-Pad Vessel Type Code
**Lines**: 141-143
**Type**: `string_replace` (padding)
**Code**:
```python
if key == 'vessel_type_isscfv_code':
    val = value.replace('.0', '').strip()
    entry[key] = val.zfill(2) if val else ''
```
**Pattern**: Short vessel type codes
**Replacement**: 2-digit zero-padded
**Comment**: ISSCFV codes are 2 digits
**Priority**: 150

---

### clean_original_sources() - Lines 155-161

#### Pattern 13: Semicolon Spacing Normalization
**Line**: 159
**Type**: `string_replace`
**Code**: `row['source_type'] = row.get('source_type', '').replace(';', '; ').strip()`
**Pattern**: `;` (semicolon without space)
**Replacement**: `; ` (semicolon with space)
**Comment**: Standardize semicolon-delimited lists with space after semicolon
**Priority**: 100

---

## Summary
**Total Patterns**: 13
**Critical Patterns**: 2 (list expansion, empty name filtering)
**Simple Replacements**: 7 (trimming, decimal removal, padding, spacing)
**Complex Logic**: 1 (semicolon list expansion)
**Column Mappings**: 2 (hull_material, vessel_type columns)
**Data Filtering**: 1 (empty names)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 4-9, 11-12 (code formatting, padding, normalization, list expansion)
- **Medium Impact**: Pattern 13 (semicolon spacing)
- **Low Impact**: Patterns 1-3 (infrastructure)

## Key Characteristics
1. **Lightweight**: No pandas/pandera dependencies - pure Python CSV
2. **Universal trimming**: All values trimmed in all files
3. **Code standardization**: Zero-padding for all numeric codes (country, FAO, gear, vessel)
4. **Column name standardization**: camelCase → snake_case
5. **List expansion**: Semicolon-delimited multi-value fields expanded to 1:1
6. **Float artifact removal**: `.0` suffix from pandas float conversion

## SQL-Friendly Patterns
All patterns are SQL-compatible:

### Patterns 4-7, 12 (Zero-padding):
```sql
SELECT LPAD(REPLACE(numeric_code, '.0', ''), 3, '0');  -- 3 digits
SELECT LPAD(REPLACE(fao_major_area, '.0', ''), 2, '0'); -- 2 digits
```

### Pattern 9 (List expansion):
```sql
-- PostgreSQL
SELECT
  fao_isscfg_code,
  TRIM(unnest(string_to_array(cbp_gear_code, ';'))) AS cbp_gear_code
FROM gear_relationships
WHERE TRIM(unnest(string_to_array(cbp_gear_code, ';'))) != '';
```

### Pattern 13 (Semicolon spacing):
```sql
SELECT REPLACE(source_type, ';', '; ');
```

## Files Processed (14 files)
1. `country_iso.csv` - ISO country codes
2. `country_iso_foc.csv` - Flag of Convenience status
3. `country_iso_ILO_c188.csv` - ILO ratification
4. `country_iso_EU.csv` - EU membership
5. `fao_major_areas.csv` - FAO fishing areas
6. `gearTypes_fao.csv` - FAO gear types
7. `gearTypes_cbp.csv` - CBP gear types
8. `gearTypes_msc.csv` - MSC gear types
9. `gearTypes_fao_cbp_relationship.csv` - FAO-CBP gear mapping
10. `gearTypes_msc_fao_relationship.csv` - MSC-FAO gear mapping
11. `vessel_hullMaterial.csv` - Hull material types
12. `vesselTypes.csv` - Vessel type classifications
13. `rfmos.csv` - RFMO organizations
14. `original_sources.csv` - Data source registry

## Implementation Notes
**This script demonstrates defensive programming** - it provides a fallback CSV-only implementation when pandas/pandera are unavailable.

**All operations are simple and SQL-friendly** - no complex logic that requires Python.