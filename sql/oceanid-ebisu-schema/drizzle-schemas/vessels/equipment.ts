// drizzle-schemas/vessels/equipment.ts - Vessel equipment and attributes - FIXED
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK references - FIXED: Added missing imports
import { vessels } from './core';
import { originalSourcesVessels } from './sources'; // ✅ FIXED: Added missing import

// ==============================================================================
// EQUIPMENT ENUMS
// ==============================================================================

export const freezerTypeEnum = pgEnum('freezer_type_enum', [
  'AIR_BLAST',
  'AIR_COIL',
  'BAIT_FREEZER',
  'BLAST',
  'BRINE',
  'CHILLED',
  'COIL',
  'DIRECT_EXPANSION',
  'DRY',
  'FREON_REFRIGERATION_SYSTEM',
  'GRID_COIL',
  'ICE',
  'MYKOM',
  'OTHER',
  'PIPE',
  'PLATE_FREEZER',
  'RSW',
  'SEMI_AIR_BLAST',
  'TUNNEL'
]);

// ==============================================================================
// VESSEL EQUIPMENT TABLE
// ==============================================================================

// Equipment data per vessel per source (composite primary key)
export const vesselEquipment = pgTable(
  'vessel_equipment',
  {
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FIXED: Added FK constraint
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    // EQUIPMENT SPECIFICATIONS
    engineModel: varchar('engine_model', { length: 100 }),
    freezerTypes: jsonb('freezer_types'), // ✅ UPDATED: Changed to JSONB array for multiple freezer types

    // EQUIPMENT BOOLEAN FLAGS
    lightsForFishing: boolean('lights_for_fishing'),
    navEquipment: boolean('nav_equipment'),
    fishFinder: boolean('fish_finder'),
    deckMachinery: boolean('deck_machinery'),
    refrigerationEquipment: boolean('refrigeration_equipment'),
    fishProcessingEquipment: boolean('fish_processing_equipment'),

    // EQUIPMENT DETAILS
    safetyEquipment: text('safety_equipment'),
    communicationDetails: text('communication_details'),
    vmsSystemCode: varchar('vms_system_code', { length: 50 }),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vesselUuid, table.sourceId] }),
    engineModelIdx: index('vessel_equipment_engine_model_idx').on(table.engineModel),
    freezerTypesIdx: index('vessel_equipment_freezer_types_idx').using('gin', table.freezerTypes), // ✅ UPDATED: GIN index for JSONB array
    vmsSystemIdx: index('vessel_equipment_vms_system_idx').on(table.vmsSystemCode),
    // Composite index for boolean flags (common query pattern)
    fishingFlagsIdx: index('vessel_equipment_fishing_flags_idx').on(table.lightsForFishing, table.navEquipment, table.fishFinder),
    processingFlagsIdx: index('vessel_equipment_processing_flags_idx').on(table.refrigerationEquipment, table.fishProcessingEquipment),
    // ✅ FIXED: Added indexes for FK columns
    vesselIdx: index('vessel_equipment_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessel_equipment_source_idx').on(table.sourceId),
  })
);

// ==============================================================================
// VESSEL ATTRIBUTES TABLE (JSONB for sparse data)
// ==============================================================================

// Sparse attributes per vessel per source (composite primary key)
export const vesselAttributes = pgTable(
  'vessel_attributes',
  {
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FIXED: Added FK constraint
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    attributes: jsonb('attributes'),
    lastUpdated: timestamp('last_updated').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vesselUuid, table.sourceId] }),
    // GIN index for JSONB path operations (efficient for complex queries)
    attributesIdx: index('vessel_attrs_idx').using('gin', table.attributes),
    // Specific BTREE indexes for commonly queried JSONB fields
    activityIdx: index('vessel_attrs_activity_idx').on(table.attributes.op('->>', 'activity_flag')),
    statusIdx: index('vessel_attrs_status_idx').on(table.attributes.op('->>', 'vessel_status')),
    // ✅ FIXED: Added indexes for FK columns
    vesselIdx: index('vessel_attributes_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessel_attributes_source_idx').on(table.sourceId),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselEquipment = typeof vesselEquipment.$inferSelect;
export type NewVesselEquipment = typeof vesselEquipment.$inferInsert;

export type VesselAttributes = typeof vesselAttributes.$inferSelect;
export type NewVesselAttributes = typeof vesselAttributes.$inferInsert;

// Type for freezer types array (for better type safety)
export type FreezerType = 'AIR_BLAST' | 'AIR_COIL' | 'BAIT_FREEZER' | 'BLAST' | 'BRINE' | 'CHILLED' | 'COIL' | 'DIRECT_EXPANSION' | 'DRY' | 'FREON_REFRIGERATION_SYSTEM' | 'GRID_COIL' | 'ICE' | 'MYKOM' | 'OTHER' | 'PIPE' | 'PLATE_FREEZER' | 'RSW' | 'SEMI_AIR_BLAST' | 'TUNNEL';
export type FreezerTypesArray = FreezerType[];

// Enhanced type with typed arrays
export type VesselEquipmentWithTypedArrays = Omit<VesselEquipment, 'freezerTypes'> & {
  freezerTypes: FreezerTypesArray | null;
};
