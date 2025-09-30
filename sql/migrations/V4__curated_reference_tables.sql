-- V4: Curated Reference Tables (Code Lists & Enums)
-- Created: 2025-09-30
-- Depends on: V1__staging_baseline.sql
-- Purpose: Add reference/code tables required by ebisu_ner_schema_mapping.json

-- =============================================================================
-- COUNTRY & FLAG STATE REFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.country_iso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ISO 3166-1 codes
  alpha2 char(2) UNIQUE NOT NULL,
  alpha3 char(3) UNIQUE NOT NULL,
  numeric_code char(3),
  name text NOT NULL,

  -- Maritime identifiers
  mid_codes int[],  -- ITU Maritime Identification Digits (e.g., {316, 366, 338} for USA)

  -- Metadata
  sovereignty text,  -- For territories (e.g., "France" for French Polynesia)
  region text,  -- UN region classification
  is_flag_of_convenience boolean DEFAULT false,

  -- Validity
  valid_from date,
  valid_to date,  -- NULL = currently valid

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_country_iso_alpha2 ON curated.country_iso(alpha2);
CREATE INDEX IF NOT EXISTS ix_country_iso_alpha3 ON curated.country_iso(alpha3);
CREATE INDEX IF NOT EXISTS ix_country_iso_mid ON curated.country_iso USING gin(mid_codes);
CREATE INDEX IF NOT EXISTS ix_country_iso_valid ON curated.country_iso(valid_from, valid_to);

COMMENT ON TABLE curated.country_iso IS 'ISO 3166-1 country codes with maritime identifiers. Includes MID (Maritime Identification Digits) for MMSI validation and flag of convenience classification.';
COMMENT ON COLUMN curated.country_iso.mid_codes IS 'ITU Maritime Identification Digits array. Used to validate MMSI first 3 digits and identify flag state from radio signals.';
COMMENT ON COLUMN curated.country_iso.is_flag_of_convenience IS 'True for registries with minimal regulation/oversight (Panama, Liberia, Marshall Islands, etc.). Key IUU fishing risk indicator.';

-- =============================================================================
-- REGIONAL FISHERIES MANAGEMENT ORGANIZATIONS (RFMOs)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.rfmos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  code text UNIQUE NOT NULL,  -- 'CCAMLR' | 'SEAFO' | 'SPRFMO' | etc.
  full_name text NOT NULL,
  acronym text,

  -- Details
  established_year int,
  headquarters_location text,
  headquarters_country_id uuid REFERENCES curated.country_iso(id),

  -- Geographic scope
  area_of_competence geometry(Polygon, 4326),  -- PostGIS polygon of managed area
  fao_areas int[],  -- FAO statistical areas array

  -- Species managed
  target_species text[],  -- Array of ASFIS codes or common names

  -- Legal framework
  convention_text_url text,
  website_url text,

  -- Membership
  member_count int,

  -- Status
  active boolean DEFAULT true,
  dissolved_date date,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_rfmos_code ON curated.rfmos(code);
