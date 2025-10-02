# Pandas Knowledge Extraction Summary

**Date**: 2025-09-30
**Issue**: #47
**Status**: ✅ Complete

## Overview

Successfully extracted cleaning patterns from 7 legacy pandas scripts into SQL rules for the staging database pipeline.

## What Was Accomplished

### 1. Migration from @ebisu → @oceanid

**Scripts migrated** (7 total):

- `country/clean_esp_vessels.py` - Spanish locale (quote fixes, port names)
- `country/clean_dnk_robust.py` - Danish/Nordic patterns
- `country/clean_bgr_robust.py` - Bulgarian Cyrillic handling
- `rfmo/local_clean_all.py` - RFMO orchestrator (whitespace, encoding)
- `reference/clean_asfis.py` - FAO species taxonomy
- `reference/clean_reference_data.py` - Country codes, gear types
- `reference/clean_msc_gear_data.py` - Marine Stewardship Council gear

**Data migrated** (18MB):

- 15 RFMO vessel CSVs (ICCAT, IOTC, WCPFC, etc.)
- 1 SEAFO PDF (133KB - will test Docling-Granite extraction)
- 2 Excel files (IATTC, IOTC - legacy formats)

### 2. Extraction Tool

Built `scripts/extract-knowledge/extract_pandas_patterns.py`:

**Features**:

- AST-based Python parser (no regex on source code)
- Extracts:
  - `re.sub()` patterns → `regex_replace` rules
  - `str.replace()` calls → `string_replace` or `quote_fix` rules
  - `re.findall/search()` → `pattern_detection` rules
- Captures inline comments for context
- Determines source type/name from file path
- Generates priority scores (higher = more specific)

**Usage**:

```bash
python scripts/extract-knowledge/extract_pandas_patterns.py \
  --input scripts/legacy-pandas-cleaners/ \
  --output sql/seed_cleaning_rules.sql
```

### 3. Extraction Results

**Total patterns**: 18 rules across 3 categories

| Rule Type | Count | Examples |
|-----------|-------|----------|
| `string_replace` | 11 | Direct find/replace (whitespace, encoding fixes) |
| `quote_fix` | 2 | Locale-specific quote mismatches (ES, BGR) |
| `regex_replace` | 2 | Pattern-based transformations (DNK Nordic quotes) |
| `pattern_detection` | 3 | Issue detection patterns (Cyrillic mismatches) |

**Generated output**: `sql/seed_cleaning_rules.sql`

## Sample Extracted Rules

### Bulgarian Cyrillic Quote Fix

```sql
INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_bgr_quote_fix_0',
  'quote_fix',
  'COUNTRY',
  'EU_BGR',
  'СВ",НИКОЛА',           -- Cyrillic with misplaced quote
  'СВ,НИКОЛА',            -- Corrected version
  '{"comment": "The specific pattern mentioned in error: СВ",НИКОЛА", "line": 15}',
  250,                     -- High priority (source-specific)
  'clean_bgr_robust.py:15',
  TRUE
);
```

### Danish Nordic Quote Pattern

```sql
INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'country_eu_dnk_regex_replace_0',
  'regex_replace',
  'COUNTRY',
  'EU_DNK',
  '(;[^;]*)",([ ][^;]*)',  -- Matches: ;"Port Name", City
  '\\1,\\2',                -- Result: ;Port Name, City
  '{"comment": "Find and fix ALL instances of quotes before commas in Danish place names", "line": 15}',
  150,                      -- Medium priority (country-specific)
  'clean_dnk_robust.py:15',
  TRUE
);
```

### RFMO Whitespace Normalization

```sql
INSERT INTO stage.cleaning_rules (
  rule_name, rule_type, source_type, source_name,
  pattern, replacement, condition, priority,
  extracted_from_script, enabled
) VALUES (
  'rfmo_all_string_replace_0',
  'string_replace',
  'RFMO',
  'ALL',
  '  ',                     -- Double space
  ' ',                      -- Single space
  '{"comment": "Collapse whitespace", "line": 13}',
  100,                      -- Standard priority (applies to all)
  'local_clean_all.py:13',
  TRUE
);
```

## Priority System

Rules are assigned priority scores to control application order:

| Priority | Rule Type | Description |
|----------|-----------|-------------|
| 300 | Exact match | Specific location/value (e.g., "Caleta Del Sebo") |
| 200-250 | Locale-specific | Country/language-specific patterns (quote fixes) |
| 150 | Source-specific | RFMO/Country-specific (applies to one source) |
| 100 | General | Applies to all sources (whitespace, encoding) |

**Application order**: Higher priority first (300 → 100)

## Integration with ML Pipeline

### Current State (Pandas Scripts)

```
Raw CSV → Manual script → Cleaned CSV → @ebisu DB
  ↓           ↓              ↓
  18MB      Sequential    One-time application
            Python         (no learning)
```

### Future State (ML Pipeline)

