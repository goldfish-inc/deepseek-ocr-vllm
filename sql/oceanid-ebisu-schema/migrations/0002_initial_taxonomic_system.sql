-- ============================================================================
-- Migration 0002: Species Taxonomic System
-- ============================================================================
-- Creates all species and taxonomic data tables from WoRMS, ITIS, and ASFIS
-- DEPENDENCIES: Migration 0001 (original_sources table must exist)
-- ============================================================================

-- Set up transaction and error handling
\set ON_ERROR_STOP on

BEGIN;

-- ============================================================================
-- WORMS (WORLD REGISTER OF MARINE SPECIES) TABLES
-- ============================================================================

-- WoRMS Core Table - Primary taxonomic data with composite PK
CREATE TABLE IF NOT EXISTS "worms_taxonomic_core" (
    "taxonID" text NOT NULL,
    "kingdom" text NOT NULL,
    "scientificName" text NOT NULL,
    "acceptedNameUsage" text,
    "phylum" text,
    "class" text,
    "order" text,
    "family" text,
    "genus" text,
    "subgenus" text,
    "specificEpithet" text,
    "infraspecificEpithet" text,
    "taxonRank" text,
    "taxonomicStatus" text,
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "created_at" timestamp with time zone DEFAULT now(),

    -- Composite primary key for partitioning capability
    CONSTRAINT "pk_worms_taxonomic_core" PRIMARY KEY ("taxonID", "kingdom")
);

-- WoRMS Core Indexes
CREATE INDEX IF NOT EXISTS "idx_worms_core_scientificname" ON "worms_taxonomic_core" ("scientificName");
CREATE INDEX IF NOT EXISTS "idx_worms_core_kingdom_genus" ON "worms_taxonomic_core" ("kingdom", "genus");
CREATE INDEX IF NOT EXISTS "idx_worms_core_kingdom_family" ON "worms_taxonomic_core" ("kingdom", "family");
CREATE INDEX IF NOT EXISTS "idx_worms_core_status_rank" ON "worms_taxonomic_core" ("taxonomicStatus", "taxonRank");
CREATE INDEX IF NOT EXISTS "idx_worms_core_source_id" ON "worms_taxonomic_core" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_worms_core_taxonid" ON "worms_taxonomic_core" ("taxonID");

-- WoRMS Extended Table - Detailed metadata
CREATE TABLE IF NOT EXISTS "worms_taxonomic_extended" (
    "taxonID" text NOT NULL,
    "kingdom" text NOT NULL,
    "scientificNameID" text,
    "acceptedNameUsageID" text,
    "parentNameUsageID" text,
    "namePublishedInID" text,
    "namePublishedIn" text,
    "namePublishedInYear" text,
    "parentNameUsage" text,
    "scientificNameAuthorship" text,
    "nomenclaturalCode" text,
    "nomenclaturalStatus" text,
    "modified" text,
    "bibliographicCitation" text,
    "references" text,
    "license" text,
    "rightsHolder" text,
    "datasetName" text,
    "institutionCode" text,
    "datasetID" text,
    "created_at" timestamp with time zone DEFAULT now(),

    -- Composite primary key matching core table
    CONSTRAINT "pk_worms_taxonomic_extended" PRIMARY KEY ("taxonID", "kingdom"),

    -- Foreign key to core table
    CONSTRAINT "fk_worms_extended_core"
        FOREIGN KEY ("taxonID", "kingdom")
        REFERENCES "worms_taxonomic_core" ("taxonID", "kingdom")
        ON DELETE CASCADE
);

-- WoRMS Extended Indexes
CREATE INDEX IF NOT EXISTS "idx_worms_extended_taxonid_kingdom" ON "worms_taxonomic_extended" ("taxonID", "kingdom");
CREATE INDEX IF NOT EXISTS "idx_worms_extended_authorship" ON "worms_taxonomic_extended" ("scientificNameAuthorship");

