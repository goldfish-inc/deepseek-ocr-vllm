import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// ===============================
// ORIGINAL SOURCES TABLE
// ===============================
export const originalSources = pgTable(
  'original_sources',
  {
    sourceId: uuid('source_id').primaryKey().defaultRandom(),
    sourceShortname: text('source_shortname').notNull().unique(),
    sourceType: text('source_type').notNull(), // 'SPECIES_DATA', 'TAXONOMIC_DATA', etc.
    sourceUrl: text('source_url'),
    sourceDescription: text('source_description'),
    refreshDate: timestamp('refresh_date', { mode: 'date' }),
    status: text('status').notNull().default('PENDING'), // 'LOADED', 'PENDING', 'FAILED'
    sizeApprox: integer('size_approx'), // Approximate record count
    lastUpdated: timestamp('last_updated', { mode: 'date', withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      statusIdx: index('idx_original_sources_status').on(table.status),
      sourceTypeIdx: index('idx_original_sources_type').on(table.sourceType),
      lastUpdatedIdx: index('idx_original_sources_updated').on(table.lastUpdated),
    }
  }
)

// ===============================
// ASFIS SPECIES TABLE (MAIN)
// ===============================
export const asfisSpecies = pgTable(
  'asfis_species',
  {
    // Primary key (UUID prevents constraint violations)
    asfisId: uuid('asfis_id').primaryKey().defaultRandom(),

    // Trade data structure - core identifiers
    isscaapGroup: numeric('ISSCAAP_Group', { precision: 10, scale: 2 }),
    taxonomicCode: text('Taxonomic_Code').notNull(),
    alpha3Code: text('Alpha3_Code'), // 3-letter trade code (shared across species)
    taxonRank: text('taxonRank'), // Species, Genus, Family, Order, etc.
    scientificName: text('scientificName').notNull(), // For WoRMS/ITIS mapping

    // Multilingual common names
    englishName: text('English_name'),
    frenchName: text('French_name'),
    spanishName: text('Spanish_name'),
    arabicName: text('Arabic_name'),
    chineseName: text('Chinese_name'),
    russianName: text('Russian_name'),

    // Taxonomic metadata
    author: text('Author'), // Taxonomic authority
    family: text('Family'), // For hierarchical cascading
    orderOrHigherTaxa: text('Order_or_higher_taxa'), // For hierarchical cascading
    fishStatData: boolean('FishStat_Data'), // Included in FAO statistics

    // Source tracking (critical for annual updates)
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    dataYear: integer('data_year').default(2025),
    lastSeenYear: integer('last_seen_year').default(2025),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Core indexes for trade data queries
      taxonomicCodeIdx: index('idx_asfis_taxonomic_code').on(table.taxonomicCode),
      alpha3CodeIdx: index('idx_asfis_alpha3_code')
        .on(table.alpha3Code)
        .where(sql`"Alpha3_Code" IS NOT NULL AND "Alpha3_Code" != ''`),
      scientificNameIdx: index('idx_asfis_species_scientific_name').on(table.scientificName),

      // Multilingual search indexes
      englishNameIdx: index('idx_asfis_species_english_name')
        .on(table.englishName)
        .where(sql`"English_name" IS NOT NULL`),
      frenchNameIdx: index('idx_asfis_species_french_name')
        .on(table.frenchName)
        .where(sql`"French_name" IS NOT NULL`),
      spanishNameIdx: index('idx_asfis_species_spanish_name')
        .on(table.spanishName)
        .where(sql`"Spanish_name" IS NOT NULL`),

      // Taxonomic hierarchy indexes (for cascading)
      familyIdx: index('idx_asfis_species_family')
        .on(table.family)
        .where(sql`"Family" IS NOT NULL`),
      orderIdx: index('idx_asfis_species_order')
        .on(table.orderOrHigherTaxa)
        .where(sql`"Order_or_higher_taxa" IS NOT NULL`),

      // Classification and metadata indexes
      isscaapIdx: index('idx_asfis_species_isscaap')
        .on(table.isscaapGroup)
        .where(sql`"ISSCAAP_Group" IS NOT NULL`),
      taxonRankIdx: index('idx_asfis_species_taxon_rank')
        .on(table.taxonRank)
        .where(sql`"taxonRank" IS NOT NULL`),
      fishStatIdx: index('idx_asfis_species_fishstat')
        .on(table.fishStatData)
        .where(sql`"FishStat_Data" IS NOT NULL`),
      sourceIdIdx: index('idx_asfis_species_source_id').on(table.sourceId),

      // Composite indexes for complex queries
      tradeCascadeIdx: index('idx_asfis_trade_cascade')
        .on(table.alpha3Code, table.taxonRank)
        .where(sql`"Alpha3_Code" IS NOT NULL`),
      dataYearIdx: index('idx_asfis_data_year').on(table.dataYear),
      lastSeenYearIdx: index('idx_asfis_last_seen_year').on(table.lastSeenYear),

      // Composite unique index for incremental updates (UPSERT key)
      compositeUniqueIdx: unique('asfis_species_composite_key').on(
        table.taxonomicCode,
        table.scientificName
      ),

      // Data quality constraints
      scientificNameNotEmptyCheck: "CHECK (scientificName IS NOT NULL AND scientificName != '')",
      taxonomicCodeNotEmptyCheck: "CHECK (Taxonomic_Code IS NOT NULL AND Taxonomic_Code != '')",
      alpha3CodeLengthCheck: 'CHECK (Alpha3_Code IS NULL OR LENGTH(Alpha3_Code) = 3)',
    }
  }
)

