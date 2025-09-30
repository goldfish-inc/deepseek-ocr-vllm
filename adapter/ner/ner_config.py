"""
NER Configuration for Ebisu Maritime Intelligence Platform
Aligns NER labels with database schema for accurate entity extraction
"""

import json
import re
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass
from enum import Enum


class EntityType(Enum):
    """Entity types aligned with Oceanid database schema (all 63 labels from labels.json v1.0.0)"""
    # Special
    O = "O"  # Outside/Non-entity

    # Vessel identity & identifiers
    VESSEL = "VESSEL"
    VESSEL_NAME = "VESSEL_NAME"
    IMO = "IMO"
    IRCS = "IRCS"
    MMSI = "MMSI"
    FLAG = "FLAG"
    PORT = "PORT"

    # Entities
    ORGANIZATION = "ORGANIZATION"
    PERSON = "PERSON"
    COMPANY = "COMPANY"

    # Vessel associates
    BENEFICIAL_OWNER = "BENEFICIAL_OWNER"
    OPERATOR = "OPERATOR"
    CHARTERER = "CHARTERER"
    VESSEL_MASTER = "VESSEL_MASTER"
    CREW_MEMBER = "CREW_MEMBER"

    # Vessel specs & metrics
    GEAR_TYPE = "GEAR_TYPE"
    VESSEL_TYPE = "VESSEL_TYPE"
    COMMODITY = "COMMODITY"
    HS_CODE = "HS_CODE"
    SPECIES = "SPECIES"
    RISK_LEVEL = "RISK_LEVEL"
    SANCTION = "SANCTION"

    # Temporal & location
    DATE = "DATE"
    LOCATION = "LOCATION"
    COUNTRY = "COUNTRY"

    # Regulatory
    RFMO = "RFMO"
    LICENSE = "LICENSE"
    TONNAGE = "TONNAGE"
    LENGTH = "LENGTH"
    ENGINE_POWER = "ENGINE_POWER"
    EU_CFR = "EU_CFR"

    # Authorization types
    FISHING_AUTHORIZATION = "FISHING_AUTHORIZATION"
    FISHING_LICENSE = "FISHING_LICENSE"
    TRANSSHIPMENT_AUTHORIZATION = "TRANSSHIPMENT_AUTHORIZATION"
    CARRIER_AUTHORIZATION = "CARRIER_AUTHORIZATION"
    OBSERVER_AUTHORIZATION = "OBSERVER_AUTHORIZATION"
    SUPPORT_VESSEL_AUTHORIZATION = "SUPPORT_VESSEL_AUTHORIZATION"

    # Vessel specifications (continued)
    HULL_MATERIAL = "HULL_MATERIAL"
    VESSEL_ENGINE_TYPE = "VESSEL_ENGINE_TYPE"
    VESSEL_FUEL_TYPE = "VESSEL_FUEL_TYPE"
    FREEZER_TYPE = "FREEZER_TYPE"
    BUILD_YEAR = "BUILD_YEAR"
    FLAG_REGISTERED_DATE = "FLAG_REGISTERED_DATE"
    EXTERNAL_MARKING = "EXTERNAL_MARKING"
    CREW_COUNT = "CREW_COUNT"

    # Metrics
    METRIC_VALUE = "METRIC_VALUE"
    UNIT = "UNIT"

    # Authorization metadata
    AUTHORIZATION_STATUS = "AUTHORIZATION_STATUS"

    # Intelligence metadata
    SANCTION_TYPE = "SANCTION_TYPE"
    SANCTION_PROGRAM = "SANCTION_PROGRAM"

    # Entity metadata
    ENTITY_TYPE = "ENTITY_TYPE"
    ENTITY_SUBTYPE = "ENTITY_SUBTYPE"
    ASSOCIATION_TYPE = "ASSOCIATION_TYPE"
    OWNERSHIP_TYPE = "OWNERSHIP_TYPE"
    CONTROL_LEVEL = "CONTROL_LEVEL"
    ADDRESS_TYPE = "ADDRESS_TYPE"
    ALIAS_TYPE = "ALIAS_TYPE"
    NAME_TYPE = "NAME_TYPE"
    GENDER = "GENDER"

    # Scores
    RISK_SCORE = "RISK_SCORE"
    CONFIDENCE_SCORE = "CONFIDENCE_SCORE"


# NER Labels for model training/inference (order matters - must match labels.json!)
NER_LABELS = [label.value for label in EntityType]

# Validate count matches labels.json expectation
assert len(NER_LABELS) == 63, f"Expected 63 labels from labels.json, got {len(NER_LABELS)}"

# Export for environment variable
NER_LABELS_JSON = json.dumps(NER_LABELS)


@dataclass
class EntityMapping:
    """Maps NER labels to database schema"""
    table: str
    primary_key: Optional[str] = None
    fields: Optional[Dict[str, str]] = None
    foreign_keys: Optional[Dict[str, str]] = None
    where_clause: Optional[str] = None
    validation_pattern: Optional[str] = None


