// drizzle-schemas/vessels/iuu.ts - Vessel IUU (Illegal, Unreported, Unregulated) tracking
import {
  pgTable,
  uuid,
  boolean,
  varchar,
  timestamp,
  jsonb,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// VESSEL IUU TABLE
// ==============================================================================

// IUU (Illegal, Unreported, Unregulated) fishing tracking for vessels
export const vesselsIuuSimple = pgTable(
  'vessels_iuu_simple',
  {
    iuuUuid: uuid('iuu_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    isIuu: boolean('is_iuu').notNull().default(false),
    listedIuu: jsonb('listed_iuu'), // JSONB array of UUIDs referencing rfmos(id)
    activityIuu: varchar('activity_iuu', { length: 500 }), // Alphanumeric description of IUU activity

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_iuu_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_iuu_source_idx').on(table.sourceId),
    isIuuIdx: index('vessels_iuu_is_iuu_idx').on(table.isIuu),
    // GIN index for JSONB array searches (performance critical for RFMO queries)
    listedRfmosIdx: index('vessels_iuu_listed_rfmos_idx').using('gin', table.listedIuu),
    // Composite indexes for complex queries
    vesselActiveIdx: index('vessels_iuu_vessel_active_idx').on(table.vesselUuid, table.isIuu),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsIuuSimple = typeof vesselsIuuSimple.$inferSelect;
export type NewVesselsIuuSimple = typeof vesselsIuuSimple.$inferInsert;

// ==============================================================================
// JSONB ARRAY TYPES FOR UUID REFERENCES
// ==============================================================================

// Type for listed_iuu JSONB array - contains UUIDs referencing rfmos.id
export type ListedIuuArray = string[]; // Array of UUID strings

// Enhanced type for IUU data with proper typing for JSONB arrays
export interface VesselsIuuSimpleWithTypedArrays extends Omit<VesselsIuuSimple, 'listedIuu'> {
  listedIuu?: ListedIuuArray | null;
}

// ==============================================================================
// CONSTANTS FOR JSONB ARRAY VALIDATION
// ==============================================================================

// Maximum number of RFMOs per IUU listing (for application validation)
export const MAX_RFMOS_PER_IUU_LISTING = 20;

// Common IUU activity patterns
export const IUU_ACTIVITY_PATTERNS = {
  ILLEGAL_FISHING: 'ILLEGAL_FISHING_OPERATIONS',
  UNREPORTED_CATCHES: 'UNREPORTED_CATCH_ACTIVITIES',
  UNREGULATED_AREAS: 'FISHING_IN_UNREGULATED_AREAS',
  QUOTA_VIOLATIONS: 'QUOTA_OVERFISHING',
  CLOSED_SEASONS: 'FISHING_DURING_CLOSED_SEASONS',
  GEAR_VIOLATIONS: 'PROHIBITED_GEAR_USAGE',
  TRANSSHIPMENT: 'ILLEGAL_TRANSSHIPMENT',
  DOCUMENT_FRAUD: 'FALSIFIED_DOCUMENTATION',
} as const;
