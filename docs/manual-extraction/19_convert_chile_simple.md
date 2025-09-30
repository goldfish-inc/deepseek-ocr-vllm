# Manual Pattern Extraction: convert_chile_simple.py

**Source**: `scripts/legacy-pandas-cleaners/converters/convert_chile_simple.py`
**Source Type**: CONVERTER
**Source Name**: Chile vessel registries (Excel → CSV)
**Purpose**: Simple Excel-to-CSV converter for Chile regional vessel registries using openpyxl

---

## Pattern 1: Excel Reading Strategy
**Lines**: 15-16
**Type**: `excel_reader_strategy`
**Code**: `load_workbook(input_file, data_only=True, read_only=True)`
**Parameters**:
- `data_only=True` - evaluates formulas to values
- `read_only=True` - memory efficient streaming mode
**Comment**: Read Excel files with formulas evaluated (avoids pandas formatting issues)
**Priority**: 150

---

## Pattern 2: None Value Normalization
**Lines**: 24-25
**Type**: `data_type_conversion`
**Code**:
```python
if val is None:
    cleaned.append('')
```
**Pattern**: `None` → `` (empty string)
**Comment**: Convert Excel empty cells (None) to CSV empty strings
**Priority**: 150

---

## Pattern 3: Comma Replacement (CSV Escaping)
**Line**: 28
**Type**: `string_replace`
**Code**: `.replace(',', ';')`
**Pattern**: `,` (comma)
**Replacement**: `;` (semicolon)
**Comment**: Replace commas with semicolons to avoid CSV delimiter conflicts
**Priority**: 200 (critical for CSV integrity)
**Note**: **This is a risky pattern** - changes data semantics (commas in addresses, etc.)

---

## Pattern 4: Newline Replacement
**Line**: 28
**Type**: `string_replace`
**Code**: `.replace('\n', ' ')`
**Pattern**: `\n` (newline in cell)
**Replacement**: ` ` (space)
**Comment**: Remove newlines within cells (multi-line Excel cells)
**Priority**: 150

---

## Pattern 5: Value Trimming
**Line**: 28
**Type**: `string_replace`
**Code**: `.strip()`
**Pattern**: Leading/trailing whitespace
**Replacement**: `` (stripped)
**Comment**: Clean all cell values
**Priority**: 100

---

## Pattern 6: Region Extraction from Filename
**Lines**: 53-64
**Type**: `pattern_detection` + string parsing
**Code**:
```python
filename = excel_file.stem
parts = filename.split('_')

if 'region' in parts:
    region_idx = parts.index('region') + 1
    if region_idx < len(parts):
        region = parts[region_idx]
        dest_name = f"CHILE_{region}"
    else:
        dest_name = filename.replace('CHL_vessels_', 'CHILE_').split('_20')[0]
else:
    dest_name = filename.replace('CHL_vessels_', 'CHILE_').split('_20')[0]
```
**Pattern**: Extract region code from filename
**Comment**: Parse Chile region from filename for directory structure
**Priority**: 100
**Examples**:
- `CHL_region_I_RPA_2025-09-08.xlsx` → `CHILE_I`
- `CHL_vessels_RM_2025-09-08.xlsx` → `CHILE_RM`

---

## Pattern 7: Output Encoding Strategy
**Line**: 18
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Comment**: Write CSV with UTF-8 encoding
**Priority**: 100

---

## Summary
**Total Patterns**: 7
**Critical Patterns**: 2 (comma replacement, None normalization)
**Simple Replacements**: 3 (comma, newline, trimming)
**Complex Logic**: 1 (region extraction)
**Excel Reading**: 1
**Encoding Rules**: 1

## Data Quality Impact
- **High Impact**: Patterns 3, 4 (comma replacement, newline removal) - **fundamental CSV integrity**
- **Medium Impact**: Patterns 1, 2, 6 (Excel reading, None handling, region extraction)
- **Low Impact**: Patterns 5, 7 (trimming, encoding)

## Key Characteristics
1. **Simple converter**: Excel → CSV only, no complex cleaning
2. **Openpyxl-only**: Uses openpyxl directly (not pandas) to avoid formatting issues
3. **Data-only mode**: Evaluates Excel formulas to values
4. **Comma replacement**: **Risky** - replaces commas with semicolons to avoid CSV conflicts
5. **Regional structure**: Creates directory structure based on Chile regions

## Critical Issue: Comma Replacement (Pattern 3)

**⚠️ WARNING**: Pattern 3 replaces ALL commas with semicolons.

**Problems**:
- Destroys semantic meaning of commas in addresses, vessel names, etc.
- Example: `"Santiago, Chile"` → `"Santiago; Chile"` (wrong!)
- Example: `"Vessel Alpha, LLC"` → `"Vessel Alpha; LLC"` (wrong!)

**Better approach**: Use proper CSV quoting:
```python
import csv
writer = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
writer.writerow(cleaned)
```

This would:
- Keep commas intact
- Properly quote fields containing commas
- Generate valid CSV

## Comparison with clean_chile_excel.py
**clean_chile_excel.py** (script #6):
- 4 fallback reading methods (openpyxl, pandas, xlrd, LibreOffice)
- Header cleaning
- NaN normalization
- Region tagging as field
- **No comma replacement**

**convert_chile_simple.py** (this script):
- Single method (openpyxl only)
- **Comma replacement** (risky!)
- Simpler region extraction
- No header cleaning

## SQL-Friendly Patterns

### Pattern 2 (None normalization):
```sql
SELECT COALESCE(value, '');
```

### Pattern 3 (Comma replacement) - **NOT RECOMMENDED**:
```sql
SELECT REPLACE(value, ',', ';');  -- Better: use proper CSV quoting
```

### Pattern 4 (Newline replacement):
```sql
SELECT REPLACE(value, E'\n', ' ');
```

### Pattern 5 (Trimming):
```sql
SELECT TRIM(value);
```

## Implementation Notes
**This script is fundamentally an Excel-to-CSV converter** - not a CSV cleaner.

**Pattern 3 (comma replacement) is problematic** - should use proper CSV quoting instead.

**Simpler than clean_chile_excel.py** but with data quality trade-offs.

**Should be combined with a subsequent CSV cleaner** to handle the converted files properly.