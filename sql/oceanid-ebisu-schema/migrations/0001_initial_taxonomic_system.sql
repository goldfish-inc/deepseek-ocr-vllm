-- ============================================================================
-- Migration 0001: Initial Reference System Foundation
-- ============================================================================
-- Creates foundational reference tables required by all other domains
-- Includes: original_sources, country data, gear types, vessel types, RFMOs
-- DEPENDENCIES: None (foundation layer)
-- ============================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Set up transaction and error handling
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- 1. ORIGINAL SOURCES (MUST BE FIRST - NO DEPENDENCIES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "original_sources" (
    "source_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_shortname" text NOT NULL UNIQUE,
    "source_fullname" text NOT NULL,
    "version_year" integer,
    "source_types" text[] NOT NULL,
    "refresh_date" date,
    "source_urls" jsonb,
    "update_frequency" text CHECK ("update_frequency" IN ('MONTHLY', 'ANNUALLY', 'RANDOM', 'WEEKLY', 'DAILY', 'UNKNOWN')),
    "size_approx" bigint,
    "status" text DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'LOADED', 'FAILED', 'ARCHIVED')),
    "created_at" timestamp with time zone DEFAULT now(),
    "last_updated" timestamp with time zone DEFAULT now(),
    CONSTRAINT "chk_source_types_not_empty" CHECK (array_length(source_types, 1) > 0)
);

-- Indexes for original_sources
CREATE INDEX IF NOT EXISTS "idx_gin_source_types" ON "original_sources" USING gin ("source_types");
CREATE INDEX IF NOT EXISTS "idx_gin_source_urls" ON "original_sources" USING gin ("source_urls");
CREATE INDEX IF NOT EXISTS "idx_original_sources_shortname" ON "original_sources" ("source_shortname");
CREATE INDEX IF NOT EXISTS "idx_original_sources_status" ON "original_sources" ("status");
CREATE INDEX IF NOT EXISTS "idx_original_sources_refresh_date" ON "original_sources" ("refresh_date");
CREATE INDEX IF NOT EXISTS "idx_original_sources_update_freq" ON "original_sources" ("update_frequency");

-- ============================================================================
-- 2. COUNTRY ISO (CORE REFERENCE - DEPENDS ON ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "country_iso" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "short_name_en" text NOT NULL,
    "short_name_fr" text,
    "alpha_2_code" text NOT NULL,
    "alpha_3_code" text NOT NULL,
    "numeric_code" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_country_alpha_2" UNIQUE("alpha_2_code"),
    CONSTRAINT "uk_country_alpha_3" UNIQUE("alpha_3_code"),
    CONSTRAINT "uk_country_numeric" UNIQUE("numeric_code"),
    CONSTRAINT "chk_numeric_code_length" CHECK (LENGTH(numeric_code) = 3)
);

-- Indexes for country_iso
CREATE INDEX IF NOT EXISTS "idx_country_alpha_2" ON "country_iso" ("alpha_2_code");
CREATE INDEX IF NOT EXISTS "idx_country_alpha_3" ON "country_iso" ("alpha_3_code");
CREATE INDEX IF NOT EXISTS "idx_country_source" ON "country_iso" ("source_id");

-- ============================================================================
-- 3. FAO MAJOR AREAS (DEPENDS ON ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "fao_major_areas" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "fao_major_area" text NOT NULL,
    "fao_major_area_name" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_fao_major_area" UNIQUE("fao_major_area")
);

-- Indexes for fao_major_areas
CREATE INDEX IF NOT EXISTS "idx_fao_major_area" ON "fao_major_areas" ("fao_major_area");
CREATE INDEX IF NOT EXISTS "idx_fao_areas_source" ON "fao_major_areas" ("source_id");

-- ============================================================================
-- 4. GEAR TYPES FAO (DEPENDS ON ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gear_types_fao" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "fao_isscfg_code" text NOT NULL,
    "fao_isscfg_alpha" text,
    "fao_isscfg_name" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_fao_gear_code" UNIQUE("fao_isscfg_code"),
    CONSTRAINT "uk_fao_gear_alpha" UNIQUE("fao_isscfg_alpha")
);

-- Indexes for gear_types_fao
CREATE INDEX IF NOT EXISTS "idx_fao_gear_code" ON "gear_types_fao" ("fao_isscfg_code");
CREATE INDEX IF NOT EXISTS "idx_fao_gear_source" ON "gear_types_fao" ("source_id");

