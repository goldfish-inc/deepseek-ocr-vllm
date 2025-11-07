-- ============================================================================
-- Migration 0004: MSC Fisheries Tables (FIXED - WITH ENUM NORMALIZATION)
-- ============================================================================
-- Creates MSC (Marine Stewardship Council) fisheries tables with junction tables
-- INCLUDES: Case-insensitive enum normalization functions for robust data import
-- DEPENDENCIES: Migration 0001 (original_sources, gear_types_msc, fao_major_areas)
--               Migration 0003 (harmonized_species)
-- ============================================================================

-- Set up transaction and error handling
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- MSC FISHERY ENUMS
-- ============================================================================

-- MSC Fishery Status Enum
DO $$ BEGIN
    CREATE TYPE msc_fishery_status AS ENUM (
        'CERTIFIED',
        'CERTIFIED WITH UNIT(S) IN ASSESSMENT',
        'COMBINED WITH ANOTHER ASSESSMENT',
        'IMPROVEMENT PROGRAM',
        'IN ASSESSMENT',
        'NOT CERTIFIED',
        'SUSPENDED',
        'WITHDRAWN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- MSC Fishery Status UOC (Unit of Certification) Enum
DO $$ BEGIN
    CREATE TYPE msc_fishery_status_uoc AS ENUM (
        'CERTIFIED',
        'IMPROVEMENT PROGRAM',
        'IN ASSESSMENT',
        'NOT CERTIFIED',
        'SUSPENDED',
        'WITHDRAWN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- ENUM NORMALIZATION FUNCTIONS (NEW - FOR CASE-INSENSITIVE HANDLING)
-- ============================================================================

-- Function to normalize MSC fishery status enum values
CREATE OR REPLACE FUNCTION normalize_msc_fishery_status(input_status TEXT)
RETURNS msc_fishery_status AS $$
BEGIN
    IF input_status IS NULL OR input_status = '' THEN
        RETURN NULL;
    END IF;

    -- Convert to uppercase and handle common variations
    CASE UPPER(TRIM(input_status))
        WHEN 'CERTIFIED' THEN RETURN 'CERTIFIED'::msc_fishery_status;
        WHEN 'CERTIFIED WITH UNIT(S) IN ASSESSMENT' THEN RETURN 'CERTIFIED WITH UNIT(S) IN ASSESSMENT'::msc_fishery_status;
        WHEN 'CERTIFIED WITH UNITS IN ASSESSMENT' THEN RETURN 'CERTIFIED WITH UNIT(S) IN ASSESSMENT'::msc_fishery_status;
        WHEN 'COMBINED WITH ANOTHER ASSESSMENT' THEN RETURN 'COMBINED WITH ANOTHER ASSESSMENT'::msc_fishery_status;
        WHEN 'IMPROVEMENT PROGRAM' THEN RETURN 'IMPROVEMENT PROGRAM'::msc_fishery_status;
        WHEN 'IN ASSESSMENT' THEN RETURN 'IN ASSESSMENT'::msc_fishery_status;
        WHEN 'NOT CERTIFIED' THEN RETURN 'NOT CERTIFIED'::msc_fishery_status;
        WHEN 'SUSPENDED' THEN RETURN 'SUSPENDED'::msc_fishery_status;
        WHEN 'WITHDRAWN' THEN RETURN 'WITHDRAWN'::msc_fishery_status;
        ELSE
            RAISE EXCEPTION 'Invalid MSC fishery status: "%". Valid values are: CERTIFIED, CERTIFIED WITH UNIT(S) IN ASSESSMENT, COMBINED WITH ANOTHER ASSESSMENT, IMPROVEMENT PROGRAM, IN ASSESSMENT, NOT CERTIFIED, SUSPENDED, WITHDRAWN', input_status;
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to normalize MSC fishery status UOC enum values
CREATE OR REPLACE FUNCTION normalize_msc_fishery_status_uoc(input_status TEXT)
RETURNS msc_fishery_status_uoc AS $$
BEGIN
    IF input_status IS NULL OR input_status = '' THEN
        RETURN NULL;
    END IF;

    -- Convert to uppercase and handle common variations
    CASE UPPER(TRIM(input_status))
        WHEN 'CERTIFIED' THEN RETURN 'CERTIFIED'::msc_fishery_status_uoc;
        WHEN 'IMPROVEMENT PROGRAM' THEN RETURN 'IMPROVEMENT PROGRAM'::msc_fishery_status_uoc;
        WHEN 'IN ASSESSMENT' THEN RETURN 'IN ASSESSMENT'::msc_fishery_status_uoc;
        WHEN 'NOT CERTIFIED' THEN RETURN 'NOT CERTIFIED'::msc_fishery_status_uoc;
        WHEN 'SUSPENDED' THEN RETURN 'SUSPENDED'::msc_fishery_status_uoc;
        WHEN 'WITHDRAWN' THEN RETURN 'WITHDRAWN'::msc_fishery_status_uoc;
        ELSE
            RAISE EXCEPTION 'Invalid MSC fishery status UOC: "%". Valid values are: CERTIFIED, IMPROVEMENT PROGRAM, IN ASSESSMENT, NOT CERTIFIED, SUSPENDED, WITHDRAWN', input_status;
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MAIN MSC FISHERIES TABLE (USING INLINE FK REFERENCES LIKE OTHER MIGRATIONS)
-- ============================================================================

-- Drop and recreate to ensure clean state
DROP TABLE IF EXISTS "msc_fisheries_species" CASCADE;
DROP TABLE IF EXISTS "msc_fisheries_fao_areas" CASCADE;
DROP TABLE IF EXISTS "msc_fisheries" CASCADE;

-- Create table fresh with constraints
CREATE TABLE "msc_fisheries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "msc_fishery_cert_codes" jsonb,
    "msc_fishery_name" varchar(500),
    "msc_fishery_status" msc_fishery_status,
    "msc_fishery_status_uoc" msc_fishery_status_uoc,
    "msc_gear_id" uuid,
    "source_id" uuid,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),

    CONSTRAINT "chk_msc_fishery_name_not_empty" CHECK ("msc_fishery_name" IS NULL OR LENGTH(TRIM("msc_fishery_name")) > 0),
    CONSTRAINT "fk_msc_fisheries_gear" FOREIGN KEY ("msc_gear_id") REFERENCES "gear_types_msc" ("id") ON DELETE SET NULL,
    CONSTRAINT "fk_msc_fisheries_source" FOREIGN KEY ("source_id") REFERENCES "original_sources" ("source_id") ON DELETE SET NULL
);

