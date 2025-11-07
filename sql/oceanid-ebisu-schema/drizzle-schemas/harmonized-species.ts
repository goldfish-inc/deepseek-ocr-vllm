import {
  pgTable,
  uuid,
  text,
  jsonb,
  numeric,
  timestamp,
  boolean,
  index,
  unique,
  foreignKey,
  pgView,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// Import existing tables for foreign key relationships
import { originalSources } from './asfis'
import { wormsCore } from './worms'  // worms_taxonomic_core
import { asfisSpecies } from './asfis'

// ===============================
// HARMONIZED SPECIES TABLE (PROPERLY DESIGNED WITH FKs)
// ===============================
export const harmonizedSpecies = pgTable(
  'harmonized_species',
  {
    // Core identification
    harmonizedId: uuid('harmonized_id').primaryKey().defaultRandom(),
    canonicalScientificName: text('canonical_scientific_name').notNull(),
    primaryAlpha3Code: text('primary_alpha3_code'),

    // PROPER FOREIGN KEY RELATIONSHIPS TO SOURCE TABLES
    wormsTaxonId: text('worms_taxon_id'), // Links to worms_taxonomic_core.taxonID
    wormsKingdom: text('worms_kingdom'),  // Links to worms_taxonomic_core.kingdom
    asfisId: uuid('asfis_id'),            // Links to asfis_species.asfis_id

    // JSONB flexible data
    alternativeNames: jsonb('alternative_names'),
    allAlpha3Codes: jsonb('all_alpha3_codes'),

    // Quality & matching metadata
    hasDirectAlpha3: boolean('has_direct_alpha3').notNull().default(false),
    cascadeAlpha3Count: numeric('cascade_alpha3_count').notNull().default('0'),
    hasCascadeAlpha3: boolean('has_cascade_alpha3').notNull().default(false),

    // Match quality indicators
    wormsMatchType: text('worms_match_type'), // 'EXACT', 'FUZZY', 'MANUAL'
    asfisMatchType: text('asfis_match_type'), // 'DIRECT', 'CASCADE', 'MANUAL'
    confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 }).default('1.00'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Essential indexes for performance
      canonicalNameIdx: index('idx_harmonized_canonical_name').on(table.canonicalScientificName),
      primaryAlpha3Idx: index('idx_harmonized_primary_alpha3').on(table.primaryAlpha3Code),

      // Foreign key indexes
      wormsTaxonIdx: index('idx_harmonized_worms_taxon').on(table.wormsTaxonId, table.wormsKingdom),
      asfisIdIdx: index('idx_harmonized_asfis_id').on(table.asfisId),

      // Boolean flag indexes for fast filtering
      hasDirectAlpha3Idx: index('idx_harmonized_has_direct_alpha3').on(table.hasDirectAlpha3),
      hasCascadeAlpha3Idx: index('idx_harmonized_has_cascade_alpha3').on(table.hasCascadeAlpha3),

      // JSONB indexes
      alternativeNamesIdx: index('idx_harmonized_alternative_names')
        .on(table.alternativeNames)
        .using('gin'),
      allAlpha3CodesIdx: index('idx_harmonized_all_alpha3_codes')
        .on(table.allAlpha3Codes)
        .using('gin'),

      // Composite indexes for common query patterns
      matchQualityIdx: index('idx_harmonized_match_quality').on(
        table.wormsMatchType,
        table.asfisMatchType,
        table.confidenceScore
      ),

      // Uniqueness constraints
      uniqueCanonicalName: unique('unique_harmonized_canonical_name').on(
        table.canonicalScientificName
      ),

      // PROPER FOREIGN KEY CONSTRAINTS
      wormsRef: foreignKey({
        columns: [table.wormsTaxonId, table.wormsKingdom],
        foreignColumns: [wormsCore.taxonId, wormsCore.kingdom],
        name: 'fk_harmonized_worms',
      }),
      asfisRef: foreignKey({
        columns: [table.asfisId],
        foreignColumns: [asfisSpecies.asfisId],
        name: 'fk_harmonized_asfis',
      }),

      // Simple constraints only
      cascadeCountCheck: "CHECK (cascade_alpha3_count >= 0)",
      confidenceScoreCheck: "CHECK (confidence_score BETWEEN 0.0 AND 1.0)",
    }
  }
)

