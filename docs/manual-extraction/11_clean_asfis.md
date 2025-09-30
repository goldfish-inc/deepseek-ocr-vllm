# Manual Pattern Extraction: clean_asfis.py

**Source**: `scripts/legacy-pandas-cleaners/reference/clean_asfis.py`
**Source Type**: REFERENCE
**Source Name**: ASFIS (Step 2 of pipeline)
**Purpose**: Rule-based cleaning of preprocessed ASFIS data (after clean_asfis_data.py)

---

## Pattern 1: File Encoding Strategy (BOM Handling)
**Line**: 81
**Type**: `encoding_strategy`
**Code**: `open(INPUT, 'r', newline='', encoding='utf-8-sig')`
**Pattern**: `encoding=utf-8-sig`
**Replacement**: NULL
**Comment**: UTF-8 with BOM (Byte Order Mark) removal - handles Excel exports
**Priority**: 100
**Special Notes**: `-sig` suffix automatically strips BOM if present

---

## Pattern 2: Header Space-to-Underscore Normalization
**Lines**: 83-84, 126
**Type**: `string_replace`
**Code**:
```python
# CSV version
header_map = {h: h.strip().replace(' ', '_') for h in reader.fieldnames}

# Pandas version
df.columns = df.columns.str.strip().str.replace(" ", "_")
```
**Pattern**: ` ` (space in headers)
**Replacement**: `_` (underscore)
**Comment**: Standardize column names for database compatibility
**Priority**: 150

---

## Pattern 3: Parenthetical Content Removal from Scientific Names
**Lines**: 69, 134
**Type**: `regex_replace`
**Code**:
```python
# CSV version
name = re.sub(r'\([^)]*\)', '', name)

# Pandas version
df['scientificName'] = df['scientificName'].str.replace(r'\([^)]*\)', '', regex=True).str.strip()
```
**Pattern**: `\([^)]*\)` (any content in parentheses)
**Replacement**: `` (empty string)
**Comment**: Remove remaining parenthetical content (subgenus names, notes)
**Priority**: 200
**Examples**:
- `Holothuria (Stichothuria) coronopertusa` → `Holothuria  coronopertusa`
- `Alitta virens (formerly Nereis virens)` → `Alitta virens`

---

## Pattern 4: Whitespace Normalization
**Lines**: 70, 136
**Type**: `regex_replace`
**Code**:
```python
# CSV version
name = re.sub(r'\s+', ' ', name)

# Pandas version
df['scientificName'] = df['scientificName'].str.replace(r'\s+', ' ', regex=True)
```
**Pattern**: `\s+` (multiple whitespace characters)
**Replacement**: ` ` (single space)
**Comment**: Collapse multiple spaces (often left after parenthesis removal)
**Priority**: 100

---

## Pattern 5: Taxonomic Rank Normalization (14 mappings)
**Lines**: 46-60, 142-157
**Type**: `lookup_table`
**Mappings**:
```python
rank_mappings = {
    'species': 'Species',
    'genus': 'Genus',
    'family': 'Family',
    'order': 'Order',
    'class': 'Class',
    'phylum': 'Phylum',
    'kingdom': 'Kingdom',
    'subfamily': 'Subfamily',
    'suborder': 'Suborder',
    'infraorder': 'Infraorder',
    'superorder': 'Superorder',
    'tribe': 'Tribe',
    'subspecies': 'Subspecies'
}
```
**Pattern**: Lowercase taxonomic ranks
**Replacement**: Capitalized versions
**Comment**: Standardize taxonomic rank capitalization
**Priority**: 150
**Implementation**: CSV lookup or SQL CASE statement

---

## Pattern 6: Word Capitalization Function
**Lines**: 73-77, 161-183
**Type**: `string_replace` (functional transformation)
**Code**:
```python
def capitalize_words(value: str) -> str:
    return ' '.join(word.capitalize() for word in value.split())
```
**Pattern**: Lowercase or UPPERCASE words in Family and Order fields
**Replacement**: Capitalized (first letter upper, rest lower)
**Comment**: Proper case for taxonomic names
**Priority**: 150
**Application**: Applied to `Family` and `Order_or_higher_taxa` fields
**Examples**:
- `SALMONIDAE` → `Salmonidae`
- `salmonidae` → `Salmonidae`
- `GADIFORMES` → `Gadiformes`

---

