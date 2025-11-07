// drizzle-schemas/vessels/core.ts - Core vessel identity and characteristics with FK references - FIXED
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  char,
  decimal,
  integer,
  date,
  timestamp,
  boolean,
  index,
  unique
} from 'drizzle-orm/pg-core';

// Import reference tables for FK references - FIXED: Added missing import
import { countryIso, vesselTypes, gearTypesFao } from '../reference';
import { originalSourcesVessels } from './sources'; // ✅ FIXED: Added missing import

// ==============================================================================
// CORE VESSEL ENUMS
// ==============================================================================

export const hullMaterialEnum = pgEnum('hull_material_enum', [
  'STEEL',
  'ALUMINUM',
  'FIBERGLASS',
  'WOOD',
  'CONCRETE',
  'PLASTIC',
  'OTHER'
]);

export const unitEnum = pgEnum('unit_enum', [
  // Length units
  'METER',
  'FEET',

  // Volume units
  'CUBIC_FEET',
  'CUBIC_METER',
  'LITER',
  'GALLON',

  // Power units
  'HP',
  'KW',
  'PS',

  // Speed units
  'KNOTS',
  'MPH',
  'KMH',

  // Freezer units
  'METRIC_TONS / DAY',
  'TONS / DAY'
]);

export const metricTypeEnum = pgEnum('metric_type_enum', [
  // Length metrics
  'length',
  'length_loa',
  'length_lbp',
  'length_lwl',
  'length_rgl',

  // Beam metrics
  'beam',
  'extreme_beam',
  'moulded_beam',

  // Depth metrics
  'depth',
  'draft_depth',
  'moulded_depth',

  // Tonnage metrics
  'tonnage',
  'gross_tonnage',
  'gross_register_tonnage',
  'net_tonnage',

  // Power and capacity
  'engine_power',
  'aux_engine_power',
  'fish_hold_volume',
  'carrying_capacity',
  'freezer_capacity',
  'total_fuel_carrying_capacity',
  'refrigerant_used_capacity',
  'vessel_capacity_units',

  // Performance metrics
  'rated_speed'
]);

export const externalIdentifierTypeEnum = pgEnum('external_identifier_type_enum', [
  // RFMO identifiers
  'RFMO_CCAMLR', 'RFMO_CCSBT', 'RFMO_FFA', 'RFMO_GFCM', 'RFMO_IATTC',
  'RFMO_ICCAT', 'RFMO_IOTC', 'RFMO_NAFO', 'RFMO_NEAFC', 'RFMO_NPFC',
  'RFMO_SEAFO', 'RFMO_SIOFA', 'RFMO_SPRFMO', 'RFMO_WCPFC',

  // National registry identifiers
  'ADFG_NO',

  // Civil Society identifiers
  'AP2HI_ID', 'ISSF_TUVI'

  // Other identifier types
  'HULL_ID'
]);

// ==============================================================================
// CORE VESSEL TABLES
// ==============================================================================

// Main vessels table - Core identifiers with FK to country_iso
export const vessels = pgTable(
  'vessels',
  {
    vesselUuid: uuid('vessel_uuid').primaryKey().defaultRandom(),

    // CORE IDENTIFIERS
    vesselName: text('vessel_name'),
    vesselFlag: uuid('vessel_flag').references(() => countryIso.id), // ✅ FK to country_iso(id)
    vesselNameOther: text('vessel_name_other'),
    imo: char('imo', { length: 7 }),
    ircs: varchar('ircs', { length: 15 }),
    mmsi: char('mmsi', { length: 9 }),
    nationalRegistry: varchar('national_registry', { length: 50 }),
    nationalRegistryOther: varchar('national_registry_other', { length: 50 }),
    euCfr: char('eu_cfr', { length: 12 }),

    // METADATA
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Unique indexes for critical identifiers (only when not null)
    imoIdx: unique('vessels_imo_idx').on(table.imo),
    euCfrIdx: unique('vessels_eu_cfr_idx').on(table.euCfr),

    // Standard indexes for lookups
    mmsiIdx: index('vessels_mmsi_idx').on(table.mmsi),
    flagIdx: index('vessels_flag_idx').on(table.vesselFlag),
    nameIdx: index('vessels_name_idx').on(table.vesselName),
  })
);

