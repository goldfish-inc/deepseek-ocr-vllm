# Manual Pattern Extraction: enhanced_worms_kingdom_splitter.py

**Source**: `scripts/legacy-pandas-cleaners/reference/enhanced_worms_kingdom_splitter.py`
**Source Type**: REFERENCE
**Source Name**: WoRMS (World Register of Marine Species)
**Purpose**: Data quality enhancement and partitioned table preparation for WoRMS taxonomic data

---

*(This script was already read earlier - lines 1-277 from system reminder)*

## Pattern 1: File Encoding Strategy
**Line**: 91
**Type**: `encoding_strategy`
**Code**: `open(input_path, 'r', newline='', encoding='utf-8', errors='replace')`
**Pattern**: `encoding=utf-8,errors='replace'`
**Comment**: UTF-8 with error replacement for taxonomic data (handles special characters)
**Priority**: 100

---

## Pattern 2: Column Normalization Function
**Lines**: 58-79
**Type**: `data_transformation` (complex field normalization)
**Code**:
```python
def normalize_columns(line, expected_cols):
    """Normalize line to have exactly expected_cols columns with data cleaning"""
    parts = line.strip().split('\t')

    # Clean each part to handle problematic characters
    cleaned_parts = []
    for part in parts:
        # Remove non-printable characters except tabs and newlines
        cleaned_part = ''.join(char for char in part if char.isprintable() or char in '\t\n')
        # Handle problematic quotes - replace them with single quotes or remove
        cleaned_part = cleaned_part.replace('"', "'").replace('\r', '').replace('\n', ' ')
        cleaned_parts.append(cleaned_part)

    # If we have fewer columns, pad with empty strings
    while len(cleaned_parts) < expected_cols:
        cleaned_parts.append('')

    # If we have more columns, truncate to expected count
    if len(cleaned_parts) > expected_cols:
        cleaned_parts = cleaned_parts[:expected_cols]

    return "\t".join(cleaned_parts)
```
**Patterns**:
1. Remove non-printable characters (except \t, \n)
2. Replace double quotes with single quotes: `"` → `'`
3. Remove carriage returns: `\r` → ``
4. Replace newlines in data: `\n` → ` ` (space)
5. Pad missing columns with empty strings
6. Truncate excess columns

**Comment**: Comprehensive data cleaning for WoRMS taxonomy with field count normalization
**Priority**: 200 (critical for data quality)

---

## Pattern 3: Delimiter Detection
**Line**: Tab-delimited (`\t`)
**Type**: `delimiter_detection`
**Comment**: WoRMS data uses tab delimiter (TSV format)
**Priority**: 150

---

## Pattern 4: Field Count Validation (Adaptive)
**Lines**: 66-69, expected 32 fields
**Type**: `field_count_validation`
**Code**:
```python
# taxon.txt expects 32 fields
expected_cols = 32
```
**Pattern**: `expected_fields=32` for taxon.txt
**Comment**: WoRMS taxon file has 32 tab-separated fields
**Priority**: 150

---

## Pattern 5: Kingdom Distribution Validation
**Lines**: 137-197
**Type**: `pattern_detection` + data validation
**Code**:
```python
def validate_kingdom_distribution(input_path):
    """Validate kingdom distribution in the cleaned taxon file"""
    kingdom_stats = defaultdict(int)

    # Find kingdom column index
    kingdom_index = header_cols.index('kingdom')

    # Count kingdoms
    for line in f:
        cols = line.strip().split('\t')
        if kingdom_index < len(cols):
            kingdom_value = cols[kingdom_index].strip()
            if kingdom_value:
                kingdom_stats[kingdom_value] += 1
            else:
                kingdom_stats['<empty>'] += 1
        else:
            kingdom_stats['<missing>'] += 1

    # Validate we have reasonable kingdoms for partitioning
    main_kingdoms = ['Animalia', 'Bacteria', 'Plantae', 'Fungi', 'Archaea', 'Chromista', 'Protozoa']
    found_main_kingdoms = [k for k in main_kingdoms if k in kingdom_stats and kingdom_stats[k] > 0]
```
**Pattern**: Kingdom value distribution analysis
**Comment**: Validate kingdom field for database partitioning (expect Animalia, Bacteria, etc.)
**Priority**: 150 (validation only)
**Expected kingdoms**: Animalia, Bacteria, Plantae, Fungi, Archaea, Chromista, Protozoa