// ===============================
// ASFIS SPECIES HISTORICAL TABLE
// ===============================
export const asfisSpeciesHistorical = pgTable(
  'asfis_species_historical',
  {
    // Copy all columns from main table
    asfisId: uuid('asfis_id'),
    isscaapGroup: numeric('ISSCAAP_Group', { precision: 10, scale: 2 }),
    taxonomicCode: text('Taxonomic_Code').notNull(),
    alpha3Code: text('Alpha3_Code'),
    taxonRank: text('taxonRank'),
    scientificName: text('scientificName').notNull(),
    englishName: text('English_name'),
    frenchName: text('French_name'),
    spanishName: text('Spanish_name'),
    arabicName: text('Arabic_name'),
    chineseName: text('Chinese_name'),
    russianName: text('Russian_name'),
    author: text('Author'),
    family: text('Family'),
    orderOrHigherTaxa: text('Order_or_higher_taxa'),
    fishStatData: boolean('FishStat_Data'),
    sourceId: uuid('source_id'),
    dataYear: integer('data_year'),
    lastSeenYear: integer('last_seen_year'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }),

    // Historical tracking columns
    archivedAt: timestamp('archived_at', { mode: 'date', withTimezone: true }).defaultNow(),
    archivedReason: text('archived_reason').default('REMOVED_FROM_SOURCE'),
    originalAsfisId: uuid('original_asfis_id'), // Reference to original record
  },
  (table) => {
    return {
      // Historical query indexes
      taxonomicCodeHistIdx: index('idx_asfis_historical_taxonomic_code').on(table.taxonomicCode),
      alpha3CodeHistIdx: index('idx_asfis_historical_alpha3_code').on(table.alpha3Code),
      archivedAtIdx: index('idx_asfis_historical_archived_at').on(table.archivedAt),
      dataYearHistIdx: index('idx_asfis_historical_data_year').on(table.dataYear),
      originalIdIdx: index('idx_asfis_historical_original_id').on(table.originalAsfisId),
    }
  }
)