-- ============================================================================
-- 5. GEAR TYPES CBP (DEPENDS ON ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gear_types_cbp" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "cbp_gear_code" text NOT NULL,
    "cbp_gear_name" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_cbp_gear_code" UNIQUE("cbp_gear_code")
);

-- Indexes for gear_types_cbp
CREATE INDEX IF NOT EXISTS "idx_cbp_gear_code" ON "gear_types_cbp" ("cbp_gear_code");
CREATE INDEX IF NOT EXISTS "idx_cbp_gear_source" ON "gear_types_cbp" ("source_id");

-- ============================================================================
-- 6. VESSEL TYPES (DEPENDS ON ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "vessel_types" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "vessel_type_cat" text NOT NULL,
    "vessel_type_subcat" text,
    "vessel_type_isscfv_code" text NOT NULL,
    "vessel_type_isscfv_alpha" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_vessel_type_code" UNIQUE("vessel_type_isscfv_code"),
    CONSTRAINT "uk_vessel_type_alpha" UNIQUE("vessel_type_isscfv_alpha")
);

-- Indexes for vessel_types
CREATE INDEX IF NOT EXISTS "idx_vessel_type_code" ON "vessel_types" ("vessel_type_isscfv_code");
CREATE INDEX IF NOT EXISTS "idx_vessel_types_source" ON "vessel_types" ("source_id");

-- ============================================================================
-- 7. VESSEL HULL MATERIAL (NO SOURCE DEPENDENCY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "vessel_hull_material" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "hull_material" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_hull_material" UNIQUE("hull_material")
);

-- Indexes for vessel_hull_material
CREATE INDEX IF NOT EXISTS "idx_hull_material" ON "vessel_hull_material" ("hull_material");

-- ============================================================================
-- 8. RFMOS (NO SOURCE DEPENDENCY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "rfmos" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "rfmo_acronym" text NOT NULL,
    "rfmo_name" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_rfmo_acronym" UNIQUE("rfmo_acronym")
);

-- Indexes for rfmos
CREATE INDEX IF NOT EXISTS "idx_rfmo_acronym" ON "rfmos" ("rfmo_acronym");

-- ============================================================================
-- 9. GEAR TYPES RELATIONSHIP FAO-CBP (DEPENDS ON GEAR_TYPES_FAO, GEAR_TYPES_CBP)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gear_types_relationship_fao_cbp" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "fao_gear_id" uuid NOT NULL REFERENCES "gear_types_fao" ("id") ON DELETE CASCADE,
    "cbp_gear_id" uuid NOT NULL REFERENCES "gear_types_cbp" ("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_gear_relationship_fao_cbp" UNIQUE("fao_gear_id", "cbp_gear_id")
);

-- Indexes for gear_types_relationship_fao_cbp
CREATE INDEX IF NOT EXISTS "idx_gear_rel_fao" ON "gear_types_relationship_fao_cbp" ("fao_gear_id");
CREATE INDEX IF NOT EXISTS "idx_gear_rel_cbp" ON "gear_types_relationship_fao_cbp" ("cbp_gear_id");

-- ============================================================================
-- 10. COUNTRY ISO EU (DEPENDS ON COUNTRY_ISO)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "country_iso_eu" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "country_id" uuid NOT NULL REFERENCES "country_iso" ("id") ON DELETE CASCADE,
    "is_eu" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_country_eu" UNIQUE("country_id")
);

-- Indexes for country_iso_eu
CREATE INDEX IF NOT EXISTS "idx_country_eu" ON "country_iso_eu" ("country_id");

-- ============================================================================
-- 11. MSC GEAR TYPES (DEPENDS ON ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gear_types_msc" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "msc_gear" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_msc_gear" UNIQUE("msc_gear")
);

-- Indexes for gear_types_msc
CREATE INDEX IF NOT EXISTS "idx_gear_types_msc_gear" ON "gear_types_msc" ("msc_gear");
CREATE INDEX IF NOT EXISTS "idx_gear_types_msc_source" ON "gear_types_msc" ("source_id");

-- ============================================================================
-- 12. MSC-FAO GEAR RELATIONSHIP (DEPENDS ON GEAR_TYPES_FAO, GEAR_TYPES_MSC)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gear_types_fao_msc_relationship" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "fao_gear_id" uuid NOT NULL REFERENCES "gear_types_fao" ("id") ON DELETE CASCADE,
    "msc_gear_id" uuid NOT NULL REFERENCES "gear_types_msc" ("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_fao_msc_gear_relationship" UNIQUE("fao_gear_id", "msc_gear_id")
);

