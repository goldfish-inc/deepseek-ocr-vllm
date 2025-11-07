// drizzle-schemas/vessels/additional.ts - Additional vessel registry data and specialized tables
import {
  pgTable,
  pgEnum,
  uuid,
  integer,
  varchar,
  date,
  timestamp,
  jsonb,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// MEXICAN VESSEL REGISTRY ENUMS
// ==============================================================================

export const mexUseTypeSpanishEnum = pgEnum('mex_use_type_spanish_enum', [
  'COMERCIAL',
  'INVESTIGACION'
]);

export const mexOperationSpanishEnum = pgEnum('mex_operation_spanish_enum', [
  'ACTUALIZACION',
  'ALTA'
]);

export const mexSpeciesGroupSpanishEnum = pgEnum('mex_species_group_spanish_enum', [
  'ATÚN',
  'CAMARÓN',
  'ESCAMA',
  'TIBURÓN',
  'OTRAS',
  'SARDINA, ANCHOVETA Y MACARELA'
]);

export const mexHullTypeSpanishEnum = pgEnum('mex_hull_type_spanish_enum', [
  'ACERO',
  'FERROCEMENTO',
  'FIBRA DE VIDRIO',
  'ALUMINIO',
  'MADERA',
  'OTROS'
]);

// Note: gear_type_spanish enum values not specified by user - placeholder values
export const mexGearTypeSpanishEnum = pgEnum('mex_gear_type_spanish_enum', [
  'ARRASTRE',
  'CERCO',
  'PALANGRE',
  'PESCA MULTIPLE',
  'OTRO'
]);

export const mexDetectionEquipmentSpanishEnum = pgEnum('mex_detection_equipment_spanish_enum', [
  'ECOSONIDA',
  'HELICOPTERO',
  'LORAN',
  'ORBIMAGEN (FOTO SATELITAL)',
  'RADIO MULTIBANDA',
  'SONAR',
  'VIDEOSONDA'
]);

export const mexStorageMethodSpanishEnum = pgEnum('mex_storage_method_spanish_enum', [
  'HIELO',
  'SALMUERA',
  'REFRIGERACIÓN',
  'CONGELACIÓN'
]);

// ==============================================================================
// MEXICAN VESSEL REGISTRY TABLE
// ==============================================================================

// Mexican vessel registry data with Spanish language fields
export const vesselsMex = pgTable(
  'vessels_mex',
  {
    mexUuid: uuid('mex_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    // Mexican State Information
    mexStateNo: integer('mex_state_no'), // 5-digit integer
    mexState: varchar('mex_state', { length: 50 }),

    // Office Information
    mexOffice: integer('mex_office'), // 5-digit integer
    mexOfficeNo: integer('mex_office_no'), // 5-digit integer

    // Record Management
    recordUpdate: date('record_update'), // DATE format YYYY-MM-DD
    modificationDate: date('modification_date'), // DATE format YYYY-MM-DD

    // Registry Information
    portOfRegistryNo: integer('port_of_registry_no'), // 5-digit integer

    // Classification (Spanish)
    useTypeSpanish: mexUseTypeSpanishEnum('use_type_spanish'),
    operationSpanish: mexOperationSpanishEnum('operation_spanish'),
    vesselSizeCatSpanish: varchar('vessel_size_cat_spanish', { length: 100 }),

    // Gear and Equipment (Spanish)
    gearTypeSpanish: jsonb('gear_type_spanish'), // JSONB array of mex_gear_type_spanish_enum values
    storageMethodSpanish: mexStorageMethodSpanishEnum('storage_method_spanish'),
    detectionEquipmentSpanish: mexDetectionEquipmentSpanishEnum('detection_equipment_spanish'),

    // Species and Hull (Spanish)
    speciesGroupSpanish: mexSpeciesGroupSpanishEnum('species_group_spanish'),
    hullTypeSpanish: mexHullTypeSpanishEnum('hull_type_spanish'),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_mex_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_mex_source_idx').on(table.sourceId),

    // Mexican administrative indexes
    stateNoIdx: index('vessels_mex_state_no_idx').on(table.mexStateNo),
    stateIdx: index('vessels_mex_state_idx').on(table.mexState),
    officeIdx: index('vessels_mex_office_idx').on(table.mexOffice),
    portRegistryIdx: index('vessels_mex_port_registry_no_idx').on(table.portOfRegistryNo),

    // Date indexes for record management
    recordUpdateIdx: index('vessels_mex_record_update_idx').on(table.recordUpdate),
    modificationDateIdx: index('vessels_mex_modification_date_idx').on(table.modificationDate),

    // Classification indexes
    useTypeIdx: index('vessels_mex_use_type_idx').on(table.useTypeSpanish),
    operationIdx: index('vessels_mex_operation_idx').on(table.operationSpanish),
    speciesGroupIdx: index('vessels_mex_species_group_idx').on(table.speciesGroupSpanish),
    hullTypeIdx: index('vessels_mex_hull_type_idx').on(table.hullTypeSpanish),
    storageMethodIdx: index('vessels_mex_storage_method_idx').on(table.storageMethodSpanish),
    detectionEquipmentIdx: index('vessels_mex_detection_equipment_idx').on(table.detectionEquipmentSpanish),

    // JSONB index for gear types array
    gearTypeIdx: index('vessels_mex_gear_type_idx').using('gin', table.gearTypeSpanish),

    // Composite indexes for common query patterns
    stateOfficeIdx: index('vessels_mex_state_office_idx').on(table.mexStateNo, table.mexOffice),
    vesselUseTypeIdx: index('vessels_mex_vessel_use_type_idx').on(table.vesselUuid, table.useTypeSpanish),
    speciesHullIdx: index('vessels_mex_species_hull_idx').on(table.speciesGroupSpanish, table.hullTypeSpanish),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsMex = typeof vesselsMex.$inferSelect;
export type NewVesselsMex = typeof vesselsMex.$inferInsert;

// ==============================================================================
// JSONB ARRAY TYPES FOR GEAR TYPES
// ==============================================================================

// Type for gear_type_spanish JSONB array - contains mex_gear_type_spanish_enum values
export type MexGearTypeSpanishArray = Array<typeof mexGearTypeSpanishEnum.enumValues[number]>;

// Enhanced type for Mexican vessel data with proper typing for JSONB arrays
export interface VesselsMexWithTypedArrays extends Omit<VesselsMex, 'gearTypeSpanish'> {
  gearTypeSpanish?: MexGearTypeSpanishArray | null;
}

// ==============================================================================
// CONSTANTS FOR VALIDATION AND ANALYSIS
// ==============================================================================

// Maximum number of gear types per vessel (for application validation)
export const MAX_GEAR_TYPES_PER_MEX_VESSEL = 10;

// Mexican state number ranges (for validation)
export const MEX_STATE_NUMBER_RANGES = {
  MIN: 1,
  MAX: 99999 // 5-digit integer maximum
} as const;

// Mexican office number ranges (for validation)
export const MEX_OFFICE_NUMBER_RANGES = {
  MIN: 1,
  MAX: 99999 // 5-digit integer maximum
} as const;

// Common vessel use categories by type
export const MEX_USE_TYPE_CATEGORIES = {
  COMMERCIAL: ['COMERCIAL'],
  RESEARCH: ['INVESTIGACION']
} as const;

// Operation type categories
export const MEX_OPERATION_CATEGORIES = {
  UPDATE: ['ACTUALIZACION'],
  NEW_REGISTRATION: ['ALTA']
} as const;

// Species group categories for analysis
export const MEX_SPECIES_GROUP_CATEGORIES = {
  LARGE_PELAGICS: ['ATÚN'],
  CRUSTACEANS: ['CAMARÓN'],
  SMALL_PELAGICS: ['SARDINA, ANCHOVETA Y MACARELA'],
  CARTILAGINOUS: ['TIBURÓN'],
  FINFISH: ['ESCAMA'],
  OTHER: ['OTRAS']
} as const;

// Hull material categories
export const MEX_HULL_MATERIAL_CATEGORIES = {
  METAL: ['ACERO', 'ALUMINIO'],
  COMPOSITE: ['FIBRA DE VIDRIO', 'FERROCEMENTO'],
  TRADITIONAL: ['MADERA'],
  OTHER: ['OTROS']
} as const;

// Storage method categories for analysis
export const MEX_STORAGE_METHOD_CATEGORIES = {
  FROZEN: ['CONGELACIÓN'],
  REFRIGERATED: ['REFRIGERACIÓN'],
  ICE_BASED: ['HIELO', 'SALMUERA']
} as const;

// Detection equipment categories for analysis
export const MEX_DETECTION_EQUIPMENT_CATEGORIES = {
  SONAR_BASED: ['ECOSONIDA', 'SONAR', 'VIDEOSONDA'],
  SATELLITE_BASED: ['ORBIMAGEN (FOTO SATELITAL)', 'LORAN'],
  RADIO_BASED: ['RADIO MULTIBANDA'],
  AERIAL: ['HELICOPTERO']
} as const;

// Common vessel size categories (Spanish)
export const MEX_COMMON_VESSEL_SIZE_CATEGORIES = [
  'MENOR',
  'MAYOR',
  'RIBEREÑA',
  'INDUSTRIAL',
  'ARTESANAL'
] as const;

// ==============================================================================
// UTILITY TYPES
// ==============================================================================

// Utility type for Mexican use types
export type MexUseTypeSpanish = typeof mexUseTypeSpanishEnum.enumValues[number];

// Utility type for Mexican operation types
export type MexOperationSpanish = typeof mexOperationSpanishEnum.enumValues[number];

// Utility type for Mexican species groups
export type MexSpeciesGroupSpanish = typeof mexSpeciesGroupSpanishEnum.enumValues[number];

// Utility type for Mexican hull types
export type MexHullTypeSpanish = typeof mexHullTypeSpanishEnum.enumValues[number];

// Utility type for Mexican gear types
export type MexGearTypeSpanish = typeof mexGearTypeSpanishEnum.enumValues[number];

// Utility type for Mexican storage methods
export type MexStorageMethodSpanish = typeof mexStorageMethodSpanishEnum.enumValues[number];

// Utility type for Mexican detection equipment
export type MexDetectionEquipmentSpanish = typeof mexDetectionEquipmentSpanishEnum.enumValues[number];

// ==============================================================================
// VALIDATION HELPERS
// ==============================================================================

// Helper type for validation functions (to be implemented in application layer)
export interface MexVesselValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MexGearTypeValidationResult {
  validGearTypes: MexGearTypeSpanish[];
  invalidGearTypes: string[];
  duplicateGearTypes: MexGearTypeSpanish[];
}

// Common validation patterns
export const MEX_VALIDATION_PATTERNS = {
  // Number validation patterns
  STATE_NUMBER: /^[1-9][0-9]{0,4}$/, // 1-5 digits, no leading zeros
  OFFICE_NUMBER: /^[1-9][0-9]{0,4}$/, // 1-5 digits, no leading zeros
  PORT_REGISTRY_NUMBER: /^[1-9][0-9]{0,4}$/, // 1-5 digits, no leading zeros
} as const;