CREATE INDEX IF NOT EXISTS ix_rfmos_active ON curated.rfmos(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS ix_rfmos_geo ON curated.rfmos USING gist(area_of_competence);

COMMENT ON TABLE curated.rfmos IS 'Regional Fisheries Management Organizations. Authoritative list of RFMOs for authorization validation and jurisdiction determination.';
COMMENT ON COLUMN curated.rfmos.code IS 'Standard RFMO acronym (CCAMLR, CCSBT, GFCM, IATTC, ICCAT, IOTC, NAFO, NEAFC, NPFC, SEAFO, SIOFA, SPRFMO, WCPFC). Used in NER validation.';
COMMENT ON COLUMN curated.rfmos.fao_areas IS 'FAO major fishing areas (1-88). Used to determine RFMO jurisdiction from vessel position.';

-- =============================================================================
-- FAO GEAR TYPES (ISSCFG Classification)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.gear_types_fao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FAO ISSCFG codes
  fao_code text UNIQUE NOT NULL,  -- e.g., 'FPO', 'GNS', 'LLS'
  name text NOT NULL,
  name_fr text,  -- French name
  name_es text,  -- Spanish name

  -- Classification
  category text NOT NULL,  -- 'Surrounding nets', 'Trawls', 'Gillnets', 'Hooks and lines', etc.
  subcategory text,

  -- IUU risk factors
  iuu_risk_level text,  -- 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  illegal_drift_net boolean DEFAULT false,
  requires_observer boolean DEFAULT false,

  -- Selectivity & bycatch
  target_species_groups text[],
  typical_bycatch_groups text[],
  selectivity_rating text,  -- 'HIGH' | 'MEDIUM' | 'LOW'

  -- Regulatory status
  banned_by_rfmos text[],  -- Array of RFMO codes where this gear is prohibited

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gear_types_fao_code ON curated.gear_types_fao(fao_code);
CREATE INDEX IF NOT EXISTS ix_gear_types_fao_category ON curated.gear_types_fao(category);
CREATE INDEX IF NOT EXISTS ix_gear_types_fao_risk ON curated.gear_types_fao(iuu_risk_level);

COMMENT ON TABLE curated.gear_types_fao IS 'FAO International Standard Statistical Classification of Fishing Gear (ISSCFG). Used for gear type validation and IUU risk assessment.';
COMMENT ON COLUMN curated.gear_types_fao.fao_code IS 'FAO 3-letter gear code from ISSCFG classification. Used in vessel authorization validation.';
COMMENT ON COLUMN curated.gear_types_fao.illegal_drift_net IS 'True for drift net gear types banned by UN Resolution 46/215 (drift nets >2.5km).';

-- =============================================================================
-- HARMONIZED SPECIES (ASFIS List)
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.harmonized_species (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ASFIS codes
  asfis_code char(3) UNIQUE NOT NULL,  -- FAO 3-alpha species code
  isscaap_code char(2),  -- International Standard Statistical Classification of Aquatic Animals and Plants

  -- Names
  scientific_name text NOT NULL,
  common_name_en text,
  common_name_fr text,
  common_name_es text,

  -- Taxonomy
  family text,
  order_name text,
  class_name text,

  -- Conservation status
  iucn_status text,  -- 'LC' | 'NT' | 'VU' | 'EN' | 'CR' | 'EW' | 'EX' | 'DD'
  cites_appendix text,  -- 'I' | 'II' | 'III' | NULL

  -- Commercial importance
  commercial_importance text,  -- 'HIGH' | 'MEDIUM' | 'LOW'
  major_fishing_areas int[],  -- FAO areas where commonly caught

  -- IUU context
  high_value_species boolean DEFAULT false,  -- Bluefin tuna, toothfish, etc.
  frequently_misreported boolean DEFAULT false,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_harmonized_species_asfis ON curated.harmonized_species(asfis_code);
CREATE INDEX IF NOT EXISTS ix_harmonized_species_scientific ON curated.harmonized_species(scientific_name);
CREATE INDEX IF NOT EXISTS ix_harmonized_species_conservation ON curated.harmonized_species(iucn_status, cites_appendix);
CREATE INDEX IF NOT EXISTS ix_harmonized_species_high_value ON curated.harmonized_species(high_value_species) WHERE high_value_species = true;

COMMENT ON TABLE curated.harmonized_species IS 'FAO ASFIS list of aquatic species. Used for catch reporting validation and IUU risk assessment.';
COMMENT ON COLUMN curated.harmonized_species.asfis_code IS 'FAO 3-alpha species code (e.g., TOT=Patagonian toothfish, BET=Bigeye tuna). Used in NER entity validation.';
COMMENT ON COLUMN curated.harmonized_species.high_value_species IS 'Species with high black market value (toothfish, bluefin tuna, abalone, shark fins). Elevated IUU risk.';

-- =============================================================================
-- PORT REFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS curated.ports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  port_code text,  -- UN/LOCODE where available
  port_name text NOT NULL,

  -- Location
  country_id uuid REFERENCES curated.country_iso(id),
  coordinates geometry(Point, 4326),
  fao_area int,

  -- Port characteristics
  port_type text,  -- 'COMMERCIAL' | 'FISHING' | 'NAVAL' | 'MIXED'
  has_landing_facilities boolean DEFAULT false,
  has_transshipment_facilities boolean DEFAULT false,

  -- IUU risk
  port_state_measures_compliant boolean,  -- Complies with PSMA (Port State Measures Agreement)
  known_iuu_port boolean DEFAULT false,

  -- Activity
  major_fishing_port boolean DEFAULT false,
  average_annual_landings_mt numeric,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ports_code ON curated.ports(port_code);
CREATE INDEX IF NOT EXISTS ix_ports_country ON curated.ports(country_id);
CREATE INDEX IF NOT EXISTS ix_ports_geo ON curated.ports USING gist(coordinates);
CREATE INDEX IF NOT EXISTS ix_ports_iuu ON curated.ports(known_iuu_port) WHERE known_iuu_port = true;

COMMENT ON TABLE curated.ports IS 'Global port registry for landing and transshipment tracking. Includes PSMA compliance and IUU risk flags.';
COMMENT ON COLUMN curated.ports.port_state_measures_compliant IS 'Port implements FAO Port State Measures Agreement (PSMA) to prevent IUU catch from entering supply chain.';

-- =============================================================================
-- CODE TABLES (Enums as Tables for Extensibility)
-- =============================================================================

-- Authorization types
CREATE TABLE IF NOT EXISTS curated.authorization_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  requires_species boolean DEFAULT false,
  requires_gear boolean DEFAULT false,
  requires_area boolean DEFAULT false,
  typical_duration_days int
);

INSERT INTO curated.authorization_types (code, name, description, requires_species, requires_gear, requires_area) VALUES
('FISHING', 'Fishing Authorization', 'General fishing authorization', true, true, true),
('FISHING_LICENSE', 'Fishing License', 'Specific fishing license number', true, true, true),
('TRANSSHIPMENT', 'Transshipment Authorization', 'Authorization for at-sea transshipment', false, false, true),
('CARRIER', 'Carrier Authorization', 'Authorization to transport fish as carrier vessel', false, false, true),
('OBSERVER', 'Observer Authorization', 'Authorization to carry scientific observers', false, false, false),
('SUPPORT_VESSEL', 'Support Vessel Authorization', 'Authorization for support vessel operations', false, false, true),
('EXPLORATORY', 'Exploratory Fishing', 'Exploratory fishing in new areas', true, true, true)
ON CONFLICT (code) DO NOTHING;

-- Sanction types
CREATE TABLE IF NOT EXISTS curated.sanction_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  severity text  -- 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
);