-- ============================================================================
-- ENSURE FK CONSTRAINTS EXIST (Force creation for existing tables)
-- ============================================================================

DO $$
BEGIN
    -- Drop any existing FK constraints for msc_gear_id (try all possible names)
    EXECUTE 'ALTER TABLE msc_fisheries DROP CONSTRAINT IF EXISTS msc_fisheries_msc_gear_id_fkey CASCADE';
    EXECUTE 'ALTER TABLE msc_fisheries DROP CONSTRAINT IF EXISTS msc_fisheries_gear_fk CASCADE';
    EXECUTE 'ALTER TABLE msc_fisheries DROP CONSTRAINT IF EXISTS fk_msc_fisheries_gear CASCADE';

    -- Drop any existing FK constraints for source_id (try all possible names)
    EXECUTE 'ALTER TABLE msc_fisheries DROP CONSTRAINT IF EXISTS msc_fisheries_source_id_fkey CASCADE';
    EXECUTE 'ALTER TABLE msc_fisheries DROP CONSTRAINT IF EXISTS msc_fisheries_source_fk CASCADE';
    EXECUTE 'ALTER TABLE msc_fisheries DROP CONSTRAINT IF EXISTS fk_msc_fisheries_source CASCADE';

    -- Now add the FK constraints fresh
    ALTER TABLE msc_fisheries
    ADD CONSTRAINT msc_fisheries_msc_gear_id_fkey
    FOREIGN KEY (msc_gear_id)
    REFERENCES gear_types_msc(id)
    ON DELETE SET NULL;

    ALTER TABLE msc_fisheries
    ADD CONSTRAINT msc_fisheries_source_id_fkey
    FOREIGN KEY (source_id)
    REFERENCES original_sources(source_id)
    ON DELETE SET NULL;

    RAISE NOTICE 'Successfully created FK constraints for msc_fisheries table';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error creating FK constraints: %', SQLERRM;
        RAISE;
