# Manual Pattern Extraction: clean_dnk_robust.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_dnk_robust.py`
**Source Type**: COUNTRY
**Source Name**: EU_DNK
**Purpose**: Automatic detection and fixing of ALL quote-before-comma patterns in Danish data

---

## Pattern 1: Regex - Universal Quote-Comma Fix
**Lines**: 9-23
**Type**: `regex_replace`
**Code**:
```python
def find_and_fix_quotes(line):
    # Pattern: find any text", text pattern within semicolon-delimited fields
    # This regex captures: ;"text", text  or  ;text", text
    pattern = r'(;[^;]*)",([ ][^;]*)'

    # Replace all matches
    fixed_line = re.sub(pattern, r'\1,\2', line)

    # Count how many replacements were made
    replacements = len(re.findall(pattern, line))

    return fixed_line, replacements
```
**Pattern**: `(;[^;]*)",([ ][^;]*)`
**Replacement**: `\1,\2` (remove quote before comma with space)
**Comment**: Universal pattern to fix ANY occurrence of quote-comma within semicolon-delimited fields
**Priority**: 200 (high - systematic fix)
**Breakdown**:
- `(;[^;]*)` - Capture group 1: semicolon followed by any non-semicolon characters
- `"` - Literal quote to remove
- `,` - Literal comma
- `([ ][^;]*)` - Capture group 2: space followed by any non-semicolon characters

**Key Difference from other DNK scripts**: This pattern finds **ALL** instances dynamically, not just known port names.

---

## Pattern 2: File Encoding Strategy
**Line**: 36
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Handle Danish characters with UTF-8, replace invalid bytes
**Priority**: 100

---

## Pattern 3: Line Ending Normalization
**Line**: 37
**Type**: `string_replace`
**Code**: `lines = [line.rstrip('\n\r') for line in f]`
**Pattern**: `\n\r` (newline and carriage return)
**Replacement**: `` (stripped)
**Comment**: Strip trailing newlines and carriage returns
**Priority**: 100

---

## Pattern 4: Field Count Validation (Dynamic)
**Line**: 41
**Type**: `field_count_validation`
**Code**: `expected_fields = header.count(';') + 1`
**Pattern**: `dynamic_field_count` (based on header)
**Replacement**: NULL
**Comment**: Determine expected field count from header semicolon count
**Priority**: 150

---

## Pattern 5: Field Count Too Few - Padding
**Lines**: 66-69
**Type**: `field_count_too_few`
**Code**:
```python
if field_count < expected_fields:
    missing = expected_fields - field_count
    line = line + (';' * missing)
```
**Pattern**: `field_count_too_few`
**Replacement**: Append missing semicolons
**Comment**: Add empty fields when line has too few delimiters
**Priority**: 150

---

## Pattern 6: Pattern Detection for Reporting
**Lines**: 60-62
**Type**: `pattern_detection` (logging only)
**Code**:
```python
matches = re.findall(r'([^;]+)",[ ]([^;]+)', original_line)
for match in matches:
    quote_patterns_found.add(f'{match[0]}", {match[1]}')
```
**Pattern**: `([^;]+)",[ ]([^;]+)`
**Replacement**: NULL
**Comment**: Extract and log unique quote-comma patterns found (for analysis)
**Priority**: 0 (logging only, doesn't modify data)
**Purpose**: Helps identify what patterns are being fixed for documentation

---

## Pattern 7: Output Encoding Strategy
**Line**: 74
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Pattern 8: Verification - Quote-Comma Detection
**Line**: 110
**Type**: `pattern_detection` (verification)
**Code**: `if '", ' in line:`
**Pattern**: `", ` (literal quote-comma-space)
**Replacement**: NULL
**Comment**: Detect remaining quote-comma patterns for verification
**Priority**: 100 (validation only)
**Implementation Notes**: Simple string search for post-cleaning verification

---

## Pattern 9: Verification - Field Count Check
**Lines**: 106-107
**Type**: `field_count_validation` (verification)
**Code**:
```python
if field_count != expected_fields:
    issues.append((line_num, f"Wrong field count: {field_count}"))
```
**Pattern**: `field_count_validation`
**Replacement**: NULL
**Comment**: Verify all lines have correct field count after cleaning
**Priority**: 100 (validation only)

---

## Summary
**Total Patterns**: 9
**Critical Patterns**: 1 (universal quote-comma regex)
**Simple Replacements**: 0
**Regex Patterns**: 2 (one for fixing, one for detection)
**Complex Logic**: 0
**Validation Rules**: 4 (dynamic field count, too few, verification x2)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Pattern 1, 5 (universal quote fix, field padding)
- **Medium Impact**: Pattern 4 (dynamic validation)
- **Low Impact**: Patterns 2, 3, 7 (infrastructure)
- **Validation Only**: Patterns 6, 8, 9 (logging and verification)

## Key Advantages over clean_dnk_final.py
1. **Automatic detection**: Finds ALL quote-comma patterns, not just 10 hardcoded ones
2. **Scalable**: Works with any Danish dataset without updating hardcoded list
3. **Reporting**: Logs unique patterns found for documentation
4. **Verification**: Built-in verification function to check output quality
5. **Future-proof**: Adapts to new port names automatically

## Key Advantages over clean_dnk_vessels.py
1. **Simpler**: No complex quote-aware state machine parser
2. **Targeted**: Focuses specifically on quote-comma pattern (most common DNK issue)
3. **Efficient**: Single regex pass instead of character-by-character parsing
4. **Predictable**: Regex behavior is well-defined and testable

## Regex Pattern Analysis
**Pattern**: `(;[^;]*)",([ ][^;]*)`

**What it matches**:
- `;` - Field boundary (semicolon delimiter)
- `[^;]*` - Any characters except semicolon (field content)
- `"` - **Problem quote** to remove
- `,` - Comma separator within field
- `[ ]` - Required space after comma
- `[^;]*` - More field content

**Why it works**:
- Anchors on field boundaries (semicolons) to ensure we're within a single field
- Requires space after comma to match Danish place name pattern: `Port", Location`
- Non-greedy matching prevents crossing field boundaries

**Limitations**:
- Won't fix quote-comma WITHOUT space: `text",text`
- Won't fix quote-comma at field boundaries
- Assumes semicolon delimiter

## Implementation Notes
**Pattern 1 is extractable as SQL regex** - PostgreSQL regex_replace can handle this:
```sql
SELECT regexp_replace(line_content, '(;[^;]*)",([ ][^;]*)', '\1,\2', 'g');
```

This is one of the few patterns that **CAN** be implemented directly in SQL without procedural logic.