# Manual Pattern Extraction: clean_msc_fishery_light.md

**Source**: `scripts/legacy-pandas-cleaners/reference/clean_msc_fishery_light.py`
**Source Type**: REFERENCE
**Source Name**: MSC (Marine Stewardship Council) Fishery Data
**Purpose**: Lightweight MSC fishery CSV cleaner with whitespace normalization and column standardization

---

## Pattern 1: File Encoding Strategy (BOM Handling)
**Line**: 21
**Type**: `encoding_strategy`
**Code**: `INPUT.open("r", newline="", encoding="utf-8-sig")`
**Pattern**: `encoding=utf-8-sig`
**Replacement**: NULL
**Comment**: UTF-8 with BOM removal - handles Excel UTF-8 exports
**Priority**: 100

---

## Pattern 2: Header Space-to-Underscore Normalization
**Line**: 23
**Type**: `string_replace`
**Code**: `fieldnames = [name.strip().replace(" ", "_") for name in reader.fieldnames]`
**Pattern**: ` ` (space in headers)
**Replacement**: `_` (underscore)
**Comment**: Standardize MSC column names for database compatibility
**Priority**: 150
**Application**: Applied to all column headers once

---

## Pattern 3: Whitespace Collapse Function
**Lines**: 14-15
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
**Application**: Applied to all field values

---

## Pattern 4: Value Whitespace Stripping + Collapse
**Line**: 34
**Type**: `string_replace` (combined operation)
**Code**: `value = collapse_whitespace(value.strip()) if isinstance(value, str) else value`
**Pattern**: Combined:
1. Strip leading/trailing whitespace
2. Collapse internal whitespace (calls Pattern 3)
**Comment**: Clean all MSC fishery data values
**Priority**: 100
**Application**: Applied to all field values

---

## Pattern 5: Output Encoding Strategy
**Line**: 26
**Type**: `encoding_strategy`
**Code**: `OUTPUT.open("w", newline="", encoding="utf-8")`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding (no BOM)
**Priority**: 100

---

## Summary
**Total Patterns**: 5
**Critical Patterns**: 2 (header normalization, whitespace collapse)
**Simple Replacements**: 2 (spaces in headers, whitespace in values)
**Complex Logic**: 0
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 2, 3, 4 (header standardization, whitespace normalization)
- **Low Impact**: Patterns 1, 5 (infrastructure)

## Key Characteristics
1. **Lightweight**: No complex parsing or validation
2. **Universal cleaner**: Works for any CSV file (not MSC-specific logic)
3. **Simple transformations**: Only whitespace handling and header normalization
4. **No field-specific rules**: All fields treated the same
5. **BOM-safe**: Handles Excel UTF-8 exports with BOM

## Comparison with clean_all_vessel_types.py
**Similarities**:
- Both use `utf-8-sig` encoding
- Both normalize headers (spaces → underscores)
- Both collapse whitespace in values
- Both are "universal" cleaners

**Differences**:
- clean_all_vessel_types.py also removes parentheses and dots from headers
- clean_all_vessel_types.py has delimiter detection logic
- clean_msc_fishery_light.py is simpler (fewer transformations)

## SQL-Friendly Patterns
All patterns are SQL-compatible:

### Pattern 2 (Header normalization):
```sql
-- During table creation
CREATE TABLE msc_fishery (
  "Fishery Name" → fishery_name,
  "MSC Status" → msc_status
);
```

### Pattern 3 & 4 (Whitespace normalization):
```sql
SELECT regexp_replace(TRIM(value), '\s+', ' ', 'g');
```

## Implementation Notes
**This is the simplest cleaning script** - only does:
1. UTF-8 BOM handling
2. Header normalization (spaces → underscores)
3. Value whitespace normalization

**No domain-specific logic** - could be used as a template for any CSV cleaning.

**Suitable for SQL implementation** - all operations can be done in SQL during COPY or as transformations.