## Pattern 7: Boolean Normalization (YES/NO → True/False)
**Lines**: 79, 187-193
**Type**: `lookup_table`
**Code**:
```python
# CSV version
bool_map = {'YES': 'True', 'NO': 'False'}

# Pandas version
fishstat_mappings = {'YES': True, 'NO': False}
df['FishStat_Data'] = df['FishStat_Data'].map(fishstat_mappings)
```
**Pattern**: `YES` | `NO` (string representation)
**Replacement**: `True` | `False` (boolean)
**Comment**: Convert FishStat_Data field to proper boolean type
**Priority**: 150

---

## Pattern 8: Output Encoding Strategy
**Line**: 87
**Type**: `encoding_strategy`
**Code**: `open(OUTPUT, 'w', newline='', encoding='utf-8')`
**Pattern**: `encoding=utf-8`
**Replacement**: NULL
**Comment**: Write cleaned data with UTF-8 encoding (no BOM)
**Priority**: 100

---

## Pattern 9: Schema Validation (Pandera)
**Lines**: 24-43, 202-204
**Type**: `data_validation`
**Code**:
```python
schema = pa.DataFrameSchema({
    "ISSCAAP_Group": Column(float, nullable=True),
    "Taxonomic_Code": Column(str),
    "Alpha3_Code": Column(str, Check.str_length(3)),
    "taxonRank": Column(str, nullable=True),
    "scientificName": Column(str, nullable=True),
    ...
})
schema.validate(df)
```
**Pattern**: Data validation rules
**Comment**: Validate cleaned data against schema (optional - only if pandera installed)
**Priority**: 100 (validation only)
**Validations**:
- Alpha3_Code must be exactly 3 characters
- Taxonomic_Code must be string
- ISSCAAP_Group can be float or null

---

## Summary
**Total Patterns**: 9
**Critical Patterns**: 4 (parenthesis removal, whitespace normalization, rank normalization, word capitalization)
**Simple Replacements**: 3 (spaces, whitespace, boolean)
**Regex Patterns**: 2 (parenthesis removal, whitespace collapse)
**Lookup Tables**: 2 (rank mappings, boolean mappings)
**Complex Logic**: 0
**Validation Rules**: 1 (schema validation)
**Encoding Rules**: 2

## Data Quality Impact
- **High Impact**: Patterns 3, 4, 5, 6 (scientific name cleaning, rank/family standardization)
- **Medium Impact**: Pattern 7 (boolean normalization)
- **Low Impact**: Patterns 1, 2, 8, 9 (infrastructure and validation)

## Key Characteristics
1. **Dual implementation**: CSV fallback + Pandas primary (handles missing dependencies)
2. **Post-processing**: Runs after clean_asfis_data.py (Step 2 of pipeline)
3. **Schema validation**: Optional Pandera validation for data quality assurance
4. **Field-specific cleaning**: Different logic for different columns
5. **No complex parsing**: Simple text transformations only

## Relationship to clean_asfis_data.py
**clean_asfis_data.py** (Step 1):
- Edge case handling (150+ mappings)
- Multi-species expansion
- Taxonomic rank inference
- Row duplication
- **Complex domain logic**

**clean_asfis.py** (Step 2 - this file):
- Text cleaning (parentheses, whitespace)
- Capitalization standardization
- Boolean conversion
- Schema validation
- **Simple text transformations**

## SQL-Friendly Patterns
Most patterns in this script **CAN be implemented in SQL**:

### Pattern 3 (Parenthesis removal):
```sql
SELECT regexp_replace(scientific_name, '\([^)]*\)', '', 'g');
```

### Pattern 4 (Whitespace normalization):
```sql
SELECT regexp_replace(scientific_name, '\s+', ' ', 'g');
```

### Pattern 5 (Rank normalization):
```sql
SELECT CASE LOWER(taxon_rank)
  WHEN 'species' THEN 'Species'
  WHEN 'genus' THEN 'Genus'
  ...
END;
```

### Pattern 6 (Word capitalization):
```sql
SELECT initcap(family_name);  -- PostgreSQL
```

### Pattern 7 (Boolean conversion):
```sql
SELECT CASE UPPER(fishstat_data)
  WHEN 'YES' THEN TRUE
  WHEN 'NO' THEN FALSE
END;
```

## Implementation Notes
**This script is much simpler than clean_asfis_data.py** - all patterns are straightforward text transformations suitable for SQL or basic string operations.

**The dual implementation (CSV + Pandas) shows defensive programming** - ensures the pipeline works even if pandas/pandera are unavailable.