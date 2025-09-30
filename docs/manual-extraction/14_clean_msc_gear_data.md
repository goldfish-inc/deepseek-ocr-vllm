# Manual Pattern Extraction: clean_msc_gear_data.py

**Source**: `scripts/legacy-pandas-cleaners/reference/clean_msc_gear_data.py`
**Source Type**: REFERENCE
**Source Name**: MSC (Marine Stewardship Council) Gear Types + FAO Gear Relationship
**Purpose**: Clean MSC gear data and expand 1:many relationships into 1:1 for UUID-based database import

---

## Function 1: clean_msc_gear_types() - Lines 20-57

### Pattern 1: String Trimming
**Line**: 36
**Type**: `string_replace`
**Code**: `df_msc['msc_gear'] = df_msc['msc_gear'].astype(str).str.strip()`
**Pattern**: Leading/trailing whitespace
**Replacement**: `` (stripped)
**Comment**: Clean MSC gear type names (e.g., " Midwater trawl" → "Midwater trawl")
**Priority**: 150

### Pattern 2: Null Value Removal
**Lines**: 39-40
**Type**: `data_filtering`
**Code**:
```python
df_msc = df_msc.dropna(subset=['msc_gear'])
df_msc = df_msc[df_msc['msc_gear'] != '']
```
**Pattern**: Null/empty string removal
**Comment**: Remove rows with missing or empty gear names
**Priority**: 150

### Pattern 3: Duplicate Removal
**Line**: 41
**Type**: `duplicate_detection`
**Code**: `df_msc = df_msc.drop_duplicates(subset=['msc_gear'])`
**Pattern**: Duplicate MSC gear names
**Comment**: Ensure each MSC gear type appears only once
**Priority**: 150

---

## Function 2: process_msc_fao_relationship() - Lines 59-135

### Pattern 4: Semicolon-Delimited List Expansion
**Lines**: 80-101
**Type**: `string_split` + row expansion
**Code**:
```python
for _, row in df_rel.iterrows():
    msc_gear = row['msc_gear']
    fao_codes = row['fao_isscfg_alpha']

    # Split by '; ' delimiter
    if '; ' in fao_codes:
        codes = [code.strip() for code in fao_codes.split('; ')]
        for code in codes:
            if code:  # Skip empty codes
                expanded_rows.append({
                    'msc_gear': msc_gear,
                    'fao_isscfg_alpha': code
                })
    else:
        # Single code
        expanded_rows.append({
            'msc_gear': msc_gear,
            'fao_isscfg_alpha': fao_codes
        })
```
**Pattern**: `; ` (semicolon + space delimiter)
**Transformation**: 1:many → 1:1 (row duplication)
**Comment**: Expand multi-value FAO code field into separate rows
**Priority**: 200 (critical for data normalization)
**Example**:
- Input: `msc_gear="Midwater trawl"`, `fao_isscfg_alpha="FPN; OTM; PTM"`
- Output: 3 rows:
  - `msc_gear="Midwater trawl"`, `fao_isscfg_alpha="FPN"`
  - `msc_gear="Midwater trawl"`, `fao_isscfg_alpha="OTM"`
  - `msc_gear="Midwater trawl"`, `fao_isscfg_alpha="PTM"`

### Pattern 5: Trimming After Split
**Line**: 89
**Type**: `string_replace`
**Code**: `codes = [code.strip() for code in fao_codes.split('; ')]`
**Pattern**: Leading/trailing whitespace after split
**Replacement**: `` (stripped)
**Comment**: Clean FAO codes after splitting (handles "FPN ; OTM" variations)
**Priority**: 100

### Pattern 6: Empty Code Filtering
**Line**: 91
**Type**: `data_filtering`
**Code**: `if code:  # Skip empty codes`
**Pattern**: Empty string after split
**Comment**: Skip empty codes from trailing/double delimiters
**Priority**: 100

