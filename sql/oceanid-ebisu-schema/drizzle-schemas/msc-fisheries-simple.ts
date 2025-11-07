import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { eq, inArray, sql } from 'drizzle-orm'

// Import related tables
import { originalSources, faoMajorAreas } from './reference'
import { gearTypesMsc } from './msc-gear'
import { harmonizedSpecies } from './harmonized-species'

// ===============================
// MSC FISHERY ENUMS (CASE-SENSITIVE IN DB, BUT NORMALIZED DURING IMPORT)
// ===============================

// NOTE: These enum values are uppercase in the database, but our import process
// handles case-insensitive normalization automatically. The preprocessing script
// and SQL import handle converting common variations like "Certified" to "CERTIFIED".

export const mscFisheryStatusEnum = pgEnum('msc_fishery_status', [
  'CERTIFIED',
  'CERTIFIED WITH UNIT(S) IN ASSESSMENT',
  'COMBINED WITH ANOTHER ASSESSMENT',
  'IMPROVEMENT PROGRAM',
  'IN ASSESSMENT',
  'NOT CERTIFIED',
  'SUSPENDED',
  'WITHDRAWN'
])

export const mscFisheryStatusUocEnum = pgEnum('msc_fishery_status_uoc', [
  'CERTIFIED',
  'IMPROVEMENT PROGRAM',
  'IN ASSESSMENT',
  'NOT CERTIFIED',
  'SUSPENDED',
  'WITHDRAWN'
])

// ===============================
// MAIN MSC FISHERIES TABLE
// ===============================

export const mscFisheries = pgTable(
  'msc_fisheries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mscFisheryCertCodes: jsonb('msc_fishery_cert_codes'), // JSONB for certification codes
    mscFisheryName: varchar('msc_fishery_name', { length: 500 }),
    mscFisheryStatus: mscFisheryStatusEnum('msc_fishery_status'),
    mscFisheryStatusUoc: mscFisheryStatusUocEnum('msc_fishery_status_uoc'),

    // FIXED: Proper FK with cascade behavior like country-profile pattern
    mscGearId: uuid('msc_gear_id')
      .references(() => gearTypesMsc.id, { onDelete: 'set null' }),

    sourceId: uuid('source_id')
      .references(() => originalSources.sourceId, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // Essential indexes
    fisheryNameIdx: index('idx_msc_fisheries_name').on(table.mscFisheryName),
    fisheryStatusIdx: index('idx_msc_fisheries_status').on(table.mscFisheryStatus),
    fisheryStatusUocIdx: index('idx_msc_fisheries_status_uoc').on(table.mscFisheryStatusUoc),
    mscGearIdx: index('idx_msc_fisheries_gear').on(table.mscGearId),
    sourceIdx: index('idx_msc_fisheries_source').on(table.sourceId),
    updatedAtIdx: index('idx_msc_fisheries_updated_at').on(table.updatedAt),

    // JSONB GIN index for efficient querying of certification codes
    certCodesGinIdx: index('idx_msc_fisheries_cert_codes_gin').using('gin', table.mscFisheryCertCodes),

    // Composite indexes for common query patterns
    statusNameIdx: index('idx_msc_fisheries_status_name').on(table.mscFisheryStatus, table.mscFisheryName),
    gearStatusIdx: index('idx_msc_fisheries_gear_status').on(table.mscGearId, table.mscFisheryStatus),

    // REMOVED: uniqueFisheryName constraint - fishery names can be duplicated
    // Non-empty name constraint only
    // Note: PostgreSQL constraint will be: CHECK (msc_fishery_name IS NULL OR LENGTH(TRIM(msc_fishery_name)) > 0)
  })
)

// ===============================
// JUNCTION TABLES (CORRECTED)
// ===============================

export const mscFisheriesSpecies = pgTable(
  'msc_fisheries_species',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mscFisheryId: uuid('msc_fishery_id')
      .notNull()
      .references(() => mscFisheries.id, { onDelete: 'cascade' }),
    harmonizedSpeciesId: uuid('harmonized_species_id')
      .notNull()
      .references(() => harmonizedSpecies.harmonizedId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueFisherySpecies: unique('uk_msc_fishery_species').on(
      table.mscFisheryId,
      table.harmonizedSpeciesId
    ),
    fisheryIdx: index('idx_msc_fisheries_species_fishery').on(table.mscFisheryId),
    speciesIdx: index('idx_msc_fisheries_species_species').on(table.harmonizedSpeciesId),
    createdAtIdx: index('idx_msc_fisheries_species_created_at').on(table.createdAt),
  })
)

export const mscFisheriesFaoAreas = pgTable(
  'msc_fisheries_fao_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mscFisheryId: uuid('msc_fishery_id')
      .notNull()
      .references(() => mscFisheries.id, { onDelete: 'cascade' }),

    // CORRECTED: Proper FK to fao_major_areas.id
    faoAreaId: uuid('fao_area_id')
      .notNull()
      .references(() => faoMajorAreas.id),

    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueFisheryFaoArea: unique('uk_msc_fishery_fao_area').on(
      table.mscFisheryId,
      table.faoAreaId
    ),
    fisheryIdx: index('idx_msc_fisheries_fao_areas_fishery').on(table.mscFisheryId),
    faoAreaIdx: index('idx_msc_fisheries_fao_areas_fao').on(table.faoAreaId),
    createdAtIdx: index('idx_msc_fisheries_fao_areas_created_at').on(table.createdAt),
  })
)