```
Raw CSV → Docling-Granite → Apply cleaning_rules → ML confidence → Review
  ↓            ↓                    ↓                    ↓            ↓
  18MB     Structure          Parallel GPU       >95% auto     <5% flagged
          extraction         rule matching        cleaned        for human
```

### Benefits

1. **Codified knowledge**: Tribal knowledge now versioned in database
2. **Measurable**: Track rule effectiveness (`times_applied`, `success_rate`)
3. **Improvable**: Human corrections update rule confidence
4. **Scalable**: GPU-accelerated vs single-threaded pandas
5. **Transparent**: Full audit trail (which rules applied, when, why)

## Next Steps

### Phase 1: Deploy Staging DB (#46)

```sql
CREATE TABLE stage.cleaning_rules (
  id UUID PRIMARY KEY,
  rule_name TEXT UNIQUE,
  rule_type TEXT,
  source_type TEXT,
  source_name TEXT,
  pattern TEXT,
  replacement TEXT,
  condition JSONB,
  priority INTEGER,
  times_applied INTEGER DEFAULT 0,
  success_rate FLOAT,
  extracted_from_script TEXT,
  enabled BOOLEAN
);

-- Load extracted rules
\i sql/seed_cleaning_rules.sql
```

### Phase 2: Apply Rules in Ingestion Worker (#48)

```python
# Fetch rules for source
rules = await db.fetch("""
  SELECT * FROM stage.cleaning_rules
  WHERE enabled = TRUE
    AND (source_type = $1 OR source_type = 'ALL')
    AND (source_name = $2 OR source_name IS NULL)
  ORDER BY priority DESC
""", 'COUNTRY', 'EU_ESP')

# Apply in priority order
for rule in rules:
    if rule['rule_type'] == 'regex_replace':
        cleaned_value = re.sub(rule['pattern'], rule['replacement'], cell_value)
        # Track effectiveness
        await db.execute("""
          UPDATE stage.cleaning_rules
          SET times_applied = times_applied + 1
          WHERE id = $1
        """, rule['id'])
```

### Phase 3: Measure Effectiveness

```sql
-- Rule effectiveness report
SELECT rule_name, rule_type, times_applied, success_rate,
       ROUND(times_applied * success_rate) as successful_applications
FROM stage.cleaning_rules
WHERE enabled = TRUE
ORDER BY successful_applications DESC
LIMIT 20;
```

### Phase 4: Train ML Model (#49)

```python
# Use extracted rules as training data seed
training_examples = []
for rule in rules:
    # Generate synthetic examples
    example = {
        'input': apply_corruption(rule['pattern']),
        'expected': rule['replacement'],
        'label': rule['rule_type']
    }
    training_examples.append(example)

# Fine-tune csv-repair-bert
model = train_model(training_examples, base_model='distilbert-base-uncased')
```

## Files Changed

- `scripts/legacy-pandas-cleaners/` - 7 Python files (6,235 lines)
- `data/raw/vessels/RFMO/` - 18 data files (18MB)
- `scripts/extract-knowledge/extract_pandas_patterns.py` - 356 lines
- `sql/seed_cleaning_rules.sql` - 18 rules (243 lines)

**Total**: 28 files, +48,978 lines

## Validation

### Test Extraction

```bash
# Run extraction
python scripts/extract-knowledge/extract_pandas_patterns.py

# Expected output:
# Found 7 Python files
# Total patterns extracted: 18
# Rule type breakdown:
#   pattern_detection: 3
#   quote_fix: 2
#   regex_replace: 2
#   string_replace: 11
```

### Verify SQL Syntax

```bash
# Check SQL is valid (requires psql)
psql -d test -f sql/seed_cleaning_rules.sql --dry-run
```

### Sample Rules

```bash
# Preview first 80 lines
head -80 sql/seed_cleaning_rules.sql
```

## Lessons Learned

1. **AST parsing is robust**: No issues parsing 7 different script styles
2. **Comments are gold**: Inline comments captured critical context
3. **Priority matters**: Source-specific rules must override general rules
4. **18 rules is a good start**: Enough to validate pipeline, not overwhelming
5. **More patterns exist**: Some complex logic not captured by AST (nested loops, stateful parsers)

## Future Improvements

1. **Extract more patterns**: Conditional logic, loop-based replacements
2. **Synthetic data generation**: Use extracted patterns to corrupt clean CSVs
3. **Rule relationships**: Some rules depend on others (order matters)
4. **Confidence scoring**: Weight rules by historical success rate
5. **Active learning**: Flag ambiguous cases for human labeling

## References

- **GitHub Issue**: #47
- **Commits**:
  - 671a1d4 (docs update)
  - 08a33db (extraction implementation)
- **Related Issues**: #46 (staging DB), #48 (ingestion worker), #49 (ML training)
- **Legacy Scripts**: @ebisu/backend/scripts/import/ (preserved for reference)