-- WoRMS Identifier Table - External identifiers
CREATE TABLE IF NOT EXISTS "worms_identifier" (
    "taxonID" text NOT NULL,
    "kingdom" text NOT NULL,
    "identifier" text,
    "title" text,
    "format" text,
    "datasetID" text,
    "subject" text,
    "created_at" timestamp with time zone DEFAULT now(),

    -- Composite primary key
    CONSTRAINT "pk_worms_identifier" PRIMARY KEY ("taxonID", "kingdom"),

    -- Foreign key to core table
    CONSTRAINT "fk_worms_identifier_core"
        FOREIGN KEY ("taxonID", "kingdom")
        REFERENCES "worms_taxonomic_core" ("taxonID", "kingdom")
        ON DELETE CASCADE
);

-- WoRMS Identifier Indexes
CREATE INDEX IF NOT EXISTS "idx_worms_identifier_taxonid_kingdom" ON "worms_identifier" ("taxonID", "kingdom");
CREATE INDEX IF NOT EXISTS "idx_worms_identifier_identifier" ON "worms_identifier" ("identifier");

-- WoRMS Species Profile Table - Habitat data
CREATE TABLE IF NOT EXISTS "worms_speciesprofile" (
    "taxonID" text NOT NULL,
    "kingdom" text NOT NULL,
    "isMarine" boolean DEFAULT false,
    "isFreshwater" boolean DEFAULT false,
    "isTerrestrial" boolean DEFAULT false,
    "isExtinct" boolean DEFAULT false,
    "isBrackish" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT now(),

    -- Composite primary key
    CONSTRAINT "pk_worms_speciesprofile" PRIMARY KEY ("taxonID", "kingdom"),

    -- Foreign key to core table
    CONSTRAINT "fk_worms_speciesprofile_core"
        FOREIGN KEY ("taxonID", "kingdom")
        REFERENCES "worms_taxonomic_core" ("taxonID", "kingdom")
        ON DELETE CASCADE
);

-- WoRMS Species Profile Indexes
CREATE INDEX IF NOT EXISTS "idx_worms_speciesprofile_taxonid_kingdom" ON "worms_speciesprofile" ("taxonID", "kingdom");
CREATE INDEX IF NOT EXISTS "idx_worms_speciesprofile_habitat" ON "worms_speciesprofile" ("isMarine", "isFreshwater", "isBrackish", "isTerrestrial");

-- ============================================================================
-- ITIS (INTEGRATED TAXONOMIC INFORMATION SYSTEM) TABLES
-- ============================================================================