INSERT INTO curated.sanction_types (code, name, description, severity) VALUES
('IUU_LISTING', 'IUU Vessel Listing', 'Listed on RFMO IUU vessel list', 'CRITICAL'),
('FINANCIAL', 'Financial Sanction', 'Financial penalties or asset freeze', 'HIGH'),
('TRADE_BAN', 'Trade Ban', 'Import/export restrictions', 'HIGH'),
('PORT_BAN', 'Port Access Ban', 'Denied access to ports', 'MEDIUM'),
('NAVIGATION_BAN', 'Navigation Ban', 'Restricted navigation rights', 'HIGH'),
('LICENSE_REVOCATION', 'License Revocation', 'Fishing license revoked', 'MEDIUM'),
('FLAG_DENIAL', 'Flag Denial', 'Denied flag state registration', 'HIGH')
ON CONFLICT (code) DO NOTHING;

-- Association/relationship types
CREATE TABLE IF NOT EXISTS curated.association_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text,
  requires_person boolean DEFAULT false,
  requires_organization boolean DEFAULT false,
  check (requires_person OR requires_organization)
);

INSERT INTO curated.association_types (code, name, description, requires_person, requires_organization) VALUES
('BENEFICIAL_OWNER', 'Beneficial Owner', 'Ultimate beneficial owner', true, true),
('OPERATOR', 'Operator', 'Vessel operator', false, true),
('CHARTERER', 'Charterer', 'Vessel charterer', false, true),
('MASTER', 'Vessel Master', 'Ship captain', true, false),
('CREW', 'Crew Member', 'Crew member', true, false),
('MANAGER', 'Ship Manager', 'Technical or commercial manager', false, true),
('INSURANCE', 'Insurance Provider', 'Hull or P&I insurance', false, true),
('FINANCIER', 'Financier', 'Financial backer or mortgagee', false, true)
ON CONFLICT (code) DO NOTHING;

-- Unit types (for metrics)
CREATE TABLE IF NOT EXISTS curated.unit_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,  -- 'LENGTH' | 'WEIGHT' | 'VOLUME' | 'POWER' | 'CURRENCY' | 'COUNT'
  symbol text,
  conversion_to_si numeric  -- Multiplier to convert to SI base unit
);

