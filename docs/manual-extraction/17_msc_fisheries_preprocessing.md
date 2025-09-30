# Manual Pattern Extraction: msc_fisheries_preprocessing.py

**Source**: `scripts/legacy-pandas-cleaners/reference/msc_fisheries_preprocessing.py`
**Source Type**: REFERENCE
**Source Name**: MSC (Marine Stewardship Council) Fisheries
**Purpose**: Preprocess MSC fishery data with scientific name extraction, enum normalization, and field parsing

---

*(This script was already read earlier - lines 1-390 from system reminder)*

## Pattern 1: Column Name Mapping (Hardcoded)
**Lines**: 13-21
**Type**: `lookup_table`
**Code**:
```python
COLUMN_MAPPING = {
    'Fishery Name': 'msc_fishery_name',
    'MSC Status': 'msc_fishery_status',
    'Status (Unit of Certification)': 'msc_fishery_status_uoc',
    'Species': 'scientific_names',
    'Gear Type': 'msc_gear',
    'Ocean Area': 'fao_areas',
    'Certificate Code': 'msc_fishery_cert_codes'
}
```
**Pattern**: Map MSC CSV column names to database column names
**Comment**: Standardize column naming (spaces → underscores, descriptive names)
**Priority**: 150

---

## Pattern 2-3: Enum Value Normalization (2 lookup tables)
**Lines**: 24-42
**Type**: `lookup_table`

### Pattern 2: MSC Fishery Status Normalization
```python
MSC_FISHERY_STATUS_MAPPING = {
    'certified': 'CERTIFIED',
    'certified with unit(s) in assessment': 'CERTIFIED WITH UNIT(S) IN ASSESSMENT',
    'combined with another assessment': 'COMBINED WITH ANOTHER ASSESSMENT',
    'improvement program': 'IMPROVEMENT PROGRAM',
    'in assessment': 'IN ASSESSMENT',
    'not certified': 'NOT CERTIFIED',
    'suspended': 'SUSPENDED',
    'withdrawn': 'WITHDRAWN'
}
```
**Pattern**: Lowercase enum values → UPPERCASE standardized
**Comment**: Normalize MSC fishery status to match PostgreSQL enum definition
**Priority**: 200 (critical for enum type compatibility)

### Pattern 3: MSC UOC Status Normalization
```python
MSC_FISHERY_STATUS_UOC_MAPPING = {
    'certified': 'CERTIFIED',
    'improvement program': 'IMPROVEMENT PROGRAM',
    'in assessment': 'IN ASSESSMENT',
    'not certified': 'NOT CERTIFIED',
    'suspended': 'SUSPENDED',
    'withdrawn': 'WITHDRAWN'
}
```
**Pattern**: Lowercase enum values → UPPERCASE standardized
**Comment**: Normalize UOC status (fewer values than main status)
**Priority**: 200

---

## Pattern 4: Scientific Name Extraction (Complex)
**Lines**: 64-128
**Type**: `regex_replace` + complex parsing
**Code**: *(Complex 64-line function)*
**Key Operations**:
1. Split by delimiters: `;`, `|`, `,`, ` and `, ` & `
2. Extract scientific names from parentheses: `Common name (Scientific name)`
3. Handle nested subgenus notation: `Genus (Subgenus) species` → both `Genus species` and `Subgenus species`
4. Remove `spp` and `sp` suffixes
5. Normalize whitespace
6. Validate scientific name format (starts with capital letter)

**Example transformations**:
- `Longfin squid (Doryteuthis pealeii)` → `Doryteuthis pealeii`
- `Penaeus (Melicertus) latisulcatus` → `Penaeus latisulcatus` + `Melicertus latisulcatus`
- `Gadus morhua; Melanogrammus aeglefinus` → `Gadus morhua` + `Melanogrammus aeglefinus`

**Priority**: 200 (complex domain-specific logic)

---

## Pattern 5: FAO Area Code Extraction
**Lines**: 130-165
**Type**: `regex_replace` + heuristic mapping
**Code**:
```python
def clean_fao_areas(fao_text: str) -> List[str]:
    # Extract numeric FAO codes
    fao_numbers = re.findall(r'\b\d{1,2}\b', fao_text)

    cleaned_areas = []
    for area in fao_numbers:
        # Zero-pad single digits
        if len(area) == 1:
            area = f"0{area}"
        cleaned_areas.append(area)

    # If no numbers found, try to extract from common area names
    if not cleaned_areas:
        area_mappings = {
            'atlantic': ['21', '27', '31', '34', '37', '41', '47'],
            'pacific': ['61', '67', '71', '77', '81', '87'],
            'indian': ['51', '57'],
            'mediterranean': ['37'],
            'north sea': ['27'],
            'baltic': ['27']
        }
        ...
```
**Pattern**: Extract numeric codes (1-2 digits), zero-pad, fallback to name mapping
**Comment**: Extract FAO major fishing area codes from Ocean Area text field
**Priority**: 200

---

