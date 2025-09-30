# Manual Pattern Extraction: clean_bgr_vessels.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_bgr_vessels.py`
**Source Type**: COUNTRY
**Source Name**: EU_BGR
**Purpose**: Clean Bulgarian vessel CSV with Cyrillic character and quote issues

---

## Pattern 1: File Encoding Strategy
**Line**: 27
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Read with UTF-8 encoding to handle Cyrillic characters
**Priority**: 100

---

## Pattern 2: Specific String Replacement (СВ",НИКОЛА)
**Line**: 44
**Type**: `quote_fix`
**Code**: `line.replace('СВ",НИКОЛА', 'СВ,НИКОЛА')`
**Pattern**: `СВ",НИКОЛА`
**Replacement**: `СВ,НИКОЛА`
**Comment**: Fix СВ",НИКОЛА quote issue - line 1767 in original data (Cyrillic vessel name)
**Priority**: 250 (source-specific + quote fix)

---

## Pattern 3: Regex - Cyrillic Quote Pattern
**Line**: 49-52
**Type**: `regex_replace`
**Code**:
```python
cyrillic_quote_pattern = r'([А-Яа-я]+)"([А-Яа-я]+)'
if re.search(cyrillic_quote_pattern, line):
    line = re.sub(cyrillic_quote_pattern, r'\1\2', line)
```
**Pattern**: `([А-Яа-я]+)"([А-Яа-я]+)`
**Replacement**: `\1\2` (remove embedded quote between Cyrillic words)
**Comment**: Remove embedded quotes within Cyrillic text (Bulgarian vessel names)
**Priority**: 200 (high - handles systematic Cyrillic naming issues)
**Special Notes**: Uses Cyrillic Unicode ranges А-Я (U+0410-U+042F) and а-я (U+0430-U+044F)

---

## Pattern 4: Field Count Validation
**Line**: 55-56
**Type**: `field_count_validation`
**Code**:
```python
expected_fields = 41  # EU Fleet Register standard
field_count = line.count(';') + 1
```
**Pattern**: `expected_fields=41`
**Replacement**: NULL
**Comment**: EU Fleet Register (BGR) should have exactly 41 fields
**Priority**: 150

---

## Pattern 5: Field Count Mismatch Detection
**Line**: 58
**Type**: `field_count_mismatch`
**Code**: `if field_count != expected_fields:`
**Pattern**: `field_count_mismatch`
**Replacement**: NULL
**Comment**: Detect lines with wrong number of fields
**Priority**: 150

---

## Pattern 6: Custom Quote-Aware Parser (Complex Logic)
**Lines**: 59-97
**Type**: `quote_aware_parser`
**Code**: [Full custom parsing state machine]
**Description**:
- Handles embedded quotes within fields
- Detects escaped quotes (`""`)
- **Removes unexpected quotes** that don't fit standard CSV quoting
- Respects semicolon delimiters only outside quotes
- Reconstructs line with correct field boundaries

**Implementation Notes**:
This is **complex procedural logic** similar to ESP/DNK parsers but with additional Cyrillic-specific handling:
1. State tracking (`in_quotes` boolean)
2. Character-by-character iteration with index tracking (`while i < len(line)`)
3. Lookahead checking for context (closing quote, escaped quote, or unexpected quote)
4. **Removes unexpected quotes** that aren't followed by semicolon or another quote
5. Conditional reparsing only when field count is wrong

**Pattern**: `custom_quote_parser_bgr`
**Replacement**: NULL
**Comment**: State machine parser for quote-aware field splitting with Cyrillic-safe embedded quote removal
**Priority**: 300 (critical)
**SQL Condition JSON**:
```json
{
  "comment": "Custom quote-aware parser for BGR CSV with Cyrillic support",
  "delimiter": ";",
  "quote_char": "\"",
  "escape_quote": "\"\"",
  "expected_fields": 41,
  "special_handling": "Remove unexpected quotes that don't match CSV escaping rules (Cyrillic vessel names)",
  "state_machine": true,
  "trigger": "Only applies when field count mismatch detected",
  "cyrillic_safe": true,
  "implementation": "Requires character-by-character parsing with quote state tracking and lookahead"
}
```

---

## Pattern 7: Field Reconstruction (Join)
**Line**: 96
**Type**: `field_merger`
**Code**: `line = ';'.join(fields)`
**Pattern**: `;` (semicolon delimiter)
**Replacement**: NULL
**Comment**: Reconstruct CSV line with semicolon delimiter after reparsing
**Priority**: 100

---

## Pattern 8: Output Encoding Strategy
**Line**: 110
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Summary
**Total Patterns**: 8
**Critical Patterns**: 3 (specific Cyrillic fix, Cyrillic quote regex, custom parser)
**Simple Replacements**: 1
**Regex Patterns**: 1 (with Cyrillic Unicode ranges)
**Complex Logic**: 1 (quote-aware parser with Cyrillic-safe quote removal)
**Validation Rules**: 2
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 2, 3, 6 (fix systematic Cyrillic and quote-related issues)
- **Medium Impact**: Patterns 4, 5 (validation)
- **Low Impact**: Patterns 1, 7, 8 (infrastructure)

## Implementation Notes
**Pattern 6 (custom parser) is NOT extractable as a simple SQL rule** - requires procedural logic with Cyrillic awareness.
**Pattern 3 (Cyrillic regex) requires Unicode support** in the SQL engine for regex matching.