// ===============================
// HARMONIZATION LOG TABLE (OPTIONAL - FOR DEBUGGING ONLY)
// Consider: Do you really need this as a persistent table?
// Alternative: Use application-level logging instead
// ===============================
export const harmonizationLog = pgTable(
  'harmonization_log',
  {
    logId: uuid('log_id').primaryKey().defaultRandom(),

    // PROPER FOREIGN KEY TO HARMONIZED SPECIES
    harmonizedId: uuid('harmonized_id')
      .notNull()
      .references(() => harmonizedSpecies.harmonizedId, { onDelete: 'cascade' }),

    // Action tracking
    action: text('action').notNull().$type<'CREATED' | 'UPDATED' | 'CASCADED' | 'MERGED'>(),
    sourceSystem: text('source_system').notNull().$type<'WORMS' | 'ASFIS' | 'CASCADE' | 'MANUAL'>(),
    matchedBy: text('matched_by').notNull(),

    // Change tracking (simplified)
    previousValues: jsonb('previous_values'),
    newValues: jsonb('new_values'),
    notes: text('notes'),

    // Metadata
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Minimal indexes for log table
      harmonizedIdIdx: index('idx_harmonization_log_harmonized_id').on(table.harmonizedId),
      actionIdx: index('idx_harmonization_log_action').on(table.action),
      createdAtIdx: index('idx_harmonization_log_created_at').on(table.createdAt),

      // Check constraints
      actionCheck: "CHECK (action IN ('CREATED', 'UPDATED', 'CASCADED', 'MERGED'))",
      sourceSystemCheck: "CHECK (source_system IN ('WORMS', 'ASFIS', 'CASCADE', 'MANUAL'))",
    }
  }
)

// ===============================
// HARMONIZATION STATISTICS VIEW (NOT A TABLE!)
// Much better as a VIEW - always up-to-date, no sync issues
// ===============================
export const harmonizationStatistics = pgView('harmonization_statistics').as((qb) => {
  return qb
    .select({
      // Basic counts
      totalSpecies: sql<number>`COUNT(*)`.as('total_species'),
      speciesWithAlpha3: sql<number>`COUNT(*) FILTER (WHERE primary_alpha3_code IS NOT NULL)`.as('species_with_alpha3'),
      directMatches: sql<number>`COUNT(*) FILTER (WHERE has_direct_alpha3 = true)`.as('direct_matches'),
      cascadedMatches: sql<number>`COUNT(*) FILTER (WHERE has_cascade_alpha3 = true)`.as('cascaded_matches'),
      wormsMatches: sql<number>`COUNT(*) FILTER (WHERE worms_taxon_id IS NOT NULL)`.as('worms_matches'),
      asfisMatches: sql<number>`COUNT(*) FILTER (WHERE asfis_id IS NOT NULL)`.as('asfis_matches'),

      // Quality metrics
      avgCascadeCount: sql<number>`ROUND(AVG(cascade_alpha3_count), 2)`.as('avg_cascade_count'),
      highCascadeSpecies: sql<number>`COUNT(*) FILTER (WHERE cascade_alpha3_count > 2)`.as('high_cascade_species'),
      avgConfidenceScore: sql<number>`ROUND(AVG(confidence_score), 3)`.as('avg_confidence_score'),

      // Match type breakdown
      wormsExactMatches: sql<number>`COUNT(*) FILTER (WHERE worms_match_type = 'EXACT')`.as('worms_exact_matches'),
      asfisDirectMatches: sql<number>`COUNT(*) FILTER (WHERE asfis_match_type = 'DIRECT')`.as('asfis_direct_matches'),
      asfisCascadeMatches: sql<number>`COUNT(*) FILTER (WHERE asfis_match_type = 'CASCADE')`.as('asfis_cascade_matches'),

      // Data freshness
      lastUpdate: sql<Date>`MAX(updated_at)`.as('last_update'),
      calculatedAt: sql<Date>`now()`.as('calculated_at'),
    })
    .from(harmonizedSpecies);
});

