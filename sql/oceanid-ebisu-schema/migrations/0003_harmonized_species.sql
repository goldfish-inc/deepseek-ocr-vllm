-- Migration 0002: Enhanced Harmonized Species Table with API Support
-- This migration creates the harmonized_species table optimized for external API queries
-- Must run AFTER 0001_initial_taxonomic_system.sql

-- ===== HARMONIZED SPECIES TABLE (ENHANCED FOR API QUERIES) =====

CREATE TABLE IF NOT EXISTS "harmonized_species" (
    -- Core identification
    "harmonized_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "canonical_scientific_name" text NOT NULL,
    "primary_alpha3_code" text,

    -- DIRECT FOREIGN KEY RELATIONSHIPS TO SOURCE TABLES
    "worms_taxon_id" text,     -- Links to worms_taxonomic_core.taxonID
    "worms_kingdom" text,      -- Links to worms_taxonomic_core.kingdom (needed for composite FK)
    "asfis_id" uuid,           -- Links to asfis_species.asfis_id

    -- JSONB flexible data for API responses
    "alternative_names" jsonb,  -- All alternative names and common names
    "all_alpha3_codes" jsonb,   -- All trade codes (direct + cascaded)
    "taxonomic_details" jsonb,  -- Complete taxonomic hierarchy

    -- Quality & matching metadata
    "has_direct_alpha3" boolean NOT NULL DEFAULT false,
    "cascade_alpha3_count" numeric NOT NULL DEFAULT 0,
    "has_cascade_alpha3" boolean NOT NULL DEFAULT false,

    -- Match quality indicators
    "worms_match_type" text,   -- 'EXACT', 'FUZZY', 'MANUAL'
    "asfis_match_type" text,   -- 'DIRECT', 'CASCADE', 'MANUAL'
    "confidence_score" numeric(3,2) DEFAULT 1.00,

    -- API optimization fields
    "search_vector" tsvector,  -- Full text search optimization
    "api_cached_response" jsonb, -- Cache common API response structure

    -- Metadata
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),

    -- Constraints
    CONSTRAINT "unique_harmonized_canonical_name" UNIQUE ("canonical_scientific_name"),
    CONSTRAINT "chk_cascade_count_positive" CHECK ("cascade_alpha3_count" >= 0),
    CONSTRAINT "chk_confidence_score_valid" CHECK ("confidence_score" BETWEEN 0.0 AND 1.0)
);

-- Essential indexes for performance
CREATE INDEX IF NOT EXISTS "idx_harmonized_canonical_name" ON "harmonized_species" ("canonical_scientific_name");
CREATE INDEX IF NOT EXISTS "idx_harmonized_primary_alpha3" ON "harmonized_species" ("primary_alpha3_code");
CREATE INDEX IF NOT EXISTS "idx_harmonized_worms_taxon" ON "harmonized_species" ("worms_taxon_id", "worms_kingdom");
CREATE INDEX IF NOT EXISTS "idx_harmonized_asfis_id" ON "harmonized_species" ("asfis_id");

-- Boolean flag indexes for fast filtering
CREATE INDEX IF NOT EXISTS "idx_harmonized_has_direct_alpha3" ON "harmonized_species" ("has_direct_alpha3");
CREATE INDEX IF NOT EXISTS "idx_harmonized_has_cascade_alpha3" ON "harmonized_species" ("has_cascade_alpha3");
CREATE INDEX IF NOT EXISTS "idx_harmonized_cascade_count" ON "harmonized_species" ("cascade_alpha3_count");

-- JSONB indexes for API queries
CREATE INDEX IF NOT EXISTS "idx_harmonized_alternative_names" ON "harmonized_species" USING gin ("alternative_names");
CREATE INDEX IF NOT EXISTS "idx_harmonized_all_alpha3_codes" ON "harmonized_species" USING gin ("all_alpha3_codes");
CREATE INDEX IF NOT EXISTS "idx_harmonized_taxonomic_details" ON "harmonized_species" USING gin ("taxonomic_details");
CREATE INDEX IF NOT EXISTS "idx_harmonized_api_cached" ON "harmonized_species" USING gin ("api_cached_response");

