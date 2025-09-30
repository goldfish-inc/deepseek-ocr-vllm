# Manual Pattern Extraction: clean_dnk_vessels.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_dnk_vessels.py`
**Source Type**: COUNTRY
**Source Name**: EU_DNK
**Purpose**: Clean Danish vessel CSV with embedded quote issues

---

## Pattern 1: File Encoding Strategy
**Line**: 26
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Handle Danish characters and encoding errors
**Priority**: 100

---

## Pattern 2: Regex - Fix Embedded Quote in Field
**Line**: 43-49
**Type**: `regex_replace`
**Code**:
```python
if '", ' in line and line.count('"') % 2 != 0:
    pattern = r'"([^"]*)", ([^;]*);'
    def fix_quote(match):
        return f'"{match.group(1)}, {match.group(2)}";'
    line = re.sub(pattern, fix_quote, line)
```
**Pattern**: `"([^"]*)", ([^;]*);`
**Replacement**: `"\1, \2";` (merge quoted field and following text)
**Comment**: Fix embedded quote in field like "Korshavn", V. Fyns Hoved (line 1710)
**Condition JSON**:
```json
{
  "comment": "Only apply if line has unbalanced quotes",
  "precondition": "line.count('\"') % 2 != 0 and '\", ' in line",
  "line": 43
}
```
**Priority**: 250 (high - fixes critical parsing error)

---

## Pattern 3: Field Count Validation
**Line**: 53
**Type**: `field_count_validation`
**Code**: `expected_fields = 41  # EU Fleet Register has 41 fields`
**Pattern**: `expected_fields=41`
**Replacement**: NULL
**Comment**: EU Fleet Register (DNK) should have exactly 41 fields
**Priority**: 150

---

## Pattern 4: Field Count Mismatch Detection
**Line**: 57
**Type**: `field_count_mismatch`
**Code**: `if line.count(';') != expected_fields - 1:`
**Pattern**: `field_count_mismatch`
**Replacement**: NULL
**Comment**: Detect lines with wrong number of semicolon delimiters
**Priority**: 150

---

## Pattern 5: Custom Quote-Aware Parser (Complex Logic)
**Lines**: 59-82
**Type**: `quote_aware_parser`
**Code**: [Full custom parsing state machine]
**Description**:
- Handles embedded quotes within fields
- Detects double quotes (`""`) for escaping
- Respects semicolon delimiters only outside quotes
- Reconstructs line with correct field boundaries

**Implementation Notes**:
This is **complex procedural logic** similar to ESP parser but with differences:
1. State tracking (`in_quotes` boolean)
2. Character-by-character iteration
3. Double quote escaping detection (check previous character)
4. Conditional reparsing only when field count is wrong

**Pattern**: `custom_quote_parser_dnk`
**Replacement**: NULL
**Comment**: State machine parser for quote-aware field splitting with semicolon delimiter and double-quote escaping
**Priority**: 300 (critical)
**SQL Condition JSON**:
```json
{
  "comment": "Custom quote-aware parser for DNK CSV",
  "delimiter": ";",
  "quote_char": "\"",
  "escape_quote": "\"\"",
  "expected_fields": 41,
  "special_handling": "Detect escaped quotes by checking previous character",
  "state_machine": true,
  "trigger": "Only applies when field count mismatch detected",
  "implementation": "Requires character-by-character parsing with quote state tracking"
}
```

---

## Pattern 6: Field Reconstruction (Join)
**Line**: 81
**Type**: `field_merger`
**Code**: `line = ';'.join(fields)`
**Pattern**: `;` (semicolon delimiter)
**Replacement**: NULL
**Comment**: Reconstruct CSV line with semicolon delimiter after reparsing
**Priority**: 100

---

## Pattern 7: Output Encoding Strategy
**Line**: 93
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Summary
**Total Patterns**: 7
**Critical Patterns**: 2 (embedded quote regex, custom parser)
**Simple Replacements**: 0
**Regex Patterns**: 1
**Complex Logic**: 1 (quote-aware parser with double-quote escaping)
**Validation Rules**: 2
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 2, 5 (fix systematic quote-related parsing errors)
- **Medium Impact**: Patterns 3, 4 (validation)
- **Low Impact**: Patterns 1, 6, 7 (infrastructure)

## Implementation Notes
**Pattern 5 (custom parser) is NOT extractable as a simple SQL rule** - same as ESP but with double-quote escaping logic.
**Pattern 2 (regex) has a precondition** - only applies when line has unbalanced quotes.