# Manual Pattern Extraction: clean_esp_robust.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_esp_robust.py`
**Source Type**: COUNTRY
**Source Name**: EU_ESP
**Purpose**: Robust automatic detection and fixing of quote-comma patterns in Spanish port names

---

## Pattern 1: Regex - Universal Quote-Comma Fix
**Lines**: 10-24
**Type**: `regex_replace`
**Code**:
```python
def find_and_fix_spanish_quotes(line):
    """
    Find and fix quote issues in Spanish port names
    Main pattern: Caleta Del Sebo", La Graciosa
    """
    # Pattern: find any text", text pattern within semicolon-delimited fields
    pattern = r'(;[^;]*)",([ ][^;]*)'

    # Replace all matches
    fixed_line = re.sub(pattern, r'\1,\2', line)

    # Count how many replacements were made
    replacements = len(re.findall(pattern, line))

    return fixed_line, replacements
```
**Pattern**: `(;[^;]*)",([ ][^;]*)`
**Replacement**: `\1,\2` (remove quote before comma with space)
**Comment**: Universal pattern to fix ANY occurrence of quote-comma in Spanish port names (e.g., "Caleta Del Sebo", La Graciosa)
**Priority**: 200 (high - systematic fix)
**Note**: **Identical pattern to clean_dnk_robust.py** - same issue occurs in Spanish and Danish data

---

## Pattern 2: File Encoding Strategy
**Line**: 38
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Handle Spanish characters (á, é, í, ó, ú, ñ, ¿, ¡) with UTF-8, replace invalid bytes
**Priority**: 100

---

## Pattern 3: Line Ending Normalization
**Line**: 39
**Type**: `string_replace`
**Code**: `lines = [line.rstrip('\n\r') for line in f]`
**Pattern**: `\n\r` (newline and carriage return)
**Replacement**: `` (stripped)
**Comment**: Strip trailing newlines and carriage returns
**Priority**: 100

---

## Pattern 4: Field Count Validation (Dynamic)
**Line**: 43
**Type**: `field_count_validation`
**Code**: `expected_fields = header.count(';') + 1`
**Pattern**: `dynamic_field_count` (based on header)
**Replacement**: NULL
**Comment**: Determine expected field count from header semicolon count
**Priority**: 150

---

## Pattern 5: Field Count Too Few - Padding
**Lines**: 69-73
**Type**: `field_count_too_few`
**Code**:
```python
if field_count < expected_fields:
    missing = expected_fields - field_count
    line = line + (';' * missing)
    total_fixes += 1
    fixes_log.append((line_num, f"Added {missing} empty fields"))
```
**Pattern**: `field_count_too_few`
**Replacement**: Append missing semicolons
**Comment**: Add empty fields when line has too few delimiters
**Priority**: 150

---

## Pattern 6: Field Count Too Many - Truncation
**Lines**: 74-80
**Type**: `field_count_too_many`
**Code**:
```python
elif field_count > expected_fields:
    # Too many fields - truncate
    parts = line.split(';')
    if len(parts) > expected_fields:
        parts = parts[:expected_fields]
        line = ';'.join(parts)
        fixes_log.append((line_num, f"Truncated from {field_count} to {expected_fields} fields"))
```
**Pattern**: `field_count_too_many`
**Replacement**: Truncate to expected field count
**Comment**: Remove excess fields (likely from unescaped semicolons in Spanish text)
**Priority**: 150
**Warning**: **May lose data** - truncates without analysis

---

## Pattern 7: Pattern Detection for Reporting
**Lines**: 63-65
**Type**: `pattern_detection` (logging only)
**Code**:
```python
matches = re.findall(r'([^;]+)",[ ]([^;]+)', original_line)
for match in matches:
    quote_patterns_found.add(f'{match[0]}", {match[1]}')
```
**Pattern**: `([^;]+)",[ ]([^;]+)`
**Replacement**: NULL
**Comment**: Extract and log unique Spanish quote-comma patterns found (for documentation)
**Priority**: 0 (logging only, doesn't modify data)

---

## Pattern 8: Output Encoding Strategy
**Line**: 85
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Pattern 9: Verification - Quote-Comma Detection
**Line**: 137
**Type**: `pattern_detection` (verification)
**Code**: `if '", ' in line:`
**Pattern**: `", ` (literal quote-comma-space)
**Replacement**: NULL
**Comment**: Detect remaining quote-comma patterns for verification
**Priority**: 100 (validation only)

---

## Pattern 10: Verification - Field Count Check
**Lines**: 133-134
**Type**: `field_count_validation` (verification)
**Code**:
```python
if field_count != header_fields:
    issues.append((line_num, f"Field count: {field_count} vs header: {header_fields}"))
```
**Pattern**: `field_count_validation`
**Replacement**: NULL
**Comment**: Verify all lines have correct field count after cleaning
**Priority**: 100 (validation only)

---

## Summary
**Total Patterns**: 10
**Critical Patterns**: 1 (universal quote-comma regex)
**Simple Replacements**: 0
**Regex Patterns**: 2 (one for fixing, one for detection)
**Complex Logic**: 0
**Validation Rules**: 4 (dynamic field count, too few, too many, verification x2)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 1, 5, 6 (universal quote fix, field padding, field truncation)
- **Medium Impact**: Pattern 4 (dynamic validation)
- **Low Impact**: Patterns 2, 3, 8 (infrastructure)
- **Validation Only**: Patterns 7, 9, 10 (logging and verification)

## Key Comparison with clean_esp_vessels.py
**clean_esp_vessels.py** (original):
- Custom quote-aware state machine parser (lines 68-106)
- Character-by-character iteration
- Spanish article detection (La/El/Los/Las)
- Port-specific patterns (Puerto/Bahía/Isla/Costa/Playa)
- **Complex procedural logic**

**clean_esp_robust.py** (this file):
- Simple universal regex pattern
- Single-pass replacement
- Works for ANY quote-comma pattern
- **Much simpler, more maintainable**

## Why This Approach is Better
1. **Automatic**: Finds all patterns, not just known ones
2. **Maintainable**: Single regex pattern vs 100+ lines of parsing logic
3. **Predictable**: Regex behavior is well-defined
4. **Portable**: Can be implemented directly in SQL (PostgreSQL regexp_replace)
5. **Fast**: Single regex pass vs character-by-character iteration

## Spanish Port Name Patterns
Common Spanish patterns this fixes:
- `Caleta Del Sebo", La Graciosa` → `Caleta Del Sebo, La Graciosa`
- `Puerto de XXX", Bahía de YYY` → `Puerto de XXX, Bahía de YYY`
- `Town", Province` → `Town, Province`

All follow the pattern: **Spanish port name** + **quote-comma** + **location specifier**

## Implementation Notes
**Pattern 1 is directly extractable to SQL**:
```sql
SELECT regexp_replace(
  line_content,
  '(;[^;]*)",([ ][^;]*)',
  '\1,\2',
  'g'  -- global flag for all occurrences
);
```

This is **one of the most SQL-friendly patterns** in all the cleaning scripts.