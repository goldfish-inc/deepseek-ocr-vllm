"""
NER (Named Entity Recognition) module for Ebisu Maritime Intelligence Platform
Provides entity extraction aligned with database schema
"""

from .ner_config import (
    EntityType,
    NER_LABELS,
    NER_LABELS_JSON,
    ENTITY_DB_MAPPINGS,
    EXTRACTION_PATTERNS,
    validate_entity,
    validate_imo,
    extract_entities_with_patterns,
    get_database_query,
    ADAPTER_CONFIG
)

from .ner_postprocessor import (
    NERPostprocessor,
    create_postprocessor
)

__all__ = [
    # Config exports
    "EntityType",
    "NER_LABELS",
    "NER_LABELS_JSON",
    "ENTITY_DB_MAPPINGS",
    "EXTRACTION_PATTERNS",
    "validate_entity",
    "validate_imo",
    "extract_entities_with_patterns",
    "get_database_query",
    "ADAPTER_CONFIG",
    # Postprocessor exports
    "NERPostprocessor",
    "create_postprocessor"
]

__version__ = "1.0.0"
