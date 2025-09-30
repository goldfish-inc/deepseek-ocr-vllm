# Manual Pattern Extraction: clean_dnk_final.py

**Source**: `scripts/legacy-pandas-cleaners/country/clean_dnk_final.py`
**Source Type**: COUNTRY
**Source Name**: EU_DNK
**Purpose**: Final comprehensive DNK cleaner with known quote patterns and field padding

---

## Pattern 1: File Encoding Strategy
**Line**: 19
**Type**: `encoding_strategy`
**Code**: `open(input_file, 'r', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors=replace`
**Replacement**: NULL
**Comment**: Handle Danish characters with UTF-8, replace invalid bytes
**Priority**: 100

---

## Pattern 2: Line Ending Normalization
**Line**: 20
**Type**: `string_replace`
**Code**: `lines = [line.rstrip('\n\r') for line in f]`
**Pattern**: `\n\r` (newline and carriage return)
**Replacement**: `` (stripped)
**Comment**: Strip trailing newlines and carriage returns
**Priority**: 100

---

## Pattern 3-12: Known Danish Port Quote Fixes (10 patterns)
**Lines**: 30-41
**Type**: `quote_fix` (multiple specific patterns)
**Code**:
```python
quote_fixes = [
    ('Korshavn", V. Fyns Hoved', 'Korshavn, V. Fyns Hoved'),
    ('Østerby", Læsø', 'Østerby, Læsø'),
    ('Hadsund", Øster Hurup', 'Hadsund, Øster Hurup'),
    ('Nykøbing", Mors', 'Nykøbing, Mors'),
    ('Rønne", Bornholm', 'Rønne, Bornholm'),
    ('Thyborøn", Lemvig', 'Thyborøn, Lemvig'),
    ('Nexø", Bornholm', 'Nexø, Bornholm'),
    ('Nørre", Nissum', 'Nørre, Nissum'),
    ('Hvide", Sande', 'Hvide, Sande'),
    ('Strib", Middelfart', 'Strib, Middelfart'),
]
```

**Individual Patterns**:

### Pattern 3: Korshavn Quote Fix
**Pattern**: `Korshavn", V. Fyns Hoved`
**Replacement**: `Korshavn, V. Fyns Hoved`
**Comment**: Fix quote in Danish port name with location specifier
**Priority**: 250

### Pattern 4: Østerby Quote Fix
**Pattern**: `Østerby", Læsø`
**Replacement**: `Østerby, Læsø`
**Comment**: Fix quote in Danish port name with island specifier (Læsø)
**Priority**: 250

### Pattern 5: Hadsund Quote Fix
**Pattern**: `Hadsund", Øster Hurup`
**Replacement**: `Hadsund, Øster Hurup`
**Comment**: Fix quote in Danish port name with regional specifier
**Priority**: 250

### Pattern 6: Nykøbing Quote Fix
**Pattern**: `Nykøbing", Mors`
**Replacement**: `Nykøbing, Mors`
**Comment**: Fix quote in Danish port name with island specifier (Mors)
**Priority**: 250

### Pattern 7: Rønne Quote Fix
**Pattern**: `Rønne", Bornholm`
**Replacement**: `Rønne, Bornholm`
**Comment**: Fix quote in Danish port name with island specifier (Bornholm)
**Priority**: 250

### Pattern 8: Thyborøn Quote Fix
**Pattern**: `Thyborøn", Lemvig`
**Replacement**: `Thyborøn, Lemvig`
**Comment**: Fix quote in Danish port name with municipality specifier
**Priority**: 250

### Pattern 9: Nexø Quote Fix
**Pattern**: `Nexø", Bornholm`
**Replacement**: `Nexø, Bornholm`
**Comment**: Fix quote in Danish port name with island specifier (Bornholm)
**Priority**: 250

### Pattern 10: Nørre Quote Fix
**Pattern**: `Nørre", Nissum`
**Replacement**: `Nørre, Nissum`
**Comment**: Fix quote in Danish port name with regional specifier
**Priority**: 250

### Pattern 11: Hvide Quote Fix
**Pattern**: `Hvide", Sande`
**Replacement**: `Hvide, Sande`
**Comment**: Fix quote in Danish port name (Hvide Sande)
**Priority**: 250

### Pattern 12: Strib Quote Fix
**Pattern**: `Strib", Middelfart`
**Replacement**: `Strib, Middelfart`
**Comment**: Fix quote in Danish port name with municipality specifier
**Priority**: 250

---

## Pattern 13: Field Count Validation (Dynamic)
**Line**: 24
**Type**: `field_count_validation`
**Code**: `expected_fields = header.count(';') + 1`
**Pattern**: `dynamic_field_count` (based on header)
**Replacement**: NULL
**Comment**: Determine expected field count from header semicolon count
**Priority**: 150
**Implementation Notes**: **Dynamic validation** - adapts to actual header structure

---

## Pattern 14: Field Count Too Few - Padding
**Lines**: 58-61
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

## Pattern 15: Field Count Too Many - Truncation
**Lines**: 64-71
**Type**: `field_count_too_many`
**Code**:
```python
elif field_count > expected_fields:
    parts = line.split(';')
    if len(parts) > expected_fields:
        parts = parts[:expected_fields]
        line = ';'.join(parts)
```
**Pattern**: `field_count_too_many`
**Replacement**: Truncate to expected field count
**Comment**: Remove excess fields (likely from unescaped semicolons)
**Priority**: 150
**Warning**: **May lose data** - truncates without analysis

---

## Pattern 16: Output Encoding Strategy
**Line**: 76
**Type**: `encoding_strategy`
**Code**: `open(output_file, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding
**Priority**: 100

---

## Summary
**Total Patterns**: 16
**Critical Patterns**: 10 (all Danish port quote fixes)
**Simple Replacements**: 10 (quote fixes)
**Complex Logic**: 0
**Validation Rules**: 3 (dynamic field count, too few, too many)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 3-12, 14, 15 (known port fixes, field padding/truncation)
- **Medium Impact**: Pattern 13 (dynamic validation)
- **Low Impact**: Patterns 1, 2, 16 (infrastructure)

## Key Differences from clean_dnk_vessels.py and clean_dnk_robust.py
1. **No custom parser**: Uses simple string replacement for known patterns
2. **Hardcoded port names**: 10 specific Danish port/location combinations
3. **Dynamic field count**: Adapts to header structure instead of assuming 41 fields
4. **Simpler logic**: No quote-aware state machine parsing
5. **Known data approach**: Assumes specific problem patterns are documented

## Pattern Analysis - Danish Naming Convention
All quote fixes follow the pattern: `Port", Location` where:
- **Port**: Main port/town name (often with Danish characters: ø, å)
- **Location**: Island, municipality, or regional specifier
- **Issue**: Quote before comma splits CSV field incorrectly

**Common location specifiers**:
- Islands: Læsø, Mors, Bornholm
- Regions: V. Fyns Hoved, Øster Hurup, Nissum
- Municipalities: Lemvig, Middelfart

## Implementation Notes
**This script assumes knowledge of the specific dataset** - it has a hardcoded list of 10 problematic port name patterns. This is:
- **Brittle**: Won't catch new port name issues in updated datasets
- **Fast**: No complex parsing, just string replacement
- **Maintainable**: Easy to add new patterns to the list
- **Dataset-specific**: Requires manual inspection to identify patterns

**Recommendation**: This approach should be combined with:
1. Pattern detection (like clean_dnk_robust.py regex patterns)
2. OR custom parser (like clean_dnk_vessels.py) for unknown patterns