-- ITIS Kingdoms (Base table)
CREATE TABLE IF NOT EXISTS "itis_kingdoms" (
    "kingdom_id" smallint PRIMARY KEY,
    "kingdom_name" char(10) NOT NULL,
    "update_date" date NOT NULL,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- ITIS Kingdoms Index
CREATE INDEX IF NOT EXISTS "idx_itis_kingdoms_name" ON "itis_kingdoms" ("kingdom_name");

-- ITIS Taxon Unit Types (Ranks)
CREATE TABLE IF NOT EXISTS "itis_taxon_unit_types" (
    "kingdom_id" smallint NOT NULL REFERENCES "itis_kingdoms" ("kingdom_id"),
    "rank_id" smallint NOT NULL,
    "rank_name" char(15) NOT NULL,
    "dir_parent_rank_id" smallint NOT NULL,
    "req_parent_rank_id" smallint NOT NULL,
    "update_date" date NOT NULL,

    CONSTRAINT "pk_itis_taxon_unit_types" PRIMARY KEY ("kingdom_id", "rank_id")
);

-- ITIS Taxon Unit Types Index
CREATE INDEX IF NOT EXISTS "idx_itis_taxon_unit_types_rank_name" ON "itis_taxon_unit_types" ("rank_name");

-- ITIS Taxon Authors Lookup
CREATE TABLE IF NOT EXISTS "itis_taxon_authors_lkp" (
    "taxon_author_id" integer PRIMARY KEY,
    "taxon_author" varchar(100) NOT NULL,
    "update_date" date NOT NULL,
    "kingdom_id" smallint REFERENCES "itis_kingdoms" ("kingdom_id"),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now()
);

-- ITIS Taxon Authors Indexes
CREATE INDEX IF NOT EXISTS "idx_itis_taxon_authors_lkp_author" ON "itis_taxon_authors_lkp" ("taxon_author");
CREATE INDEX IF NOT EXISTS "idx_itis_taxon_authors_lkp_kingdom" ON "itis_taxon_authors_lkp" ("kingdom_id");

-- ITIS Comments
CREATE TABLE IF NOT EXISTS "itis_comments" (
    "comment_id" integer PRIMARY KEY,
    "comment_detail" text,
    "update_date" date NOT NULL
);

-- ITIS Taxonomic Units (Main table)
CREATE TABLE IF NOT EXISTS "itis_taxonomic_units" (
    "tsn" integer PRIMARY KEY,
    "unit_ind1" char(1),
    "unit_name1" varchar(35) NOT NULL,
    "unit_ind2" char(1),
    "unit_name2" varchar(35),
    "unit_ind3" varchar(7),
    "unit_name3" varchar(35),
    "unit_ind4" varchar(7),
    "unit_name4" varchar(35),
    "unnamed_taxon_ind" char(1),
    "name_usage" varchar(12) NOT NULL,
    "unaccept_reason" varchar(50),
    "credibility_rtng" varchar(40) NOT NULL,
    "completeness_rtng" char(1),
    "currency_rating" char(1),
    "phylo_sort_seq" smallint,
    "initial_time_stamp" timestamp NOT NULL,
    "parent_tsn" integer,
    "taxon_author_id" integer,
    "hybrid_author_id" integer,
    "kingdom_id" smallint NOT NULL,
    "rank_id" smallint NOT NULL,
    "update_date" date NOT NULL,
    "uncertain_prnt_ind" char(3),
    "complete_name" varchar(300),
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),

    -- Foreign key constraints
    CONSTRAINT "fk_itis_taxonomic_units_kingdom"
        FOREIGN KEY ("kingdom_id")
        REFERENCES "itis_kingdoms" ("kingdom_id"),
    CONSTRAINT "fk_itis_taxonomic_units_parent"
        FOREIGN KEY ("parent_tsn")
        REFERENCES "itis_taxonomic_units" ("tsn"),
    CONSTRAINT "fk_itis_taxonomic_units_author"
        FOREIGN KEY ("taxon_author_id")
        REFERENCES "itis_taxon_authors_lkp" ("taxon_author_id"),
    CONSTRAINT "fk_itis_taxonomic_units_hybrid_author"
        FOREIGN KEY ("hybrid_author_id")
        REFERENCES "itis_taxon_authors_lkp" ("taxon_author_id")
);

-- ITIS Taxonomic Units Indexes
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_parent_tsn" ON "itis_taxonomic_units" ("parent_tsn");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_complete_name" ON "itis_taxonomic_units" ("complete_name");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_kingdom_id" ON "itis_taxonomic_units" ("kingdom_id");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_name_usage" ON "itis_taxonomic_units" ("name_usage");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_rank_id" ON "itis_taxonomic_units" ("rank_id");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_taxon_author_id" ON "itis_taxonomic_units" ("taxon_author_id");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_kingdom_rank" ON "itis_taxonomic_units" ("kingdom_id", "rank_id");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_kingdom_name_usage" ON "itis_taxonomic_units" ("kingdom_id", "name_usage");
CREATE INDEX IF NOT EXISTS "idx_itis_taxonomic_units_name_usage_complete_name" ON "itis_taxonomic_units" ("name_usage", "complete_name");

-- ITIS Vernaculars (Common names)
CREATE TABLE IF NOT EXISTS "itis_vernaculars" (
    "vern_id" integer PRIMARY KEY,
    "tsn" integer NOT NULL REFERENCES "itis_taxonomic_units" ("tsn"),
    "vernacular_name" varchar(80) NOT NULL,
    "language" varchar(15) NOT NULL,
    "approved_ind" char(1),
    "update_date" date NOT NULL
);