// ===============================
// STAGING TABLE FOR INCREMENTAL UPDATES
// ===============================
export const asfisSpeciesStaging = pgTable('asfis_species_staging', {
  // Same structure as main table for UPSERT operations
  asfisId: uuid('asfis_id').defaultRandom(),
  isscaapGroup: numeric('ISSCAAP_Group', { precision: 10, scale: 2 }),
  taxonomicCode: text('Taxonomic_Code').notNull(),
  alpha3Code: text('Alpha3_Code'),
  taxonRank: text('taxonRank'),
  scientificName: text('scientificName').notNull(),
  englishName: text('English_name'),
  frenchName: text('French_name'),
  spanishName: text('Spanish_name'),
  arabicName: text('Arabic_name'),
  chineseName: text('Chinese_name'),
  russianName: text('Russian_name'),
  author: text('Author'),
  family: text('Family'),
  orderOrHigherTaxa: text('Order_or_higher_taxa'),
  fishStatData: boolean('FishStat_Data'),
  sourceId: uuid('source_id'),
  dataYear: integer('data_year'),
  lastSeenYear: integer('last_seen_year'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow(),

  // Incremental update support
  rowHash: text('row_hash'), // For change detection
  compositeKey: text('composite_key'), // Taxonomic_Code::scientificName
})

// ===============================
// TABLE RELATIONS
// ===============================
export const originalSourcesRelations = relations(originalSources, ({ many }) => ({
  asfisSpecies: many(asfisSpecies),
}))

export const asfisSpeciesRelations = relations(asfisSpecies, ({ one }) => ({
  source: one(originalSources, {
    fields: [asfisSpecies.sourceId],
    references: [originalSources.sourceId],
  }),
}))

// ===============================
// TYPESCRIPT TYPES
// ===============================
export type OriginalSource = typeof originalSources.$inferSelect
export type NewOriginalSource = typeof originalSources.$inferInsert

export type AsfisSpecies = typeof asfisSpecies.$inferSelect
export type NewAsfisSpecies = typeof asfisSpecies.$inferInsert

export type AsfisSpeciesHistorical = typeof asfisSpeciesHistorical.$inferSelect
export type NewAsfisSpeciesHistorical = typeof asfisSpeciesHistorical.$inferInsert

export type AsfisSpeciesStaging = typeof asfisSpeciesStaging.$inferSelect
export type NewAsfisSpeciesStaging = typeof asfisSpeciesStaging.$inferInsert

// ===============================
// ENUMS AND CONSTANTS
// ===============================
export const SOURCE_TYPES = {
  SPECIES_DATA: 'SPECIES_DATA',
  TAXONOMIC_DATA: 'TAXONOMIC_DATA',
  REFERENCE_DATA: 'REFERENCE_DATA',
  MAPPING_DATA: 'MAPPING_DATA',
} as const

export const SOURCE_STATUS = {
  LOADED: 'LOADED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
} as const

export const TAXON_RANKS = {
  SPECIES: 'Species',
  SUBSPECIES: 'Subspecies',
  GENUS: 'Genus',
  FAMILY: 'Family',
  ORDER: 'Order',
  CLASS: 'Class',
  PHYLUM: 'Phylum',
  KINGDOM: 'Kingdom',
  SUPERCLASS: 'Superclass',
  SUBORDER: 'Suborder',
  INFRAORDER: 'Infraorder',
  SUBFAMILY: 'Subfamily',
  TRIBE: 'Tribe',
} as const

export const ARCHIVED_REASONS = {
  REMOVED_FROM_SOURCE: 'REMOVED_FROM_SOURCE',
  DATA_QUALITY_ISSUE: 'DATA_QUALITY_ISSUE',
  DUPLICATE_RECORD: 'DUPLICATE_RECORD',
  MANUAL_REMOVAL: 'MANUAL_REMOVAL',
} as const

// ===============================
// HELPER FUNCTIONS FOR TRADE DATA
// ===============================

// Helper type for trade data analysis
export type TradeCodeAssignment = {
  alpha3Code: string
  assignmentType: 'Direct Species' | 'Multi-Species' | 'Taxonomic Hierarchy' | 'Other'
  speciesCount: number
  scientificNames: string[]
  taxonRanks: string[]
}

// Helper type for annual update operations
export type AnnualUpdateResult = {
  actionType: 'ARCHIVED' | 'UPDATED' | 'INSERTED' | 'UNCHANGED'
  recordCount: number
  details: string
}

// Helper type for change preview
export type ChangePreview = {
  changeType: 'WILL_ARCHIVE' | 'WILL_INSERT' | 'WILL_UPDATE'
  taxonomicCode: string
  currentAlpha3Code?: string
  newAlpha3Code?: string
  currentScientificName?: string
  newScientificName?: string
}

// ===============================
// MIGRATION UTILITIES
// ===============================

// SQL for creating custom functions (to be run after table creation)
export const customFunctions = `
-- Function to get trade code assignment types
CREATE OR REPLACE FUNCTION get_asfis_trade_code_types()
RETURNS TABLE(
    assignment_type TEXT,
    code_count BIGINT,
    species_count BIGINT,
    example_codes TEXT[]
) AS $$
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
        ARRAY_AGG("Alpha3_Code" ORDER BY species_per_code DESC LIMIT 5) as example_codes
    FROM code_stats
    GROUP BY 1
    ORDER BY code_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Function for cascading candidates
CREATE OR REPLACE FUNCTION get_asfis_cascading_candidates()
RETURNS TABLE(
    "Alpha3_Code" TEXT,
    taxon_rank TEXT,
    scientific_name TEXT,
    potential_species_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a."Alpha3_Code",
        a."taxonRank" as taxon_rank,
        a."scientificName" as scientific_name,
        -- Will be populated when WoRMS/ITIS tables are available
        0::BIGINT as potential_species_count
    FROM asfis_species a
    WHERE a."taxonRank" IN ('Family', 'Order', 'Class', 'Phylum', 'Kingdom')
    AND a."Alpha3_Code" IS NOT NULL
    ORDER BY a."scientificName";
END;
$$ LANGUAGE plpgsql;
`

// ===============================
// EXAMPLE USAGE
// ===============================

/*
// Example: Insert new original source
const newSource: NewOriginalSource = {
  sourceShortname: 'ASFIS',
  sourceType: 'SPECIES_DATA',
  sourceUrl: 'https://www.fao.org/fishery/collection/asfis/en',
  sourceDescription: 'Aquatic Sciences and Fisheries Information System',
  refreshDate: new Date('2025-07-07'),
  status: 'LOADED',
  sizeApprox: 13733
};

// Example: Query species by trade code
const tunaSpecies = await db
  .select()
  .from(asfisSpecies)
  .where(eq(asfisSpecies.alpha3Code, 'YFT'));

// Example: Search multilingual names
const searchResults = await db
  .select({
    alpha3Code: asfisSpecies.alpha3Code,
    scientificName: asfisSpecies.scientificName,
    englishName: asfisSpecies.englishName,
    frenchName: asfisSpecies.frenchName
  })
  .from(asfisSpecies)
  .where(
    or(
      ilike(asfisSpecies.englishName, '%tuna%'),
      ilike(asfisSpecies.frenchName, '%thon%'),
      ilike(asfisSpecies.spanishName, '%atún%')
    )
  );

// Example: Annual update preparation
const stagingData = await db
  .select()
  .from(asfisSpeciesStaging)
  .leftJoin(asfisSpecies, eq(asfisSpeciesStaging.compositeKey,
    concat(asfisSpecies.taxonomicCode, '::', asfisSpecies.scientificName)));
*/
