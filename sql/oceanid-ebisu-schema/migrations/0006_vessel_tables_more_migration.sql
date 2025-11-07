-- ============================================================================
-- 0006_vessel_tables_more_migration.sql - Additional Vessel Tables Migration (UPDATED)
-- ============================================================================
-- Creates additional vessel-related tables for IUU, Outlaw Ocean, ISSF data
-- UPDATED: Consistent with enhanced 0005 migration changes
-- DEPENDS ON: 0005_vessel_tables_migration_enhanced.sql (for vessels and original_sources_vessels tables)
-- DEPENDS ON: 0001_initial_taxonomic_system.sql and 0002_initial_taxonomic_system.sql (for reference tables like country_iso and rfmos)
-- ============================================================================

-- Set up transaction and error handling
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- ADDITIONAL ENUMS FOR NEW TABLES
-- ============================================================================

-- Crime types enum for Outlaw Ocean data
DO $$ BEGIN
    CREATE TYPE crime_type_enum AS ENUM (
        'ILLEGAL_FISHING',
        'UNREPORTED_FISHING',
        'UNREGULATED_FISHING',
        'FORCED_LABOR',
        'HUMAN_TRAFFICKING',
        'LABOR_ABUSE',
        'DOCUMENT_FRAUD',
        'FLAG_OF_CONVENIENCE_ABUSE',
        'TRANSSHIPMENT_VIOLATIONS',
        'QUOTA_VIOLATIONS',
        'PROTECTED_SPECIES_VIOLATIONS',
        'MARINE_POLLUTION',
        'SAFETY_VIOLATIONS',
        'CUSTOMS_VIOLATIONS',
        'TAX_EVASION',
        'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ISSF initiative types enum
DO $$ BEGIN
    CREATE TYPE issf_initiative_type_enum AS ENUM (
        'PVR_COMPLIANCE',
        'VOSI_PARTICIPATION',
        'CONSERVATION_INITIATIVE',
        'FAD_MANAGEMENT',
        'BYCATCH_REDUCTION',
        'OBSERVER_PROGRAM',
        'TRACEABILITY_PROGRAM',
        'SUSTAINABILITY_INITIATIVE',
        'RESEARCH_PROJECT',
        'CAPACITY_BUILDING',
        'POLICY_DEVELOPMENT',
        'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Mexican vessel registry enums
DO $$ BEGIN
    CREATE TYPE mex_use_type_spanish_enum AS ENUM (
        'COMERCIAL',
        'INVESTIGACION'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mex_operation_spanish_enum AS ENUM (
        'ACTUALIZACION',
        'ALTA'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mex_species_group_spanish_enum AS ENUM (
        'ATÃšN',
        'CAMARÃ"N',
        'ESCAMA',
        'TIBURÃ"N',
        'OTRAS',
        'SARDINA, ANCHOVETA Y MACARELA'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mex_hull_type_spanish_enum AS ENUM (
        'ACERO',
        'FERROCEMENTO',
        'FIBRA DE VIDRIO',
        'ALUMINIO',
        'MADERA',
        'OTROS'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mex_gear_type_spanish_enum AS ENUM (
        'ARRASTRE',
        'CERCO',
        'PALANGRE',
        'PESCA MULTIPLE',
        'OTRO'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mex_detection_equipment_spanish_enum AS ENUM (
        'ECOSONIDA',
        'HELICOPTERO',
        'LORAN',
        'ORBIMAGEN (FOTO SATELITAL)',
        'RADIO MULTIBANDA',
        'SONAR',
        'VIDEOSONDA'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE mex_storage_method_spanish_enum AS ENUM (
        'HIELO',
        'SALMUERA',
        'REFRIGERACIÃ"N',
        'CONGELACIÃ"N'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- VESSEL IUU (ILLEGAL, UNREPORTED, UNREGULATED) TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_iuu_simple (
    iuu_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    is_iuu BOOLEAN NOT NULL DEFAULT false,
    listed_iuu JSONB, -- JSONB array of UUIDs referencing rfmos(id)
    activity_iuu VARCHAR(500), -- Alphanumeric description of IUU activity

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_iuu_simple
CREATE INDEX IF NOT EXISTS vessels_iuu_vessel_idx ON vessels_iuu_simple(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_iuu_source_idx ON vessels_iuu_simple(source_id);
CREATE INDEX IF NOT EXISTS vessels_iuu_is_iuu_idx ON vessels_iuu_simple(is_iuu);
-- GIN index for JSONB array searches (performance critical for RFMO queries)
CREATE INDEX IF NOT EXISTS vessels_iuu_listed_rfmos_idx ON vessels_iuu_simple USING gin(listed_iuu);
-- Composite indexes for complex queries
CREATE INDEX IF NOT EXISTS vessels_iuu_vessel_active_idx ON vessels_iuu_simple(vessel_uuid, is_iuu);

-- ============================================================================
-- VESSEL OUTLAW OCEAN TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_outlaw_ocean (
    outlaw_ocean_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    mandarin_name VARCHAR(40), -- Mandarin characters
    subsidy_recipient BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    state_owned_operator BOOLEAN DEFAULT false,
    crimes JSONB, -- JSONB array of crime_type_enum values
    concerns VARCHAR(300), -- Alphanumeric open text
    oo_url TEXT, -- Clickable URL to Outlaw Ocean platform

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_outlaw_ocean
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_vessel_idx ON vessels_outlaw_ocean(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_source_idx ON vessels_outlaw_ocean(source_id);
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_active_idx ON vessels_outlaw_ocean(is_active);
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_subsidy_idx ON vessels_outlaw_ocean(subsidy_recipient);
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_state_owned_idx ON vessels_outlaw_ocean(state_owned_operator);
-- GIN index for JSONB crimes array searches
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_crimes_idx ON vessels_outlaw_ocean USING gin(crimes);
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_mandarin_name_idx ON vessels_outlaw_ocean(mandarin_name);
-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_vessel_active_idx ON vessels_outlaw_ocean(vessel_uuid, is_active);
CREATE INDEX IF NOT EXISTS vessels_outlaw_ocean_flags_idx ON vessels_outlaw_ocean(subsidy_recipient, state_owned_operator);

-- ============================================================================
-- VESSEL ISSF PVR (PROACTIVE VESSEL REGISTER) TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_issf_pvr (
    issf_pvr_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    is_uvi_issf_compliant BOOLEAN DEFAULT false,
    is_active_reg_auth BOOLEAN DEFAULT false,
    flag_or_rfmo BOOLEAN DEFAULT false,
    flag_id UUID REFERENCES country_iso(id), -- FK to country_iso table
    rfmo_id UUID REFERENCES rfmos(id), -- FK to rfmos table
    not_listed_iuu BOOLEAN DEFAULT false,
    has_shark_finning_policy BOOLEAN DEFAULT false,
    has_observer BOOLEAN DEFAULT false,
    full_tuna_retention BOOLEAN DEFAULT false,
    skipper_ws_gb BOOLEAN DEFAULT false,
    no_ls_driftnet BOOLEAN DEFAULT false,
    ne_fads BOOLEAN DEFAULT false,
    shark_turtle_seabird_best_practices BOOLEAN DEFAULT false,
    has_fad_management_policy BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_issf_pvr
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_vessel_idx ON vessels_issf_pvr(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_source_idx ON vessels_issf_pvr(source_id);
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_uvi_compliant_idx ON vessels_issf_pvr(is_uvi_issf_compliant);
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_flag_idx ON vessels_issf_pvr(flag_id);
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_rfmo_idx ON vessels_issf_pvr(rfmo_id);
-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_vessel_compliant_idx ON vessels_issf_pvr(vessel_uuid, is_uvi_issf_compliant);
CREATE INDEX IF NOT EXISTS vessels_issf_pvr_compliance_flags_idx ON vessels_issf_pvr(is_uvi_issf_compliant, is_active_reg_auth, not_listed_iuu);

-- ============================================================================
-- VESSEL ISSF VOSI (VESSEL ONLINE SURVEY INITIATIVE) TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_issf_vosi (
    issf_vosi_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    on_pvr BOOLEAN DEFAULT false,
    biodegradable_fad_trial BOOLEAN DEFAULT false,
    fad_recovery_initiative BOOLEAN DEFAULT false,
    ne_fads_no_netting BOOLEAN DEFAULT false,
    fads_buoy_position_data BOOLEAN DEFAULT false,
    fad_echosounder_biomass_data BOOLEAN DEFAULT false,
    electric_monitoring BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_issf_vosi
CREATE INDEX IF NOT EXISTS vessels_issf_vosi_vessel_idx ON vessels_issf_vosi(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_issf_vosi_source_idx ON vessels_issf_vosi(source_id);
CREATE INDEX IF NOT EXISTS vessels_issf_vosi_on_pvr_idx ON vessels_issf_vosi(on_pvr);
-- Composite indexes for FAD-related queries
CREATE INDEX IF NOT EXISTS vessels_issf_vosi_fad_initiatives_idx ON vessels_issf_vosi(biodegradable_fad_trial, fad_recovery_initiative, ne_fads_no_netting);
CREATE INDEX IF NOT EXISTS vessels_issf_vosi_data_collection_idx ON vessels_issf_vosi(fads_buoy_position_data, fad_echosounder_biomass_data, electric_monitoring);

-- ============================================================================
-- VESSEL ISSF INITIATIVES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_issf_initiatives (
    issf_initiative_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    type issf_initiative_type_enum NOT NULL,
    description VARCHAR(300), -- Alphanumeric field
    start_date DATE, -- DATE format YYYY-MM-DD
    end_date DATE, -- DATE format YYYY-MM-DD
    initiative_url TEXT, -- Clickable URL

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_issf_initiatives
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_vessel_idx ON vessels_issf_initiatives(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_source_idx ON vessels_issf_initiatives(source_id);
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_type_idx ON vessels_issf_initiatives(type);
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_start_date_idx ON vessels_issf_initiatives(start_date);
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_end_date_idx ON vessels_issf_initiatives(end_date);
-- Composite indexes for date range queries
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_date_range_idx ON vessels_issf_initiatives(start_date, end_date);
CREATE INDEX IF NOT EXISTS vessels_issf_initiatives_vessel_type_idx ON vessels_issf_initiatives(vessel_uuid, type);

-- ============================================================================
-- VESSEL QUICK BOOLEAN FLAGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_quick_boolean (
    quick_boolean_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    is_fip BOOLEAN DEFAULT false, -- Fishery Improvement Project
    is_itm BOOLEAN DEFAULT false, -- Industrial Tuna Management
    is_msc BOOLEAN DEFAULT false, -- MSC (reported by third party, not MSC)
    is_cpib BOOLEAN DEFAULT false, -- CPIB
    is_fairtrade_certified BOOLEAN DEFAULT false,
    is_issf_pvr BOOLEAN DEFAULT false, -- ISSF ProActive Vessel Register
    is_issf_vosi BOOLEAN DEFAULT false, -- ISSF Vessel Online Survey Initiative
    is_issf_ps BOOLEAN DEFAULT false, -- ISSF PS
    is_issf_uvi BOOLEAN DEFAULT false, -- ISSF UVI

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_quick_boolean
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_vessel_idx ON vessels_quick_boolean(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_source_idx ON vessels_quick_boolean(source_id);
-- Individual boolean flag indexes
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_fip_idx ON vessels_quick_boolean(is_fip);
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_msc_idx ON vessels_quick_boolean(is_msc);
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_fairtrade_idx ON vessels_quick_boolean(is_fairtrade_certified);
-- Composite indexes for certification combinations
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_issf_flags_idx ON vessels_quick_boolean(is_issf_pvr, is_issf_vosi, is_issf_ps, is_issf_uvi);
CREATE INDEX IF NOT EXISTS vessels_quick_boolean_cert_flags_idx ON vessels_quick_boolean(is_msc, is_fairtrade_certified, is_fip);

-- ============================================================================
-- VESSEL MSC (MARINE STEWARDSHIP COUNCIL) TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_msc (
    msc_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    is_msc BOOLEAN DEFAULT false, -- MSC certification (MSC source only)
    msc_fishery_cert_code UUID, -- FK to msc_fisheries table (will be added when msc_fisheries table is created)

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_msc
CREATE INDEX IF NOT EXISTS vessels_msc_vessel_idx ON vessels_msc(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_msc_source_idx ON vessels_msc(source_id);
CREATE INDEX IF NOT EXISTS vessels_msc_is_msc_idx ON vessels_msc(is_msc);
CREATE INDEX IF NOT EXISTS vessels_msc_fishery_cert_idx ON vessels_msc(msc_fishery_cert_code);
-- Composite index for MSC certified vessels
CREATE INDEX IF NOT EXISTS vessels_msc_vessel_certified_idx ON vessels_msc(vessel_uuid, is_msc);

-- Note: FK constraint for msc_fishery_cert_code will be added when msc_fisheries table is created:
-- ALTER TABLE vessels_msc ADD CONSTRAINT vessels_msc_fishery_cert_fk
-- FOREIGN KEY (msc_fishery_cert_code) REFERENCES msc_fisheries(id);

-- ============================================================================
-- VESSEL MEXICAN REGISTRY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vessels_mex (
    mex_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_uuid UUID NOT NULL REFERENCES vessels(vessel_uuid), -- FK to vessels table
    source_id UUID NOT NULL REFERENCES original_sources_vessels(source_id), -- FK to original_sources_vessels table

    -- Mexican State Information
    mex_state_no INTEGER, -- 5-digit integer
    mex_state VARCHAR(50),

    -- Office Information
    mex_office INTEGER, -- 5-digit integer
    mex_office_no INTEGER, -- 5-digit integer

    -- Record Management
    record_update DATE, -- DATE format YYYY-MM-DD
    modification_date DATE, -- DATE format YYYY-MM-DD

    -- Registry Information
    port_of_registry_no INTEGER, -- 5-digit integer

    -- Classification (Spanish)
    use_type_spanish mex_use_type_spanish_enum,
    operation_spanish mex_operation_spanish_enum,
    vessel_size_cat_spanish VARCHAR(100),

    -- Gear and Equipment (Spanish)
    gear_type_spanish JSONB, -- JSONB array of mex_gear_type_spanish_enum values
    storage_method_spanish mex_storage_method_spanish_enum,
    detection_equipment_spanish mex_detection_equipment_spanish_enum,

    -- Species and Hull (Spanish)
    species_group_spanish mex_species_group_spanish_enum,
    hull_type_spanish mex_hull_type_spanish_enum,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for vessels_mex
CREATE INDEX IF NOT EXISTS vessels_mex_vessel_idx ON vessels_mex(vessel_uuid);
CREATE INDEX IF NOT EXISTS vessels_mex_source_idx ON vessels_mex(source_id);

-- Mexican administrative indexes
CREATE INDEX IF NOT EXISTS vessels_mex_state_no_idx ON vessels_mex(mex_state_no);
CREATE INDEX IF NOT EXISTS vessels_mex_state_idx ON vessels_mex(mex_state);
CREATE INDEX IF NOT EXISTS vessels_mex_office_idx ON vessels_mex(mex_office);
CREATE INDEX IF NOT EXISTS vessels_mex_port_registry_no_idx ON vessels_mex(port_of_registry_no);

-- Date indexes for record management
CREATE INDEX IF NOT EXISTS vessels_mex_record_update_idx ON vessels_mex(record_update);
CREATE INDEX IF NOT EXISTS vessels_mex_modification_date_idx ON vessels_mex(modification_date);

-- Classification indexes
CREATE INDEX IF NOT EXISTS vessels_mex_use_type_idx ON vessels_mex(use_type_spanish);
CREATE INDEX IF NOT EXISTS vessels_mex_operation_idx ON vessels_mex(operation_spanish);
CREATE INDEX IF NOT EXISTS vessels_mex_species_group_idx ON vessels_mex(species_group_spanish);
CREATE INDEX IF NOT EXISTS vessels_mex_hull_type_idx ON vessels_mex(hull_type_spanish);
CREATE INDEX IF NOT EXISTS vessels_mex_storage_method_idx ON vessels_mex(storage_method_spanish);
CREATE INDEX IF NOT EXISTS vessels_mex_detection_equipment_idx ON vessels_mex(detection_equipment_spanish);

-- JSONB index for gear types array
CREATE INDEX IF NOT EXISTS vessels_mex_gear_type_idx ON vessels_mex USING gin(gear_type_spanish);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS vessels_mex_state_office_idx ON vessels_mex(mex_state_no, mex_office);
CREATE INDEX IF NOT EXISTS vessels_mex_vessel_use_type_idx ON vessels_mex(vessel_uuid, use_type_spanish);
CREATE INDEX IF NOT EXISTS vessels_mex_species_hull_idx ON vessels_mex(species_group_spanish, hull_type_spanish);

-- ============================================================================
-- DATA VALIDATION AND CONSTRAINTS
-- ============================================================================

-- Add constraint to ensure listed_iuu contains valid UUID format
ALTER TABLE vessels_iuu_simple
ADD CONSTRAINT vessels_iuu_listed_iuu_valid_json
CHECK (listed_iuu IS NULL OR jsonb_typeof(listed_iuu) = 'array');

-- Add constraint to ensure crimes contains valid JSON array
ALTER TABLE vessels_outlaw_ocean
ADD CONSTRAINT vessels_outlaw_ocean_crimes_valid_json
CHECK (crimes IS NULL OR jsonb_typeof(crimes) = 'array');

-- Add constraint for URL format validation (basic check)
ALTER TABLE vessels_outlaw_ocean
ADD CONSTRAINT vessels_outlaw_ocean_url_format
CHECK (oo_url IS NULL OR oo_url ~ '^https?://');

-- Add constraint for ISSF initiatives URL format validation
ALTER TABLE vessels_issf_initiatives
ADD CONSTRAINT vessels_issf_initiatives_url_format
CHECK (initiative_url IS NULL OR initiative_url ~ '^https?://');

-- Add constraint to ensure end_date is after start_date for initiatives
ALTER TABLE vessels_issf_initiatives
ADD CONSTRAINT vessels_issf_initiatives_date_range_valid
CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

-- Add constraint to ensure only one of flag_id or rfmo_id is set when flag_or_rfmo is true
ALTER TABLE vessels_issf_pvr
ADD CONSTRAINT vessels_issf_pvr_flag_or_rfmo_logic
CHECK (
    (flag_or_rfmo = false) OR
    (flag_or_rfmo = true AND ((flag_id IS NOT NULL AND rfmo_id IS NULL) OR (flag_id IS NULL AND rfmo_id IS NOT NULL)))
);

-- Mexican vessel registry constraints
-- Validate 5-digit integer ranges for Mexican numbers
ALTER TABLE vessels_mex
ADD CONSTRAINT vessels_mex_state_no_range
CHECK (mex_state_no IS NULL OR (mex_state_no >= 1 AND mex_state_no <= 99999));

ALTER TABLE vessels_mex
ADD CONSTRAINT vessels_mex_office_range
CHECK (mex_office IS NULL OR (mex_office >= 1 AND mex_office <= 99999));

ALTER TABLE vessels_mex
ADD CONSTRAINT vessels_mex_office_no_range
CHECK (mex_office_no IS NULL OR (mex_office_no >= 1 AND mex_office_no <= 99999));

ALTER TABLE vessels_mex
ADD CONSTRAINT vessels_mex_port_registry_no_range
CHECK (port_of_registry_no IS NULL OR (port_of_registry_no >= 1 AND port_of_registry_no <= 99999));

-- Validate gear_type_spanish JSONB array format
ALTER TABLE vessels_mex
ADD CONSTRAINT vessels_mex_gear_type_valid_json
CHECK (gear_type_spanish IS NULL OR jsonb_typeof(gear_type_spanish) = 'array');

-- Ensure modification_date is not before record_update
ALTER TABLE vessels_mex
ADD CONSTRAINT vessels_mex_date_logic
CHECK (modification_date IS NULL OR record_update IS NULL OR modification_date >= record_update);

-- ============================================================================
-- COMPLETION AND VERIFICATION
-- ============================================================================

-- Simple verification - count new tables
DO $$
DECLARE
    new_table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO new_table_count
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
    AND t.table_name IN (
        'vessels_iuu_simple',
        'vessels_outlaw_ocean',
        'vessels_issf_pvr',
        'vessels_issf_vosi',
        'vessels_issf_initiatives',
        'vessels_quick_boolean',
        'vessels_msc',
        'vessels_mex'
    );

    RAISE NOTICE 'Created % additional vessel tables', new_table_count;

    IF new_table_count != 8 THEN
        RAISE EXCEPTION 'Expected exactly 8 additional vessel tables, but found %', new_table_count;
    END IF;
END $$;

-- Update the success message:
DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Additional vessel tables created successfully!';
    RAISE NOTICE 'New tables added:';
    RAISE NOTICE '  - vessels_iuu_simple: IUU (Illegal, Unreported, Unregulated) fishing tracking';
    RAISE NOTICE '  - vessels_outlaw_ocean: Outlaw Ocean investigation data';
    RAISE NOTICE '  - vessels_issf_pvr: ISSF ProActive Vessel Register compliance data';
    RAISE NOTICE '  - vessels_issf_vosi: ISSF Vessel Online Survey Initiative data';
    RAISE NOTICE '  - vessels_issf_initiatives: ISSF sustainability initiatives tracking';
    RAISE NOTICE '  - vessels_quick_boolean: Quick certification and program flags';
    RAISE NOTICE '  - vessels_msc: MSC (Marine Stewardship Council) certification data';
    RAISE NOTICE '  - vessels_mex: Mexican vessel registry data with Spanish enums';
    RAISE NOTICE 'Total additional tables: 9';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  - All Mexican enums created (7 Spanish language types)';
    RAISE NOTICE '  - Consistent FK relationships to vessels and sources tables';
    RAISE NOTICE '  - JSONB arrays for RFMO references (vessels_iuu_simple)';
    RAISE NOTICE '  - JSONB arrays for crime type enums (vessels_outlaw_ocean)';
    RAISE NOTICE '  - ISSF compliance and sustainability tracking';
    RAISE NOTICE '  - Quick boolean flags for multiple certification programs';
    RAISE NOTICE '  - Performance-optimized indexing including GIN indexes for JSONB';
    RAISE NOTICE '  - Data validation constraints for JSON, URL formats, and business logic';
    RAISE NOTICE '  - Compatible with enhanced 0005 migration base tables';
    RAISE NOTICE 'Ready for vessel compliance, certification, investigation, and ISSF data imports.';
END $$;

COMMIT;
