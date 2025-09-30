# Manual Pattern Extraction: clean_asfis_data.py

**Source**: `scripts/legacy-pandas-cleaners/reference/clean_asfis_data.py`
**Source Type**: REFERENCE
**Source Name**: ASFIS
**Purpose**: Preprocess ASFIS (FAO fisheries species database) with taxonomic edge cases and normalization

---

## Pattern 1: Hardcoded Edge Case Dictionary (150+ mappings)
**Lines**: 27-162
**Type**: `lookup_table` (complex data structure)
**Description**: 150+ edge case mappings for problematic ASFIS scientific names

**Categories of Edge Cases**:

### Category A: Synonym Mappings (Lines 28-41)
Examples:
- `Siluriformes (=Siluroidei)` → `Siluridae` (Family)
- `Harpagiferidae (=Artedidraconidae)` → `Harpagiferidae` (Family)
**Pattern Type**: Taxonomic synonym resolution with parenthetical notation

### Category B: Subgenus Removal (Lines 43-88)
Examples:
- `Cambarellus (Cambarellus) patzcuarensis` → `Cambarellus patzcuarensis` (Species)
- `Holothuria (Holothuria) tubulosa` → `Holothuria tubulosa` (Species)
**Pattern Type**: Remove redundant or alternate subgenus names in parentheses

### Category C: Hybrid Species (Lines 90-111)
Examples:
- `Oreochromis aureus x O. niloticus` → Split into both parent species
- `Epinephelus fuscoguttatus x E. lanceolatus` → Split into both parents
**Pattern Type**: Hybrid notation with `x` separator, genus abbreviation expansion

### Category D: Multi-Genus Listings (Lines 103-105)
Examples:
- `Osmerus spp, Hypomesus spp` → Split into two genera
- `Pandalus spp, Pandalopsis spp` → Split into two genera
**Pattern Type**: Comma-separated genus groups

### Category E: Multi-Species Listings (Lines 107, 115)
Examples:
- `Alosa alosa, A. fallax` → Split into two species
- `Auxis thazard, A. rochei` → Split into two species
**Pattern Type**: Comma-separated species with genus abbreviation

### Category F: High-Level Taxa (Lines 108-161)
Examples:
- `Actinopterygii` → Superclass
- `Elasmobranchii` → Subclass
- `Mollusca` → Phylum
**Pattern Type**: Higher taxonomic ranks (Kingdom → Order)

**Implementation**: This is a **large lookup dictionary** - 150+ key-value mappings

**SQL Representation**: Could be a `reference.asfis_edge_cases` table:
```sql
CREATE TABLE reference.asfis_edge_cases (
  original_name TEXT PRIMARY KEY,
  species_name_0 TEXT NOT NULL,
  taxon_rank TEXT NOT NULL,
  species_name_1 TEXT,
  comment TEXT
);
```

---

## Pattern 2: Comma-Separated Species Detection
**Lines**: 198-208
**Type**: `pattern_detection` + string split
**Code**:
```python
if ',' in scientific_name and ' spp' not in scientific_name:
    current_rank = "Species"
    parts = scientific_name.split(',', 1)
    species_scientific_name_0 = parts[0].strip()
    second_part = parts[1].strip()
    if second_part.startswith('A. ') or second_part.startswith('E. ') or ...:
        genus = species_scientific_name_0.split()[0]
        species = second_part[3:].strip()
        species_scientific_name_1 = f"{genus} {species}"
    else:
        species_scientific_name_1 = second_part
```
**Pattern**: Comma-separated species list with genus abbreviation
**Logic**:
1. Detect comma in name (but not if "spp" present)
2. Split on first comma
3. Check if second part starts with abbreviated genus (`A.`, `E.`, `O.`, etc.)
4. If yes: expand abbreviation using genus from first species
5. If no: use second part as-is

**Comment**: Handle patterns like "Alosa alosa, A. fallax"
**Priority**: 200

---