-- ITIS Vernaculars Indexes
CREATE INDEX IF NOT EXISTS "idx_itis_vernaculars_tsn" ON "itis_vernaculars" ("tsn");
CREATE INDEX IF NOT EXISTS "idx_itis_vernaculars_vernacular_name" ON "itis_vernaculars" ("vernacular_name");

-- ITIS Hierarchy (Materialized paths)
CREATE TABLE IF NOT EXISTS "itis_hierarchy" (
    "tsn" integer PRIMARY KEY REFERENCES "itis_taxonomic_units" ("tsn"),
    "parent_tsn" integer,
    "level" integer,
    "children_count" integer,
    "hierarchy_string" text
);

-- ITIS Hierarchy Indexes
CREATE INDEX IF NOT EXISTS "idx_itis_hierarchy_parent_tsn" ON "itis_hierarchy" ("parent_tsn");
CREATE INDEX IF NOT EXISTS "idx_itis_hierarchy_hierarchy_string" ON "itis_hierarchy" ("hierarchy_string");

-- ITIS Longnames (Complete names)
CREATE TABLE IF NOT EXISTS "itis_longnames" (
    "tsn" integer PRIMARY KEY REFERENCES "itis_taxonomic_units" ("tsn"),
    "completename" text
);

-- ITIS Longnames Index
CREATE INDEX IF NOT EXISTS "idx_itis_longnames_completename" ON "itis_longnames" ("completename");

-- ITIS Synonym Links
CREATE TABLE IF NOT EXISTS "itis_synonym_links" (
    "tsn" integer NOT NULL REFERENCES "itis_taxonomic_units" ("tsn"),
    "tsn_accepted" integer NOT NULL REFERENCES "itis_taxonomic_units" ("tsn"),
    "update_date" date NOT NULL,

    CONSTRAINT "pk_itis_synonym_links" PRIMARY KEY ("tsn", "tsn_accepted")
);

-- ITIS Synonym Links Indexes
CREATE INDEX IF NOT EXISTS "idx_itis_synonym_links_tsn" ON "itis_synonym_links" ("tsn");
CREATE INDEX IF NOT EXISTS "idx_itis_synonym_links_tsn_accepted" ON "itis_synonym_links" ("tsn_accepted");

-- ITIS Geographic Divisions
CREATE TABLE IF NOT EXISTS "itis_geographic_div" (
    "tsn" integer NOT NULL REFERENCES "itis_taxonomic_units" ("tsn"),
    "geographic_value" varchar(45) NOT NULL,
    "update_date" date NOT NULL,

    CONSTRAINT "pk_itis_geographic_div" PRIMARY KEY ("tsn", "geographic_value")
);

-- ITIS Geographic Divisions Index
CREATE INDEX IF NOT EXISTS "idx_itis_geographic_div_tsn" ON "itis_geographic_div" ("tsn");

-- ITIS Jurisdiction
CREATE TABLE IF NOT EXISTS "itis_jurisdiction" (
    "tsn" integer NOT NULL REFERENCES "itis_taxonomic_units" ("tsn"),
    "jurisdiction_value" varchar(45) NOT NULL,
    "origin" char(3),
    "update_date" date NOT NULL,

    CONSTRAINT "pk_itis_jurisdiction" PRIMARY KEY ("tsn", "jurisdiction_value")
);

-- ITIS Jurisdiction Index
CREATE INDEX IF NOT EXISTS "idx_itis_jurisdiction_tsn" ON "itis_jurisdiction" ("tsn");

-- ============================================================================
-- ASFIS (AQUATIC SCIENCES AND FISHERIES INFORMATION SYSTEM) TABLES
-- ============================================================================