-- Full-text search index for API
CREATE INDEX IF NOT EXISTS "idx_harmonized_search_vector" ON "harmonized_species" USING gin ("search_vector");

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_harmonized_match_quality" ON "harmonized_species" ("worms_match_type", "asfis_match_type", "confidence_score");
CREATE INDEX IF NOT EXISTS "idx_harmonized_name_alpha3" ON "harmonized_species" ("canonical_scientific_name", "primary_alpha3_code");
CREATE INDEX IF NOT EXISTS "idx_harmonized_direct_cascade" ON "harmonized_species" ("has_direct_alpha3", "has_cascade_alpha3");

-- ===== ADD FOREIGN KEY CONSTRAINTS SAFELY =====

DO $$
BEGIN
    -- Add WoRMS FK constraint if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_harmonized_worms'
          AND table_name = 'harmonized_species'
    ) THEN
        -- Check if target table exists first
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'worms_taxonomic_core') THEN
            ALTER TABLE harmonized_species
            ADD CONSTRAINT fk_harmonized_worms
            FOREIGN KEY (worms_taxon_id, worms_kingdom)
            REFERENCES worms_taxonomic_core ("taxonID", kingdom)
            ON DELETE SET NULL;
            RAISE NOTICE 'Added WoRMS FK constraint successfully';
        ELSE
            RAISE WARNING 'Cannot add WoRMS FK constraint - worms_taxonomic_core table not found';
        END IF;
    END IF;

    -- Add ASFIS FK constraint if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_harmonized_asfis'
          AND table_name = 'harmonized_species'
    ) THEN
        -- Check if target table exists first
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'asfis_species') THEN
            ALTER TABLE harmonized_species
            ADD CONSTRAINT fk_harmonized_asfis
            FOREIGN KEY (asfis_id)
            REFERENCES asfis_species (asfis_id)
            ON DELETE SET NULL;
            RAISE NOTICE 'Added ASFIS FK constraint successfully';
        ELSE
            RAISE WARNING 'Cannot add ASFIS FK constraint - asfis_species table not found';
        END IF;
    END IF;
END $$;

-- ===== HARMONIZATION AUDIT LOG =====

