# Manual Pattern Extraction: clean_country_profile_data.py

**Source**: `scripts/legacy-pandas-cleaners/reference/clean_country_profile_data.py`
**Source Type**: REFERENCE
**Source Name**: FOC + ILO_C188 (country profile data)
**Purpose**: Clean country profile data (FOC flags, ILO C188 ratification) for UUID-based database import

---

## Function 1: clean_country_iso_foc() - Lines 5-51

### Pattern 1: String Trimming
**Line**: 16
**Type**: `string_replace`
**Code**: `df['alpha_3_code'] = df['alpha_3_code'].astype(str).str.strip()`
**Pattern**: Leading/trailing whitespace
**Replacement**: `` (stripped)
**Comment**: Clean ISO 3-letter country codes (e.g., " USA" → "USA")
**Priority**: 150

### Pattern 2: Column Name Flexibility (Boolean Field)
**Lines**: 20-26
**Type**: `pattern_detection` + fallback
**Code**:
```python
foc_column = None
if 'isFOC' in df.columns:
    foc_column = 'isFOC'
elif 'is_foc' in df.columns:
    foc_column = 'is_foc'
else:
    raise ValueError("FOC status column not found")
```
**Pattern**: Multiple possible column names (`isFOC` or `is_foc`)
**Comment**: Handle both camelCase and snake_case column naming conventions
**Priority**: 100

### Pattern 3: Boolean Type Conversion
**Line**: 29
**Type**: `data_type_conversion`
**Code**: `df['is_foc'] = df[foc_column].astype(bool)`
**Pattern**: Convert to boolean type
**Comment**: Standardize FOC flag as proper boolean
**Priority**: 150

### Pattern 4: Duplicate Removal
**Lines**: 35-38
**Type**: `duplicate_detection`
**Code**:
```python
original_count = len(df)
df = df.drop_duplicates()
if len(df) < original_count:
    print(f"Removed {original_count - len(df)} duplicate records")
```
**Pattern**: Duplicate row detection
**Comment**: Remove duplicate country-FOC entries
**Priority**: 150

---

## Function 2: clean_country_iso_ilo_c188() - Lines 53-160

### Pattern 5: Column Name Flexibility (Ratification Field)
**Lines**: 68-74
**Type**: `pattern_detection` + fallback
**Code**:
```python
ratified_column = None
if 'isC188ratified' in df.columns:
    ratified_column = 'isC188ratified'
elif 'is_c188_ratified' in df.columns:
    ratified_column = 'is_c188_ratified'
else:
    raise ValueError("C188 ratification column not found")
```
**Pattern**: Multiple possible column names
**Comment**: Handle both camelCase and snake_case for ratification field
**Priority**: 100

### Pattern 6: Date Parsing with Error Handling
**Lines**: 79-98
**Type**: `data_type_conversion` + flexible mapping
**Code**:
```python
date_field_mapping = {
    'dateEnteredForce': 'date_entered_force',
    'date_entered_force': 'date_entered_force',
    'dateRatified': 'date_ratified',
    ...
}

for old_name, new_name in date_field_mapping.items():
    if old_name in df.columns:
        df[new_name] = pd.to_datetime(df[old_name], format='%Y-%m-%d', errors='coerce')
        df[new_name] = df[new_name].where(pd.notnull(df[new_name]), None)
```
**Pattern**: Date parsing with coercion and NaT → None conversion
**Comment**: Parse date fields (dateEnteredForce, dateRatified, dateFutureEnterForceBy) with flexible naming
**Priority**: 200
**Format**: `YYYY-MM-DD`
**Error Handling**: `errors='coerce'` - invalid dates become NaT, then None

### Pattern 7: Empty String Normalization
**Lines**: 101-116
**Type**: `string_replace` + null normalization
**Code**:
```python
for old_name, new_name in string_field_mapping.items():
    if old_name in df.columns:
        df[new_name] = df[old_name].astype(str).str.strip()
        df[new_name] = df[new_name].replace(['', 'nan', 'NaN'], None)
```
**Patterns**:
- `` (empty string) → `None`
- `nan` (string) → `None`
- `NaN` (string) → `None`