-- ASFIS Species (Main table)
CREATE TABLE IF NOT EXISTS "asfis_species" (
    "asfis_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "source_id" uuid REFERENCES "original_sources" ("source_id"),
    "ISSCAAP_Group" numeric(10,2),
    "Taxonomic_Code" text NOT NULL,
    "Alpha3_Code" text,
    "taxonRank" text,
    "scientificName" text NOT NULL,
    "English_name" text,
    "French_name" text,
    "Spanish_name" text,
    "Arabic_name" text,
    "Chinese_name" text,
    "Russian_name" text,
    "Author" text,
    "Family" text,
    "Order_or_higher_taxa" text,
    "FishStat_Data" boolean,
    "data_year" integer DEFAULT 2025,
    "last_seen_year" integer DEFAULT 2025,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),

    -- Constraints
    CONSTRAINT "asfis_species_composite_key" UNIQUE ("Taxonomic_Code", "scientificName"),
    CONSTRAINT "chk_asfis_scientific_name_not_empty" CHECK ("scientificName" IS NOT NULL AND "scientificName" != ''),
    CONSTRAINT "chk_asfis_taxonomic_code_not_empty" CHECK ("Taxonomic_Code" IS NOT NULL AND "Taxonomic_Code" != ''),
    CONSTRAINT "chk_asfis_alpha3_code_length" CHECK ("Alpha3_Code" IS NULL OR LENGTH("Alpha3_Code") = 3)
);

-- ASFIS Species Indexes
CREATE INDEX IF NOT EXISTS "idx_asfis_taxonomic_code" ON "asfis_species" ("Taxonomic_Code");
CREATE INDEX IF NOT EXISTS "idx_asfis_alpha3_code" ON "asfis_species" ("Alpha3_Code") WHERE "Alpha3_Code" IS NOT NULL AND "Alpha3_Code" != '';
CREATE INDEX IF NOT EXISTS "idx_asfis_species_scientific_name" ON "asfis_species" ("scientificName");
CREATE INDEX IF NOT EXISTS "idx_asfis_species_english_name" ON "asfis_species" ("English_name") WHERE "English_name" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_french_name" ON "asfis_species" ("French_name") WHERE "French_name" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_spanish_name" ON "asfis_species" ("Spanish_name") WHERE "Spanish_name" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_family" ON "asfis_species" ("Family") WHERE "Family" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_order" ON "asfis_species" ("Order_or_higher_taxa") WHERE "Order_or_higher_taxa" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_isscaap" ON "asfis_species" ("ISSCAAP_Group") WHERE "ISSCAAP_Group" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_taxon_rank" ON "asfis_species" ("taxonRank") WHERE "taxonRank" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_fishstat" ON "asfis_species" ("FishStat_Data") WHERE "FishStat_Data" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_species_source_id" ON "asfis_species" ("source_id");
CREATE INDEX IF NOT EXISTS "idx_asfis_trade_cascade" ON "asfis_species" ("Alpha3_Code", "taxonRank") WHERE "Alpha3_Code" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_asfis_data_year" ON "asfis_species" ("data_year");
CREATE INDEX IF NOT EXISTS "idx_asfis_last_seen_year" ON "asfis_species" ("last_seen_year");

-- ASFIS Species Historical (Archive table)
CREATE TABLE IF NOT EXISTS "asfis_species_historical" (
    "asfis_id" uuid,
    "source_id" uuid,
    "ISSCAAP_Group" numeric(10,2),
    "Taxonomic_Code" text NOT NULL,
    "Alpha3_Code" text,
    "taxonRank" text,
    "scientificName" text NOT NULL,
    "English_name" text,
    "French_name" text,
    "Spanish_name" text,
    "Arabic_name" text,
    "Chinese_name" text,
    "Russian_name" text,
    "Author" text,
    "Family" text,
    "Order_or_higher_taxa" text,
    "FishStat_Data" boolean,
    "data_year" integer,
    "last_seen_year" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,

    -- Historical tracking columns
    "archived_at" timestamp with time zone DEFAULT now(),
    "archived_reason" text DEFAULT 'REMOVED_FROM_SOURCE',
    "original_asfis_id" uuid
);

