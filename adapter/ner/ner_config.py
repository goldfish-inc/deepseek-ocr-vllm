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
assert len(NER_LABELS) == 62, f"Expected 62 labels from labels.json, got {len(NER_LABELS)}"

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

# ISO 3166-1 country codes (alpha-2 and alpha-3)
# Subset of maritime-relevant countries - full list in database
ISO_3166_CODES = {
    # Alpha-2 codes
    "US", "CA", "MX", "GB", "FR", "ES", "IT", "DE", "NO", "IS", "DK", "SE", "FI",
    "RU", "CN", "JP", "KR", "TW", "PH", "ID", "MY", "SG", "TH", "VN", "IN", "PK",
    "AU", "NZ", "BR", "AR", "CL", "PE", "EC", "PA", "CR", "GT", "HN", "NI", "SV",
    "ZA", "NA", "GH", "NG", "KE", "TZ", "MZ", "MG", "MU", "SC", "EG", "MA", "DZ",
    "TN", "LY", "TR", "GR", "HR", "MT", "CY", "IL", "LB", "AE", "OM", "QA", "KW",
    "BH", "SA", "YE", "IR", "IQ", "PL", "LT", "LV", "EE", "UA", "GE", "PT", "IE",
    "IS", "GL", "FO", "NL", "BE", "LU", "CH", "AT", "CZ", "SK", "HU", "RO", "BG",
    "SI", "ME", "AL", "MK", "RS", "BA", "XK", "MD", "BY",
    # Alpha-3 codes
    "USA", "CAN", "MEX", "GBR", "FRA", "ESP", "ITA", "DEU", "NOR", "ISL", "DNK",
    "SWE", "FIN", "RUS", "CHN", "JPN", "KOR", "TWN", "PHL", "IDN", "MYS", "SGP",
    "THA", "VNM", "IND", "PAK", "AUS", "NZL", "BRA", "ARG", "CHL", "PER", "ECU",
    "PAN", "CRI", "GTM", "HND", "NIC", "SLV", "ZAF", "NAM", "GHA", "NGA", "KEN",
    "TZA", "MOZ", "MDG", "MUS", "SYC", "EGY", "MAR", "DZA", "TUN", "LBY", "TUR",
    "GRC", "HRV", "MLT", "CYP", "ISR", "LBN", "ARE", "OMN", "QAT", "KWT", "BHR",
    "SAU", "YEM", "IRN", "IRQ", "POL", "LTU", "LVA", "EST", "UKR", "GEO", "PRT",
    "IRL", "ISL", "GRL", "FRO", "NLD", "BEL", "LUX", "CHE", "AUT", "CZE", "SVK",
    "HUN", "ROU", "BGR", "SVN", "MNE", "ALB", "MKD", "SRB", "BIH", "XKX", "MDA", "BLR"
}

