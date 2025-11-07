// drizzle-schemas/vessels/tracking.ts - Source tracking and vessel classifications with all FK references - FIXED
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  date,
  timestamp,
  boolean,
  index,
  primaryKey
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships - FIXED: Added missing imports
import { countryIso, gearTypesFao, vesselTypes } from '../reference';
import { vessels } from './core';
import { originalSourcesVessels } from './sources'; // ✅ FIXED: Import was present but ensuring it's correctly used

// ==============================================================================
// TRACKING ENUMS
// ==============================================================================

export const identifierTypeEnum = pgEnum('identifier_type_enum', [
  'vessel_name',
  'vessel_name_other',
  'imo',
  'ircs',
  'mmsi',
  'national_registry',
  'national_registry_other',
  'eu_cfr'
]);

// ==============================================================================
// SOURCE TRACKING TABLES
// ==============================================================================

export const vesselSources = pgTable(
  'vessel_sources',
  {
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    firstSeenDate: date('first_seen_date'),
    lastSeenDate: date('last_seen_date'),
    isActive: boolean('is_active').default(true),
    dataGovernanceNotes: text('data_governance_notes'),
    lastQualityReview: date('last_quality_review'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vesselUuid, table.sourceId] }),
    vesselIdx: index('vessel_sources_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessel_sources_source_idx').on(table.sourceId),
    activeIdx: index('vessel_sources_active_idx').on(table.isActive),
    lastSeenIdx: index('vessel_sources_last_seen_idx').on(table.lastSeenDate),
  })
);

export const vesselSourceIdentifiers = pgTable(
  'vessel_source_identifiers',
  {
    identifierUuid: uuid('identifier_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    identifierType: identifierTypeEnum('identifier_type').notNull(),
    identifierValue: text('identifier_value'),
    associatedFlag: uuid('associated_flag').references(() => countryIso.id), // ✅ FK to country_iso(id)
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_source_identifiers_vessel_idx').on(table.vesselUuid),
    typeIdx: index('vessel_source_identifiers_type_idx').on(table.identifierType),
    valueIdx: index('vessel_source_identifiers_value_idx').on(table.identifierValue),
    sourceIdx: index('vessel_source_identifiers_source_idx').on(table.sourceId),
    flagIdx: index('vessel_source_identifiers_flag_idx').on(table.associatedFlag), // ✅ FIXED: Added index for FK
  })
);

// ==============================================================================
// CLASSIFICATION JUNCTION TABLES (Many-to-Many relationships)
// ==============================================================================

// Junction table: vessels <-> vessel_types (many-to-many)
export const vesselVesselTypes = pgTable(
  'vessel_vessel_types',
  {
    relationshipUuid: uuid('relationship_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    vesselTypeId: uuid('vessel_type_id').notNull().references(() => vesselTypes.id), // ✅ FIXED: Added FK constraint
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_vessel_types_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessel_vessel_types_source_idx').on(table.sourceId),
    typeIdx: index('vessel_vessel_types_type_idx').on(table.vesselTypeId), // ✅ FIXED: Index for FK
    // Composite index for common lookup patterns
    vesselSourceIdx: index('vessel_vessel_types_vessel_source_idx').on(table.vesselUuid, table.sourceId),
    vesselTypeSourceIdx: index('vessel_vessel_types_vessel_type_source_idx').on(table.vesselUuid, table.vesselTypeId),
  })
);

// Junction table: vessels <-> gear_types_fao (many-to-many)
export const vesselGearTypes = pgTable(
  'vessel_gear_types',
  {
    relationshipUuid: uuid('relationship_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    faoGearId: uuid('fao_gear_id').notNull().references(() => gearTypesFao.id), // ✅ FIXED: Added FK constraint
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_gear_types_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessel_gear_types_source_idx').on(table.sourceId),
    gearIdx: index('vessel_gear_types_gear_idx').on(table.faoGearId), // ✅ FIXED: Index for FK
    // Composite index for common lookup patterns
    vesselSourceIdx: index('vessel_gear_types_vessel_source_idx').on(table.vesselUuid, table.sourceId),
    vesselGearSourceIdx: index('vessel_gear_types_vessel_gear_source_idx').on(table.vesselUuid, table.faoGearId),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselSources = typeof vesselSources.$inferSelect;
export type NewVesselSources = typeof vesselSources.$inferInsert;

export type VesselSourceIdentifiers = typeof vesselSourceIdentifiers.$inferSelect;
export type NewVesselSourceIdentifiers = typeof vesselSourceIdentifiers.$inferInsert;

export type VesselVesselTypes = typeof vesselVesselTypes.$inferSelect;
export type NewVesselVesselTypes = typeof vesselVesselTypes.$inferInsert;

export type VesselGearTypes = typeof vesselGearTypes.$inferSelect;
export type NewVesselGearTypes = typeof vesselGearTypes.$inferInsert;