-- ASFIS Historical Indexes
CREATE INDEX IF NOT EXISTS "idx_asfis_historical_taxonomic_code" ON "asfis_species_historical" ("Taxonomic_Code");
CREATE INDEX IF NOT EXISTS "idx_asfis_historical_alpha3_code" ON "asfis_species_historical" ("Alpha3_Code");
CREATE INDEX IF NOT EXISTS "idx_asfis_historical_archived_at" ON "asfis_species_historical" ("archived_at");
CREATE INDEX IF NOT EXISTS "idx_asfis_historical_data_year" ON "asfis_species_historical" ("data_year");
CREATE INDEX IF NOT EXISTS "idx_asfis_historical_original_id" ON "asfis_species_historical" ("original_asfis_id");

-- ASFIS Species Staging (For incremental updates)
CREATE TABLE IF NOT EXISTS "asfis_species_staging" (
    "asfis_id" uuid DEFAULT gen_random_uuid(),
    "source_id" uuid,
    "ISSCAAP_Group" numeric(10,2),
    "Taxonomic_Code" text NOT NULL,
    "Alpha3_Code" text,
    "taxonRank" text,
    "scientificName" text NOT NULL,
    "English_name" text,
    "French_name" text,
    "Spanish_name" text,
    "Arabic_name" text,
    "Chinese_name" text,
    "Russian_name" text,
    "Author" text,
    "Family" text,
    "Order_or_higher_taxa" text,
    "FishStat_Data" boolean,
    "data_year" integer,
    "last_seen_year" integer,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),

    -- Incremental update support
    "row_hash" text,
    "composite_key" text
);

-- ============================================================================
-- CUSTOM FUNCTIONS FOR ASFIS TRADE CODE ANALYSIS
-- ============================================================================