# ITU Maritime Identification Digits (MID) - First 3 digits of MMSI
# Maps MID code to country name
MID_TO_COUNTRY = {
    "201": "Albania", "202": "Andorra", "203": "Austria", "204": "Azores",
    "205": "Belgium", "206": "Belarus", "207": "Bulgaria", "208": "Vatican",
    "209": "Cyprus", "210": "Cyprus", "211": "Germany", "212": "Cyprus",
    "213": "Georgia", "214": "Moldova", "215": "Malta", "216": "Armenia",
    "218": "Germany", "219": "Denmark", "220": "Denmark", "224": "Spain",
    "225": "Spain", "226": "France", "227": "France", "228": "France",
    "229": "Malta", "230": "Finland", "231": "Faroe Islands", "232": "United Kingdom",
    "233": "United Kingdom", "234": "United Kingdom", "235": "United Kingdom",
    "236": "Gibraltar", "237": "Greece", "238": "Croatia", "239": "Greece",
    "240": "Greece", "241": "Greece", "242": "Morocco", "243": "Hungary",
    "244": "Netherlands", "245": "Netherlands", "246": "Netherlands",
    "247": "Italy", "248": "Malta", "249": "Malta", "250": "Ireland",
    "251": "Iceland", "252": "Liechtenstein", "253": "Luxembourg",
    "254": "Monaco", "255": "Madeira", "256": "Malta", "257": "Norway",
    "258": "Norway", "259": "Norway", "261": "Poland", "262": "Montenegro",
    "263": "Portugal", "264": "Romania", "265": "Sweden", "266": "Sweden",
    "267": "Slovakia", "268": "San Marino", "269": "Switzerland",
    "270": "Czech Republic", "271": "Turkey", "272": "Ukraine",
    "273": "Russia", "274": "North Macedonia", "275": "Latvia",
    "276": "Estonia", "277": "Lithuania", "278": "Slovenia",
    "279": "Serbia", "301": "Anguilla", "303": "USA", "304": "Antigua and Barbuda",
    "305": "Antigua and Barbuda", "306": "Curaçao", "307": "Aruba",
    "308": "Bahamas", "309": "Bahamas", "310": "Bermuda", "311": "Bahamas",
    "312": "Belize", "314": "Barbados", "316": "Canada", "319": "Cayman Islands",
    "321": "Costa Rica", "323": "Cuba", "325": "Dominica", "327": "Dominican Republic",
    "329": "Guadeloupe", "330": "Grenada", "331": "Greenland", "332": "Guatemala",
    "334": "Honduras", "336": "Haiti", "338": "USA", "339": "Jamaica",
    "341": "Saint Kitts and Nevis", "343": "Saint Lucia", "345": "Mexico",
    "347": "Martinique", "348": "Montserrat", "350": "Nicaragua",
    "351": "Panama", "352": "Panama", "353": "Panama", "354": "Panama",
    "355": "Panama", "356": "Panama", "357": "Panama", "358": "Puerto Rico",
    "359": "El Salvador", "361": "Saint Pierre and Miquelon",
    "362": "Trinidad and Tobago", "364": "Turks and Caicos Islands",
    "366": "USA", "367": "USA", "368": "USA", "369": "USA",
    "370": "Panama", "371": "Panama", "372": "Panama", "373": "Panama",
    "374": "Panama", "375": "Saint Vincent and the Grenadines",
    "376": "Saint Vincent and the Grenadines", "377": "Saint Vincent and the Grenadines",
    "378": "British Virgin Islands", "379": "US Virgin Islands",
    "401": "Afghanistan", "403": "Saudi Arabia", "405": "Bangladesh",
    "408": "Bahrain", "410": "Bhutan", "412": "China", "413": "China",
    "414": "China", "416": "Taiwan", "417": "Sri Lanka", "419": "India",
    "422": "Iran", "423": "Azerbaijan", "425": "Iraq", "428": "Israel",
    "431": "Japan", "432": "Japan", "434": "Turkmenistan", "436": "Kazakhstan",
    "437": "Uzbekistan", "438": "Jordan", "440": "South Korea",
    "441": "South Korea", "443": "Palestine", "445": "North Korea",
    "447": "Kuwait", "450": "Lebanon", "451": "Kyrgyzstan", "453": "Macao",
    "455": "Maldives", "457": "Mongolia", "459": "Nepal", "461": "Oman",
    "463": "Pakistan", "466": "Qatar", "468": "Syria", "470": "UAE",
    "471": "UAE", "472": "Tajikistan", "473": "Yemen", "475": "Yemen",
    "477": "Hong Kong", "478": "Bosnia and Herzegovina", "501": "Antarctica",
    "503": "Australia", "506": "Myanmar", "508": "Brunei", "510": "Micronesia",
    "511": "Palau", "512": "New Zealand", "514": "Cambodia", "515": "Cambodia",
    "516": "Christmas Island", "518": "Cook Islands", "520": "Fiji",
    "523": "Cocos Islands", "525": "Indonesia", "529": "Kiribati",
    "531": "Laos", "533": "Malaysia", "536": "Northern Mariana Islands",
    "538": "Marshall Islands", "540": "New Caledonia", "542": "Niue",
    "544": "Nauru", "546": "French Polynesia", "548": "Philippines",
    "553": "Papua New Guinea", "555": "Pitcairn Islands", "557": "Solomon Islands",
    "559": "American Samoa", "561": "Samoa", "563": "Singapore",
    "564": "Singapore", "565": "Singapore", "566": "Singapore",
    "567": "Thailand", "570": "Tonga", "572": "Tuvalu", "574": "Vietnam",
    "576": "Vanuatu", "577": "Vanuatu", "578": "Wallis and Futuna",
    "601": "South Africa", "603": "Angola", "605": "Algeria", "607": "Saint Paul and Amsterdam Islands",
    "608": "Ascension Island", "609": "Burundi", "610": "Benin", "611": "Botswana",
    "612": "Central African Republic", "613": "Cameroon", "615": "Congo",
    "616": "Comoros", "617": "Cape Verde", "618": "Antarctica",
    "619": "Ivory Coast", "620": "Comoros", "621": "Djibouti",
    "622": "Egypt", "624": "Ethiopia", "625": "Eritrea", "626": "Gabon",
    "627": "Ghana", "629": "Gambia", "630": "Guinea-Bissau",
    "631": "Equatorial Guinea", "632": "Guinea", "633": "Burkina Faso",
    "634": "Kenya", "635": "Antarctica", "636": "Liberia", "637": "Liberia",
    "638": "South Sudan", "642": "Libya", "644": "Lesotho", "645": "Mauritius",
    "647": "Madagascar", "649": "Mali", "650": "Mozambique",
    "654": "Mauritania", "655": "Malawi", "656": "Niger", "657": "Nigeria",
    "659": "Namibia", "660": "Réunion", "661": "Rwanda", "662": "Sudan",
    "663": "Senegal", "664": "Seychelles", "665": "Saint Helena",
    "666": "Somalia", "667": "Sierra Leone", "668": "Sao Tome and Principe",
    "669": "Eswatini", "670": "Chad", "671": "Togo", "672": "Tunisia",
    "674": "Tanzania", "675": "Uganda", "676": "DR Congo", "677": "Tanzania",
    "678": "Zambia", "679": "Zimbabwe", "701": "Argentina", "710": "Brazil",
    "720": "Bolivia", "725": "Chile", "730": "Colombia", "735": "Ecuador",
    "740": "Falkland Islands", "745": "Guiana", "750": "Guyana", "755": "Paraguay",
    "760": "Peru", "765": "Suriname", "770": "Uruguay", "775": "Venezuela"
}