CREATE TABLE IF NOT EXISTS "harmonization_log" (
    "log_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- DIRECT FOREIGN KEY TO HARMONIZED SPECIES
    "harmonized_id" uuid NOT NULL
        REFERENCES "harmonized_species" ("harmonized_id")
        ON DELETE CASCADE,

    -- Action tracking
    "action" text NOT NULL CHECK ("action" IN ('CREATED', 'UPDATED', 'CASCADED', 'MERGED')),
    "source_system" text NOT NULL CHECK ("source_system" IN ('WORMS', 'ASFIS', 'CASCADE', 'MANUAL')),
    "matched_by" text NOT NULL,

    -- Change tracking
    "previous_values" jsonb,
    "new_values" jsonb,
    "notes" text,

    -- Metadata
    "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_harmonization_log_harmonized_id" ON "harmonization_log" ("harmonized_id");
CREATE INDEX IF NOT EXISTS "idx_harmonization_log_action" ON "harmonization_log" ("action");
CREATE INDEX IF NOT EXISTS "idx_harmonization_log_created_at" ON "harmonization_log" ("created_at");

-- ===== API OPTIMIZATION FUNCTIONS =====

-- Enhanced name normalization function
CREATE OR REPLACE FUNCTION normalize_scientific_name_enhanced(input_name text)
RETURNS text AS $$
BEGIN
    IF input_name IS NULL OR LENGTH(TRIM(input_name)) = 0 THEN
        RETURN NULL;
    END IF;

    -- Remove quotes, normalize spaces, remove special characters
    RETURN LOWER(TRIM(REGEXP_REPLACE(
        REGEXP_REPLACE(
            REGEXP_REPLACE(input_name, '''|"', '', 'g'),  -- Remove quotes
            '\s+', ' ', 'g'  -- Multiple spaces to single
        ),
        '[^a-z0-9\s]', '', 'g'  -- Remove special chars except spaces
    )));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update search vectors (for full-text search)
CREATE OR REPLACE FUNCTION update_search_vector()
RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.canonical_scientific_name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.primary_alpha3_code, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.alternative_names::text, '')), 'B');

    -- Update the API cache when data changes
    NEW.api_cached_response := NULL;  -- Clear cache on update
    NEW.updated_at := now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic search vector updates
DROP TRIGGER IF EXISTS trigger_update_search_vector ON harmonized_species;
CREATE TRIGGER trigger_update_search_vector
    BEFORE INSERT OR UPDATE ON harmonized_species
    FOR EACH ROW EXECUTE FUNCTION update_search_vector();

-- ===== API QUERY FUNCTIONS =====

-- Primary API function: Search by scientific name OR Alpha3 code
CREATE OR REPLACE FUNCTION api_search_species(
    search_term text,
    limit_count integer DEFAULT 20,
    include_cascaded boolean DEFAULT true
)
RETURNS TABLE (
    harmonized_id uuid,
    scientific_name text,
    primary_alpha3_code text,
    alternative_names jsonb,
    all_alpha3_codes jsonb,
    worms_details jsonb,
    asfis_details jsonb,
    confidence_score numeric,
    match_type text
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        h.harmonized_id,
        h.canonical_scientific_name as scientific_name,
        h.primary_alpha3_code,
        h.alternative_names,
        h.all_alpha3_codes,
        -- WoRMS details as JSONB
        jsonb_build_object(
            'taxon_id', w."taxonID",
            'kingdom', w.kingdom,
            'phylum', w.phylum,
            'class', w.class,
            'order', w."order",
            'family', w.family,
            'genus', w.genus,
            'rank', w.taxon_rank,
            'status', w.taxonomic_status,
            'is_marine', w.is_marine,
            'is_freshwater', w.is_freshwater
        ) as worms_details,
        -- ASFIS details as JSONB
        jsonb_build_object(
            'asfis_id', a.asfis_id,
            'english_name', a.english_name,
            'french_name', a.french_name,
            'spanish_name', a.spanish_name,
            'taxonomic_code', a.taxonomic_code,
            'rank', a.taxon_rank,
            'family', a.family,
            'order', a."order"
        ) as asfis_details,
        h.confidence_score,
        CONCAT(
            COALESCE(h.worms_match_type, ''),
            CASE WHEN h.worms_match_type IS NOT NULL AND h.asfis_match_type IS NOT NULL THEN '+' ELSE '' END,
            COALESCE(h.asfis_match_type, '')
        ) as match_type
    FROM harmonized_species h
    LEFT JOIN worms_taxonomic_core w ON h.worms_taxon_id = w."taxonID" AND h.worms_kingdom = w.kingdom
    LEFT JOIN asfis_species a ON h.asfis_id = a.asfis_id
    WHERE (
        -- Search by scientific name
        h.canonical_scientific_name ILIKE '%' || search_term || '%'
        OR normalize_scientific_name_enhanced(h.canonical_scientific_name) = normalize_scientific_name_enhanced(search_term)
        -- Search by Alpha3 code
        OR h.primary_alpha3_code = UPPER(search_term)
        -- Search in alternative names
        OR h.alternative_names::text ILIKE '%' || search_term || '%'
        -- Full-text search
        OR h.search_vector @@ plainto_tsquery('english', search_term)
        -- Search in cascaded Alpha3 codes if enabled
        OR (include_cascaded AND h.all_alpha3_codes::text ILIKE '%' || UPPER(search_term) || '%')
    )
    AND (
        -- Only include species with direct codes OR cascaded codes based on parameter
        h.primary_alpha3_code IS NOT NULL
        OR (include_cascaded AND h.has_cascade_alpha3)
        OR search_term IS NULL  -- Show all if no search term
    )
    ORDER BY
        -- Prioritize exact matches
        CASE
            WHEN h.canonical_scientific_name ILIKE search_term THEN 1
            WHEN h.primary_alpha3_code = UPPER(search_term) THEN 2
            WHEN h.canonical_scientific_name ILIKE search_term || '%' THEN 3
            ELSE 4
        END,
        h.confidence_score DESC,
        h.canonical_scientific_name
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get complete species information by ID (for detailed API response)
CREATE OR REPLACE FUNCTION api_get_species_details(species_id uuid)
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'harmonized_id', h.harmonized_id,
        'scientific_name', h.canonical_scientific_name,
        'primary_alpha3_code', h.primary_alpha3_code,
        'alternative_names', h.alternative_names,
        'all_alpha3_codes', h.all_alpha3_codes,
        'taxonomic_details', h.taxonomic_details,
        'confidence_score', h.confidence_score,
        'match_types', jsonb_build_object(
            'worms', h.worms_match_type,
            'asfis', h.asfis_match_type
        ),
        'worms_data', jsonb_build_object(
            'taxon_id', w."taxonID",
            'kingdom', w.kingdom,
            'phylum', w.phylum,
            'class', w.class,
            'order', w."order",
            'family', w.family,
            'genus', w.genus,
            'specific_epithet', w."specificEpithet",
            'rank', w.taxon_rank,
            'authorship', w.authorship,
            'status', w.taxonomic_status,
            'habitat', jsonb_build_object(
                'marine', w.is_marine,
                'brackish', w.is_brackish,
                'freshwater', w.is_freshwater,
                'terrestrial', w.is_terrestrial
            )
        ),
        'asfis_data', jsonb_build_object(
            'asfis_id', a.asfis_id,
            'names', jsonb_build_object(
                'english', a.english_name,
                'french', a.french_name,
                'spanish', a.spanish_name,
                'arabic', a.arabic_name,
                'chinese', a.chinese_name,
                'russian', a.russian_name
            ),
            'taxonomic_code', a.taxonomic_code,
            'rank', a.taxon_rank,
            'family', a.family,
            'order', a."order"
        ),
        'metadata', jsonb_build_object(
            'created_at', h.created_at,
            'updated_at', h.updated_at,
            'has_direct_alpha3', h.has_direct_alpha3,
            'has_cascade_alpha3', h.has_cascade_alpha3,
            'cascade_count', h.cascade_alpha3_count
        )
    ) INTO result
    FROM harmonized_species h
    LEFT JOIN worms_taxonomic_core w ON h.worms_taxon_id = w."taxonID" AND h.worms_kingdom = w.kingdom
    LEFT JOIN asfis_species a ON h.asfis_id = a.asfis_id
    WHERE h.harmonized_id = species_id;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function for Alpha3 code lookup (common API use case)
CREATE OR REPLACE FUNCTION api_lookup_by_alpha3(alpha3_code text)
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_agg(
        jsonb_build_object(
            'harmonized_id', h.harmonized_id,
            'scientific_name', h.canonical_scientific_name,
            'alpha3_code', h.primary_alpha3_code,
            'english_name', a.english_name,
            'confidence_score', h.confidence_score,
            'match_type', h.asfis_match_type,
            'worms_family', w.family,
            'worms_kingdom', w.kingdom
        )
    ) INTO result
    FROM harmonized_species h
    LEFT JOIN worms_taxonomic_core w ON h.worms_taxon_id = w."taxonID" AND h.worms_kingdom = w.kingdom
    LEFT JOIN asfis_species a ON h.asfis_id = a.asfis_id
    WHERE h.primary_alpha3_code = UPPER(alpha3_code)
       OR h.all_alpha3_codes::text ILIKE '%' || UPPER(alpha3_code) || '%';

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ===== HARMONIZATION STATISTICS VIEW =====

CREATE OR REPLACE VIEW "harmonization_statistics" AS
SELECT
    -- Basic counts
    COUNT(*) as total_species,
    COUNT(*) FILTER (WHERE primary_alpha3_code IS NOT NULL) as species_with_alpha3,
    COUNT(*) FILTER (WHERE has_direct_alpha3 = true) as direct_matches,
    COUNT(*) FILTER (WHERE has_cascade_alpha3 = true) as cascaded_matches,
    COUNT(*) FILTER (WHERE worms_taxon_id IS NOT NULL) as worms_matches,
    COUNT(*) FILTER (WHERE asfis_id IS NOT NULL) as asfis_matches,

    -- Quality metrics
    ROUND(AVG(cascade_alpha3_count), 2) as avg_cascade_count,
    COUNT(*) FILTER (WHERE cascade_alpha3_count > 2) as high_cascade_species,
    ROUND(AVG(confidence_score), 3) as avg_confidence_score,

    -- Match type breakdown
    COUNT(*) FILTER (WHERE worms_match_type = 'EXACT') as worms_exact_matches,
    COUNT(*) FILTER (WHERE asfis_match_type = 'DIRECT') as asfis_direct_matches,
    COUNT(*) FILTER (WHERE asfis_match_type = 'CASCADE') as asfis_cascade_matches,

    -- API optimization stats
    COUNT(*) FILTER (WHERE search_vector IS NOT NULL) as with_search_vectors,
    COUNT(*) FILTER (WHERE api_cached_response IS NOT NULL) as with_cached_responses,

    -- Data freshness
    MAX(updated_at) as last_update,
    now() as calculated_at
FROM harmonized_species;

-- ===== ENHANCED VALIDATION FUNCTION =====

CREATE OR REPLACE FUNCTION validate_harmonization_integrity()
RETURNS TABLE (
    check_name text,
    status text,
    count_value bigint,
    notes text
) AS $$
BEGIN
    -- Check 1: Orphaned WoRMS references
    RETURN QUERY
    SELECT
        'Orphaned WoRMS References'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text,
        COUNT(*),
        'Species with invalid WoRMS FK references'::text
    FROM harmonized_species h
    WHERE h.worms_taxon_id IS NOT NULL
      AND h.worms_kingdom IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM worms_taxonomic_core w
          WHERE w."taxonID" = h.worms_taxon_id
            AND w.kingdom = h.worms_kingdom
      );

    -- Check 2: Orphaned ASFIS references
    RETURN QUERY
    SELECT
        'Orphaned ASFIS References'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text,
        COUNT(*),
        'Species with invalid ASFIS FK references'::text
    FROM harmonized_species h
    WHERE h.asfis_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM asfis_species a
          WHERE a.asfis_id = h.asfis_id
      );

    -- Check 3: Boolean flag consistency
    RETURN QUERY
    SELECT
        'Boolean Flag Consistency'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::text,
        COUNT(*),
        'Species with inconsistent boolean flags'::text
    FROM harmonized_species
    WHERE (cascade_alpha3_count > 0 AND has_cascade_alpha3 = false)
       OR (cascade_alpha3_count = 0 AND has_cascade_alpha3 = true);

    -- Check 4: Search vector completeness
    RETURN QUERY
    SELECT
        'Search Vector Completeness'::text,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END::text,
        COUNT(*),
        'Species missing search vectors for full-text search'::text
    FROM harmonized_species
    WHERE search_vector IS NULL;

    -- Check 5: API data quality
    RETURN QUERY
    SELECT
        'API Data Quality'::text,
        'INFO'::text,
        COUNT(*) FILTER (WHERE primary_alpha3_code IS NOT NULL),
        'Species available for API queries'::text
    FROM harmonized_species;
END;
$$ LANGUAGE plpgsql;

-- ===== HELPER VIEWS FOR API DEVELOPMENT =====

-- View for species with trade codes (optimized for API)
CREATE OR REPLACE VIEW "api_species_with_codes" AS
SELECT
    h.harmonized_id,
    h.canonical_scientific_name,
    h.primary_alpha3_code,
    h.alternative_names,
    h.all_alpha3_codes,
    h.confidence_score,
    h.has_direct_alpha3,
    h.has_cascade_alpha3,
    -- WoRMS summary
    jsonb_build_object(
        'family', w.family,
        'genus', w.genus,
        'kingdom', w.kingdom,
        'is_marine', w.is_marine
    ) as worms_summary,
    -- ASFIS summary
    jsonb_build_object(
        'english_name', a.english_name,
        'french_name', a.french_name
    ) as asfis_summary,
    h.updated_at
FROM harmonized_species h
LEFT JOIN worms_taxonomic_core w ON h.worms_taxon_id = w."taxonID" AND h.worms_kingdom = w.kingdom
LEFT JOIN asfis_species a ON h.asfis_id = a.asfis_id
WHERE h.primary_alpha3_code IS NOT NULL
ORDER BY h.confidence_score DESC, h.canonical_scientific_name;

-- ===== MIGRATION METADATA =====

INSERT INTO "migration_metadata" (migration_name, version, notes)
VALUES ('enhanced_harmonized_species_with_api_support', '0002', 'Creates enhanced harmonized_species table with API optimization, full-text search, and comprehensive query functions')
ON CONFLICT DO NOTHING;

-- ===== FINAL NOTICES =====

DO $$
BEGIN
    RAISE NOTICE '✅ Enhanced harmonized_species migration completed successfully!';
    RAISE NOTICE '📊 Table includes API optimization features:';
    RAISE NOTICE '   - Full-text search vectors';
    RAISE NOTICE '   - JSONB indexes for fast API responses';
    RAISE NOTICE '   - Specialized API query functions';
    RAISE NOTICE '   - Comprehensive validation functions';
    RAISE NOTICE '🔍 Key API functions available:';
    RAISE NOTICE '   - api_search_species(search_term, limit, include_cascaded)';
    RAISE NOTICE '   - api_get_species_details(species_id)';
    RAISE NOTICE '   - api_lookup_by_alpha3(alpha3_code)';
    RAISE NOTICE '📋 Helper views for development:';
    RAISE NOTICE '   - api_species_with_codes';
    RAISE NOTICE '   - harmonization_statistics';
END $$;