-- Function to get trade code assignment types
CREATE OR REPLACE FUNCTION get_asfis_trade_code_types()
RETURNS TABLE(
    assignment_type TEXT,
    code_count BIGINT,
    species_count BIGINT,
    example_codes TEXT[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH code_stats AS (
        SELECT
            "Alpha3_Code",
            COUNT(*) as species_per_code,
            ARRAY_AGG(DISTINCT "scientificName") as species_names,
            ARRAY_AGG(DISTINCT "taxonRank") as ranks
        FROM asfis_species
        WHERE "Alpha3_Code" IS NOT NULL
        GROUP BY "Alpha3_Code"
    )
    SELECT
        CASE
            WHEN species_per_code = 1 AND 'Species' = ANY(ranks) THEN 'Direct Species Mapping (1:1)'
            WHEN species_per_code > 1 AND 'Species' = ANY(ranks) THEN 'Multi-Species Mapping (1:Many)'
            WHEN 'Family' = ANY(ranks) OR 'Order' = ANY(ranks) OR 'Class' = ANY(ranks) THEN 'Taxonomic Cascading (1:Hierarchy)'
            ELSE 'Other'
        END as assignment_type,
        COUNT(*) as code_count,
        SUM(species_per_code) as species_count,
        ARRAY_AGG("Alpha3_Code" ORDER BY species_per_code DESC) as example_codes
    FROM code_stats
    GROUP BY 1
    ORDER BY code_count DESC;
END;
$$;

-- Function for cascading candidates
CREATE OR REPLACE FUNCTION get_asfis_cascading_candidates()
RETURNS TABLE(
    "Alpha3_Code" TEXT,
    taxon_rank TEXT,
    scientific_name TEXT,
    potential_species_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        a."Alpha3_Code",
        a."taxonRank" as taxon_rank,
        a."scientificName" as scientific_name,
        0::BIGINT as potential_species_count -- Will be populated when WoRMS/ITIS integration is complete
    FROM asfis_species a
    WHERE a."taxonRank" IN ('Family', 'Order', 'Class', 'Phylum', 'Kingdom')
    AND a."Alpha3_Code" IS NOT NULL
    ORDER BY a."scientificName";
END;
$$;

-- ============================================================================
-- MIGRATION METADATA TRACKING
-- ============================================================================

-- Insert migration tracking record
INSERT INTO "migration_metadata" (migration_name, version, notes)
VALUES ('species_taxonomic_system', '0002', 'Creates all species and taxonomic tables: WoRMS (4 tables), ITIS (11 tables), ASFIS (3 tables) with complete indexing and custom functions')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- VERIFICATION AND COMPLETION
-- ============================================================================

-- Simple species table count verification
DO $$
DECLARE
    species_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO species_count
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
    AND t.table_name IN (
        -- WoRMS tables (4 tables)
        'worms_taxonomic_core', 'worms_taxonomic_extended', 'worms_identifier', 'worms_speciesprofile',
        -- ITIS tables (11 tables)
        'itis_kingdoms', 'itis_taxon_unit_types', 'itis_taxon_authors_lkp', 'itis_comments',
        'itis_taxonomic_units', 'itis_vernaculars', 'itis_hierarchy', 'itis_longnames',
        'itis_synonym_links', 'itis_geographic_div', 'itis_jurisdiction',
        -- ASFIS tables (3 tables)
        'asfis_species', 'asfis_species_historical', 'asfis_species_staging'
    );

    RAISE NOTICE 'Created % species/taxonomic tables', species_count;

    IF species_count != 18 THEN
        RAISE EXCEPTION 'Expected exactly 18 species tables, but found %', species_count;
    END IF;
END $$;

-- Verify critical foreign key relationships exist
DO $$
BEGIN
    -- Verify WoRMS foreign keys
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        WHERE tc.constraint_name = 'fk_worms_extended_core'
        AND tc.table_name = 'worms_taxonomic_extended'
    ) THEN
        RAISE EXCEPTION 'Missing WoRMS extended foreign key constraint';
    END IF;

    -- Verify ITIS foreign keys
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        WHERE tc.constraint_name = 'fk_itis_taxonomic_units_kingdom'
        AND tc.table_name = 'itis_taxonomic_units'
    ) THEN
        RAISE EXCEPTION 'Missing ITIS kingdom foreign key constraint';
    END IF;

    -- Verify ASFIS constraints
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        WHERE tc.constraint_name = 'asfis_species_composite_key'
        AND tc.table_name = 'asfis_species'
    ) THEN
        RAISE EXCEPTION 'Missing ASFIS composite key constraint';
    END IF;

    RAISE NOTICE 'All critical foreign key relationships verified successfully';
END $$;

-- Success notification
DO $$
BEGIN
    RAISE NOTICE 'SUCCESS: Migration 0002 completed successfully!';
    RAISE NOTICE 'Species taxonomic system created:';
    RAISE NOTICE '  WoRMS (World Register of Marine Species):';
    RAISE NOTICE '    - worms_taxonomic_core (composite PK: taxonID+kingdom)';
    RAISE NOTICE '    - worms_taxonomic_extended (detailed metadata)';
    RAISE NOTICE '    - worms_identifier (external identifiers)';
    RAISE NOTICE '    - worms_speciesprofile (habitat data)';
    RAISE NOTICE '  ITIS (Integrated Taxonomic Information System):';
    RAISE NOTICE '    - 11 interconnected tables with hierarchical relationships';
    RAISE NOTICE '    - Full taxonomic hierarchy support';
    RAISE NOTICE '    - Common names and geographic data';
    RAISE NOTICE '  ASFIS (Aquatic Sciences and Fisheries Information System):';
    RAISE NOTICE '    - asfis_species (main trade data with Alpha3 codes)';
    RAISE NOTICE '    - Historical and staging tables for updates';
    RAISE NOTICE '    - Custom functions for trade code analysis';
    RAISE NOTICE 'Ready for harmonized_species migration (0003) and vessel migrations.';
END $$;

COMMIT;
