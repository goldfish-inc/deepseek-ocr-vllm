# Manual Pattern Extraction: clean_esp_vessels.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_esp_vessels.py`
**Source Type**: COUNTRY
**Source Name**: EU_ESP
**Purpose**: Clean Spanish vessel CSV with specific formatting issues

---

## Pattern 1: File Encoding Strategy
**Line**: 27
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Read with UTF-8 to handle Spanish characters
**Priority**: 100

---

## Pattern 2: Specific String Replacement (Caleta Del Sebo)
**Line**: 44
**Type**: `quote_fix`
**Code**: `line.replace('Caleta Del Sebo", La', 'Caleta Del Sebo, La')`
**Pattern**: `Caleta Del Sebo", La`
**Replacement**: `Caleta Del Sebo, La`
**Comment**: Fix Caleta Del Sebo quote issue - line 8359 in original data
**Priority**: 250 (source-specific + quote fix)

---

## Pattern 3: Regex - Spanish Article Pattern
**Line**: 49-56
**Type**: `regex_replace`
**Code**:
```python
spanish_article_pattern = r'([^;"]+)", (La|El|Los|Las|L\')\s'
matches = re.findall(spanish_article_pattern, line)
if matches:
    for place, article in matches:
        old_pattern = f'{place}", {article}'
        new_pattern = f'{place}, {article}'
        line = line.replace(old_pattern, new_pattern)
```
**Pattern**: `([^;"]+)", (La|El|Los|Las|L')\s`
**Replacement**: `\1, \2` (capture groups)
**Comment**: Fix quote before Spanish articles (La/El/Los/Las/L')
**Priority**: 200 (high - handles systematic Spanish location names)

---

## Pattern 4: Regex - Port Name Pattern
**Line**: 60-62
**Type**: `regex_replace`
**Code**:
```python
port_pattern = r'"(Puerto[^"]*)", (Bahía|Isla|Costa|Playa)'
if re.search(port_pattern, line):
    line = re.sub(port_pattern, r'"\1, \2', line)
```
**Pattern**: `"(Puerto[^"]*)", (Bahía|Isla|Costa|Playa)`
**Replacement**: `"\1, \2` (keeps quotes, fixes comma)
**Comment**: Fix port names with embedded commas (Puerto/Bahía/Isla/Costa/Playa)
**Priority**: 200

---

## Pattern 5: Field Count Validation
**Line**: 66
**Type**: `field_count_validation`
**Code**: `expected_fields = 41`
**Pattern**: `expected_fields=41`
**Replacement**: NULL
**Comment**: ESP vessel CSV should have exactly 41 fields
**Priority**: 150

---

## Pattern 6: Field Count Mismatch Detection
**Line**: 111-112
**Type**: `field_count_mismatch`
**Code**:
```python
elif len(fields) != expected_fields:
    problem_lines.append((line_num, f"Field count: {len(fields)} vs expected {expected_fields}"))
```
**Pattern**: `field_count_mismatch`
**Replacement**: NULL
**Comment**: Log lines where field count doesn't match expected 41
**Priority**: 150

---

## Pattern 7: Custom Quote-Aware Parser (Complex Logic)
**Lines**: 68-106
**Type**: `quote_aware_parser`
**Code**: [Full custom parsing state machine]
**Description**:
- Handles nested quotes within fields
- Respects semicolon delimiters only outside quotes
- Detects escaped quotes (`""`)
- Removes misplaced quotes before Spanish articles
- Reconstructs line with correct field boundaries

**Implementation Notes**:
This is **complex procedural logic** that cannot be represented as a simple regex or string replacement. It requires:
1. State tracking (`in_quotes` boolean)
2. Character-by-character iteration
3. Lookahead checking for context
4. Conditional quote removal based on surrounding characters

**Pattern**: `custom_quote_parser_esp`
**Replacement**: NULL
**Comment**: State machine parser for quote-aware field splitting with semicolon delimiter and Spanish article detection
**Priority**: 300 (critical - this is the core cleaning logic)
**SQL Condition JSON**:
```json
{
  "comment": "Custom quote-aware parser for ESP CSV",
  "delimiter": ";",
  "quote_char": "\"",
  "escape_quote": "\"\"",
  "expected_fields": 41,
  "special_handling": "Remove quotes before Spanish articles (La/El/Los/Las) within fields",
  "state_machine": true,
  "implementation": "Requires character-by-character parsing with quote state tracking"
}
```

---

## Pattern 8: Field Reconstruction (Join)
**Line**: 110
**Type**: `field_merger`
**Code**: `line = ';'.join(fields)`
**Pattern**: `;` (semicolon delimiter)
**Replacement**: NULL
**Comment**: Reconstruct CSV line with semicolon delimiter after parsing
**Priority**: 100

---

## Pattern 9: Output Encoding Strategy
**Line**: 123
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Summary
**Total Patterns**: 9
**Critical Patterns**: 3 (Spanish article regex, port pattern regex, custom parser)
**Simple Replacements**: 1
**Regex Patterns**: 2
**Complex Logic**: 1 (quote-aware parser - **requires procedural implementation**)
**Validation Rules**: 2
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 3, 4, 7 (handle systematic Spanish naming issues)
- **Medium Impact**: Patterns 2, 5, 6 (specific fixes and validation)
- **Low Impact**: Patterns 1, 8, 9 (infrastructure)

## Implementation Notes
**Pattern 7 (custom parser) is NOT extractable as a simple SQL rule**. Options:
1. Implement as UDF (User-Defined Function) in PostgreSQL with PL/pgSQL
2. Implement as Python UDF via pl/python3u extension
3. Keep as pre-processing step in Python worker before SQL ingestion
4. Document as "complex parsing requirement" in cleaning_rules with reference implementation