# Valid MID codes (keys from MID_TO_COUNTRY)
VALID_MID_CODES = set(MID_TO_COUNTRY.keys())


def validate_imo(imo_str: str) -> bool:
    """Validate IMO number using Luhn algorithm"""
    if not re.match(r"^[0-9]{7}$", imo_str):
        return False

    digits = [int(d) for d in imo_str]
    check_digit = digits[-1]
    weighted_sum = sum(d * (7 - i) for i, d in enumerate(digits[:-1]))
    computed_check = weighted_sum % 10

    return computed_check == check_digit


def validate_mmsi(mmsi_str: str) -> Tuple[bool, Optional[Dict[str, str]]]:
    """
    Validate MMSI (Maritime Mobile Service Identity) number.

    MMSI structure: 9 digits, first 3 digits = MID (Maritime Identification Digit)
    Returns tuple: (is_valid, metadata_dict)

    Example:
        >>> validate_mmsi("316001234")
        (True, {"country": "Canada", "mid": "316"})
        >>> validate_mmsi("999999999")
        (False, {"error": "Unknown MID: 999"})
    """
    # Check format
    if not mmsi_str.isdigit() or len(mmsi_str) != 9:
        return False, {"error": "Invalid format (must be 9 digits)"}

    # Extract and validate MID
    mid = mmsi_str[:3]
    if mid not in VALID_MID_CODES:
        return False, {"error": f"Unknown MID: {mid}"}

    return True, {"country": MID_TO_COUNTRY[mid], "mid": mid}