-- Indexes for gear_types_fao_msc_relationship
CREATE INDEX IF NOT EXISTS "idx_gear_types_fao_msc_rel_fao" ON "gear_types_fao_msc_relationship" ("fao_gear_id");
CREATE INDEX IF NOT EXISTS "idx_gear_types_fao_msc_rel_msc" ON "gear_types_fao_msc_relationship" ("msc_gear_id");

-- ============================================================================
-- 13. COUNTRY ISO FOC (DEPENDS ON COUNTRY_ISO, ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "country_iso_foc" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "country_id" uuid NOT NULL REFERENCES "country_iso" ("id") ON DELETE CASCADE,
    "alpha_3_code" text,
    "is_foc" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_country_foc" UNIQUE("country_id")
);

-- Indexes for country_iso_foc
CREATE INDEX IF NOT EXISTS "idx_country_foc_country" ON "country_iso_foc" ("country_id");
CREATE INDEX IF NOT EXISTS "idx_country_foc_status" ON "country_iso_foc" ("is_foc");
CREATE INDEX IF NOT EXISTS "idx_country_foc_source" ON "country_iso_foc" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_country_foc_alpha3" ON "country_iso_foc" ("alpha_3_code");

-- ============================================================================
-- 14. COUNTRY ISO ILO C188 (DEPENDS ON COUNTRY_ISO, ORIGINAL_SOURCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "country_iso_ilo_c188" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "country_id" uuid NOT NULL REFERENCES "country_iso" ("id") ON DELETE CASCADE,
    "alpha_3_code" text,
    "is_c188_ratified" boolean NOT NULL,
    "date_entered_force" date,
    "date_ratified" date,
    "date_future_enter_force_by" date,
    "convention_org" text,
    "convention_shortname" text,
    "convention_fullname" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "uk_country_ilo_c188" UNIQUE("country_id")
);

-- Indexes for country_iso_ilo_c188
CREATE INDEX IF NOT EXISTS "idx_country_ilo_c188_country" ON "country_iso_ilo_c188" ("country_id");
CREATE INDEX IF NOT EXISTS "idx_country_ilo_c188_status" ON "country_iso_ilo_c188" ("is_c188_ratified");
CREATE INDEX IF NOT EXISTS "idx_country_ilo_c188_source" ON "country_iso_ilo_c188" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_country_ilo_c188_alpha3" ON "country_iso_ilo_c188" ("alpha_3_code");
CREATE INDEX IF NOT EXISTS "idx_country_ilo_c188_org" ON "country_iso_ilo_c188" ("convention_org");

-- ============================================================================
-- 15. MIGRATION METADATA TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS "migration_metadata" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "migration_name" text NOT NULL,
    "version" text NOT NULL,
    "executed_at" timestamp with time zone DEFAULT now(),
    "execution_time_ms" integer,
    "status" text NOT NULL DEFAULT 'completed',
    "notes" text
);

-- Insert migration tracking record
INSERT INTO "migration_metadata" (migration_name, version, notes)
VALUES ('initial_reference_system_foundation', '0001', 'Creates foundational reference tables: original_sources, countries, gear types, vessel types, RFMOs, and MSC/country profile extensions')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION AND COMPLETION
-- ============================================================================

-- Simple table count verification
DO $$
DECLARE
    foundation_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO foundation_count
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_catalog = current_database();

    RAISE NOTICE 'Total tables in public schema: %', foundation_count;

    -- Check if we have at least the core foundation tables
    IF foundation_count < 15 THEN
        RAISE EXCEPTION 'Insufficient tables created. Expected at least 15 foundation tables.';
    END IF;
END $$;

-- Success notification
DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Migration 0001 completed successfully!';
    RAISE NOTICE 'Foundation tables created:';
    RAISE NOTICE '  - original_sources (source tracking foundation)';
    RAISE NOTICE '  - country_iso + country profiles (FOC, ILO C188, EU status)';
    RAISE NOTICE '  - gear_types_fao/cbp/msc + relationships';
    RAISE NOTICE '  - vessel_types + vessel_hull_material';
    RAISE NOTICE '  - rfmos (Regional Fisheries Management Organizations)';
    RAISE NOTICE '  - fao_major_areas';
    RAISE NOTICE 'Ready for species data migration (0002) and subsequent domain migrations.';
END $$;

COMMIT;