// Vessel info table - Basic characteristics (1:1 with vessels)
export const vesselInfo = pgTable(
  'vessel_info',
  {
    vesselUuid: uuid('vessel_uuid').primaryKey().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)

    vesselType: uuid('vessel_type').references(() => vesselTypes.id), // ✅ FK to vessel_types(id)
    primaryGear: uuid('primary_gear').references(() => gearTypesFao.id), // ✅ FK to gear_types_fao(id)
    hullMaterial: hullMaterialEnum('hull_material'),
    portRegistry: varchar('port_registry', { length: 100 }),
    buildYear: date('build_year'), // ✅ DATE type for year-only (store as 'YYYY-01-01')
    flagRegisteredDate: date('flag_registered_date'),
    vesselEngineType: varchar('vessel_engine_type', { length: 50 }),
    vesselFuelType: varchar('vessel_fuel_type', { length: 50 }),
    externalMarking: text('external_marking'),
    crew: varchar('crew', { length: 50 }),

    // ✅ NEW: Home port fields (from migration)
    homePort: varchar('home_port', { length: 100 }),
    homePortState: varchar('home_port_state', { length: 100 }),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    typeIdx: index('vessel_info_type_idx').on(table.vesselType),
    hullIdx: index('vessel_info_hull_idx').on(table.hullMaterial),
    buildYearIdx: index('vessel_info_build_year_idx').on(table.buildYear),
    gearIdx: index('vessel_info_gear_idx').on(table.primaryGear),
    homePortIdx: index('vessel_info_home_port_idx').on(table.homePort), // ✅ NEW
    homePortStateIdx: index('vessel_info_home_port_state_idx').on(table.homePortState), // ✅ NEW
    // Composite indexes
    typeGearIdx: index('vessel_info_type_gear_idx').on(table.vesselType, table.primaryGear),
    portLocationIdx: index('vessel_info_port_location_idx').on(table.homePort, table.homePortState), // ✅ NEW
  })
);

// Vessel metrics table - Measurements with units
export const vesselMetrics = pgTable(
  'vessel_metrics',
  {
    metricUuid: uuid('metric_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    metricType: metricTypeEnum('metric_type').notNull(),
    value: decimal('value', { precision: 15, scale: 4 }),
    unit: unitEnum('unit'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_metrics_vessel_idx').on(table.vesselUuid),
    typeIdx: index('vessel_metrics_type_idx').on(table.metricType),
    sourceIdx: index('vessel_metrics_source_idx').on(table.sourceId), // ✅ FIXED: Index for source FK
    valueIdx: index('vessel_metrics_value_idx').on(table.value),
  })
);

// Vessel build information table
export const vesselBuildInformation = pgTable(
  'vessel_build_information',
  {
    buildInfoUuid: uuid('build_info_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    buildCountryId: uuid('build_country_id').references(() => countryIso.id), // ✅ FK to country_iso(id)
    buildLocation: varchar('build_location', { length: 200 }),
    buildYear: integer('build_year'),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_build_info_vessel_idx').on(table.vesselUuid),
    countryIdx: index('vessel_build_info_country_idx').on(table.buildCountryId),
    yearIdx: index('vessel_build_info_year_idx').on(table.buildYear),
    sourceIdx: index('vessel_build_info_source_idx').on(table.sourceId), // ✅ FIXED: Index for source FK
    vesselSourceIdx: index('vessel_build_info_vessel_source_idx').on(table.vesselUuid, table.sourceId),
    countryYearIdx: index('vessel_build_info_country_year_idx').on(table.buildCountryId, table.buildYear),
  })
);

// Vessel external identifiers table - RFMO IDs, port IDs, etc.
export const vesselExternalIdentifiers = pgTable(
  'vessel_external_identifiers',
  {
    externalIdUuid: uuid('external_id_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    identifierType: externalIdentifierTypeEnum('identifier_type').notNull(),
    identifierValue: varchar('identifier_value', { length: 100 }),
    isActive: boolean('is_active').default(true),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    // Critical lookup index for external ID searches
    lookupIdx: index('vessel_external_ids_lookup_idx').on(table.identifierType, table.identifierValue),
    vesselIdx: index('vessel_external_ids_vessel_idx').on(table.vesselUuid),
    activeIdx: index('vessel_external_ids_active_idx').on(table.isActive),
    sourceIdx: index('vessel_external_ids_source_idx').on(table.sourceId), // ✅ FIXED: Index for source FK
    // CRITICAL: Reverse lookup index for RFMO ID queries (performance critical)
    rfmoLookupIdx: index('vessel_external_ids_rfmo_lookup_idx').on(table.identifierValue, table.identifierType),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type Vessels = typeof vessels.$inferSelect;
export type NewVessels = typeof vessels.$inferInsert;

export type VesselInfo = typeof vesselInfo.$inferSelect;
export type NewVesselInfo = typeof vesselInfo.$inferInsert;

export type VesselMetrics = typeof vesselMetrics.$inferSelect;
export type NewVesselMetrics = typeof vesselMetrics.$inferInsert;

export type VesselBuildInformation = typeof vesselBuildInformation.$inferSelect;
export type NewVesselBuildInformation = typeof vesselBuildInformation.$inferInsert;

export type VesselExternalIdentifiers = typeof vesselExternalIdentifiers.$inferSelect;
export type NewVesselExternalIdentifiers = typeof vesselExternalIdentifiers.$inferInsert;
