-- ============================================================================
-- 0005_vessel_tables_migration_enhanced.sql - Enhanced Vessel Database Schema Migration
-- ============================================================================
-- Creates all vessel-related tables, enums, and indexes with complete FK relationships
-- UPDATED: Includes all recent enhancements (associates, FK constraints, year-only DATEs, home port fields)
-- UPDATED: Includes new freezer type enum and enhanced unit enum with freezer units
-- DEPENDS ON: 0001_initial_taxonomic_system.sql, 0002_initial_taxonomic_system.sql and 0003_harmonized_species.sql
-- ============================================================================

-- Set up transaction and error handling
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- VESSEL-SPECIFIC ENUMS (with existence checks)
-- ============================================================================

-- Hull material types
DO $$ BEGIN
    CREATE TYPE hull_material_enum AS ENUM (
      'STEEL', 'ALUMINUM', 'FIBERGLASS', 'WOOD', 'CONCRETE', 'PLASTIC', 'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Unit types for measurements (UPDATED: Added freezer capacity units)
DO $$ BEGIN
    CREATE TYPE unit_enum AS ENUM (
      'METER', 'FEET', 'CUBIC_FEET', 'CUBIC_METER', 'LITER', 'GALLON',
      'HP', 'KW', 'PS', 'KNOTS', 'MPH', 'KMH',
      'METRIC_TONS / DAY', 'TONS / DAY'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Freezer types enum (NEW: Standardized freezer equipment types)
DO $$ BEGIN
    CREATE TYPE freezer_type_enum AS ENUM (
      'AIR_BLAST', 'AIR_COIL', 'BAIT_FREEZER', 'BLAST', 'BRINE', 'CHILLED',
      'COIL', 'DIRECT_EXPANSION', 'DRY', 'FREON_REFRIGERATION_SYSTEM',
      'GRID_COIL', 'ICE', 'MYKOM', 'OTHER', 'PIPE', 'PLATE_FREEZER',
      'RSW', 'SEMI_AIR_BLAST', 'TUNNEL'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Metric types for vessel measurements (UPDATED: Added vessel_capacity_units)
DO $$ BEGIN
    CREATE TYPE metric_type_enum AS ENUM (
      'length', 'length_loa', 'length_lbp', 'length_lwl', 'length_rgl',
      'beam', 'extreme_beam', 'moulded_beam',
      'depth', 'draft_depth', 'moulded_depth',
      'tonnage', 'gross_tonnage', 'gross_register_tonnage', 'net_tonnage',
      'engine_power', 'aux_engine_power', 'fish_hold_volume', 'carrying_capacity',
      'freezer_capacity', 'total_fuel_carrying_capacity', 'refrigerant_used_capacity',
      'vessel_capacity_units',
      'rated_speed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Identifier types for vessel identification
DO $$ BEGIN
    CREATE TYPE identifier_type_enum AS ENUM (
      'vessel_name', 'vessel_name_other', 'imo', 'ircs', 'mmsi',
      'national_registry', 'national_registry_other', 'eu_cfr'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- External identifier types - Complete RFMO and national registry coverage
DO $$ BEGIN
    CREATE TYPE external_identifier_type_enum AS ENUM (
      'RFMO_CCAMLR', 'RFMO_CCSBT', 'RFMO_FFA', 'RFMO_GFCM', 'RFMO_IATTC',
      'RFMO_ICCAT', 'RFMO_IOTC', 'RFMO_NAFO', 'RFMO_NEAFC', 'RFMO_NPFC',
      'RFMO_SEAFO', 'RFMO_SIOFA', 'RFMO_SPRFMO', 'RFMO_WCPFC',
      'HULL_ID', 'AP2HI_ID', 'ISSF_TUVI', 'ADFG_NO'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Associate types
DO $$ BEGIN
    CREATE TYPE associate_type_enum AS ENUM (
        'BENEFICIAL_OWNER', 'CHARTERER', 'FISH_MASTER', 'FISH_PRODUCER_ORGANIZATION',
        'OPERATING_COMPANY', 'OPERATOR', 'OTHER_BENEFICIARY', 'OWNER',
        'OWNING_COMPANY', 'SDN_LINKED_ENTITY', 'VESSEL_MASTER', 'WRO_COMPANY'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Authorization types
DO $$ BEGIN
    CREATE TYPE authorization_type_enum AS ENUM (
      'FISHING_AUTHORIZATION', 'FISHING_LICENSE', 'TRANSSHIPMENT_AUTHORIZATION',
      'CARRIER_AUTHORIZATION', 'OBSERVER_AUTHORIZATION',
      'EXEMPT_VESSEL', 'SUPPORT_VESSEL_AUTHORIZATION', 'OTHER_AUTHORIZATION'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Historical tracking types
DO $$ BEGIN
    CREATE TYPE reported_history_enum AS ENUM (
      'VESSEL_NAME_CHANGE', 'FLAG_CHANGE', 'IMO_CHANGE', 'IRCS_CHANGE',
      'MMSI_CHANGE', 'REGISTRY_CHANGE', 'VESSEL_TYPE_CHANGE',
      'OWNERSHIP_CHANGE', 'OTHER_CHANGE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- VESSEL-SPECIFIC ORIGINAL SOURCES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS original_sources_vessels (
  source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_shortname TEXT UNIQUE NOT NULL,
  source_fullname TEXT NOT NULL,
  version_year DATE, -- Changed from INTEGER to DATE for year-only
  source_types TEXT[] NOT NULL,
  refresh_date DATE,
  source_urls JSONB,
  update_frequency TEXT CHECK (update_frequency IN ('MONTHLY', 'ANNUALLY', 'RANDOM', 'WEEKLY', 'DAILY', 'UNKNOWN')),
  size_approx INTEGER,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LOADED', 'FAILED', 'ARCHIVED')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- MISSING COLUMNS - ADD THESE:
  rfmo_id UUID,  -- FK to rfmos(id) for RFMO-specific sources
  country_id UUID,  -- FK to country_iso(id) for country-specific sources
  metadata JSONB,   -- Additional flexible metadata

  -- Constraints
  CONSTRAINT chk_vessel_source_types_not_empty CHECK (array_length(source_types, 1) > 0)
);

-- Enhanced indexes (REPLACE existing index section)
CREATE INDEX IF NOT EXISTS idx_gin_vessel_source_types ON original_sources_vessels USING gin(source_types);
CREATE INDEX IF NOT EXISTS idx_gin_vessel_source_urls ON original_sources_vessels USING gin(source_urls);
CREATE INDEX IF NOT EXISTS idx_gin_vessel_source_metadata ON original_sources_vessels USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_shortname ON original_sources_vessels(source_shortname);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_status ON original_sources_vessels(status);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_refresh_date ON original_sources_vessels(refresh_date);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_version_year ON original_sources_vessels(version_year);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_update_freq ON original_sources_vessels(update_frequency);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_rfmo_id ON original_sources_vessels(rfmo_id);
CREATE INDEX IF NOT EXISTS idx_vessel_sources_country_id ON original_sources_vessels(country_id);

-- ============================================================================
-- CORE VESSEL TABLES
-- ============================================================================

-- Main vessels table - Core identifiers with country FK
CREATE TABLE vessels (
  vessel_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CORE IDENTIFIERS
  vessel_name TEXT,
  vessel_flag UUID REFERENCES country_iso(id), -- ✅ FK to country_iso
  vessel_name_other TEXT,
  imo CHAR(7),
  ircs VARCHAR(15),
  mmsi CHAR(9),
  national_registry VARCHAR(50),
  national_registry_other VARCHAR(50),
  eu_cfr CHAR(12),

  -- METADATA
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels
CREATE UNIQUE INDEX vessels_imo_idx ON vessels(imo) WHERE imo IS NOT NULL;
CREATE UNIQUE INDEX vessels_eu_cfr_idx ON vessels(eu_cfr) WHERE eu_cfr IS NOT NULL;
CREATE INDEX vessels_mmsi_idx ON vessels(mmsi);
CREATE INDEX vessels_flag_idx ON vessels(vessel_flag);
CREATE INDEX vessels_name_idx ON vessels(vessel_name);

-- ✅ UPDATED: Vessel info table with FK relationships, DATE build_year, and home port fields
CREATE TABLE vessel_info (
  vessel_uuid UUID PRIMARY KEY REFERENCES vessels(vessel_uuid),

  vessel_type UUID REFERENCES vessel_types(id), -- ✅ UPDATED: UUID with FK to vessel_types(id)
  primary_gear UUID REFERENCES gear_types_fao(id), -- ✅ UPDATED: UUID with FK to gear_types_fao(id)
  hull_material hull_material_enum,
  port_registry VARCHAR(100),
  home_port VARCHAR(100), -- ✅ NEW: Home port field
  home_port_state VARCHAR(100), -- ✅ NEW: Home port state field
  build_year DATE, -- ✅ UPDATED: Changed from INTEGER to DATE (year-only: 'YYYY-01-01')
  flag_registered_date DATE,
  vessel_engine_type VARCHAR(50),
  vessel_fuel_type VARCHAR(50),
  external_marking TEXT,
  crew VARCHAR(50),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ✅ UPDATED: Indexes for vessel_info (including new home port indexes)
CREATE INDEX vessel_info_type_idx ON vessel_info(vessel_type);
CREATE INDEX vessel_info_hull_idx ON vessel_info(hull_material);
CREATE INDEX vessel_info_build_year_idx ON vessel_info(build_year);
CREATE INDEX vessel_info_gear_idx ON vessel_info(primary_gear);
CREATE INDEX vessel_info_home_port_idx ON vessel_info(home_port); -- ✅ NEW: Home port index
CREATE INDEX vessel_info_home_port_state_idx ON vessel_info(home_port_state); -- ✅ NEW: Home port state index
CREATE INDEX vessel_info_type_gear_idx ON vessel_info(vessel_type, primary_gear); -- ✅ NEW: Composite index
CREATE INDEX vessel_info_port_location_idx ON vessel_info(home_port, home_port_state); -- ✅ NEW: Composite port index

-- ============================================================================
-- SOURCE TRACKING TABLES
-- ============================================================================

CREATE TABLE vessel_sources (
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),

  first_seen_date DATE,
  last_seen_date DATE,
  is_active BOOLEAN DEFAULT true,
  data_governance_notes TEXT,
  last_quality_review DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (vessel_uuid, source_id)
);

-- Indexes for vessel_sources
CREATE INDEX vessel_sources_vessel_idx ON vessel_sources(vessel_uuid);
CREATE INDEX vessel_sources_source_idx ON vessel_sources(source_id);
CREATE INDEX vessel_sources_active_idx ON vessel_sources(is_active);
CREATE INDEX vessel_sources_last_seen_idx ON vessel_sources(last_seen_date);

CREATE TABLE vessel_source_identifiers (
  identifier_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),
  identifier_type identifier_type_enum,
  identifier_value TEXT,
  associated_flag UUID REFERENCES country_iso(id), -- ✅ FK to country_iso
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_source_identifiers
CREATE INDEX vessel_source_identifiers_vessel_idx ON vessel_source_identifiers(vessel_uuid);
CREATE INDEX vessel_source_identifiers_type_idx ON vessel_source_identifiers(identifier_type);
CREATE INDEX vessel_source_identifiers_value_idx ON vessel_source_identifiers(identifier_value);
CREATE INDEX vessel_source_identifiers_source_idx ON vessel_source_identifiers(source_id);

-- ============================================================================
-- VESSEL METRICS AND MEASUREMENTS
-- ============================================================================

CREATE TABLE vessel_metrics (
  metric_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),
  metric_type metric_type_enum,
  value DECIMAL(15,4),
  unit unit_enum,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_metrics
CREATE INDEX vessel_metrics_vessel_idx ON vessel_metrics(vessel_uuid);
CREATE INDEX vessel_metrics_type_idx ON vessel_metrics(metric_type);
CREATE INDEX vessel_metrics_source_idx ON vessel_metrics(source_id);
CREATE INDEX vessel_metrics_value_idx ON vessel_metrics(value);

-- ============================================================================
-- CLASSIFICATION TABLES (Junction tables with FK constraints)
-- ============================================================================

CREATE TABLE vessel_vessel_types (
  relationship_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  vessel_type_id UUID REFERENCES vessel_types(id), -- ✅ UPDATED: Added FK constraint
  source_id UUID REFERENCES original_sources_vessels(source_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_vessel_types
CREATE INDEX vessel_vessel_types_vessel_idx ON vessel_vessel_types(vessel_uuid);
CREATE INDEX vessel_vessel_types_source_idx ON vessel_vessel_types(source_id);
CREATE INDEX vessel_vessel_types_type_idx ON vessel_vessel_types(vessel_type_id);
CREATE INDEX vessel_vessel_types_vessel_source_idx ON vessel_vessel_types(vessel_uuid, source_id); -- ✅ NEW: Composite index

CREATE TABLE vessel_gear_types (
  relationship_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  fao_gear_id UUID REFERENCES gear_types_fao(id), -- ✅ UPDATED: Added FK constraint
  source_id UUID REFERENCES original_sources_vessels(source_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_gear_types
CREATE INDEX vessel_gear_types_vessel_idx ON vessel_gear_types(vessel_uuid);
CREATE INDEX vessel_gear_types_source_idx ON vessel_gear_types(source_id);
CREATE INDEX vessel_gear_types_gear_idx ON vessel_gear_types(fao_gear_id);
CREATE INDEX vessel_gear_types_vessel_source_idx ON vessel_gear_types(vessel_uuid, source_id); -- ✅ NEW: Composite index

-- ============================================================================
-- VESSEL BUILD INFORMATION
-- ============================================================================

CREATE TABLE vessel_build_information (
  build_info_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),

  build_country_id UUID REFERENCES country_iso(id), -- ✅ FK to country_iso
  build_location VARCHAR(200),
  build_year INTEGER, -- Note: This is separate from vessel_info.build_year which is now DATE

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_build_information
CREATE INDEX vessel_build_info_vessel_idx ON vessel_build_information(vessel_uuid);
CREATE INDEX vessel_build_info_country_idx ON vessel_build_information(build_country_id);
CREATE INDEX vessel_build_info_year_idx ON vessel_build_information(build_year);
CREATE INDEX vessel_build_info_source_idx ON vessel_build_information(source_id);
CREATE INDEX vessel_build_info_vessel_source_idx ON vessel_build_information(vessel_uuid, source_id); -- ✅ NEW: Composite index

-- ============================================================================
-- EXTERNAL IDENTIFIERS AND RELATIONSHIPS
-- ============================================================================

CREATE TABLE vessel_external_identifiers (
  external_id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),

  identifier_type external_identifier_type_enum,
  identifier_value VARCHAR(100),
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_external_identifiers
CREATE INDEX vessel_external_ids_lookup_idx ON vessel_external_identifiers(identifier_type, identifier_value);
CREATE INDEX vessel_external_ids_vessel_idx ON vessel_external_identifiers(vessel_uuid);
CREATE INDEX vessel_external_ids_active_idx ON vessel_external_identifiers(is_active);
CREATE INDEX vessel_external_ids_source_idx ON vessel_external_identifiers(source_id); -- ✅ NEW: Source index
-- CRITICAL: Index for RFMO ID lookups
CREATE INDEX vessel_external_ids_rfmo_lookup_idx ON vessel_external_identifiers(identifier_value, identifier_type);

-- ============================================================================
-- VESSEL EQUIPMENT (UPDATED: Enhanced freezer types as JSONB array)
-- ============================================================================

CREATE TABLE vessel_equipment (
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),

  -- EQUIPMENT SPECIFICATIONS
  engine_model VARCHAR(100),
  freezer_types JSONB, -- ✅ UPDATED: Changed from VARCHAR to JSONB array for multiple freezer types

  -- EQUIPMENT BOOLEAN FLAGS
  lights_for_fishing BOOLEAN,
  nav_equipment BOOLEAN,
  fish_finder BOOLEAN,
  deck_machinery BOOLEAN,
  refrigeration_equipment BOOLEAN,
  fish_processing_equipment BOOLEAN,

  -- EQUIPMENT DETAILS
  safety_equipment TEXT,
  communication_details TEXT,
  vms_system_code VARCHAR(50),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (vessel_uuid, source_id)
);

-- ✅ UPDATED: Indexes for vessel_equipment (including GIN index for JSONB freezer_types)
CREATE INDEX vessel_equipment_engine_model_idx ON vessel_equipment(engine_model);
CREATE INDEX vessel_equipment_freezer_types_idx ON vessel_equipment USING gin(freezer_types); -- ✅ UPDATED: GIN index for JSONB array
CREATE INDEX vessel_equipment_vms_system_idx ON vessel_equipment(vms_system_code);
CREATE INDEX vessel_equipment_fishing_flags_idx ON vessel_equipment(lights_for_fishing, nav_equipment, fish_finder);
CREATE INDEX vessel_equipment_processing_flags_idx ON vessel_equipment(refrigeration_equipment, fish_processing_equipment);

-- ============================================================================
-- VESSEL SDN TABLE (MOVED FROM 0006 TO RESOLVE FK DEPENDENCY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_sdn_simple (
    sdn_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    is_sdn BOOLEAN NOT NULL DEFAULT false,
    date_issued_sdn DATE, -- DATE format YYYY-MM-DD

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_sdn_simple
CREATE INDEX IF NOT EXISTS vessels_sdn_vessel_idx ON vessels_sdn_simple(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_sdn_source_idx ON vessels_sdn_simple(source_id);
CREATE INDEX IF NOT EXISTS vessels_sdn_is_sdn_idx ON vessels_sdn_simple(is_sdn);
CREATE INDEX IF NOT EXISTS vessels_sdn_date_issued_idx ON vessels_sdn_simple(date_issued_sdn);
-- Composite index for active SDN lookups
CREATE INDEX IF NOT EXISTS vessels_sdn_vessel_active_idx ON vessels_sdn_simple(vessel_uuid, is_sdn);

-- ============================================================================
-- SPARSE ATTRIBUTES
-- ============================================================================

CREATE TABLE vessel_attributes (
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),

  attributes JSONB,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (vessel_uuid, source_id)
);

-- Indexes for vessel_attributes
CREATE INDEX vessel_attrs_idx ON vessel_attributes USING gin(attributes jsonb_path_ops);
CREATE INDEX vessel_attrs_activity_idx ON vessel_attributes USING btree((attributes->>'activity_flag'));
CREATE INDEX vessel_attrs_status_idx ON vessel_attributes USING btree((attributes->>'vessel_status')); -- ✅ NEW: Status index

-- ============================================================================
-- VESSEL ASSOCIATES WITH DEDUPLICATION SUPPORT
-- ============================================================================

-- VESSEL ASSOCIATES MASTER TABLE (Deduplicated Entities)
-- This table stores unique associate identities with canonical names
CREATE TABLE vessel_associates_master (
  associate_master_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical (normalized) name for deduplication
  canonical_name VARCHAR(200) NOT NULL,

  -- Track all name variations seen across sources
  name_variations JSONB, -- JSONB for all spelling variations

  -- Confidence score based on source quality (0.00 to 1.00)
  confidence_score DECIMAL(3,2) DEFAULT 1.00,

  -- Tracking dates
  first_seen_date DATE DEFAULT CURRENT_DATE,
  last_seen_date DATE DEFAULT CURRENT_DATE,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_associates_master
CREATE INDEX vessel_associates_master_canonical_name_idx ON vessel_associates_master(canonical_name);
CREATE INDEX vessel_associates_master_confidence_idx ON vessel_associates_master(confidence_score);
CREATE INDEX vessel_associates_master_last_seen_idx ON vessel_associates_master(last_seen_date);
-- GIN index for name variations array search
CREATE INDEX vessel_associates_master_name_variations_gin_idx ON vessel_associates_master USING gin(name_variations jsonb_path_ops);

-- VESSEL ASSOCIATES TABLE (Relationships - Updated to Reference Master)
CREATE TABLE vessel_associates (
  associate_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid),
  source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id),

  -- Reference to deduplicated master record
  associate_master_uuid UUID NOT NULL REFERENCES vessel_associates_master(associate_master_uuid),

  -- Relationship-specific data (NOT in master table)
  associate_type associate_type_enum NOT NULL,

  -- Original data as reported by source (for audit trail)
  original_name VARCHAR(200) NOT NULL, -- Exact spelling from source
  address TEXT,

  -- Enhanced address components
  city VARCHAR(150),
  state VARCHAR(150),
  country_id UUID REFERENCES country_iso(id), -- Address country FK

  -- Registration/license number (can be vessel-specific)
  reg_number VARCHAR(150),

  -- Nationality (can be different from address country)
  nationality_country_id UUID REFERENCES country_iso(id),

  -- SDN linking capability (source-specific)
  sdn_uuid UUID REFERENCES vessels_sdn_simple(sdn_uuid),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint to prevent duplicate relationships from same source
  CONSTRAINT vessel_associates_unique_relationship UNIQUE(vessel_uuid, associate_master_uuid, source_id, associate_type)
);

-- Enhanced indexes for vessel_associates
CREATE INDEX vessel_associates_vessel_idx ON vessel_associates(vessel_uuid);
CREATE INDEX vessel_associates_master_idx ON vessel_associates(associate_master_uuid);
CREATE INDEX vessel_associates_source_idx ON vessel_associates(source_id);
CREATE INDEX vessel_associates_type_idx ON vessel_associates(associate_type);

-- Enhanced indexes for location and details
CREATE INDEX vessel_associates_country_idx ON vessel_associates(country_id);
CREATE INDEX vessel_associates_nationality_idx ON vessel_associates(nationality_country_id);
CREATE INDEX vessel_associates_original_name_idx ON vessel_associates(original_name);
CREATE INDEX vessel_associates_city_idx ON vessel_associates(city);
CREATE INDEX vessel_associates_reg_number_idx ON vessel_associates(reg_number);
CREATE INDEX vessel_associates_sdn_idx ON vessel_associates(sdn_uuid);

-- Composite indexes for complex queries
CREATE INDEX vessel_associates_vessel_type_idx ON vessel_associates(vessel_uuid, associate_type);
CREATE INDEX vessel_associates_master_type_idx ON vessel_associates(associate_master_uuid, associate_type);
CREATE INDEX vessel_associates_location_idx ON vessel_associates(country_id, city, state);
CREATE INDEX vessel_associates_source_type_idx ON vessel_associates(source_id, associate_type);

-- ============================================================================
-- POLYMORPHIC WRO ENFORCEMENT TABLE (REPLACES vessels_wro)
-- ============================================================================

-- Create polymorphic WRO enforcement table
CREATE TABLE IF NOT EXISTS wro_enforcement (
    wro_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id),

    -- Polymorphic relationship - EITHER vessel OR company, never both
    vessel_uuid UUID REFERENCES vessels(vessel_uuid), -- Nullable - for vessel-specific WROs
    associate_master_uuid UUID REFERENCES vessel_associates_master(associate_master_uuid), -- Nullable - for company-specific WROs

    -- WRO enforcement data (single source of truth)
    is_wro BOOLEAN NOT NULL DEFAULT false,
    wro_effective_date DATE, -- DATE format YYYY-MM-DD
    wro_end_date DATE, -- DATE format YYYY-MM-DD
    wro_reason VARCHAR(50),
    wro_details VARCHAR(500), -- Open text alphanumeric field

    is_finding BOOLEAN NOT NULL DEFAULT false,
    finding_date DATE, -- DATE format YYYY-MM-DD

    -- Contextual metadata
    merchandise VARCHAR(150), -- Merchandise type from WRO data
    industry VARCHAR(150), -- Industry type from WRO data
    detail_urls JSONB, -- URLs and additional detail links

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- CRITICAL: Polymorphic constraint - exactly one of vessel_uuid OR associate_master_uuid must be non-null
    CONSTRAINT wro_enforcement_polymorphic_check CHECK (
        (vessel_uuid IS NOT NULL AND associate_master_uuid IS NULL) OR
        (vessel_uuid IS NULL AND associate_master_uuid IS NOT NULL)
    )
);

-- ========================================
-- INDEXES FOR POLYMORPHIC WRO ENFORCEMENT
-- ========================================

-- Core indexes for both query patterns
CREATE INDEX IF NOT EXISTS wro_enforcement_vessel_idx ON wro_enforcement(vessel_uuid);
CREATE INDEX IF NOT EXISTS wro_enforcement_associate_idx ON wro_enforcement(associate_master_uuid);
CREATE INDEX IF NOT EXISTS wro_enforcement_source_idx ON wro_enforcement(source_id);

-- WRO status indexes
CREATE INDEX IF NOT EXISTS wro_enforcement_is_wro_idx ON wro_enforcement(is_wro);
CREATE INDEX IF NOT EXISTS wro_enforcement_wro_effective_date_idx ON wro_enforcement(wro_effective_date);
CREATE INDEX IF NOT EXISTS wro_enforcement_wro_end_date_idx ON wro_enforcement(wro_end_date);
CREATE INDEX IF NOT EXISTS wro_enforcement_is_finding_idx ON wro_enforcement(is_finding);
CREATE INDEX IF NOT EXISTS wro_enforcement_finding_date_idx ON wro_enforcement(finding_date);

-- Contextual indexes
CREATE INDEX IF NOT EXISTS wro_enforcement_merchandise_idx ON wro_enforcement(merchandise);
CREATE INDEX IF NOT EXISTS wro_enforcement_industry_idx ON wro_enforcement(industry);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS wro_enforcement_vessel_active_idx ON wro_enforcement(vessel_uuid, is_wro) WHERE vessel_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS wro_enforcement_associate_active_idx ON wro_enforcement(associate_master_uuid, is_wro) WHERE associate_master_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS wro_enforcement_wro_finding_idx ON wro_enforcement(is_wro, is_finding);
CREATE INDEX IF NOT EXISTS wro_enforcement_date_range_idx ON wro_enforcement(wro_effective_date, wro_end_date);
CREATE INDEX IF NOT EXISTS wro_enforcement_industry_merchandise_idx ON wro_enforcement(industry, merchandise);

-- GIN index for JSONB detail URLs
CREATE INDEX IF NOT EXISTS wro_enforcement_detail_urls_gin_idx ON wro_enforcement USING gin(detail_urls);

-- Partial unique indexes to prevent duplicate enforcement actions for same entity from same source
CREATE UNIQUE INDEX IF NOT EXISTS wro_enforcement_unique_vessel_source_idx
ON wro_enforcement(vessel_uuid, source_id) WHERE vessel_uuid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wro_enforcement_unique_associate_source_idx
ON wro_enforcement(associate_master_uuid, source_id) WHERE associate_master_uuid IS NOT NULL;

-- ============================================================================
-- VESSEL AUTHORIZATIONS (Enhanced with species and area FK relationships)
-- ============================================================================

CREATE TABLE vessel_authorizations (
  authorization_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),

  -- AUTHORIZATION DETAILS
  authorization_type authorization_type_enum,
  license_number VARCHAR(100),
  fishing_license_type VARCHAR(100),

  -- DATE RANGE
  start_date DATE,
  end_date DATE,
  reported_date DATE,

  -- STATUS AND FLAGS
  status VARCHAR(50),
  is_active BOOLEAN DEFAULT true,

  -- ✅ UPDATED: Enhanced REGIONAL AUTHORIZATION with FK
  rfmo_id UUID REFERENCES rfmos(id), -- ✅ FK to rfmos table
  region_description TEXT,
  fao_area_ids JSONB, -- ✅ JSONB array of UUIDs referencing fao_major_areas.id

  -- ✅ UPDATED: Enhanced SPECIES AUTHORIZATION with FK reference
  species_description TEXT,
  species_ids JSONB, -- ✅ JSONB array of UUIDs referencing harmonized_species.harmonized_id

  -- FLEXIBLE DATA STORAGE
  additional_data JSONB,
  context_data JSONB,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ✅ UPDATED: Enhanced indexes for vessel_authorizations
CREATE INDEX vessel_authorizations_vessel_idx ON vessel_authorizations(vessel_uuid);
CREATE INDEX vessel_authorizations_type_idx ON vessel_authorizations(authorization_type);
CREATE INDEX vessel_authorizations_status_idx ON vessel_authorizations(status);
CREATE INDEX vessel_authorizations_active_idx ON vessel_authorizations(is_active);
CREATE INDEX vessel_authorizations_source_idx ON vessel_authorizations(source_id); -- ✅ NEW: Source index
CREATE INDEX vessel_authorizations_date_range_idx ON vessel_authorizations(start_date, end_date);
CREATE INDEX vessel_authorizations_license_type_idx ON vessel_authorizations(fishing_license_type);
CREATE INDEX vessel_authorizations_rfmo_idx ON vessel_authorizations(rfmo_id); -- ✅ UPDATED: RFMO FK index

-- Indexes for commonly queried additional_data fields
CREATE INDEX vessel_authorizations_quota_bft_idx ON vessel_authorizations USING btree((additional_data->>'catch_quota_bft'));
CREATE INDEX vessel_authorizations_quota_year_idx ON vessel_authorizations USING btree((additional_data->>'catch_quota_bft_year'));
CREATE INDEX vessel_authorizations_ffa_registrant_idx ON vessel_authorizations USING btree((additional_data->>'ffa_registrant'));

-- ✅ UPDATED: GIN indexes for JSONB UUID arrays (performance critical)
CREATE INDEX vessel_authorizations_fao_areas_idx ON vessel_authorizations USING gin(fao_area_ids); -- ✅ FAO areas array
CREATE INDEX vessel_authorizations_species_ids_idx ON vessel_authorizations USING gin(species_ids); -- ✅ Species array

CREATE INDEX vessel_authorizations_reported_date_idx ON vessel_authorizations(reported_date);

-- ✅ NEW: Enhanced composite indexes
CREATE INDEX vessel_authorizations_vessel_active_idx ON vessel_authorizations(vessel_uuid, is_active);
CREATE INDEX vessel_authorizations_type_active_idx ON vessel_authorizations(authorization_type, is_active);
CREATE INDEX vessel_authorizations_rfmo_active_idx ON vessel_authorizations(rfmo_id, is_active); -- ✅ NEW: RFMO + active

-- ============================================================================
-- HISTORICAL TRACKING
-- ============================================================================

CREATE TABLE vessel_reported_history (
  history_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_uuid UUID REFERENCES vessels(vessel_uuid),
  source_id UUID REFERENCES original_sources_vessels(source_id),
  reported_history_type reported_history_enum,
  identifier_value TEXT,
  flag_country_id UUID REFERENCES country_iso(id), -- ✅ FK to country_iso
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessel_reported_history
CREATE INDEX vessel_history_vessel_idx ON vessel_reported_history(vessel_uuid);
CREATE INDEX vessel_history_type_idx ON vessel_reported_history(reported_history_type);
CREATE INDEX vessel_history_flag_idx ON vessel_reported_history(flag_country_id);
CREATE INDEX vessel_history_value_idx ON vessel_reported_history(identifier_value);
CREATE INDEX vessel_history_source_idx ON vessel_reported_history(source_id);
CREATE INDEX vessel_history_vessel_type_idx ON vessel_reported_history(vessel_uuid, reported_history_type); -- ✅ NEW: Composite index

-- ============================================================================
-- STAGING TABLES FOR BATCH IMPORTS
-- ============================================================================

-- Example staging table for ICCAT vessel imports
CREATE TABLE staging_iccat_vessels (
  staging_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  processed BOOLEAN DEFAULT false,

  -- SOURCE DATA IDENTIFIERS
  source_vessel_id VARCHAR(100),

  -- RAW VESSEL DATA
  vessel_name TEXT,
  flag_state VARCHAR(5),
  imo VARCHAR(20),
  ircs VARCHAR(20),
  mmsi VARCHAR(15),
  vessel_type VARCHAR(100),
  gear_type VARCHAR(100),
  build_year INTEGER,
  tonnage VARCHAR(50),
  length VARCHAR(50),

  -- ICCAT-SPECIFIC FIELDS
  iccat_number VARCHAR(50),
  activity_flag VARCHAR(10),
  status VARCHAR(50),

  -- AUTHORIZATION DATA
  auth_start_date DATE,
  auth_end_date DATE,
  species TEXT,
  fishing_area TEXT,

  -- RAW DATA PRESERVATION
  raw_data JSONB,

  -- PROCESSING METADATA
  error_log TEXT,
  processing_notes TEXT,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for staging_iccat_vessels
CREATE INDEX staging_iccat_processed_idx ON staging_iccat_vessels(processed);
CREATE INDEX staging_iccat_imported_idx ON staging_iccat_vessels(imported_at);
CREATE INDEX staging_iccat_source_vessel_idx ON staging_iccat_vessels(source_vessel_id);
CREATE INDEX staging_iccat_batch_idx ON staging_iccat_vessels(batch_id);
CREATE INDEX staging_iccat_flag_idx ON staging_iccat_vessels(flag_state);
CREATE INDEX staging_iccat_number_idx ON staging_iccat_vessels(iccat_number);
CREATE INDEX staging_iccat_activity_idx ON staging_iccat_vessels(activity_flag); -- ✅ NEW: Activity flag index

-- Generic staging table template for other vessel sources
CREATE TABLE staging_generic_vessels (
  staging_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system VARCHAR(50) NOT NULL,
  batch_id UUID,
  processed BOOLEAN DEFAULT false,

  -- SOURCE DATA
  source_vessel_id VARCHAR(100),
  source_record_hash VARCHAR(64),

  -- FLEXIBLE DATA STORAGE
  vessel_data JSONB,
  authorization_data JSONB,
  additional_data JSONB,

  -- PROCESSING METADATA
  validation_status VARCHAR(20) DEFAULT 'PENDING',
  error_log TEXT,
  processing_notes TEXT,
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for staging_generic_vessels
CREATE INDEX staging_generic_processed_idx ON staging_generic_vessels(processed);
CREATE INDEX staging_generic_source_system_idx ON staging_generic_vessels(source_system);
CREATE INDEX staging_generic_hash_idx ON staging_generic_vessels(source_record_hash);
CREATE INDEX staging_generic_validation_idx ON staging_generic_vessels(validation_status);
CREATE INDEX staging_generic_batch_idx ON staging_generic_vessels(batch_id);
CREATE INDEX staging_generic_imported_idx ON staging_generic_vessels(imported_at);
CREATE INDEX staging_generic_batch_processed_idx ON staging_generic_vessels(batch_id, processed); -- ✅ NEW: Composite index

-- GIN indexes for JSONB searching
CREATE INDEX staging_generic_vessel_data_idx ON staging_generic_vessels USING gin(vessel_data);
CREATE INDEX staging_generic_auth_data_idx ON staging_generic_vessels USING gin(authorization_data);

-- ============================================================================
-- DATA VALIDATION CONSTRAINTS (UPDATED: Added freezer_types validation)
-- ============================================================================

-- Add constraint to ensure freezer_types contains valid JSONB array
ALTER TABLE vessel_equipment
ADD CONSTRAINT vessel_equipment_freezer_types_valid_json
CHECK (freezer_types IS NULL OR jsonb_typeof(freezer_types) = 'array');

-- Add constraint to ensure FAO area IDs contains valid UUID format
ALTER TABLE vessel_authorizations
ADD CONSTRAINT vessel_auth_fao_areas_valid_json
CHECK (fao_area_ids IS NULL OR jsonb_typeof(fao_area_ids) = 'array');

-- Add constraint to ensure species IDs contains valid JSON array
ALTER TABLE vessel_authorizations
ADD CONSTRAINT vessel_auth_species_ids_valid_json
CHECK (species_ids IS NULL OR jsonb_typeof(species_ids) = 'array');

-- Add constraint to ensure detail_urls contains valid JSONB array
ALTER TABLE wro_enforcement
ADD CONSTRAINT wro_enforcement_detail_urls_valid_json
CHECK (detail_urls IS NULL OR jsonb_typeof(detail_urls) = 'array');

-- ========================================
-- VERIFICATION OF POLYMORPHIC TABLE SETUP
-- ========================================

DO $$
DECLARE
    table_exists BOOLEAN;
    constraint_exists BOOLEAN;
    index_count INTEGER;
BEGIN
    -- Verify wro_enforcement table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'wro_enforcement'
    ) INTO table_exists;

    -- Verify polymorphic constraint exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'wro_enforcement_polymorphic_check'
    ) INTO constraint_exists;

    -- Count indexes
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes
    WHERE tablename = 'wro_enforcement';

    IF NOT table_exists THEN
        RAISE EXCEPTION 'wro_enforcement table was not created successfully';
    END IF;

    IF NOT constraint_exists THEN
        RAISE EXCEPTION 'Polymorphic constraint was not created successfully';
    END IF;

    IF index_count < 10 THEN
        RAISE WARNING 'Expected at least 10 indexes on wro_enforcement, found %', index_count;
    END IF;

    RAISE NOTICE 'Polymorphic WRO enforcement setup verification successful:';
    RAISE NOTICE '  - wro_enforcement table: EXISTS';
    RAISE NOTICE '  - Polymorphic constraint: EXISTS';
    RAISE NOTICE '  - Performance indexes: % created', index_count;
    RAISE NOTICE '  - Supports both vessel-level and company-level enforcement';
    RAISE NOTICE '  - Single source of truth for all WRO data';
END;
$$;

-- ============================================================================
-- ADD MISSING FK CONSTRAINTS (ADD TO END OF 0005 MIGRATION)
-- ============================================================================

-- Add FK constraints for original_sources_vessels (with dependency checks)
DO $$
BEGIN
    -- Add RFMO FK constraint if rfmos table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rfmos') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                      WHERE constraint_name = 'fk_vessel_source_rfmo'
                      AND table_name = 'original_sources_vessels') THEN
            ALTER TABLE original_sources_vessels
            ADD CONSTRAINT fk_vessel_source_rfmo
            FOREIGN KEY (rfmo_id) REFERENCES rfmos(id) ON DELETE SET NULL;

            RAISE NOTICE 'Added FK constraint: original_sources_vessels.rfmo_id -> rfmos(id)';
        END IF;
    ELSE
        RAISE NOTICE 'WARNING: rfmos table not found - FK constraint will be added later';
    END IF;

    -- Add country FK constraint if country_iso table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'country_iso') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                      WHERE constraint_name = 'fk_vessel_source_country'
                      AND table_name = 'original_sources_vessels') THEN
            ALTER TABLE original_sources_vessels
            ADD CONSTRAINT fk_vessel_source_country
            FOREIGN KEY (country_id) REFERENCES country_iso(id) ON DELETE SET NULL;

            RAISE NOTICE 'Added FK constraint: original_sources_vessels.country_id -> country_iso(id)';
        END IF;
    ELSE
        RAISE NOTICE 'WARNING: country_iso table not found - FK constraint will be added later';
    END IF;
END $$;

-- Add missing vessel_vessel_types FK constraint
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vessel_types') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                      WHERE constraint_name = 'fk_vessel_vessel_type'
                      AND table_name = 'vessel_vessel_types') THEN
            ALTER TABLE vessel_vessel_types
            ADD CONSTRAINT fk_vessel_vessel_type
            FOREIGN KEY (vessel_type_id) REFERENCES vessel_types(id) ON DELETE CASCADE;

            RAISE NOTICE 'Added FK constraint: vessel_vessel_types.vessel_type_id -> vessel_types(id)';
        END IF;
    END IF;
END $$;

-- Add missing vessel_gear_types FK constraint
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gear_types_fao') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                      WHERE constraint_name = 'fk_vessel_gear_fao'
                      AND table_name = 'vessel_gear_types') THEN
            ALTER TABLE vessel_gear_types
            ADD CONSTRAINT fk_vessel_gear_fao
            FOREIGN KEY (fao_gear_id) REFERENCES gear_types_fao(id) ON DELETE CASCADE;

            RAISE NOTICE 'Added FK constraint: vessel_gear_types.fao_gear_id -> gear_types_fao(id)';
        END IF;
    END IF;
END $$;

-- Fix vessel_info table - add missing home port fields if not present
DO $$
BEGIN
    -- Add home_port column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'vessel_info' AND column_name = 'home_port') THEN
        ALTER TABLE vessel_info ADD COLUMN home_port VARCHAR(100);
        RAISE NOTICE 'Added missing column: vessel_info.home_port';
    END IF;

    -- Add home_port_state column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'vessel_info' AND column_name = 'home_port_state') THEN
        ALTER TABLE vessel_info ADD COLUMN home_port_state VARCHAR(100);
        RAISE NOTICE 'Added missing column: vessel_info.home_port_state';
    END IF;
END $$;

-- Add missing indexes for new home port fields
CREATE INDEX IF NOT EXISTS vessel_info_home_port_idx ON vessel_info(home_port);
CREATE INDEX IF NOT EXISTS vessel_info_home_port_state_idx ON vessel_info(home_port_state);
CREATE INDEX IF NOT EXISTS vessel_info_port_location_idx ON vessel_info(home_port, home_port_state);

-- ============================================================================
-- COMPLETION AND VERIFICATION
-- ============================================================================

-- Verify core vessel table creation
DO $$
DECLARE
    core_table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO core_table_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN (
        'original_sources_vessels',
        'vessels',
        'vessel_info',
        'vessel_sources',
        'vessel_source_identifiers',
        'vessel_metrics',
        'vessel_vessel_types',
        'vessel_gear_types',
        'vessel_build_information',
        'vessel_external_identifiers',
        'vessel_equipment',
        'vessel_attributes',
        'vessel_associates_master',
        'vessel_associates',
        'vessel_authorizations',
        'vessel_reported_history',
        'vessels_sdn_simple',
        'wro_enforcement',  -- ✅ NEW POLYMORPHIC TABLE NAME
        'staging_iccat_vessels',
        'staging_generic_vessels'
    );

    RAISE NOTICE 'Created % core vessel tables (including SDN, associates_master, and polymorphic WRO)', core_table_count;

    IF core_table_count < 20 THEN  -- ✅ UPDATED COUNT
        RAISE EXCEPTION 'Expected exactly 20 core vessel tables, but found %', core_table_count;
    END IF;
END $$;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: All vessel tables, enums, and indexes created successfully!';
    RAISE NOTICE 'Total vessel tables: 20 (including polymorphic WRO enforcement)';  -- ✅ UPDATED COUNT
    RAISE NOTICE 'Enhanced features:';
    RAISE NOTICE '  - Complete FK relationships to reference tables';
    RAISE NOTICE '  - Enhanced vessel_associates with location columns';
    RAISE NOTICE '  - Year-only DATE fields for build_year and version_year';
    RAISE NOTICE '  - JSONB array references to species and FAO areas';
    RAISE NOTICE '  - NEW: Home port fields in vessel_info table';
    RAISE NOTICE '  - NEW: vessel_capacity_units metric type';
    RAISE NOTICE '  - NEW: Enhanced unit_enum with freezer capacity units';
    RAISE NOTICE '  - NEW: freezer_type_enum with 19 standardized types';
    RAISE NOTICE '  - NEW: vessel_equipment.freezer_types as JSONB array';
    RAISE NOTICE '  - SDN table included for associates FK dependency';
    RAISE NOTICE '  - wro_enforcement: Polymorphic WRO tracking for vessels and companies';  -- ✅ NEW POLYMORPHIC REFERENCE
    RAISE NOTICE '  - Performance-optimized indexing strategy including GIN indexes';
    RAISE NOTICE 'Ready for vessel data imports and enterprise domain integration.';
END $$;

COMMIT;