## Pattern 3: Hybrid Species Detection (x separator)
**Lines**: 209-219
**Type**: `pattern_detection` + string split
**Code**:
```python
elif ' x ' in scientific_name:
    current_rank = "Species"
    parts = scientific_name.split(' x ')
    species_scientific_name_0 = parts[0].strip()
    second_part = parts[1].strip()
    if second_part.startswith('O. ') or second_part.startswith('P. ') or ...:
        genus = species_scientific_name_0.split()[0]
        species = second_part[3:].strip()
        species_scientific_name_1 = f"{genus} {species}"
    else:
        species_scientific_name_1 = second_part
```
**Pattern**: Hybrid species notation with ` x ` separator
**Logic**: Same as Pattern 2 but for hybrids
**Comment**: Handle patterns like "Oreochromis aureus x O. niloticus"
**Priority**: 200

---

## Pattern 4-12: Taxonomic Rank Inference from Suffixes (9 patterns)
**Lines**: 225-257
**Type**: `pattern_detection` (suffix matching)

### Pattern 4: Family Detection (-dae suffix)
**Line**: 225-227
**Code**: `if word_count == 1 and words[0].lower().endswith('dae'):`
**Pattern**: Single word ending in `-dae`
**Rank**: Family
**Example**: `Salmonidae` → Family

### Pattern 5: Genus with "spp" Detection
**Line**: 228-230
**Code**: `elif word_count == 2 and words[1].lower() == 'spp':`
**Pattern**: Two words, second word is `spp`
**Rank**: Genus
**Example**: `Pandalus spp` → Genus (drop "spp")

### Pattern 6: Species Detection (2 words)
**Line**: 231-233
**Code**: `elif word_count == 2 and words[1].lower() != 'spp':`
**Pattern**: Two words (binomial nomenclature)
**Rank**: Species
**Example**: `Gadus morhua` → Species

### Pattern 7: Subspecies Detection (3 words)
**Line**: 234-236
**Code**: `elif word_count == 3:`
**Pattern**: Three words (trinomial nomenclature)
**Rank**: Subspecies
**Example**: `Gadus morhua callarias` → Subspecies

### Pattern 8: Order Detection (-formes suffix)
**Line**: 237-239
**Code**: `elif word_count == 1 and words[0].lower().endswith('formes'):`
**Pattern**: Single word ending in `-formes`
**Rank**: Order
**Example**: `Gadiformes` → Order

### Pattern 9: Class Detection (-ia suffix)
**Line**: 240-242
**Code**: `elif word_count == 1 and words[0].lower().endswith('ia'):`
**Pattern**: Single word ending in `-ia`
**Rank**: Class
**Example**: `Actinopterygii` → Class

### Pattern 10: Class Detection (-phyceae suffix)
**Line**: 243-245
**Code**: `elif word_count == 1 and words[0].lower().endswith('phyceae'):`
**Pattern**: Single word ending in `-phyceae`
**Rank**: Class (for algae)
**Example**: `Phaeophyceae` → Class

### Pattern 11: Phylum Detection (-a suffix)
**Line**: 246-248
**Code**: `elif word_count == 1 and words[0].lower().endswith('a'):`
**Pattern**: Single word ending in `-a`
**Rank**: Phylum
**Example**: `Mollusca` → Phylum

### Pattern 12: Subfamily Detection (-nae suffix)
**Line**: 249-251
**Code**: `elif word_count == 1 and words[0].lower().endswith('nae'):`
**Pattern**: Single word ending in `-nae`
**Rank**: Subfamily
**Example**: `Scombrinae` → Subfamily

### Pattern 13: Tribe Detection (-ini suffix)
**Line**: 252-254
**Code**: `elif word_count == 1 and words[0].lower().endswith('ini'):`
**Pattern**: Single word ending in `-ini`
**Rank**: Tribe
**Example**: `Thunnini` → Tribe

---

