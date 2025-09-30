# Manual Pattern Extraction: clean_chile_excel.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_chile_excel.py`
**Source Type**: COUNTRY
**Source Name**: CHILE_LTP-PEP
**Purpose**: Robust Excel processor for Chile regional vessel registries with multiple fallback reading strategies

---

## Pattern 1: Multiple Excel Reading Strategies (Complex Infrastructure)
**Lines**: 21-158
**Type**: `excel_reader_strategy`
**Description**: Implements 4 fallback methods to read problematic Excel files

### Method 1: openpyxl (data_only mode) - Lines 21-41
**Code**: `openpyxl.load_workbook(excel_file, read_only=True, data_only=True)`
**Priority**: 1 (first attempt)
**Parameters**:
- `read_only=True` - memory efficient
- `data_only=True` - evaluates formulas to values
**Comment**: Best for .xlsx files with formulas

### Method 2: pandas multi-engine - Lines 43-65
**Code**:
```python
for engine in ['openpyxl', 'xlrd', None]:
    df = pd.read_excel(excel_file, engine=engine, header=0)
```
**Priority**: 2 (second attempt)
**Comment**: Tries 3 different pandas engines sequentially
**Engines**:
1. openpyxl (modern .xlsx)
2. xlrd (legacy .xls)
3. None (pandas default)

### Method 3: xlrd direct - Lines 67-87
**Code**: `xlrd.open_workbook(excel_file, ignore_workbook_corruption=True)`
**Priority**: 3 (third attempt)
**Parameters**:
- `ignore_workbook_corruption=True` - bypasses corruption checks
**Comment**: For old .xls format with corruption issues

### Method 4: LibreOffice conversion - Lines 89-136
**Code**:
```python
soffice_cmd = ['soffice' or 'libreoffice']
convert_cmd = [soffice_cmd, '--headless', '--convert-to', 'csv', '--outdir', temp_dir, excel_file]
```
**Priority**: 4 (last resort)
**Comment**: Convert Excel → CSV using system LibreOffice, then read as CSV
**Implementation Notes**: Requires LibreOffice installed on system

**Overall Pattern**: `multi_method_excel_reader`
**SQL Condition JSON**:
```json
{
  "comment": "Excel reading strategy with 4 fallback methods",
  "methods": ["openpyxl_data_only", "pandas_multi_engine", "xlrd_ignore_corruption", "libreoffice_convert"],
  "implementation": "Requires Python Excel libraries + optional LibreOffice",
  "cannot_extract_to_sql": true
}
```

---

## Pattern 2: Empty Row Detection
**Lines**: 33, 180
**Type**: `pattern_detection`
**Code**:
```python
if any(cell is not None for cell in row):  # Skip empty rows
if not any(cell is not None and str(cell).strip() for cell in row_data):
    continue  # Skip empty rows
```
**Pattern**: `empty_row_detection`
**Replacement**: NULL (skip row)
**Comment**: Skip rows where all cells are None or empty strings
**Priority**: 100

---

## Pattern 3: Header Name Cleaning
**Lines**: 169-175
**Type**: `string_replace` (multiple operations)
**Code**:
```python
if header is None:
    clean_headers.append("unknown_column")
else:
    clean_name = str(header).strip().replace(' ', '_').replace('(', '').replace(')', '')
    clean_headers.append(clean_name)
```
**Patterns & Replacements**:
1. `None` → `"unknown_column"`
2. Leading/trailing whitespace → stripped
3. Space → `_` (underscore)
4. `(` → `` (empty)
5. `)` → `` (empty)

**Comment**: Standardize Excel column headers for CSV output
**Priority**: 150

---

## Pattern 4: NaN/None Value Normalization
**Lines**: 188-191
**Type**: `string_replace`
**Code**:
```python
clean_value = str(value).strip()
if clean_value.lower() in ['nan', 'none', '#n/a']:
    clean_value = ""
```
**Pattern**: `nan|none|#n/a` (case-insensitive)
**Replacement**: `` (empty string)
**Comment**: Normalize Excel error values and missing data indicators
**Priority**: 150
**Values Normalized**:
- `nan` (pandas NaN)
- `none` (Python None)
- `#N/A` (Excel error)

---

## Pattern 5: Region Extraction from Filename
**Lines**: 204-209
**Type**: `pattern_detection`
**Code**:
```python
if 'region_' in filename:
    region = filename.split('region_')[1].split('_')[0]
else:
    region = excel_file.stem.replace('CHL_', '').replace('_2025-09-08', '')
```
**Pattern**: Conditional extraction:
1. If `region_` in filename: extract between `region_` and next `_`
2. Otherwise: strip `CHL_` prefix and date suffix

**Comment**: Extract Chile region code from filename (e.g., "I", "II", "RM")
**Priority**: 100
**Examples**:
- `CHL_region_I_RPA_2025-09-08.xlsx` → `I`
- `CHL_RM_2025-09-08.xlsx` → `RM`

---

## Pattern 6: Output Encoding Strategy
**Lines**: 123, 230
**Type**: `encoding_strategy`
**Code**: `f.open('r', encoding='utf-8')` and `f.open('w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: UTF-8 for both reading temp CSV and writing final output
**Priority**: 100

---

## Pattern 7: Python Warnings Suppression
**Line**: 16
**Type**: `infrastructure_config`
**Code**: `warnings.filterwarnings('ignore', category=UserWarning)`
**Comment**: Suppress Excel library warnings (openpyxl/xlrd format warnings)
**Priority**: 0 (infrastructure only)

---

## Summary
**Total Patterns**: 7
**Critical Patterns**: 3 (multi-method Excel reading, header cleaning, NaN normalization)
**Simple Replacements**: 3 (header transformations, NaN values, region extraction)
**Complex Logic**: 1 (multi-method Excel reader with 4 fallback strategies)
**Encoding Rules**: 1
**Infrastructure**: 1

## Data Quality Impact
- **High Impact**: Patterns 1, 3, 4 (Excel reading robustness, header standardization, missing value handling)
- **Medium Impact**: Patterns 2, 5 (empty row detection, region tagging)
- **Low Impact**: Patterns 6, 7 (infrastructure)

## Key Characteristics
1. **Excel-specific**: Only script that handles Excel files (not CSV)
2. **Multi-method fallback**: 4 different reading strategies for robustness
3. **External dependency**: Can use LibreOffice for conversion (optional)
4. **Regional tagging**: Adds chile_region field to output
5. **No quote handling**: Excel format doesn't have CSV quote issues
6. **No field count validation**: Excel preserves column structure

## Implementation Notes
**Pattern 1 (multi-method Excel reader) is NOT extractable to SQL** - requires Python libraries and external tools.

**This script is fundamentally different from CSV cleaners** - it's an **Excel→CSV converter** not a **CSV→CSV cleaner**. The "cleaning" is primarily:
1. Converting Excel to CSV format
2. Normalizing headers
3. Handling Excel-specific issues (NaN, formulas, corruption)

**SQL equivalent would require**:
1. PostgreSQL extension for Excel reading (doesn't exist)
2. Or pre-conversion step to CSV using this Python script
3. Then SQL cleaning rules on the resulting CSV