def validate_flag(flag_str: str) -> bool:
    """
    Validate flag country code against ISO 3166-1 alpha-2 or alpha-3 codes.

    Example:
        >>> validate_flag("US")
        True
        >>> validate_flag("USA")
        True
        >>> validate_flag("XX")
        False
    """
    return flag_str.upper() in ISO_3166_CODES


def validate_rfmo(rfmo_str: str) -> bool:
    """
    Validate RFMO (Regional Fisheries Management Organization) code.

    Example:
        >>> validate_rfmo("CCAMLR")
        True
        >>> validate_rfmo("ccamlr")
        True
        >>> validate_rfmo("INVALID")
        False
    """
    return rfmo_str.upper() in RFMO_CODES


def validate_eu_cfr(cfr_str: str) -> Tuple[bool, Optional[Dict[str, str]]]:
    """
    Validate EU CFR (Community Fishing Registry) number.

    Format: 3-letter country code + 9 digits (e.g., "FRA123456789")
    Returns tuple: (is_valid, metadata_dict)

    Example:
        >>> validate_eu_cfr("FRA123456789")
        (True, {"country_code": "FRA"})
        >>> validate_eu_cfr("XX123456789")
        (False, {"error": "Invalid country code"})
    """
    # Check format: 3 letters + 9 digits
    if not re.match(r"^[A-Z]{3}[0-9]{9}$", cfr_str.upper()):
        return False, {"error": "Invalid format (must be 3 letters + 9 digits)"}

    country_code = cfr_str[:3].upper()

    # Validate country code is valid ISO 3166 alpha-3
    if country_code not in ISO_3166_CODES:
        return False, {"error": f"Invalid country code: {country_code}"}

    return True, {"country_code": country_code}


def validate_entity(entity_type: EntityType, text: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    Validate extracted entity against known patterns and business rules.

    Returns tuple: (is_valid, metadata_dict)
    - For simple validators: (True, None) or (False, None)
    - For complex validators: (True, {"country": "..."}) or (False, {"error": "..."})
    """
    mapping = ENTITY_DB_MAPPINGS.get(entity_type)

    # Entity-specific validators with metadata
    if entity_type == EntityType.IMO:
        is_valid = validate_imo(text)
        return is_valid, None

    elif entity_type == EntityType.MMSI:
        return validate_mmsi(text)

    elif entity_type == EntityType.FLAG:
        is_valid = validate_flag(text)
        return is_valid, None

    elif entity_type == EntityType.RFMO:
        is_valid = validate_rfmo(text)
        return is_valid, None

    elif entity_type == EntityType.EU_CFR:
        return validate_eu_cfr(text)

    # Fallback: regex pattern validation
    if mapping and mapping.validation_pattern:
        is_valid = bool(re.match(mapping.validation_pattern, text))
        return is_valid, None

    # No validation pattern defined - accept by default
    return True, None


def extract_entities_with_patterns(text: str) -> List[Dict[str, Any]]:
    """Extract entities using regex patterns as fallback/validation"""
    entities = []

    for entity_type, patterns in EXTRACTION_PATTERNS.items():
        for pattern in patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                entity_text = match.group(1) if match.groups() else match.group(0)

                # Validate extracted entity
                is_valid, metadata = validate_entity(entity_type, entity_text)
                if is_valid:
                    entity_dict = {
                        "text": entity_text,
                        "label": entity_type.value,
                        "start": match.start(),
                        "end": match.end(),
                        "confidence": 0.95,  # High confidence for pattern match
                        "source": "pattern"
                    }

                    # Add metadata if available (e.g., country from MMSI)
                    if metadata:
                        entity_dict["metadata"] = metadata

                    entities.append(entity_dict)

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