END $$;

-- Indexes for msc_fisheries (AFTER FK constraints to avoid conflicts)
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_name" ON "msc_fisheries" ("msc_fishery_name");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_status" ON "msc_fisheries" ("msc_fishery_status");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_status_uoc" ON "msc_fisheries" ("msc_fishery_status_uoc");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_gear" ON "msc_fisheries" ("msc_gear_id");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_source" ON "msc_fisheries" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_cert_codes_gin" ON "msc_fisheries" USING gin ("msc_fishery_cert_codes");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_updated_at" ON "msc_fisheries" ("updated_at");

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_status_name" ON "msc_fisheries" ("msc_fishery_status", "msc_fishery_name");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_gear_status" ON "msc_fisheries" ("msc_gear_id", "msc_fishery_status");


-- ============================================================================
-- MSC FISHERIES - SPECIES JUNCTION TABLE (USING INLINE FK REFERENCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "msc_fisheries_species" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "msc_fishery_id" uuid NOT NULL REFERENCES "msc_fisheries" ("id") ON DELETE CASCADE,
    "harmonized_species_id" uuid NOT NULL REFERENCES "harmonized_species" ("harmonized_id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now(),

    -- Constraints
    CONSTRAINT "uk_msc_fishery_species" UNIQUE ("msc_fishery_id", "harmonized_species_id")
);

-- Indexes for msc_fisheries_species
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_species_fishery" ON "msc_fisheries_species" ("msc_fishery_id");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_species_species" ON "msc_fisheries_species" ("harmonized_species_id");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_species_created_at" ON "msc_fisheries_species" ("created_at");

-- ============================================================================
-- MSC FISHERIES - FAO AREAS JUNCTION TABLE (INLINE FK REFERENCES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "msc_fisheries_fao_areas" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "msc_fishery_id" uuid NOT NULL REFERENCES "msc_fisheries" ("id") ON DELETE CASCADE,
    "fao_area_id" uuid NOT NULL REFERENCES "fao_major_areas" ("id") ON DELETE CASCADE,
    "created_at" timestamp with time zone DEFAULT now(),

    -- Constraints
    CONSTRAINT "uk_msc_fishery_fao_area" UNIQUE ("msc_fishery_id", "fao_area_id")
);

-- Indexes for msc_fisheries_fao_areas
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_fao_areas_fishery" ON "msc_fisheries_fao_areas" ("msc_fishery_id");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_fao_areas_fao" ON "msc_fisheries_fao_areas" ("fao_area_id");
CREATE INDEX IF NOT EXISTS "idx_msc_fisheries_fao_areas_created_at" ON "msc_fisheries_fao_areas" ("created_at");

-- ============================================================================
-- MSC FISHERIES HELPER FUNCTIONS
-- ============================================================================

-- Function to get fishery details with related data
CREATE OR REPLACE FUNCTION get_msc_fishery_details(fishery_id uuid)
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'fishery_id', f.id,
        'fishery_name', f.msc_fishery_name,
        'status', f.msc_fishery_status,
        'status_uoc', f.msc_fishery_status_uoc,
        'cert_codes', f.msc_fishery_cert_codes,
        'gear', jsonb_build_object(
            'gear_id', g.id,
            'gear_name', g.msc_gear
        ),
        'species', jsonb_agg(DISTINCT jsonb_build_object(
            'species_id', hs.harmonized_id,
            'scientific_name', hs.canonical_scientific_name,
            'alpha3_code', hs.primary_alpha3_code
        )),
        'fao_areas', jsonb_agg(DISTINCT jsonb_build_object(
            'area_id', fa.id,
            'area_code', fa.fao_major_area,
            'area_name', fa.fao_major_area_name
        )),
        'metadata', jsonb_build_object(
            'created_at', f.created_at,
            'updated_at', f.updated_at
        )
    ) INTO result
    FROM msc_fisheries f
    LEFT JOIN gear_types_msc g ON f.msc_gear_id = g.id
    LEFT JOIN msc_fisheries_species fs ON f.id = fs.msc_fishery_id
    LEFT JOIN harmonized_species hs ON fs.harmonized_species_id = hs.harmonized_id
    LEFT JOIN msc_fisheries_fao_areas ffa ON f.id = ffa.msc_fishery_id
    LEFT JOIN fao_major_areas fa ON ffa.fao_area_id = fa.id
    WHERE f.id = fishery_id
    GROUP BY f.id, f.msc_fishery_name, f.msc_fishery_status, f.msc_fishery_status_uoc,
             f.msc_fishery_cert_codes, f.created_at, f.updated_at, g.id, g.msc_gear;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to search MSC fisheries by various criteria
