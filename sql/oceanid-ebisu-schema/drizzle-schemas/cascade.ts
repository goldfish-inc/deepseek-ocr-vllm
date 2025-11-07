import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  unique,
  primaryKey,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { speciesNameRegistry } from './species-registry'

// ===============================
// TAXONOMIC CASCADE CONFIGURATION
// ===============================
export const taxonomicCascadeConfig = pgTable(
  'taxonomic_cascade_config',
  {
    cascadeId: uuid('cascade_id').primaryKey().defaultRandom(),

    // Source configuration
    sourceCode: text('source_code').notNull(), // e.g., 'TUN', 'CAX', 'SHK'
    sourceType: text('source_type').notNull(), // 'ALPHA3', 'ISSCAAP', 'CUSTOM'

    // Cascade configuration
    cascadeLevel: text('cascade_level').notNull(), // 'ORDER', 'FAMILY', 'GENUS', 'SPECIES'
    targetTaxon: text('target_taxon').notNull(), // e.g., 'Scombridae', 'Ariidae'
    cascadeRule: text('cascade_rule').notNull(), // 'ALL_DESCENDANTS', 'DIRECT_CHILDREN', 'SPECIES_ONLY'

    // Priority and status
    priority: integer('priority').default(100), // Higher priority overrides lower
    active: boolean('active').default(true),

    // Metadata
    notes: text('notes'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
    createdBy: text('created_by').default(sql`CURRENT_USER`),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Indexes for performance
      sourceCodeIdx: index('idx_cascade_source_code').on(table.sourceCode),
      activeSourceIdx: index('idx_cascade_active_source').on(table.active, table.sourceCode),
      cascadeLevelIdx: index('idx_cascade_level').on(table.cascadeLevel),
      targetTaxonIdx: index('idx_cascade_target').on(table.targetTaxon),
      priorityIdx: index('idx_cascade_priority').on(table.priority),

      // Unique constraint to prevent duplicates
      uniqueSourceTarget: unique('unique_cascade_source_target').on(
        table.sourceCode,
        table.sourceType,
        table.targetTaxon
      ),

      // Check constraints
      sourceTypeCheck: check(
        'chk_cascade_source_type',
        sql`${table.sourceType} IN ('ALPHA3', 'ISSCAAP', 'CUSTOM')`
      ),
      cascadeLevelCheck: check(
        'chk_cascade_level',
        sql`${table.cascadeLevel} IN ('ORDER', 'FAMILY', 'GENUS', 'SPECIES')`
      ),
      cascadeRuleCheck: check(
        'chk_cascade_rule',
        sql`${table.cascadeRule} IN ('ALL_DESCENDANTS', 'DIRECT_CHILDREN', 'SPECIES_ONLY')`
      ),
    }
  }
)

// ===============================
// CASCADE RESOLUTION (PRE-COMPUTED)
// ===============================
export const taxonomicCascadeResolution = pgTable(
  'taxonomic_cascade_resolution',
  {
    resolutionId: uuid('resolution_id').primaryKey().defaultRandom(),

    // Links
    cascadeId: uuid('cascade_id').notNull()
      .references(() => taxonomicCascadeConfig.cascadeId, { onDelete: 'cascade' }),
    speciesId: uuid('species_id').notNull()
      .references(() => speciesNameRegistry.speciesId, { onDelete: 'cascade' }),

    // Resolution details
    scientificName: text('scientific_name').notNull(),
    taxonomicPath: text('taxonomic_path').array(), // ['Animalia', 'Chordata', 'Actinopterygii', ...]
    cascadeDepth: integer('cascade_depth'), // How many levels down from cascade point
    confidence: numeric('confidence', { precision: 3, scale: 2 }).default('1.00'),

    // Metadata
    resolutionDate: timestamp('resolution_date', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      // Performance indexes
      cascadeIdx: index('idx_resolution_cascade').on(table.cascadeId),
      speciesIdx: index('idx_resolution_species').on(table.speciesId),
      cascadeSpeciesIdx: index('idx_resolution_cascade_species').on(table.cascadeId, table.speciesId),
      pathIdx: index('idx_resolution_path').using('gin', table.taxonomicPath),

      // Prevent duplicate resolutions
      uniqueCascadeSpecies: unique('unique_cascade_species').on(
        table.cascadeId,
        table.speciesId
      ),
    }
  }
)

// ===============================
// CASCADE AUDIT LOG
// ===============================
export const cascadeAuditLog = pgTable(
  'cascade_audit_log',
  {
    logId: uuid('log_id').primaryKey().defaultRandom(),
    cascadeId: uuid('cascade_id').references(() => taxonomicCascadeConfig.cascadeId),
    action: text('action').notNull(), // 'CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'DEACTIVATE'
    oldValues: text('old_values'), // JSONB stored as text
    newValues: text('new_values'), // JSONB stored as text
    changedBy: text('changed_by').default(sql`CURRENT_USER`),
    changedAt: timestamp('changed_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      cascadeIdx: index('idx_audit_cascade').on(table.cascadeId),
      actionIdx: index('idx_audit_action').on(table.action),
      changedAtIdx: index('idx_audit_changed_at').on(table.changedAt),
    }
  }
)