### Pattern 7: Duplicate Removal (Relationship)
**Line**: 107
**Type**: `duplicate_detection`
**Code**: `df_expanded = df_expanded.drop_duplicates(subset=['msc_gear', 'fao_isscfg_alpha'])`
**Pattern**: Duplicate msc_gear + fao_isscfg_alpha pairs
**Comment**: Remove duplicate relationships after expansion
**Priority**: 150

---

## Pattern 8: File Encoding Strategy
**Lines**: 30, 48, 69, 114
**Type**: `encoding_strategy`
**Code**: `encoding='utf-8'`
**Pattern**: `encoding=utf-8`
**Comment**: Standard UTF-8 for gear type names (may contain special characters)
**Priority**: 100

---

## Summary
**Total Patterns**: 8
**Critical Patterns**: 2 (semicolon list expansion, duplicate removal)
**Simple Replacements**: 2 (string trimming, empty filtering)
**Complex Logic**: 1 (1:many relationship expansion)
**Duplicate Detection**: 2 (gear names, relationships)
**Data Filtering**: 2 (null removal, empty code filtering)
**Encoding Rules**: 1

## Data Quality Impact
- **High Impact**: Patterns 4, 7 (list expansion, relationship deduplication) - **fundamental data normalization**
- **Medium Impact**: Patterns 1, 2, 3 (trimming, null removal, gear deduplication)
- **Low Impact**: Patterns 5, 6, 8 (infrastructure)

## Key Characteristics
1. **Data normalization**: Converts 1:many relationships into 1:1 (database 1NF - First Normal Form)
2. **Delimiter-based expansion**: Semicolon-space delimiter for multi-value fields
3. **UUID-ready**: Removes manual ID generation, prepares for database UUID handling
4. **Relationship table**: Prepares join table for many-to-many relationship
5. **Defensive filtering**: Handles nulls, empties, duplicates, and malformed delimiters

## SQL-Friendly Patterns

### Pattern 1 (String trimming):
```sql
SELECT TRIM(msc_gear);
```

### Pattern 2 (Null removal):
```sql
WHERE msc_gear IS NOT NULL AND msc_gear != '';
```

### Pattern 3 & 7 (Duplicate removal):
```sql
SELECT DISTINCT msc_gear;
SELECT DISTINCT msc_gear, fao_isscfg_alpha;
```

### Pattern 4 (Semicolon list expansion):
**This is more complex in SQL but possible**:
```sql
-- PostgreSQL
SELECT
  msc_gear,
  TRIM(unnest(string_to_array(fao_isscfg_alpha, '; '))) AS fao_isscfg_alpha
FROM gear_relationships
WHERE TRIM(unnest(string_to_array(fao_isscfg_alpha, '; '))) != '';
```

Or using LATERAL JOIN:
```sql
SELECT
  msc_gear,
  TRIM(code) AS fao_isscfg_alpha
FROM gear_relationships,
  LATERAL unnest(string_to_array(fao_isscfg_alpha, '; ')) AS code
WHERE TRIM(code) != '';
```

## Data Model
**Input tables**:
1. `gearTypes_msc.csv` - MSC gear type names
2. `gearTypes_msc_fao_relationship.csv` - MSC → FAO gear mappings (with multi-value FAO field)

**Output tables**:
1. `cleaned_gear_types_msc.csv` - Cleaned MSC gear names (unique)
2. `cleaned_gear_types_fao_msc_relationship.csv` - Expanded 1:1 relationships

**Relationship expansion example**:
```
Input (1 row):
msc_gear="Midwater trawl", fao_isscfg_alpha="FPN; OTM; PTM"

Output (3 rows):
msc_gear="Midwater trawl", fao_isscfg_alpha="FPN"
msc_gear="Midwater trawl", fao_isscfg_alpha="OTM"
msc_gear="Midwater trawl", fao_isscfg_alpha="PTM"
```

## Implementation Notes
**Pattern 4 (semicolon list expansion) is the most important pattern** - it converts a denormalized multi-value field into proper relational format.

**This transformation is essential for database normalization** - multi-value fields in CSV must be split into separate rows for proper foreign key relationships.

**SQL implementation is more complex** but achievable using PostgreSQL's `unnest(string_to_array())` or similar functions in other databases.