# Manual Pattern Extraction: clean_all_vessel_types.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_all_vessel_types.py`
**Source Type**: MULTIPLE (CIVIL_SOCIETY, COUNTRY, COUNTRY_EU, INTERGOV)
**Source Name**: ALL
**Purpose**: Universal vessel data cleaner for all registry types

---

## Pattern 1: Whitespace Normalization Function
**Line**: 22-24
**Type**: `string_replace` (functional transformation)
**Code**:
```python
def collapse_whitespace(value: str) -> str:
    """Normalize whitespace in data values"""
    return " ".join(value.split())
```
**Pattern**: `\\s+` (multiple whitespace)
**Replacement**: ` ` (single space)
**Comment**: Collapse multiple whitespace characters into single space
**Priority**: 100
**Application**: Applied to all field values after stripping

---

## Pattern 2: Delimiter Detection Logic
**Line**: 37-46
**Type**: `delimiter_detection`
**Code**:
```python
delimiter = ',' if raw_file.suffix.lower() == '.csv' else ';'
if vessel_type == "COUNTRY_EU":
    delimiter = ';'  # EU data uses semicolon separator

# Auto-detect from sample
sample = infile.read(1024)
if sample.count(';') > sample.count(','):
    delimiter = ';'
```
**Pattern**: `auto_detect_delimiter`
**Replacement**: NULL
**Comment**: Auto-detect delimiter from first 1024 bytes (count semicolons vs commas). EU data defaults to semicolon.
**Priority**: 150 (medium - affects parsing)
**Condition JSON**:
```json
{
  "comment": "Delimiter detection strategy",
  "default": ",",
  "country_eu_default": ";",
  "detection_method": "Count semicolons vs commas in first 1024 bytes",
  "line": 37
}
```

---

## Pattern 3: File Encoding Strategy
**Line**: 41
**Type**: `encoding_strategy`
**Code**: `raw_file.open('r', newline='', encoding='utf-8-sig')`
**Pattern**: `encoding=utf-8-sig`
**Replacement**: NULL
**Comment**: UTF-8 with BOM (Byte Order Mark) handling - handles Excel UTF-8 exports
**Priority**: 100
**Special Notes**: `utf-8-sig` automatically strips BOM if present, critical for Excel-generated CSVs

---

## Pattern 4: Field Name Standardization
**Line**: 51-54
**Type**: `string_replace` (multiple operations)
**Code**:
```python
clean_name = name.strip().replace(' ', '_').replace('(', '').replace(')', '').replace('.', '')
```
**Patterns & Replacements**:
1. Leading/trailing whitespace → stripped
2. Space → `_` (underscore)
3. `(` → `` (empty)
4. `)` → `` (empty)
5. `.` → `` (empty)

**Comment**: Standardize CSV header field names for database compatibility
**Priority**: 150 (medium - affects all field names)
**Application**: Applied to all column headers once

---

## Pattern 5: Value Whitespace Stripping
**Line**: 65
**Type**: `string_replace`
**Code**: `value = collapse_whitespace(value.strip())`
**Pattern**: Combined operation:
1. Strip leading/trailing whitespace
2. Collapse internal whitespace (calls Pattern 1)

**Comment**: Clean all data values before writing
**Priority**: 100
**Application**: Applied to all field values

---

## Pattern 6: Output Encoding Strategy
**Line**: 56
**Type**: `encoding_strategy`
**Code**: `output_path.open('w', newline='', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding (no BOM for consistency)
**Priority**: 100

---

## Pattern 7: CSV DictReader with Custom Delimiter
**Line**: 48
**Type**: `csv_parser_config`
**Code**: `reader = csv.DictReader(infile, delimiter=delimiter)`
**Pattern**: `csv.DictReader with auto-detected delimiter`
**Replacement**: NULL
**Comment**: Use Python csv.DictReader for robust CSV parsing
**Priority**: 150

---

## Summary
**Total Patterns**: 7
**Critical Patterns**: 3 (delimiter detection, field name standardization, whitespace normalization)
**Simple Replacements**: 5 (within field names and values)
**Complex Logic**: 1 (delimiter auto-detection)
**Encoding Rules**: 2
**Validation Rules**: 0

## Data Quality Impact
- **High Impact**: Patterns 2, 4 (delimiter detection, field name standardization)
- **Medium Impact**: Patterns 1, 5 (whitespace normalization)
- **Low Impact**: Patterns 3, 6, 7 (infrastructure)

## Key Differences from Other Scripts
1. **Universal**: Applies to all vessel types (CIVIL_SOCIETY, COUNTRY, COUNTRY_EU, INTERGOV)
2. **No quote handling**: Assumes Python csv module handles quotes correctly
3. **No custom parser**: Relies on csv.DictReader for parsing
4. **Field name transformation**: Unique pattern not seen in other scripts
5. **BOM handling**: Uses utf-8-sig for Excel compatibility

## Implementation Notes
- This script is **simpler** than country-specific scripts (no custom parsers)
- Relies on Python's csv module for quote and escape handling
- **Pattern 4 (field name standardization) is unique** - should be added to SQL cleaning rules
- **Pattern 2 (delimiter detection) is procedural** - requires sampling file content