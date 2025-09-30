# Legacy Pandas Cleaning Scripts

**Purpose**: Historical CSV cleaning scripts extracted from @ebisu for knowledge mining.

These scripts represent **tribal knowledge** developed through manual iteration on real-world data quality issues. They will be parsed to extract cleaning patterns into the `stage.cleaning_rules` database table for automated application in the ML pipeline.

## Directory Structure

```
legacy-pandas-cleaners/
├── country/          # Country vessel registry cleaners
│   ├── clean_esp_vessels.py      # Spanish locale: quote fixes, port names
│   ├── clean_dnk_robust.py       # Danish/Nordic: quote patterns
│   └── clean_bgr_robust.py       # Bulgarian registry
├── rfmo/             # RFMO vessel data cleaners
│   └── local_clean_all.py        # Orchestrator for 9 RFMOs
└── reference/        # Reference data cleaners
    ├── clean_asfis.py            # FAO species taxonomy
    ├── clean_reference_data.py   # Country codes, gear types
    └── clean_msc_gear_data.py    # Marine Stewardship Council gear

Total: 7 scripts encoding ~50-100 unique cleaning patterns
```

## Pattern Categories

### 1. Locale-Specific Fixes
**Example**: Spanish place names with embedded quotes
```python
# From clean_esp_vessels.py:49
spanish_article_pattern = r'([^;"]+)", (La|El|Los|Las|L\')\s'
# "Caleta Del Sebo", La → Caleta Del Sebo, La
```

### 2. Quote Escaping
**Example**: Nordic quotes before commas
```python
# From clean_dnk_robust.py:15
pattern = r'(;[^;]*)",([ ][^;]*)'
# ;"Port Name", City → ;Port Name, City
```

### 3. Field Delimiter Repairs
**Example**: Field count validation
```python
# From clean_esp_vessels.py:66
expected_fields = 41
if len(fields) != expected_fields:
    # Attempt to merge/split fields
```

### 4. Encoding Fixes
**Example**: UTF-8 handling for special characters
```python
# From clean_esp_vessels.py:27
with open(input_file, 'r', encoding='utf-8', errors='replace')
```

### 5. Whitespace Normalization
**Example**: Collapse multiple spaces
```python
# From local_clean_all.py:12
def collapse_whitespace(value: str) -> str:
    return " ".join(value.split())
```

## Usage in ML Pipeline

These scripts are **read-only** for knowledge extraction. They will:

1. **Parse**: AST analysis to extract regex patterns, string replacements, conditions
2. **Categorize**: Group into rule types (regex_replace, quote_fix, delimiter_repair, etc.)
3. **Store**: Insert into `stage.cleaning_rules` with source line references
4. **Apply**: CSV ingestion worker applies rules in priority order
5. **Improve**: Human corrections feed back to update rule effectiveness

## Extraction Process

See `scripts/extract-knowledge/extract_pandas_patterns.py` for automated extraction.

```bash
# Extract all patterns into SQL
python scripts/extract-knowledge/extract_pandas_patterns.py \
  --input scripts/legacy-pandas-cleaners/ \
  --output sql/seed_cleaning_rules.sql

# Expected output: ~50-100 INSERT statements
```

## Migration Path

- **Phase 1** (Current): Copy scripts, extract patterns → rules table
- **Phase 2**: Apply rules in ML pipeline, measure effectiveness
- **Phase 3**: Fine-tune csv-repair-bert model on extracted patterns
- **Phase 4**: Retire scripts once ML model achieves >95% accuracy

## Original Location

Copied from: `@ebisu/backend/scripts/import/` (2025-09-30)

These scripts remain in @ebisu for now but will be deprecated once the ML pipeline is validated to match or exceed their cleaning accuracy.

## Related Issues

- #47: Extract pandas cleaning patterns into knowledge base
- #48: CSV ingestion worker (applies extracted rules)
- #49: Train csv-repair-bert model on extracted patterns