// ===============================
// RELATIONS (CORRECTED)
// ===============================

export const mscFisheriesRelations = relations(mscFisheries, ({ one, many }) => ({
  // CORRECTED: Proper relation to original_sources
  source: one(originalSources, {
    fields: [mscFisheries.sourceId],
    references: [originalSources.sourceId],
  }),

  // CORRECTED: Proper relation to gear_types_msc
  mscGear: one(gearTypesMsc, {
    fields: [mscFisheries.mscGearId],
    references: [gearTypesMsc.id],
  }),

  // Junction table relations
  speciesRelationships: many(mscFisheriesSpecies),
  faoAreaRelationships: many(mscFisheriesFaoAreas),
}))

export const mscFisheriesSpeciesRelations = relations(mscFisheriesSpecies, ({ one }) => ({
  fishery: one(mscFisheries, {
    fields: [mscFisheriesSpecies.mscFisheryId],
    references: [mscFisheries.id],
  }),
  species: one(harmonizedSpecies, {
    fields: [mscFisheriesSpecies.harmonizedSpeciesId],
    references: [harmonizedSpecies.harmonizedId],
  }),
}))

export const mscFisheriesFaoAreasRelations = relations(mscFisheriesFaoAreas, ({ one }) => ({
  fishery: one(mscFisheries, {
    fields: [mscFisheriesFaoAreas.mscFisheryId],
    references: [mscFisheries.id],
  }),

  // CORRECTED: Proper relation to fao_major_areas
  faoArea: one(faoMajorAreas, {
    fields: [mscFisheriesFaoAreas.faoAreaId],
    references: [faoMajorAreas.id],
  }),
}))

// ===============================
// EFFICIENT UPDATE HELPER FUNCTIONS
// ===============================

/**
 * Efficient weekly update pattern for MSC fisheries
 * Handles the complete update cycle with proper transactions
 */
export async function updateMscFisheryRelationships(
  db: any, // Your database instance
  fisheryId: string,
  newSpeciesIds: string[],
  newFaoAreaIds: string[]
): Promise<void> {
  await db.transaction(async (tx: any) => {
    // 1. Remove existing relationships
    await tx.delete(mscFisheriesSpecies).where(eq(mscFisheriesSpecies.mscFisheryId, fisheryId))
    await tx.delete(mscFisheriesFaoAreas).where(eq(mscFisheriesFaoAreas.mscFisheryId, fisheryId))

    // 2. Insert new species relationships
    if (newSpeciesIds.length > 0) {
      const speciesRelationships = newSpeciesIds.map(speciesId => ({
        mscFisheryId: fisheryId,
        harmonizedSpeciesId: speciesId,
      }))
      await tx.insert(mscFisheriesSpecies).values(speciesRelationships)
    }

    // 3. Insert new FAO area relationships
    if (newFaoAreaIds.length > 0) {
      const faoAreaRelationships = newFaoAreaIds.map(faoAreaId => ({
        mscFisheryId: fisheryId,
        faoAreaId: faoAreaId,
      }))
      await tx.insert(mscFisheriesFaoAreas).values(faoAreaRelationships)
    }
  })
}

/**
 * Batch update multiple fisheries efficiently
 */
export async function batchUpdateMscFisheries(
  db: any,
  updates: Array<{
    fisheryId: string
    speciesIds: string[]
    faoAreaIds: string[]
  }>
): Promise<void> {
  await db.transaction(async (tx: any) => {
    const fisheryIds = updates.map(u => u.fisheryId)

    // 1. Remove all existing relationships for these fisheries
    await tx.delete(mscFisheriesSpecies).where(inArray(mscFisheriesSpecies.mscFisheryId, fisheryIds))
    await tx.delete(mscFisheriesFaoAreas).where(inArray(mscFisheriesFaoAreas.mscFisheryId, fisheryIds))

    // 2. Prepare bulk inserts
    const allSpeciesRelationships = updates.flatMap(update =>
      update.speciesIds.map(speciesId => ({
        mscFisheryId: update.fisheryId,
        harmonizedSpeciesId: speciesId,
      }))
    )

    const allFaoAreaRelationships = updates.flatMap(update =>
      update.faoAreaIds.map(faoAreaId => ({
        mscFisheryId: update.fisheryId,
        faoAreaId: faoAreaId,
      }))
    )

    // 3. Bulk insert new relationships
    if (allSpeciesRelationships.length > 0) {
      await tx.insert(mscFisheriesSpecies).values(allSpeciesRelationships)
    }

    if (allFaoAreaRelationships.length > 0) {
      await tx.insert(mscFisheriesFaoAreas).values(allFaoAreaRelationships)
    }
  })
}

/**
 * Query MSC fisheries by certification codes (JSONB query)
 * Example usage for JSONB querying capability
 */
