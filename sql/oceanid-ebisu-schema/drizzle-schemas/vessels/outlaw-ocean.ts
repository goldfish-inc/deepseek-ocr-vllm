// drizzle-schemas/vessels/outlaw-ocean.ts - Vessel Outlaw Ocean investigation data
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  text,
  timestamp,
  jsonb,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// OUTLAW OCEAN ENUMS
// ==============================================================================

export const crimeTypeEnum = pgEnum('crime_type_enum', [
  'ILLEGAL_FISHING',
  'UNREPORTED_FISHING',
  'UNREGULATED_FISHING',
  'FORCED_LABOR',
  'HUMAN_TRAFFICKING',
  'LABOR_ABUSE',
  'DOCUMENT_FRAUD',
  'FLAG_OF_CONVENIENCE_ABUSE',
  'TRANSSHIPMENT_VIOLATIONS',
  'QUOTA_VIOLATIONS',
  'PROTECTED_SPECIES_VIOLATIONS',
  'MARINE_POLLUTION',
  'SAFETY_VIOLATIONS',
  'CUSTOMS_VIOLATIONS',
  'TAX_EVASION',
  'OTHER'
]);

// ==============================================================================
// VESSEL OUTLAW OCEAN TABLE
// ==============================================================================

// Outlaw Ocean investigation data for vessels
export const vesselsOutlawOcean = pgTable(
  'vessels_outlaw_ocean',
  {
    outlawOceanUuid: uuid('outlaw_ocean_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    mandarinName: varchar('mandarin_name', { length: 40 }), // Mandarin characters
    subsidyRecipient: boolean('subsidy_recipient').default(false),
    isActive: boolean('is_active').default(true),
    stateOwnedOperator: boolean('state_owned_operator').default(false),
    crimes: jsonb('crimes'), // JSONB array of crime_type_enum values
    concerns: varchar('concerns', { length: 300 }), // Alphanumeric open text
    ooUrl: text('oo_url'), // Clickable URL to Outlaw Ocean platform

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_outlaw_ocean_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_outlaw_ocean_source_idx').on(table.sourceId),
    activeIdx: index('vessels_outlaw_ocean_active_idx').on(table.isActive),
    subsidyIdx: index('vessels_outlaw_ocean_subsidy_idx').on(table.subsidyRecipient),
    stateOwnedIdx: index('vessels_outlaw_ocean_state_owned_idx').on(table.stateOwnedOperator),
    // GIN index for JSONB crimes array searches
    crimesIdx: index('vessels_outlaw_ocean_crimes_idx').using('gin', table.crimes),
    mandarinNameIdx: index('vessels_outlaw_ocean_mandarin_name_idx').on(table.mandarinName),
    // Composite indexes for common query patterns
    vesselActiveIdx: index('vessels_outlaw_ocean_vessel_active_idx').on(table.vesselUuid, table.isActive),
    flagsIdx: index('vessels_outlaw_ocean_flags_idx').on(table.subsidyRecipient, table.stateOwnedOperator),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsOutlawOcean = typeof vesselsOutlawOcean.$inferSelect;
export type NewVesselsOutlawOcean = typeof vesselsOutlawOcean.$inferInsert;

// ==============================================================================
// JSONB ARRAY TYPES FOR CRIME REFERENCES
// ==============================================================================

// Type for crimes JSONB array - contains crime_type_enum values
export type CrimesArray = Array<typeof crimeTypeEnum.enumValues[number]>;

// Enhanced type for Outlaw Ocean data with proper typing for JSONB arrays
export interface VesselsOutlawOceanWithTypedArrays extends Omit<VesselsOutlawOcean, 'crimes'> {
  crimes?: CrimesArray | null;
}

// ==============================================================================
// CONSTANTS FOR VALIDATION AND CATEGORIZATION
// ==============================================================================

// Maximum number of crimes per vessel (for application validation)
export const MAX_CRIMES_PER_VESSEL = 15;

// Crime category groupings for analysis
export const CRIME_CATEGORIES = {
  FISHING_VIOLATIONS: [
    'ILLEGAL_FISHING',
    'UNREPORTED_FISHING',
    'UNREGULATED_FISHING',
    'QUOTA_VIOLATIONS',
    'PROTECTED_SPECIES_VIOLATIONS'
  ],
  LABOR_VIOLATIONS: [
    'FORCED_LABOR',
    'HUMAN_TRAFFICKING',
    'LABOR_ABUSE'
  ],
  REGULATORY_VIOLATIONS: [
    'DOCUMENT_FRAUD',
    'FLAG_OF_CONVENIENCE_ABUSE',
    'TRANSSHIPMENT_VIOLATIONS',
    'CUSTOMS_VIOLATIONS',
    'TAX_EVASION'
  ],
  ENVIRONMENTAL_VIOLATIONS: [
    'MARINE_POLLUTION'
  ],
  SAFETY_VIOLATIONS: [
    'SAFETY_VIOLATIONS'
  ]
} as const;

// Severity levels for different crime types
export const CRIME_SEVERITY_LEVELS = {
  HIGH: ['HUMAN_TRAFFICKING', 'FORCED_LABOR'],
  MEDIUM: ['ILLEGAL_FISHING', 'QUOTA_VIOLATIONS', 'PROTECTED_SPECIES_VIOLATIONS'],
  LOW: ['DOCUMENT_FRAUD', 'SAFETY_VIOLATIONS', 'OTHER']
} as const;

// Common concern patterns for text analysis
export const CONCERN_PATTERNS = {
  LABOR_CONCERNS: 'labor violations, crew welfare, working conditions',
  ENVIRONMENTAL_CONCERNS: 'overfishing, bycatch, pollution, protected areas',
  REGULATORY_CONCERNS: 'documentation issues, flag state compliance, licensing',
  TRANSPARENCY_CONCERNS: 'ownership opacity, beneficial ownership, shell companies'
} as const;