## Pattern 6: Certificate Code Extraction (Complex)
**Lines**: 167-228
**Type**: `string_split` + regex extraction
**Code**: *(Complex 61-line function)*
**Key Operations**:
1. Split by delimiters: `;`, `|`, ` and `, ` & `
2. Extract codes from parentheses: `MSC-F-31213 (MRAG-F-0022)` → both codes
3. Split by commas within groups
4. Validate code format (alphanumeric + hyphens)
5. Remove duplicates while preserving order

**Example transformations**:
- `MSC-F-31213` → `MSC-F-31213`
- `MSC-F-31213 (MRAG-F-0022)` → `MSC-F-31213` + `MRAG-F-0022`
- `MSC-F-31213, MSC-F-31214` → `MSC-F-31213` + `MSC-F-31214`

**Priority**: 150

---

## Pattern 7: Long Text Truncation
**Lines**: 230-246
**Type**: `string_replace` (truncation)
**Code**:
```python
def truncate_long_text(text: str, max_length: int = 500) -> str:
    if len(text) <= max_length:
        return text

    # Truncate at word boundary
    truncated = text[:max_length-3]
    last_space = truncated.rfind(' ')

    if last_space > max_length * 0.8:
        return truncated[:last_space] + "..."
    else:
        return truncated + "..."
```
**Pattern**: Truncate fishery names exceeding 500 characters at word boundary
**Comment**: Handle very long fishery names (database constraint)
**Priority**: 150

---

## Pattern 8: Enum Normalization Function (Fuzzy Matching)
**Lines**: 44-62
**Type**: `lookup_table` + fuzzy matching
**Code**:
```python
def normalize_enum_value(value: str, mapping: dict) -> str:
    # Convert to lowercase for comparison
    value_lower = str(value).strip().lower()

    # Try exact match first
    if value_lower in mapping:
        return mapping[value_lower]

    # Try partial matches for variations
    for key, mapped_value in mapping.items():
        if value_lower in key or key in value_lower:
            return mapped_value

    # If no match found, return original value (uppercase)
    return str(value).strip().upper()
```
**Pattern**: Case-insensitive enum matching with partial matching fallback
**Comment**: Robust enum normalization with fuzzy matching
**Priority**: 200

---

## Pattern 9: Output Encoding Strategy
**Line**: 357
**Type**: `encoding_strategy`
**Code**: `output_df.to_csv(output_file, index=False)`
**Pattern**: `encoding=utf-8` (pandas default)
**Comment**: UTF-8 output for scientific names and international text
**Priority**: 100

---

## Summary
**Total Patterns**: 9
**Critical Patterns**: 5 (enum normalization x2, scientific name extraction, FAO area extraction, certificate parsing)
**Simple Replacements**: 1 (column mapping)
**Complex Logic**: 3 (scientific names, FAO areas, certificates)
**Lookup Tables**: 3 (column names, 2x enum mappings)
**Text Transformation**: 1 (truncation)
**Fuzzy Matching**: 1 (enum normalization)

## Data Quality Impact
- **High Impact**: Patterns 2-6, 8 (enum normalization, scientific name/area/cert extraction)
- **Medium Impact**: Patterns 1, 7 (column mapping, truncation)
- **Low Impact**: Pattern 9 (infrastructure)

## Key Characteristics
1. **Domain-specific**: Heavy marine science domain knowledge (species names, FAO areas, MSC certification)
2. **Complex parsing**: Multiple delimiter types, nested parentheses, subgenus handling
3. **Enum safety**: Case-insensitive + fuzzy matching for enum values
4. **Multi-value field handling**: Semicolons, pipes, commas, "and", "&" as delimiters
5. **Validation**: Scientific name format validation, FAO code validation
6. **Defensive**: Handles missing delimiters, malformed data, long text

## SQL-Friendly Patterns

### Patterns 2-3, 8 (Enum normalization):
```sql
SELECT CASE UPPER(TRIM(msc_status))
  WHEN 'CERTIFIED' THEN 'CERTIFIED'
  WHEN 'CERTIFIED WITH UNIT(S) IN ASSESSMENT' THEN 'CERTIFIED WITH UNIT(S) IN ASSESSMENT'
  ...
END;
```

### Pattern 7 (Truncation):
```sql
SELECT
  CASE
    WHEN LENGTH(fishery_name) > 500
    THEN SUBSTR(fishery_name, 1, 497) || '...'
    ELSE fishery_name
  END;
```

**Patterns 4-6 (scientific names, FAO areas, certificates) are NOT SQL-friendly** - require complex procedural logic with regex, splitting, nested loops, and validation.

## Implementation Notes
**This is one of the most complex cleaning scripts** - requires:
1. Deep domain knowledge (marine taxonomy, FAO geography, MSC certification)
2. Complex parsing logic (nested parentheses, multiple delimiter types)
3. Validation and normalization
4. Defensive programming for malformed data

**Most patterns require procedural implementation** - only enum normalization and truncation are SQL-friendly.

**Should remain as Python preprocessing step** or be implemented as PostgreSQL functions (PL/pgSQL or PL/Python).