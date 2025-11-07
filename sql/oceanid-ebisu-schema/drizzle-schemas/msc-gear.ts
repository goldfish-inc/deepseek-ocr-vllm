import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Import base tables (assuming they exist in your schema)
import { originalSources, gearTypesFao } from './reference'

// MSC Gear Types Table
export const gearTypesMsc = pgTable(
  'gear_types_msc',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    mscGear: text('msc_gear').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Indexes for performance
    mscGearIdx: index('idx_gear_types_msc_gear').on(table.mscGear),
    sourceIdx: index('idx_gear_types_msc_source').on(table.sourceId),

    // Unique constraint
    uniqueMscGear: unique('uk_msc_gear').on(table.mscGear),
  })
)

// MSC-FAO Gear Relationship Table
export const gearTypesFaoMscRelationship = pgTable(
  'gear_types_fao_msc_relationship',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    faoGearId: uuid('fao_gear_id')
      .notNull()
      .references(() => gearTypesFao.id, { onDelete: 'cascade' }),
    mscGearId: uuid('msc_gear_id')
      .notNull()
      .references(() => gearTypesMsc.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Indexes for performance
    faoGearIdx: index('idx_gear_types_fao_msc_rel_fao').on(table.faoGearId),
    mscGearIdx: index('idx_gear_types_fao_msc_rel_msc').on(table.mscGearId),

    // Unique constraint - each FAO-MSC combination can only exist once
    uniqueFaoMscRelationship: unique('uk_fao_msc_gear_relationship').on(
      table.faoGearId,
      table.mscGearId
    ),
  })
)

// Relations
export const gearTypesMscRelations = relations(gearTypesMsc, ({ one, many }) => ({
  // Relationship to source
  source: one(originalSources, {
    fields: [gearTypesMsc.sourceId],
    references: [originalSources.sourceId],
  }),
  // One-to-many relationship with FAO gear via relationship table
  faoRelationships: many(gearTypesFaoMscRelationship),
}))

export const gearTypesFaoMscRelationshipRelations = relations(
  gearTypesFaoMscRelationship,
  ({ one }) => ({
    // Relationship to FAO gear
    faoGear: one(gearTypesFao, {
      fields: [gearTypesFaoMscRelationship.faoGearId],
      references: [gearTypesFao.id],
    }),
    // Relationship to MSC gear
    mscGear: one(gearTypesMsc, {
      fields: [gearTypesFaoMscRelationship.mscGearId],
      references: [gearTypesMsc.id],
    }),
  })
)

// Extend FAO gear relations to include MSC relationships
export const gearTypesFaoMscExtendedRelations = relations(gearTypesFao, ({ many }) => ({
  // One-to-many relationship with MSC gear via relationship table
  mscRelationships: many(gearTypesFaoMscRelationship),
}))

// Type exports for use in queries
export type GearTypesMsc = typeof gearTypesMsc.$inferSelect
export type NewGearTypesMsc = typeof gearTypesMsc.$inferInsert

export type GearTypesFaoMscRelationship = typeof gearTypesFaoMscRelationship.$inferSelect
export type NewGearTypesFaoMscRelationship = typeof gearTypesFaoMscRelationship.$inferInsert

// Query helpers and complex types
export type MscGearWithSource = GearTypesMsc & {
  source: typeof originalSources.$inferSelect
}

export type MscGearWithFaoRelationships = GearTypesMsc & {
  faoRelationships: (GearTypesFaoMscRelationship & {
    faoGear: typeof gearTypesFao.$inferSelect
  })[]
}

export type FaoGearWithMscRelationships = typeof gearTypesFao.$inferSelect & {
  mscRelationships: (GearTypesFaoMscRelationship & {
    mscGear: GearTypesMsc
  })[]
}

// Example usage types for API responses
export interface MscGearSummary {
  id: string
  mscGear: string
  sourceShortname: string
  relatedFaoCodes: string[]
  relationshipCount: number
}

export interface GearMappingAnalysis {
  mscGearId: string
  mscGear: string
  faoMappings: {
    faoGearId: string
    faoCode: string
    faoName: string
  }[]
  mappingStrength: 'single' | 'multiple' | 'complex'
}

export interface GearCrosswalk {
  faoCode: string
  faoName: string
  mscEquivalents: {
    mscGearId: string
    mscGear: string
  }[]
  mappingType: 'one-to-one' | 'one-to-many' | 'many-to-many'
}

// Query filter types
export interface MscGearFilters {
  sourceId?: string
  mscGearPattern?: string // For LIKE/ILIKE searches
  hasFaoMapping?: boolean
  faoCodeFilter?: string[]
  createdAfter?: Date
  createdBefore?: Date
}

export interface RelationshipFilters {
  faoGearIds?: string[]
  mscGearIds?: string[]
  includeGearDetails?: boolean
  mappingComplexity?: 'simple' | 'complex' | 'all'
}

// Query options
export interface MscGearQueryOptions {
  includeSource?: boolean
  includeFaoRelationships?: boolean
  includeGearDetails?: boolean
  filters?: MscGearFilters
  limit?: number
  offset?: number
  sortBy?: 'msc_gear' | 'created_at' | 'relationship_count'
  sortOrder?: 'asc' | 'desc'
}

export interface RelationshipQueryOptions {
  includeGearDetails?: boolean
  filters?: RelationshipFilters
  groupBy?: 'fao_gear' | 'msc_gear' | 'none'
  limit?: number
  offset?: number
}

// Statistical analysis types
export interface GearMappingStatistics {
  totalMscGears: number
  totalFaoGears: number
  totalRelationships: number
  averageFaoPerMsc: number
  averageMscPerFao: number
  unmappedMscGears: number
  unmappedFaoGears: number
  complexMappings: number // Gears with >3 relationships
}

export interface SourceTrackingInfo {
  sourceShortname: string
  sourceStatus: string
  recordCount: number
  refreshDate: Date | null
  dataQuality: 'complete' | 'partial' | 'needs_refresh'
  lastUpdated: Date
}

// Advanced query result types
export interface GearHierarchyView {
  faoCategory: string
  faoCode: string
  faoName: string
  mscEquivalents: {
    id: string
    name: string
    sourceVerified: boolean
  }[]
  hierarchyLevel: 'exact' | 'broader' | 'narrower' | 'related'
}

export interface GearCompatibilityMatrix {
  faoGearId: string
  faoCode: string
  compatibleMscGears: {
    mscGearId: string
    mscGear: string
    compatibilityScore: number // 0-100
    mappingReason: 'exact_match' | 'semantic_equivalent' | 'operational_similar'
  }[]
}
