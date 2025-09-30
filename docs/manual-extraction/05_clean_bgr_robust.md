# Manual Pattern Extraction: clean_bgr_robust.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_bgr_robust.py`
**Source Type**: COUNTRY
**Source Name**: EU_BGR
**Purpose**: Robust Bulgarian CSV cleaner with Cyrillic quote handling and field count fixes

---

## Pattern 1: Specific String Replacement (СВ",НИКОЛА)
**Line**: 15
**Type**: `quote_fix`
**Code**: `line = line.replace('СВ",НИКОЛА', 'СВ,НИКОЛА')`
**Pattern**: `СВ",НИКОЛА`
**Replacement**: `СВ,НИКОЛА`
**Comment**: Fix specific error mentioned in line 1767 - Cyrillic vessel name
**Priority**: 250 (source-specific + quote fix)

---

## Pattern 2: Regex - Cyrillic Quote Before Comma
**Line**: 19-20
**Type**: `regex_replace`
**Code**:
```python
# Pattern: Cyrillic text", more text
pattern = r'([А-Яа-я\s]+)",([ ][А-Яа-я\s]+)'
line = re.sub(pattern, r'\1,\2', line)
```
**Pattern**: `([А-Яа-я\s]+)",([ ][А-Яа-я\s]+)`
**Replacement**: `\1,\2` (remove quote before comma)
**Comment**: Remove quotes before commas in Cyrillic text with space after comma
**Priority**: 200 (high - systematic Cyrillic pattern)
**Notes**: Includes whitespace in character class `[А-Яа-я\s]`

---

## Pattern 3: Regex - Mid-Field Quote Removal (Complex)
**Line**: 24-36
**Type**: `regex_replace` with conditional logic
**Code**:
```python
pattern2 = r'([^;]+)"([А-Яа-я\s,]+)'

def replace_if_not_boundary(match):
    before = match.group(1)
    after = match.group(2)
    # If the quote is at the start of a field after semicolon, keep it
    if before.endswith(';'):
        return match.group(0)
    # Otherwise remove the quote
    return before + after

line = re.sub(pattern2, replace_if_not_boundary, line)
```
**Pattern**: `([^;]+)"([А-Яа-я\s,]+)`
**Replacement**: Conditional - keep if after semicolon, remove otherwise
**Comment**: Remove quotes within fields but preserve field boundary quotes
**Priority**: 200
**Condition JSON**:
```json
{
  "comment": "Complex quote removal with boundary detection",
  "pattern": "([^;]+)\"([А-Яа-я\\s,]+)",
  "conditional_logic": "Remove quote unless it's a field start (after semicolon)",
  "implementation": "Requires callback function to check context",
  "line": 24
}
```
**Implementation Notes**: This is **complex conditional regex** - cannot be simple SQL pattern

---

## Pattern 4: File Encoding Strategy
**Line**: 50
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Handle Cyrillic with UTF-8 encoding, replace invalid characters
**Priority**: 100

---

## Pattern 5: Line Ending Normalization
**Line**: 51
**Type**: `string_replace`
**Code**: `lines = [line.rstrip('\n\r') for line in f]`
**Pattern**: `\n\r` (newline and carriage return)
**Replacement**: `` (stripped)
**Comment**: Strip trailing newlines and carriage returns (Windows line endings)
**Priority**: 100

---

## Pattern 6: Field Count Validation (Flexible)
**Line**: 56-68
**Type**: `field_count_validation`
**Code**:
```python
expected_fields = 40
header_fields = header.count(';') + 1

if header_fields == 41:
    print(f"Header has {header_fields} fields, expected {expected_fields}")
    actual_fields = header_fields
else:
    actual_fields = expected_fields
```
**Pattern**: `expected_fields=40 (flexible to 41)`
**Replacement**: NULL
**Comment**: EU Fleet Register expected 40 fields, but BGR might have 41 - adapt dynamically
**Priority**: 150
**Implementation Notes**: This is **adaptive validation** - adjusts expected count based on actual header

---

## Pattern 7: Field Count Too Few - Padding
**Line**: 96-100
**Type**: `field_count_too_few`
**Code**:
```python
if field_count < actual_fields:
    missing = actual_fields - field_count
    line = line + (';' * missing)
```
**Pattern**: `field_count_too_few`
**Replacement**: Append missing semicolons
**Comment**: Add empty fields when line has too few fields
**Priority**: 150
**Implementation Notes**: Appends empty fields with semicolon delimiters

---

## Pattern 8: Field Count Too Many - Truncation
**Line**: 101-115
**Type**: `field_count_too_many`
**Code**:
```python
elif field_count > actual_fields:
    parts = line.split(';')

    if len(parts) == 41 and actual_fields == 40:
        # Common issue: vessel name or port name contains semicolon
        merged_parts = parts[:40]  # Keep first 40
        line = ';'.join(merged_parts)
```
**Pattern**: `field_count_too_many`
**Replacement**: Truncate to expected field count
**Comment**: When 41 fields expected 40, truncate (likely unescaped semicolon in vessel/port name)
**Priority**: 150
**Implementation Notes**: **Heuristic truncation** - keeps first N fields, may lose data

---

## Pattern 9: Output Encoding Strategy
**Line**: 120
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Pattern 10: Verification - Cyrillic Quote Detection
**Line**: 173
**Type**: `pattern_detection` (verification)
**Code**: `if re.search(r'[А-Яа-я]"[А-Яа-я]', line):`
**Pattern**: `[А-Яа-я]"[А-Яа-я]`
**Replacement**: NULL
**Comment**: Detect remaining Cyrillic quote issues for verification
**Priority**: 100 (validation only)
**Implementation Notes**: Used in post-cleaning verification, not during cleaning

---

## Summary
**Total Patterns**: 10
**Critical Patterns**: 4 (specific fix, Cyrillic quote regex, conditional quote removal, adaptive field count)
**Simple Replacements**: 1
**Regex Patterns**: 3 (two simple, one conditional)
**Complex Logic**: 2 (conditional regex callback, adaptive field count validation)
**Validation Rules**: 3 (flexible field count, too few, too many)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 1, 2, 3, 6, 7, 8 (fix systematic Cyrillic and field count issues)
- **Medium Impact**: Pattern 10 (verification)
- **Low Impact**: Patterns 4, 5, 9 (infrastructure)

## Key Differences from clean_bgr_vessels.py
1. **No custom parser**: Uses simpler field count checking and truncation/padding
2. **Conditional regex**: Pattern 3 uses callback function for context-aware replacement
3. **Adaptive field count**: Adjusts to header reality (40 or 41 fields)
4. **Verification function**: Built-in post-cleaning check (lines 148-183)
5. **Logging**: Tracks specific quote patterns found and fixed

## Implementation Notes
**Pattern 3 (conditional regex) is NOT extractable as simple SQL** - requires callback function to check if quote is after semicolon.
**Pattern 6 (adaptive validation) is NOT extractable** - requires inspecting header first to set expected count.
**Pattern 8 (truncation heuristic) may lose data** - should be flagged for manual review.