## Pattern 14: Row Duplication Logic (Multi-Species Expansion)
**Lines**: 265-285
**Type**: `data_transformation`
**Code**:
```python
for row in processed_rows:
    # Always add the first row (with speciesScientificNames[0])
    first_row = row.copy()
    first_row[alpha3_code_idx + 3] = ""  # Clear speciesScientificNames[1]
    normalized_rows.append(first_row)

    # If there's a second species, create a duplicate row
    if species_name_1 and species_name_1.strip():
        second_row = row.copy()
        second_row[alpha3_code_idx + 2] = species_name_1  # Move to [0]
        second_row[alpha3_code_idx + 3] = ""  # Clear [1]
        normalized_rows.append(second_row)
        duplicate_count += 1
```
**Pattern**: Row duplication for entries with multiple species
**Logic**: Expand rows with 2 species into 2 separate rows
**Comment**: Normalizes multi-species entries for database 1NF (First Normal Form)
**Priority**: 200

---

## Pattern 15: Column Transformation
**Lines**: 287-315
**Type**: `data_transformation`
**Operations**:
1. Remove `Scientific_Name` column (original raw name)
2. Remove `speciesScientificNames[1]` column (after duplication)
3. Rename `speciesScientificNames[0]` → `scientificName`
4. Rename `currentRank` → `taxonRank`

**Comment**: Schema transformation for cleaner output
**Priority**: 100

---

## Pattern 16: File Encoding Strategy
**Line**: 166, 318
**Type**: `encoding_strategy`
**Code**: `encoding='utf-8'`
**Pattern**: `encoding=utf-8`
**Comment**: UTF-8 for scientific names (Greek letters, diacritics)
**Priority**: 100

---

## Summary
**Total Patterns**: 16 (including 150+ edge cases in Pattern 1)
**Critical Patterns**: 3 (edge case lookup, comma-species split, hybrid split)
**Simple Replacements**: 0
**Regex Patterns**: 0
**Complex Logic**: 4 (edge case dictionary, row duplication, column transformation, suffix inference)
**Lookup Tables**: 1 (150+ edge cases)
**Validation Rules**: 0

## Data Quality Impact
- **High Impact**: Patterns 1, 2, 3, 14 (edge cases, multi-species handling, normalization)
- **Medium Impact**: Patterns 4-13 (taxonomic rank inference)
- **Low Impact**: Patterns 15, 16 (schema transformation, encoding)

## Key Characteristics
1. **Domain-specific**: Requires deep taxonomic knowledge (150+ edge cases)
2. **Normalization**: Expands multi-species entries into separate rows (1NF)
3. **Rank inference**: Heuristic classification based on naming conventions
4. **Genus abbreviation expansion**: Handles "A. species" notation
5. **Hybrid support**: Parses "Species A x Species B" notation

## Implementation Challenges
**Pattern 1 (edge case dictionary) is the biggest challenge** - 150+ hardcoded mappings require:
1. Migration to database table `reference.asfis_edge_cases`
2. Regular updates as FAO ASFIS adds new species
3. Taxonomic expertise to validate mappings

**Patterns 2-3 (comma/hybrid splitting) require procedural logic**:
- Genus abbreviation expansion (check first letter + dot)
- Context-aware splitting

**Patterns 4-13 (suffix inference) are simple regex patterns** - can be SQL CASE statements

**Pattern 14 (row duplication) is SQL-friendly**:
```sql
-- Expand multi-species entries
SELECT ... WHERE species_name_1 IS NULL OR species_name_1 = ''
UNION ALL
SELECT ... WHERE species_name_1 IS NOT NULL AND species_name_1 != ''
```

## Example Transformations
Input: `Alosa alosa, A. fallax`
→ Species split detection (comma, genus abbreviation)
→ Expand to: `Alosa alosa` (Species) + `Alosa fallax` (Species)
→ Create 2 rows

Input: `Holothuria (Holothuria) tubulosa`
→ Edge case lookup (Pattern 1)
→ Transform to: `Holothuria tubulosa` (Species)
→ Create 1 row

Input: `Gadiformes`
→ Suffix inference (Pattern 8: -formes)
→ Classify as: Order
→ Create 1 row with taxonRank=Order