# Database schema mappings
ENTITY_DB_MAPPINGS = {
    EntityType.VESSEL_NAME: EntityMapping(
        table="vessels",
        fields={"vessel_name": "TEXT", "vessel_name_other": "TEXT"}
    ),

    EntityType.IMO: EntityMapping(
        table="vessels",
        fields={"imo": "CHAR(7)"},
        validation_pattern=r"^[0-9]{7}$"
    ),

    EntityType.IRCS: EntityMapping(
        table="vessels",
        fields={"ircs": "VARCHAR(15)"},
        validation_pattern=r"^[A-Z0-9]{4,8}$"
    ),

    EntityType.MMSI: EntityMapping(
        table="vessels",
        fields={"mmsi": "CHAR(9)"},
        validation_pattern=r"^[0-9]{9}$"
    ),

    EntityType.EU_CFR: EntityMapping(
        table="vessels",
        fields={"eu_cfr": "CHAR(12)"},
        validation_pattern=r"^[A-Z]{3}[0-9]{9}$"
    ),

    EntityType.FLAG: EntityMapping(
        table="vessels",
        fields={"vessel_flag": "UUID"},
        foreign_keys={"vessel_flag": "country_iso(id)"}
    ),

    EntityType.PORT: EntityMapping(
        table="vessel_info",
        fields={
            "port_registry": "VARCHAR(100)",
            "home_port": "VARCHAR(100)",
            "home_port_state": "VARCHAR(100)"
        }
    ),

    EntityType.COMPANY: EntityMapping(
        table="entity_organizations",
        primary_key="entity_id",
        fields={"organization_name": "TEXT", "imo_company_number": "TEXT"},
        where_clause="organization_type IN ('COMPANY', 'PARTNERSHIP')"
    ),

    EntityType.BENEFICIAL_OWNER: EntityMapping(
        table="vessel_associates",
        fields={"associate_name": "TEXT", "associate_type": "associate_type_enum"},
        where_clause="associate_type = 'BENEFICIAL_OWNER'"
    ),

    EntityType.OPERATOR: EntityMapping(
        table="vessel_associates",
        fields={"associate_name": "TEXT", "associate_type": "associate_type_enum"},
        where_clause="associate_type IN ('OPERATOR', 'OPERATING_COMPANY')"
    ),

    EntityType.VESSEL_MASTER: EntityMapping(
        table="vessel_associates",
        fields={"associate_name": "TEXT", "associate_type": "associate_type_enum"},
        where_clause="associate_type = 'VESSEL_MASTER'"
    ),

    EntityType.GEAR_TYPE: EntityMapping(
        table="gear_types_fao",
        primary_key="id",
        fields={
            "fao_isscfg_code": "VARCHAR(10)",
            "fao_isscfg_alpha": "VARCHAR(10)",
            "fao_isscfg_name": "TEXT"
        }
    ),

    EntityType.VESSEL_TYPE: EntityMapping(
        table="vessel_types",
        primary_key="id",
        fields={
            "vessel_type_isscfv_code": "VARCHAR(10)",
            "vessel_type_name": "TEXT"
        }
    ),

    EntityType.SPECIES: EntityMapping(
        table="harmonized_species",
        primary_key="species_id",
        fields={
            "scientific_name": "TEXT",
            "common_name": "TEXT",
            "fao_3alpha_code": "VARCHAR(3)"
        }
    ),

    EntityType.RFMO: EntityMapping(
        table="rfmos",
        primary_key="id",
        fields={"rfmo_code": "VARCHAR(10)", "rfmo_name": "TEXT"}
    ),

    EntityType.SANCTION: EntityMapping(
        table="vessel_sanctions",
        fields={
            "sanction_type": "sanction_type_enum",
            "listing_name": "TEXT",
            "program_name": "TEXT"
        }
    ),

    EntityType.LICENSE: EntityMapping(
        table="vessel_authorizations",
        fields={
            "authorization_number": "TEXT",
            "authorization_type": "authorization_type_enum"
        }
    ),

    EntityType.TONNAGE: EntityMapping(
        table="vessel_metrics",
        fields={"value": "DECIMAL(15,4)", "unit": "unit_enum"},
        where_clause="metric_type IN ('tonnage', 'gross_tonnage', 'net_tonnage')"
    ),

    EntityType.LENGTH: EntityMapping(
        table="vessel_metrics",
        fields={"value": "DECIMAL(15,4)", "unit": "unit_enum"},
        where_clause="metric_type IN ('length', 'length_loa', 'length_lbp')"
    ),

    EntityType.ENGINE_POWER: EntityMapping(
        table="vessel_metrics",
        fields={"value": "DECIMAL(15,4)", "unit": "unit_enum"},
        where_clause="metric_type IN ('engine_power', 'aux_engine_power')"
    ),
}