CREATE OR REPLACE FUNCTION search_msc_fisheries(
    search_term text DEFAULT NULL,
    fishery_status msc_fishery_status DEFAULT NULL,
    gear_id uuid DEFAULT NULL,
    limit_count integer DEFAULT 20
)
RETURNS TABLE (
    fishery_id uuid,
    fishery_name varchar,
    status msc_fishery_status,
    status_uoc msc_fishery_status_uoc,
    gear_name text,
    species_count bigint,
    fao_areas_count bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id as fishery_id,
        f.msc_fishery_name as fishery_name,
        f.msc_fishery_status as status,
        f.msc_fishery_status_uoc as status_uoc,
        g.msc_gear as gear_name,
        COUNT(DISTINCT fs.harmonized_species_id) as species_count,
        COUNT(DISTINCT ffa.fao_area_id) as fao_areas_count
    FROM msc_fisheries f
    LEFT JOIN gear_types_msc g ON f.msc_gear_id = g.id
    LEFT JOIN msc_fisheries_species fs ON f.id = fs.msc_fishery_id
    LEFT JOIN msc_fisheries_fao_areas ffa ON f.id = ffa.msc_fishery_id
    WHERE (
        search_term IS NULL OR
        f.msc_fishery_name ILIKE '%' || search_term || '%'
    )
    AND (fishery_status IS NULL OR f.msc_fishery_status = fishery_status)
    AND (gear_id IS NULL OR f.msc_gear_id = gear_id)
    GROUP BY f.id, f.msc_fishery_name, f.msc_fishery_status, f.msc_fishery_status_uoc, g.msc_gear
    ORDER BY f.msc_fishery_name
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get fisheries by species
CREATE OR REPLACE FUNCTION get_msc_fisheries_by_species(species_id uuid)
RETURNS TABLE (
    fishery_id uuid,
    fishery_name varchar,
    status msc_fishery_status,
    gear_name text
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id as fishery_id,
        f.msc_fishery_name as fishery_name,
        f.msc_fishery_status as status,
        g.msc_gear as gear_name
    FROM msc_fisheries f
    INNER JOIN msc_fisheries_species fs ON f.id = fs.msc_fishery_id
    LEFT JOIN gear_types_msc g ON f.msc_gear_id = g.id
    WHERE fs.harmonized_species_id = species_id
    ORDER BY f.msc_fishery_name;
END;
$$ LANGUAGE plpgsql;

-- Updated helper functions for clean certification codes (direct JSONB arrays)

-- Function to search MSC fisheries by certification codes (Updated for direct JSONB array)
CREATE OR REPLACE FUNCTION search_msc_fisheries_by_cert_codes(
    cert_codes text[] DEFAULT NULL,
    limit_count integer DEFAULT 20
)
RETURNS TABLE (
    fishery_id uuid,
    fishery_name varchar,
    status msc_fishery_status,
    cert_codes_found jsonb,
    species_count bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id as fishery_id,
        f.msc_fishery_name as fishery_name,
        f.msc_fishery_status as status,
        f.msc_fishery_cert_codes as cert_codes_found,
        COUNT(DISTINCT fs.harmonized_species_id) as species_count
    FROM msc_fisheries f
    LEFT JOIN msc_fisheries_species fs ON f.id = fs.msc_fishery_id
    WHERE (
        cert_codes IS NULL OR
        -- Check if any of the provided codes exist in the JSONB array
        f.msc_fishery_cert_codes ?| cert_codes
    )
    AND f.msc_fishery_cert_codes IS NOT NULL
    GROUP BY f.id, f.msc_fishery_name, f.msc_fishery_status, f.msc_fishery_cert_codes
    ORDER BY f.msc_fishery_name
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get fishery by exact certification code match
CREATE OR REPLACE FUNCTION get_msc_fisheries_by_exact_cert_code(cert_code text)
RETURNS TABLE (
    fishery_id uuid,
    fishery_name varchar,
    status msc_fishery_status,
    all_cert_codes jsonb,
    gear_name text
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id as fishery_id,
        f.msc_fishery_name as fishery_name,
        f.msc_fishery_status as status,
        f.msc_fishery_cert_codes as all_cert_codes,
        g.msc_gear as gear_name
    FROM msc_fisheries f
    LEFT JOIN gear_types_msc g ON f.msc_gear_id = g.id
    WHERE f.msc_fishery_cert_codes @> to_jsonb(ARRAY[cert_code])
    ORDER BY f.msc_fishery_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MSC FISHERIES STATISTICS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW "msc_fisheries_statistics" AS
SELECT
    -- Basic counts
    COUNT(*) as total_fisheries,
    COUNT(*) FILTER (WHERE msc_fishery_status = 'CERTIFIED') as certified_fisheries,
    COUNT(*) FILTER (WHERE msc_fishery_status = 'IN ASSESSMENT') as in_assessment_fisheries,
    COUNT(*) FILTER (WHERE msc_fishery_status = 'SUSPENDED') as suspended_fisheries,
    COUNT(*) FILTER (WHERE msc_fishery_status = 'NOT CERTIFIED') as not_certified_fisheries,

    -- Species and areas counts
    COUNT(DISTINCT fs.harmonized_species_id) as total_species,
    COUNT(DISTINCT ffa.fao_area_id) as total_fao_areas,
    COUNT(DISTINCT f.msc_gear_id) as total_gear_types,

    -- Average relationships per fishery
    ROUND(AVG(species_per_fishery.species_count), 2) as avg_species_per_fishery,
    ROUND(AVG(areas_per_fishery.areas_count), 2) as avg_areas_per_fishery,

    -- Data freshness
    MAX(f.updated_at) as last_update,
    now() as calculated_at
FROM msc_fisheries f
LEFT JOIN msc_fisheries_species fs ON f.id = fs.msc_fishery_id
LEFT JOIN msc_fisheries_fao_areas ffa ON f.id = ffa.msc_fishery_id
LEFT JOIN (
    SELECT msc_fishery_id, COUNT(*) as species_count
    FROM msc_fisheries_species
    GROUP BY msc_fishery_id
) species_per_fishery ON f.id = species_per_fishery.msc_fishery_id
LEFT JOIN (
    SELECT msc_fishery_id, COUNT(*) as areas_count
    FROM msc_fisheries_fao_areas
    GROUP BY msc_fishery_id
) areas_per_fishery ON f.id = areas_per_fishery.msc_fishery_id;

-- ============================================================================
-- VALIDATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_msc_fisheries_integrity()
RETURNS TABLE (
    check_name text,
    status text,
    count_value bigint,
    notes text
) AS $$
BEGIN
    -- Check 1: Orphaned species relationships
    RETURN QUERY
    SELECT
        'Orphaned Species References'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text,
        COUNT(*),
        'MSC fisheries with invalid species FK references'::text
    FROM msc_fisheries_species fs
    WHERE NOT EXISTS (
        SELECT 1 FROM harmonized_species hs
        WHERE hs.harmonized_id = fs.harmonized_species_id
    );

    -- Check 2: Orphaned FAO area relationships
    RETURN QUERY
    SELECT
        'Orphaned FAO Area References'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text,
        COUNT(*),
        'MSC fisheries with invalid FAO area FK references'::text
    FROM msc_fisheries_fao_areas ffa
    WHERE NOT EXISTS (
        SELECT 1 FROM fao_major_areas fa
        WHERE fa.id = ffa.fao_area_id
    );

    -- Check 3: Fisheries without species
    RETURN QUERY
    SELECT
        'Fisheries Without Species'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END::text,
        COUNT(*),
        'MSC fisheries with no species associations'::text
    FROM msc_fisheries f
    WHERE NOT EXISTS (
        SELECT 1 FROM msc_fisheries_species fs
        WHERE fs.msc_fishery_id = f.id
    );

    -- Check 4: Fisheries without FAO areas
    RETURN QUERY
    SELECT
        'Fisheries Without FAO Areas'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END::text,
        COUNT(*),
        'MSC fisheries with no FAO area associations'::text
    FROM msc_fisheries f
    WHERE NOT EXISTS (
        SELECT 1 FROM msc_fisheries_fao_areas ffa
        WHERE ffa.msc_fishery_id = f.id
    );

    -- Check 5: Data quality summary
    RETURN QUERY
    SELECT
        'Total Fisheries Ready'::text,
        'INFO'::text,
        COUNT(*),
        'MSC fisheries with both species and FAO area associations'::text
    FROM msc_fisheries f
    WHERE EXISTS (
        SELECT 1 FROM msc_fisheries_species fs
        WHERE fs.msc_fishery_id = f.id
    )
    AND EXISTS (
        SELECT 1 FROM msc_fisheries_fao_areas ffa
        WHERE ffa.msc_fishery_id = f.id
    );

    -- NEW Check 6: Enum value integrity
    RETURN QUERY
    SELECT
        'Enum Values Integrity'::text,
        'INFO'::text,
        COUNT(*),
        'MSC fisheries with valid enum values (all should pass with normalization functions)'::text
    FROM msc_fisheries f
    WHERE f.msc_fishery_status IS NOT NULL
      AND f.msc_fishery_status_uoc IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGER FOR UPDATED_AT FIELD
-- ============================================================================

CREATE OR REPLACE FUNCTION update_msc_fisheries_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_msc_fisheries_updated_at
    BEFORE UPDATE ON msc_fisheries
    FOR EACH ROW EXECUTE FUNCTION update_msc_fisheries_updated_at();

-- ============================================================================
-- MIGRATION METADATA TRACKING
-- ============================================================================

-- Insert migration tracking record
INSERT INTO "migration_metadata" (migration_name, version, notes)
VALUES ('msc_fisheries_tables', '0004', 'Creates MSC fisheries tables with species and FAO area junction tables, includes case-insensitive enum normalization functions for robust data import')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION AND COMPLETION
-- ============================================================================

-- Verify MSC fisheries tables creation
DO $$
DECLARE
    msc_table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO msc_table_count
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
    AND t.table_name IN (
        'msc_fisheries',
        'msc_fisheries_species',
        'msc_fisheries_fao_areas'
    );

    RAISE NOTICE 'Created % MSC fisheries tables', msc_table_count;

    IF msc_table_count != 3 THEN
        RAISE EXCEPTION 'Expected exactly 3 MSC fisheries tables, but found %', msc_table_count;
    END IF;
END $$;

-- Verify foreign key relationships exist (using actual constraint names)
DO $$
DECLARE
    constraint_count INTEGER;
    expected_main_fks INTEGER := 2;
    expected_junction_fks INTEGER := 4;
BEGIN
    -- Count actual FK constraints on main table
    SELECT COUNT(*) INTO constraint_count
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'msc_fisheries';

    RAISE NOTICE 'MSC fisheries table has % FK constraints (expected %)', constraint_count, expected_main_fks;

    IF constraint_count < expected_main_fks THEN
        RAISE WARNING 'MSC fisheries table has fewer FK constraints than expected (% < %)', constraint_count, expected_main_fks;
    END IF;

    -- Count FK constraints on junction tables
    SELECT COUNT(*) INTO constraint_count
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name IN ('msc_fisheries_species', 'msc_fisheries_fao_areas');

    RAISE NOTICE 'MSC fisheries junction tables have % total FK constraints (expected %)', constraint_count, expected_junction_fks;

    IF constraint_count < expected_junction_fks THEN
        RAISE WARNING 'Junction tables have fewer FK constraints than expected (% < %)', constraint_count, expected_junction_fks;
    END IF;

    RAISE NOTICE 'Foreign key relationship verification completed';
END $$;

-- Verify enum normalization functions exist
DO $$
DECLARE
    function_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO function_count
    FROM information_schema.routines r
    WHERE r.routine_schema = 'public'
    AND r.routine_name IN ('normalize_msc_fishery_status', 'normalize_msc_fishery_status_uoc');

    RAISE NOTICE 'Created % enum normalization functions', function_count;

    IF function_count != 2 THEN
        RAISE EXCEPTION 'Expected exactly 2 enum normalization functions, but found %', function_count;
    END IF;
END $$;

-- Success notification
DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Migration 0004 completed successfully!';
    RAISE NOTICE 'MSC Fisheries system created:';
    RAISE NOTICE '  Main tables:';
    RAISE NOTICE '    - msc_fisheries (main fishery records with status tracking)';
    RAISE NOTICE '    - msc_fisheries_species (species associations)';
    RAISE NOTICE '    - msc_fisheries_fao_areas (fishing area associations)';
    RAISE NOTICE '  Enums:';
    RAISE NOTICE '    - msc_fishery_status (8 certification statuses)';
    RAISE NOTICE '    - msc_fishery_status_uoc (6 unit of certification statuses)';
    RAISE NOTICE '  NEW Features:';
    RAISE NOTICE '    - normalize_msc_fishery_status() function for case-insensitive enum handling';
    RAISE NOTICE '    - normalize_msc_fishery_status_uoc() function for case-insensitive enum handling';
    RAISE NOTICE '    - Robust data import with automatic enum normalization';
    RAISE NOTICE '    - Explicit FK constraint creation for development re-runs';
    RAISE NOTICE '  Existing Features:';
    RAISE NOTICE '    - INLINE FK references matching working migrations (0001, 0002, 0003)';
    RAISE NOTICE '    - Compatible with DBeaver ER diagram display';
    RAISE NOTICE '    - JSONB support for certification codes with GIN index';
    RAISE NOTICE '    - Helper functions for detailed queries and search';
    RAISE NOTICE '    - Statistics view for MSC program analytics';
    RAISE NOTICE '    - Integrity validation function';
    RAISE NOTICE '    - Performance-optimized indexing strategy';
    RAISE NOTICE '    - Automatic updated_at timestamp handling';
    RAISE NOTICE 'Ready for MSC fishery certification data imports with robust enum handling.';
END $$;

COMMIT;