---

## Pattern 6: Output Encoding Strategy
**Line**: 92 (write)
**Type**: `encoding_strategy`
**Code**: `open(output_path, 'w', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Comment**: Write cleaned WoRMS data with UTF-8
**Priority**: 100

---

## Pattern 7: Progress Indicator
**Lines**: 119-121
**Type**: `logging` (not a cleaning pattern)
**Code**:
```python
if lines_processed % 100000 == 0:
    logger.info(f"   📊 Processed {lines_processed:,} lines...")
```
**Comment**: Log progress every 100,000 lines (WoRMS has millions of records)
**Priority**: 0 (infrastructure only)

---

## Summary
**Total Patterns**: 7 (6 data cleaning + 1 logging)
**Critical Patterns**: 1 (column normalization with comprehensive cleaning)
**Simple Replacements**: 4 (within column normalization)
**Complex Logic**: 1 (column normalization function)
**Validation Rules**: 2 (field count, kingdom distribution)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Pattern 2 (column normalization - handles non-printable chars, quotes, padding, truncation)
- **Medium Impact**: Patterns 4, 5 (field count validation, kingdom validation)
- **Low Impact**: Patterns 1, 3, 6 (infrastructure)

## Key Characteristics
1. **Tab-delimited (TSV)**: WoRMS uses tabs, not commas or semicolons
2. **Large dataset**: Millions of records - requires progress logging
3. **Partitioned table preparation**: Validates kingdom field for PostgreSQL partitioning
4. **Character encoding issues**: Handles non-printable characters and quote problems
5. **Field count enforcement**: Pads or truncates to exactly 32 fields
6. **No custom parser**: Unlike vessel cleaners, uses simple split/join

## SQL-Friendly Patterns

### Pattern 2 (Character cleaning - partial):
```sql
-- Remove carriage returns
SELECT REPLACE(field, E'\r', '');

-- Replace newlines with space
SELECT REPLACE(field, E'\n', ' ');

-- Replace double quotes with single
SELECT REPLACE(field, '"', '''');
```

**Non-printable character removal NOT directly SQL-compatible** - requires regex or procedural code.

### Pattern 4 (Field count validation):
```sql
-- PostgreSQL - count fields
SELECT
  CASE
    WHEN array_length(string_to_array(line, E'\t'), 1) = 32 THEN 'valid'
    ELSE 'invalid'
  END
FROM worms_raw;
```

### Pattern 5 (Kingdom validation):
```sql
-- Count kingdom distribution
SELECT kingdom, COUNT(*) AS count
FROM worms_taxon
GROUP BY kingdom
ORDER BY count DESC;

-- Validate against expected kingdoms
SELECT
  CASE
    WHEN kingdom IN ('Animalia', 'Bacteria', 'Plantae', 'Fungi', 'Archaea', 'Chromista', 'Protozoa')
    THEN 'valid'
    ELSE 'unexpected'
  END AS kingdom_status,
  COUNT(*)
FROM worms_taxon
GROUP BY kingdom_status;
```

## WoRMS-Specific Notes
1. **World Register of Marine Species**: Authoritative taxonomic database for marine organisms
2. **32 fields**: taxon.txt has fixed schema with 32 tab-separated columns
3. **Kingdom-based partitioning**: PostgreSQL partitioned table by kingdom improves query performance
4. **Millions of records**: ~1.5M+ taxa - requires efficient processing
5. **File structure**:
   - `taxon.txt` - main taxonomic data (32 fields)
   - `identifier.txt` - external IDs (6 fields)
   - `speciesprofile.txt` - species traits (6 fields)
   - `vernacularname.txt` - common names (5 fields)

## Implementation Notes
**Pattern 2 (column normalization) is partially SQL-compatible** - simple replacements work in SQL, but non-printable character removal requires regex or procedural code.

**This script is simpler than vessel cleaners** - no quote-aware parsers, just field normalization and validation.

**The kingdom validation (Pattern 5) is unique** - prepares data for PostgreSQL partitioned table by kingdom.