# NER Module for Ebisu Maritime Intelligence Platform

Schema-aligned Named Entity Recognition for maritime domain entities.

## Features

- **30+ Entity Types**: Vessels, IMO, IRCS, MMSI, RFMOs, gear types, species, etc.
- **Database Alignment**: All entities map directly to Ebisu database tables
- **Multi-source Validation**: Model predictions + pattern matching
- **Intelligence-aware**: Treats conflicts as signals, not errors
- **Domain-specific**: Special handling for maritime entities

## Structure

```
adapter/ner/
├── __init__.py              # Module exports
├── ner_config.py            # Entity types & database mappings
├── ner_postprocessor.py     # Entity extraction & validation
└── schema/
    └── ebisu_ner_schema_mapping.json  # Complete schema mapping
```

## Usage

### Basic Entity Extraction

```python
from ner import create_postprocessor

processor = create_postprocessor()
text = "The vessel OCEAN WARRIOR with IMO 9876543 is flagged in Panama"

# Process with tokens from model
entities = processor.process_predictions(text, predictions, tokens)

# Or use pattern-based extraction
entities = processor._enhance_entities([], text)
```

### Entity Validation

```python
from ner import validate_imo, validate_entity, EntityType

# Validate IMO with checksum
is_valid = validate_imo("9543212")  # True (valid checksum)

# Validate other entities
is_valid = validate_entity(EntityType.MMSI, "366123456")
```

### Database Integration

```python
# Get database mapping for entities
entities_with_db = processor._add_database_info(entities)

# Format for database insertion
db_records = processor.format_for_database(entities_with_db)
# Returns: {"vessels": [...], "vessel_metrics": [...], ...}
```

## Entity Types

| Label | Database Table | Description |
|-------|---------------|-------------|
| VESSEL_NAME | vessels | Primary vessel name |
| IMO | vessels | 7-digit IMO number with checksum |
| IRCS | vessels | International Radio Call Sign |
| MMSI | vessels | 9-digit Maritime Mobile Service Identity |
| EU_CFR | vessels | European Union fleet register number |
| FLAG | vessels → country_iso | Flag state |
| PORT | vessel_info | Port of registry or home port |
| COMPANY | entity_organizations | Company/organization |
| BENEFICIAL_OWNER | vessel_associates | Beneficial ownership |
| OPERATOR | vessel_associates | Vessel operator |
| VESSEL_MASTER | vessel_associates | Ship captain/master |
| GEAR_TYPE | gear_types_fao | Fishing gear type |
| VESSEL_TYPE | vessel_types | Vessel classification |
| SPECIES | harmonized_species | Fish species |
| RFMO | rfmos | Regional Fisheries Management Organization |
| SANCTION | vessel_sanctions | Sanctions/IUU listings |
| LICENSE | vessel_authorizations | Fishing licenses |
| TONNAGE | vessel_metrics | Vessel tonnage measurements |
| LENGTH | vessel_metrics | Vessel length measurements |
| ENGINE_POWER | vessel_metrics | Engine specifications |

## Configuration

### Environment Variables

```bash
# Set NER labels for model
export NER_LABELS='["O","VESSEL","VESSEL_NAME","IMO","IRCS","MMSI","FLAG",...]'

# Configure confidence threshold
export NER_CONFIDENCE_THRESHOLD=0.5
```

### Adapter Integration

```python
# In adapter/app.py
from ner import NER_LABELS_JSON, create_postprocessor

# Set environment for model
os.environ["NER_LABELS"] = NER_LABELS_JSON

# Initialize postprocessor
ner_processor = create_postprocessor({
    "confidence_threshold": 0.5
})
```

## Testing

```bash
# Run tests
cd adapter
python -m pytest tests/test_ner_evaluator.py -v

# Generate evaluation report
python tests/test_ner_evaluator.py
```

## Schema Mapping

The complete database schema mapping is in `schema/ebisu_ner_schema_mapping.json`:

- Entity type → database table mappings
- Field specifications and types
- Foreign key relationships
- Validation patterns
- Intelligence tracking configuration

## Performance

- **Pattern Matching**: 0.9+ confidence for known patterns
- **Model Predictions**: Confidence varies by model
- **Validation**: IMO checksum, MMSI format, etc.
- **Conflict Resolution**: Highest confidence wins

## Maritime-Specific Features

### Vessel Name Detection

- Recognizes prefixes: M/V, F/V, S/V
- Handles multi-word vessel names
- Tracks name changes as intelligence

### RFMO Recognition

- All 14 major RFMOs configured
- Pattern matching for codes and full names

### Gear Type Detection

- FAO ISSCFG codes
- Common abbreviations (PS, LL, GN)
- Full names (purse seine, longline)

### Multi-label Support

- Person → Vessel Master/Crew Member
- Company → Operator/Beneficial Owner
- Context-aware role detection

## Contributing

When adding new entity types:

1. Add to `EntityType` enum in `ner_config.py`
2. Add database mapping to `ENTITY_DB_MAPPINGS`
3. Add extraction patterns if applicable
4. Update test fixtures in `tests/fixtures/`
5. Regenerate NER_LABELS_JSON for model