export async function queryByCertificationCodes(
  db: any,
  certificationCodes: string[]
): Promise<MscFishery[]> {
  // This demonstrates JSONB querying capability
  return await db
    .select()
    .from(mscFisheries)
    .where(
      // Query JSONB array for any matching certification codes
      sql`${mscFisheries.mscFisheryCertCodes} ?| ${certificationCodes}`
    )
}

/**
 * Helper function to create a properly formatted enum status value
 * This ensures TypeScript code uses the correct uppercase values
 * that match the PostgreSQL enum definitions
 */
export function normalizeMscFisheryStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'certified': 'CERTIFIED',
    'certified with unit(s) in assessment': 'CERTIFIED WITH UNIT(S) IN ASSESSMENT',
    'certified with units in assessment': 'CERTIFIED WITH UNIT(S) IN ASSESSMENT',
    'combined with another assessment': 'COMBINED WITH ANOTHER ASSESSMENT',
    'improvement program': 'IMPROVEMENT PROGRAM',
    'in assessment': 'IN ASSESSMENT',
    'not certified': 'NOT CERTIFIED',
    'suspended': 'SUSPENDED',
    'withdrawn': 'WITHDRAWN'
  }

  const normalized = statusMap[status?.toLowerCase()?.trim()] || status?.toUpperCase()?.trim()
  return normalized
}

/**
 * Helper function to create a properly formatted enum status UOC value
 */
export function normalizeMscFisheryStatusUoc(status: string): string {
  const statusMap: Record<string, string> = {
    'certified': 'CERTIFIED',
    'improvement program': 'IMPROVEMENT PROGRAM',
    'in assessment': 'IN ASSESSMENT',
    'not certified': 'NOT CERTIFIED',
    'suspended': 'SUSPENDED',
    'withdrawn': 'WITHDRAWN'
  }

  const normalized = statusMap[status?.toLowerCase()?.trim()] || status?.toUpperCase()?.trim()
  return normalized
}

// ===============================
// TYPESCRIPT TYPES
// ===============================

export type MscFishery = typeof mscFisheries.$inferSelect
export type NewMscFishery = typeof mscFisheries.$inferInsert

export type MscFisheriesSpecies = typeof mscFisheriesSpecies.$inferSelect
export type NewMscFisheriesSpecies = typeof mscFisheriesSpecies.$inferInsert

export type MscFisheriesFaoAreas = typeof mscFisheriesFaoAreas.$inferSelect
export type NewMscFisheriesFaoAreas = typeof mscFisheriesFaoAreas.$inferInsert

// Updated JSONB field type for clean certification codes
export interface MscFisheryCertCodes {
  // REMOVED - no longer using {"codes": [...]} wrapper format
  // codes: string[]
}

// Certification codes are now stored as direct JSONB arrays: ["MSC-F-31213", "MRAG-F-0022"]
export type MscFisheryCertCodesArray = string[]

// Updated type for the actual database field
export type MscFishery = typeof mscFisheries.$inferSelect & {
  // Override the inferred type to be more specific
  mscFisheryCertCodes: string[] | null // Direct JSONB array, not wrapped
}

// Weekly update types
export interface WeeklyUpdateData {
  fisheryId: string
  speciesIds: string[]
  faoAreaIds: string[]
}

export interface BatchUpdateResult {
  updatedCount: number
  errors: string[]
}

// Enum validation types for better TypeScript support
export type MscFisheryStatusType =
  | 'CERTIFIED'
  | 'CERTIFIED WITH UNIT(S) IN ASSESSMENT'
  | 'COMBINED WITH ANOTHER ASSESSMENT'
  | 'IMPROVEMENT PROGRAM'
  | 'IN ASSESSMENT'
  | 'NOT CERTIFIED'
  | 'SUSPENDED'
  | 'WITHDRAWN'

export type MscFisheryStatusUocType =
  | 'CERTIFIED'
  | 'IMPROVEMENT PROGRAM'
  | 'IN ASSESSMENT'
  | 'NOT CERTIFIED'
  | 'SUSPENDED'
  | 'WITHDRAWN'

// Type guards for enum validation
export function isMscFisheryStatus(status: string): status is MscFisheryStatusType {
  const validStatuses: MscFisheryStatusType[] = [
    'CERTIFIED',
    'CERTIFIED WITH UNIT(S) IN ASSESSMENT',
    'COMBINED WITH ANOTHER ASSESSMENT',
    'IMPROVEMENT PROGRAM',
    'IN ASSESSMENT',
    'NOT CERTIFIED',
    'SUSPENDED',
    'WITHDRAWN'
  ]
  return validStatuses.includes(status as MscFisheryStatusType)
}

export function isMscFisheryStatusUoc(status: string): status is MscFisheryStatusUocType {
  const validStatuses: MscFisheryStatusUocType[] = [
    'CERTIFIED',
    'IMPROVEMENT PROGRAM',
    'IN ASSESSMENT',
    'NOT CERTIFIED',
    'SUSPENDED',
    'WITHDRAWN'
  ]
  return validStatuses.includes(status as MscFisheryStatusUocType)
}