# Extraction patterns for specific entity types
EXTRACTION_PATTERNS = {
    EntityType.IMO: [
        r"\bIMO[\s#:]*([0-9]{7})\b",
        r"\b(?:IMO|imo)[\s]*(?:number|no\.?|#)?[\s:]*([0-9]{7})\b"
    ],
    EntityType.MMSI: [
        r"\bMMSI[\s#:]*([0-9]{9})\b",
        r"\b(?:MMSI|mmsi)[\s]*(?:number|no\.?|#)?[\s:]*([0-9]{9})\b"
    ],
    EntityType.IRCS: [
        r"\b(?:call sign|IRCS|ircs|Call Sign)[\s:]*([A-Z0-9]{4,8})\b",
        r"\b(?:radio call sign)[\s:]*([A-Z0-9]{4,8})\b"
    ],
    EntityType.EU_CFR: [
        r"\b(?:CFR|cfr|EU CFR)[\s#:]*([A-Z]{3}[0-9]{9})\b",
        r"\b([A-Z]{3}[0-9]{9})\b"  # Direct pattern match
    ],
    EntityType.DATE: [
        r"\b(\d{4}-\d{2}-\d{2})\b",  # ISO format
        r"\b(\d{1,2}/\d{1,2}/\d{4})\b",  # US format
        r"\b(\d{1,2}-\d{1,2}-\d{4})\b",  # EU format
        r"\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b",
        r"\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b"
    ],
}


# Known RFMO codes
RFMO_CODES = {
    "CCAMLR", "CCSBT", "FFA", "GFCM", "IATTC", "ICCAT",
    "IOTC", "NAFO", "NEAFC", "NPFC", "SEAFO", "SIOFA",
    "SPRFMO", "WCPFC"
}

# Known gear type codes
GEAR_TYPES = {
    "PS": "purse seine",
    "LL": "longline",
    "GN": "gillnet",
    "TR": "trawl",
    "PT": "pole and line",
    "DG": "driftnet"
}


def validate_imo(imo_str: str) -> bool:
    """Validate IMO number using Luhn algorithm"""
    if not re.match(r"^[0-9]{7}$", imo_str):
        return False

    digits = [int(d) for d in imo_str]
    check_digit = digits[-1]
    weighted_sum = sum(d * (7 - i) for i, d in enumerate(digits[:-1]))
    computed_check = weighted_sum % 10

    return computed_check == check_digit


def validate_entity(entity_type: EntityType, text: str) -> bool:
    """Validate extracted entity against known patterns"""
    mapping = ENTITY_DB_MAPPINGS.get(entity_type)

    if not mapping or not mapping.validation_pattern:
        return True  # No validation pattern defined

    if entity_type == EntityType.IMO:
        return validate_imo(text)

    return bool(re.match(mapping.validation_pattern, text))


def extract_entities_with_patterns(text: str) -> List[Dict[str, Any]]:
    """Extract entities using regex patterns as fallback/validation"""
    entities = []

    for entity_type, patterns in EXTRACTION_PATTERNS.items():
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                entity_text = match.group(1) if match.groups() else match.group(0)

                # Validate extracted entity
                if validate_entity(entity_type, entity_text):
                    entities.append({
                        "text": entity_text,
                        "label": entity_type.value,
                        "start": match.start(),
                        "end": match.end(),
                        "confidence": 0.95,  # High confidence for pattern match
                        "source": "pattern"
                    })

    return entities


def get_database_query(entity_type: EntityType, entity_value: str) -> Optional[str]:
    """Generate SQL query for entity lookup in database"""
    mapping = ENTITY_DB_MAPPINGS.get(entity_type)

    if not mapping:
        return None

    # Build basic SELECT query
    if mapping.primary_key:
        select_clause = f"SELECT {mapping.primary_key}, *"
    else:
        select_clause = "SELECT *"

    from_clause = f"FROM {mapping.table}"

    # Build WHERE clause
    where_conditions = []

    if mapping.fields:
        # Search across all text fields
        text_fields = [f for f, t in mapping.fields.items() if "TEXT" in t or "VARCHAR" in t]
        if text_fields:
            field_conditions = [f"{field} ILIKE '%{entity_value}%'" for field in text_fields]
            where_conditions.append(f"({' OR '.join(field_conditions)})")

    if mapping.where_clause:
        where_conditions.append(f"({mapping.where_clause})")

    if where_conditions:
        where_clause = f"WHERE {' AND '.join(where_conditions)}"
    else:
        where_clause = ""

    return f"{select_clause} {from_clause} {where_clause}"


# Configuration for the adapter service
ADAPTER_CONFIG = {
    "ner_labels": NER_LABELS,
    "entity_mappings": {k.value: v.__dict__ for k, v in ENTITY_DB_MAPPINGS.items()},
    "extraction_patterns": {k.value: v for k, v in EXTRACTION_PATTERNS.items()},
    "validation": {
        "imo": "luhn_algorithm",
        "mmsi": "9_digits",
        "ircs": "4-8_alphanumeric",
        "eu_cfr": "3_letters_9_digits"
    },
    "postprocessing": {
        "merge_overlapping": True,
        "resolve_conflicts": "highest_confidence",
        "min_confidence": 0.5
    }
}


if __name__ == "__main__":
    # Print configuration for environment setup
    print(f"NER_LABELS={NER_LABELS_JSON}")
    print(f"\nTotal entity types: {len(NER_LABELS)}")
    print(f"Database mappings: {len(ENTITY_DB_MAPPINGS)}")
    print(f"\nEntity types:")
    for label in NER_LABELS:
        if label != "O":
            print(f"  - {label}")