// ===============================
// CASCADE STATISTICS (MATERIALIZED)
// ===============================
export const cascadeStatistics = pgTable(
  'cascade_statistics',
  {
    cascadeId: uuid('cascade_id').primaryKey()
      .references(() => taxonomicCascadeConfig.cascadeId, { onDelete: 'cascade' }),

    // Statistics
    totalSpecies: integer('total_species').notNull().default(0),
    directSpecies: integer('direct_species').notNull().default(0),
    cascadedSpecies: integer('cascaded_species').notNull().default(0),

    // Coverage metrics
    wormsSpecies: integer('worms_species').default(0),
    itisSpecies: integer('itis_species').default(0),
    asfisSpecies: integer('asfis_species').default(0),

    // Quality metrics
    avgConfidence: numeric('avg_confidence', { precision: 3, scale: 2 }),
    minConfidence: numeric('min_confidence', { precision: 3, scale: 2 }),
    maxConfidence: numeric('max_confidence', { precision: 3, scale: 2 }),

    // Update tracking
    lastCalculated: timestamp('last_calculated', { mode: 'date', withTimezone: true }).defaultNow(),
  }
)

// ===============================
// TABLE RELATIONS
// ===============================
export const taxonomicCascadeConfigRelations = relations(taxonomicCascadeConfig, ({ many, one }) => ({
  resolutions: many(taxonomicCascadeResolution),
  auditLogs: many(cascadeAuditLog),
  statistics: one(cascadeStatistics, {
    fields: [taxonomicCascadeConfig.cascadeId],
    references: [cascadeStatistics.cascadeId],
  }),
}))

export const taxonomicCascadeResolutionRelations = relations(taxonomicCascadeResolution, ({ one }) => ({
  cascade: one(taxonomicCascadeConfig, {
    fields: [taxonomicCascadeResolution.cascadeId],
    references: [taxonomicCascadeConfig.cascadeId],
  }),
  species: one(speciesNameRegistry, {
    fields: [taxonomicCascadeResolution.speciesId],
    references: [speciesNameRegistry.speciesId],
  }),
}))

export const cascadeAuditLogRelations = relations(cascadeAuditLog, ({ one }) => ({
  cascade: one(taxonomicCascadeConfig, {
    fields: [cascadeAuditLog.cascadeId],
    references: [taxonomicCascadeConfig.cascadeId],
  }),
}))

export const cascadeStatisticsRelations = relations(cascadeStatistics, ({ one }) => ({
  cascade: one(taxonomicCascadeConfig, {
    fields: [cascadeStatistics.cascadeId],
    references: [taxonomicCascadeConfig.cascadeId],
  }),
}))

// ===============================
// TYPESCRIPT TYPES
// ===============================
export type TaxonomicCascadeConfig = typeof taxonomicCascadeConfig.$inferSelect
export type NewTaxonomicCascadeConfig = typeof taxonomicCascadeConfig.$inferInsert

export type TaxonomicCascadeResolution = typeof taxonomicCascadeResolution.$inferSelect
export type NewTaxonomicCascadeResolution = typeof taxonomicCascadeResolution.$inferInsert

export type CascadeAuditLog = typeof cascadeAuditLog.$inferSelect
export type NewCascadeAuditLog = typeof cascadeAuditLog.$inferInsert

export type CascadeStatistics = typeof cascadeStatistics.$inferSelect
export type NewCascadeStatistics = typeof cascadeStatistics.$inferInsert

// ===============================
// ENUMS AND CONSTANTS
// ===============================
export const CASCADE_SOURCE_TYPES = {
  ALPHA3: 'ALPHA3',
  ISSCAAP: 'ISSCAAP',
  CUSTOM: 'CUSTOM',
} as const

export const CASCADE_LEVELS = {
  ORDER: 'ORDER',
  FAMILY: 'FAMILY',
  GENUS: 'GENUS',
  SPECIES: 'SPECIES',
} as const

export const CASCADE_RULES = {
  ALL_DESCENDANTS: 'ALL_DESCENDANTS',
  DIRECT_CHILDREN: 'DIRECT_CHILDREN',
  SPECIES_ONLY: 'SPECIES_ONLY',
} as const

export const CASCADE_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ACTIVATE: 'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
} as const

// ===============================
// HELPER TYPES
// ===============================
export type CascadeConfigWithStats = TaxonomicCascadeConfig & {
  statistics: CascadeStatistics | null
}

export type CascadeResolutionWithSpecies = TaxonomicCascadeResolution & {
  species: SpeciesNameRegistry
}

// ===============================
// DEFAULT CASCADE CONFIGURATIONS
// ===============================
export const defaultCascadeConfigs: NewTaxonomicCascadeConfig[] = [
  {
    sourceCode: 'TUN',
    sourceType: 'ALPHA3',
    cascadeLevel: 'FAMILY',
    targetTaxon: 'Scombridae',
    cascadeRule: 'ALL_DESCENDANTS',
    priority: 100,
    notes: 'All tunas and mackerels',
  },
  {
    sourceCode: 'CAX',
    sourceType: 'ALPHA3',
    cascadeLevel: 'FAMILY',
    targetTaxon: 'Ariidae',
    cascadeRule: 'SPECIES_ONLY',
    priority: 100,
    notes: 'Sea catfishes',
  },
  {
    sourceCode: 'SHK',
    sourceType: 'ALPHA3',
    cascadeLevel: 'ORDER',
    targetTaxon: 'Lamniformes',
    cascadeRule: 'ALL_DESCENDANTS',
    priority: 90,
    notes: 'All sharks',
  },
  {
    sourceCode: 'PER',
    sourceType: 'ALPHA3',
    cascadeLevel: 'ORDER',
    targetTaxon: 'Perciformes',
    cascadeRule: 'ALL_DESCENDANTS',
    priority: 80,
    notes: 'All perch-like fish',
  },
]