INSERT INTO curated.unit_types (code, name, category, symbol, conversion_to_si) VALUES
-- Length
('M', 'Meter', 'LENGTH', 'm', 1.0),
('FT', 'Foot', 'LENGTH', 'ft', 0.3048),
-- Weight
('MT', 'Metric Ton', 'WEIGHT', 't', 1000.0),
('KG', 'Kilogram', 'WEIGHT', 'kg', 1.0),
('LB', 'Pound', 'WEIGHT', 'lb', 0.453592),
-- Volume
('M3', 'Cubic Meter', 'VOLUME', 'm³', 1.0),
('GT', 'Gross Tonnage', 'VOLUME', 'GT', NULL),  -- Complex calculation
-- Power
('KW', 'Kilowatt', 'POWER', 'kW', 1.0),
('HP', 'Horsepower', 'POWER', 'hp', 0.745699872),
-- Count
('PERSONS', 'Persons', 'COUNT', NULL, 1.0),
('UNITS', 'Units', 'COUNT', NULL, 1.0)
ON CONFLICT (code) DO NOTHING;

-- Organization types
CREATE TABLE IF NOT EXISTS curated.organization_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text
);

INSERT INTO curated.organization_types (code, name, description) VALUES
('RFMO', 'Regional Fisheries Management Organization', 'Intergovernmental RFMO'),
('FLAG_STATE', 'Flag State Authority', 'National maritime authority'),
('FISHING_COMPANY', 'Fishing Company', 'Commercial fishing operator'),
('VESSEL_OWNER', 'Vessel Owner', 'Registered vessel owner'),
('PROCESSING_COMPANY', 'Processing Company', 'Fish processing facility'),
('EXPORTER', 'Exporter', 'Fish export company'),
('IMPORTER', 'Importer', 'Fish import company'),
('NGO', 'Non-Governmental Organization', 'Environmental or monitoring NGO'),
('ENFORCEMENT_AGENCY', 'Enforcement Agency', 'Fisheries enforcement authority')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- UPDATE TRIGGERS
-- =============================================================================

CREATE TRIGGER update_country_iso_updated_at BEFORE UPDATE ON curated.country_iso
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_rfmos_updated_at BEFORE UPDATE ON curated.rfmos
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_gear_types_fao_updated_at BEFORE UPDATE ON curated.gear_types_fao
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_harmonized_species_updated_at BEFORE UPDATE ON curated.harmonized_species
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

CREATE TRIGGER update_ports_updated_at BEFORE UPDATE ON curated.ports
FOR EACH ROW EXECUTE FUNCTION stage.update_updated_at_column();

-- =============================================================================
-- SAMPLE DATA (Minimal Bootstrap)
-- =============================================================================

-- Insert canonical RFMO list
INSERT INTO curated.rfmos (code, full_name, established_year, active) VALUES
('CCAMLR', 'Commission for the Conservation of Antarctic Marine Living Resources', 1982, true),
('CCSBT', 'Commission for the Conservation of Southern Bluefin Tuna', 1994, true),
('GFCM', 'General Fisheries Commission for the Mediterranean', 1952, true),
('IATTC', 'Inter-American Tropical Tuna Commission', 1950, true),
('ICCAT', 'International Commission for the Conservation of Atlantic Tunas', 1969, true),
('IOTC', 'Indian Ocean Tuna Commission', 1996, true),
('NAFO', 'Northwest Atlantic Fisheries Organization', 1979, true),
('NEAFC', 'North East Atlantic Fisheries Commission', 1982, true),
('NPFC', 'North Pacific Fisheries Commission', 2015, true),
('SEAFO', 'South East Atlantic Fisheries Organization', 2003, true),
('SIOFA', 'Southern Indian Ocean Fisheries Agreement', 2012, true),
('SPRFMO', 'South Pacific Regional Fisheries Management Organisation', 2013, true),
('WCPFC', 'Western and Central Pacific Fisheries Commission', 2004, true)
ON CONFLICT (code) DO NOTHING;

-- Note: Full reference data (ISO 3166 countries, FAO gear types, ASFIS species)
-- should be loaded via separate seed scripts due to volume (200+ countries, 60+ gear types, 12,000+ species)

COMMENT ON SCHEMA curated IS 'Curated maritime intelligence schema. Contains validated, deduplicated, and enriched vessel and entity data promoted from staging.';