// ===============================
// TABLE RELATIONS
// ===============================
export const harmonizedSpeciesRelations = relations(harmonizedSpecies, ({ one, many }) => ({
  // Relations to source tables
  wormsCore: one(wormsCore, {
    fields: [harmonizedSpecies.wormsTaxonId, harmonizedSpecies.wormsKingdom],
    references: [wormsCore.taxonId, wormsCore.kingdom],
  }),
  asfisSpecies: one(asfisSpecies, {
    fields: [harmonizedSpecies.asfisId],
    references: [asfisSpecies.asfisId],
  }),

  // Optional: Relation to log entries (if you keep the log table)
  logs: many(harmonizationLog),
}))

export const harmonizationLogRelations = relations(harmonizationLog, ({ one }) => ({
  harmonizedSpecies: one(harmonizedSpecies, {
    fields: [harmonizationLog.harmonizedId],
    references: [harmonizedSpecies.harmonizedId],
  }),
}))

// ===============================
// TYPESCRIPT TYPES
// ===============================
export type HarmonizedSpecies = typeof harmonizedSpecies.$inferSelect
export type NewHarmonizedSpecies = typeof harmonizedSpecies.$inferInsert

export type HarmonizationLog = typeof harmonizationLog.$inferSelect
export type NewHarmonizationLog = typeof harmonizationLog.$inferInsert

export type HarmonizationStatistics = typeof harmonizationStatistics.$inferSelect

// ===============================
// HELPER TYPES FOR JSONB DATA (Enhanced)
// ===============================

// Structure for alternative names JSONB
export type AlternativeNames = {
  worms_names?: string[]        // Alternative names from WoRMS
  asfis_names?: string[]        // Alternative names from ASFIS
  synonyms?: string[]           // Known synonyms
  common_variations?: string[]  // Common spelling variations
  vernacular_names?: string[]   // Common names
}

// Structure for Alpha3 codes JSONB
export type AllAlpha3Codes = {
  direct?: {
    code: string
    source: 'SPECIES_LEVEL'
    asfis_id: string
    match_type: 'EXACT' | 'MANUAL'
    confidence: number
  }[]
  cascaded?: {
    code: string
    source: 'FAMILY_LEVEL' | 'ORDER_LEVEL' | 'CLASS_LEVEL'
    asfis_id: string
    taxonomic_level: string     // The actual taxonomic name (e.g., "Scombridae")
    match_method: 'family_scientific_name' | 'family_field' | 'order_scientific_name' | 'order_field' | 'class_scientific_name'
    confidence: number
  }[]
}

// ===============================
// ENUMS AND CONSTANTS
// ===============================
export const LOG_ACTIONS = {
  CREATED: 'CREATED',       // New harmonized record created
  UPDATED: 'UPDATED',       // Existing record updated
  CASCADED: 'CASCADED',     // Alpha3 code cascaded to this record
  MERGED: 'MERGED',         // Multiple source records merged
} as const

export const SOURCE_SYSTEMS = {
  WORMS: 'WORMS',
  ASFIS: 'ASFIS',
  CASCADE: 'CASCADE',
  MANUAL: 'MANUAL',
} as const

export const MATCH_TYPES = {
  WORMS: {
    EXACT: 'EXACT',         // Exact scientific name match
    FUZZY: 'FUZZY',         // Fuzzy string matching
    MANUAL: 'MANUAL',       // Manually curated match
  },
  ASFIS: {
    DIRECT: 'DIRECT',       // Direct species-to-Alpha3 mapping
    CASCADE: 'CASCADE',     // Inherited from higher taxonomic level
    MANUAL: 'MANUAL',       // Manually assigned
  },
} as const

// ===============================
// VALIDATION HELPER FUNCTIONS TYPES
// ===============================

export type ValidationResult = {
  check_name: string
  status: 'PASS' | 'FAIL' | 'WARNING'
  count_value: number
  notes: string
}

export type QualityMetrics = {
  total_species: number
  species_with_alpha3: number
  direct_matches: number
  cascaded_matches: number
  worms_matches: number
  asfis_matches: number
  avg_confidence_score: number
}
