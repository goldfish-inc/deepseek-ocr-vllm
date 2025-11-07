// drizzle-schemas/vessels/quick-boolean.ts - Quick certification and program flags
import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// VESSEL QUICK BOOLEAN TABLE
// ==============================================================================

// Quick boolean flags for various certifications and programs
export const vesselsQuickBoolean = pgTable(
  'vessels_quick_boolean',
  {
    quickBooleanUuid: uuid('quick_boolean_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    // Fishery and Sustainability Programs
    isFip: boolean('is_fip').default(false), // Fishery Improvement Project
    isItm: boolean('is_itm').default(false), // Industrial Tuna Management
    isMsc: boolean('is_msc').default(false), // MSC (reported by third party, not MSC)
    isCpib: boolean('is_cpib').default(false), // CPIB
    isFairtradeCertified: boolean('is_fairtrade_certified').default(false),

    // ISSF Programs
    isIssfPvr: boolean('is_issf_pvr').default(false), // ISSF ProActive Vessel Register
    isIssfVosi: boolean('is_issf_vosi').default(false), // ISSF Vessel Online Survey Initiative
    isIssfPs: boolean('is_issf_ps').default(false), // ISSF PS
    isIssfUvi: boolean('is_issf_uvi').default(false), // ISSF UVI

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_quick_boolean_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_quick_boolean_source_idx').on(table.sourceId),
    // Individual boolean flag indexes
    fipIdx: index('vessels_quick_boolean_fip_idx').on(table.isFip),
    mscIdx: index('vessels_quick_boolean_msc_idx').on(table.isMsc),
    fairtradeIdx: index('vessels_quick_boolean_fairtrade_idx').on(table.isFairtradeCertified),
    // Composite indexes for certification combinations
    issfFlagsIdx: index('vessels_quick_boolean_issf_flags_idx').on(table.isIssfPvr, table.isIssfVosi, table.isIssfPs, table.isIssfUvi),
    certFlagsIdx: index('vessels_quick_boolean_cert_flags_idx').on(table.isMsc, table.isFairtradeCertified, table.isFip),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsQuickBoolean = typeof vesselsQuickBoolean.$inferSelect;
export type NewVesselsQuickBoolean = typeof vesselsQuickBoolean.$inferInsert;

// ==============================================================================
// CONSTANTS FOR VALIDATION AND ANALYSIS
// ==============================================================================

// Certification and sustainability program categories
export const CERTIFICATION_CATEGORIES = {
  SUSTAINABILITY: ['isMsc', 'isFairtradeCertified', 'isFip'],
  MANAGEMENT: ['isItm', 'isCpib'],
  ISSF_PROGRAMS: ['isIssfPvr', 'isIssfVosi', 'isIssfPs', 'isIssfUvi']
} as const;

// All boolean flag field names
export const ALL_BOOLEAN_FLAGS = [
  'isFip',
  'isItm',
  'isMsc',
  'isCpib',
  'isFairtradeCertified',
  'isIssfPvr',
  'isIssfVosi',
  'isIssfPs',
  'isIssfUvi'
] as const;

// Priority/importance levels for different certifications
export const CERTIFICATION_IMPORTANCE_LEVELS = {
  HIGH: ['isMsc', 'isIssfPvr', 'isFairtradeCertified'],
  MEDIUM: ['isFip', 'isIssfVosi', 'isIssfPs'],
  LOW: ['isItm', 'isCpib', 'isIssfUvi']
} as const;

// Common certification combinations for analysis
export const COMMON_CERTIFICATION_COMBINATIONS = {
  ISSF_COMPREHENSIVE: ['isIssfPvr', 'isIssfVosi', 'isIssfPs'],
  SUSTAINABILITY_FOCUSED: ['isMsc', 'isFairtradeCertified', 'isFip'],
  MANAGEMENT_PROGRAMS: ['isItm', 'isCpib']
} as const;

// Utility type for boolean flag field names
export type BooleanFlagField = typeof ALL_BOOLEAN_FLAGS[number];