**Comment**: Normalize empty/null string values for SQL compatibility
**Priority**: 150
**Fields**: `convention_org`, `convention_shortname`, `convention_fullname`

---

## Pattern 8: Column Standardization Mappings (Multiple)
**Lines**: 80-116
**Type**: `lookup_table` (column name mappings)

### Date Field Mappings:
```python
date_field_mapping = {
    'dateEnteredForce': 'date_entered_force',
    'dateRatified': 'date_ratified',
    'dateFutureEnterForceBy': 'date_future_enter_force_by'
}
```

### String Field Mappings:
```python
string_field_mapping = {
    'conventionOrg': 'convention_org',
    'convention_shortname': 'convention_shortname',
    'convention_fullname': 'convention_fullname'
}
```

**Pattern**: camelCase → snake_case
**Comment**: Standardize column names for database consistency
**Priority**: 150

---

## Summary
**Total Patterns**: 8
**Critical Patterns**: 3 (date parsing, empty string normalization, duplicate removal)
**Simple Replacements**: 2 (string trimming, boolean conversion)
**Complex Logic**: 3 (column name flexibility, date field mapping, string field mapping)
**Duplicate Detection**: 1
**Data Type Conversions**: 2 (boolean, date)

## Data Quality Impact
- **High Impact**: Patterns 3, 6, 7 (boolean conversion, date parsing, null normalization)
- **Medium Impact**: Patterns 1, 4, 8 (trimming, deduplication, column standardization)
- **Low Impact**: Patterns 2, 5 (column name flexibility - infrastructure)

## Key Characteristics
1. **Flexible column naming**: Handles both camelCase and snake_case inputs
2. **Date parsing robustness**: Coerces invalid dates to None
3. **Null value normalization**: Standardizes empty strings, "nan", "NaN" to None
4. **Duplicate removal**: Ensures data quality
5. **Database-ready**: Outputs clean CSV ready for SQL import with UUID handling
6. **No manual ID generation**: Relies on database UUID generation

## SQL-Friendly Patterns

### Pattern 1 (String trimming):
```sql
SELECT TRIM(alpha_3_code);
```

### Pattern 3 (Boolean conversion):
```sql
SELECT CAST(is_foc AS BOOLEAN);
```

### Pattern 4 (Duplicate removal):
```sql
SELECT DISTINCT ON (alpha_3_code, is_foc) *;
```

### Pattern 6 (Date parsing):
```sql
SELECT TO_DATE(date_entered_force, 'YYYY-MM-DD');
-- Invalid dates become NULL automatically with try_cast in some databases
```

### Pattern 7 (Empty string normalization):
```sql
SELECT NULLIF(TRIM(convention_org), '');  -- Empty strings become NULL
SELECT CASE
  WHEN LOWER(convention_org) IN ('nan', 'none') THEN NULL
  ELSE convention_org
END;
```

## Data Sources
1. **FOC (Flag of Convenience)**: Country flags considered "flags of convenience" for shipping
2. **ILO C188**: ILO Maritime Labour Convention 2006 ratification status by country

## Output Files
1. `/import/country_iso_foc_cleaned.csv`
   - Columns: `alpha_3_code`, `is_foc`
2. `/import/country_iso_ILO_c188_cleaned.csv`
   - Columns: `alpha_3_code`, `is_c188_ratified`, `date_entered_force`, `date_ratified`, `date_future_enter_force_by`, `convention_org`, `convention_shortname`, `convention_fullname`

## Implementation Notes
**This script is highly SQL-friendly** - most operations can be done directly in SQL during import:
1. String trimming
2. Boolean conversion
3. Date parsing
4. Empty string → NULL normalization
5. Duplicate removal

**The only Python-specific logic is flexible column naming** (Patterns 2, 5, 8) - which could be handled via SQL's `COALESCE`:
```sql
SELECT COALESCE(
  TRY_CAST("isFOC" AS BOOLEAN),
  TRY_CAST("is_foc" AS BOOLEAN)
) AS is_foc;
```