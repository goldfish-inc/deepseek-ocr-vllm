// drizzle-schemas/vessels/issf.ts - ISSF (International Seafood Sustainability Foundation) programs and compliance
import {
  pgTable,
  pgEnum,
  uuid,
  boolean,
  varchar,
  date,
  text,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';
import { countryIso, rfmos } from '../reference';

// ==============================================================================
// ISSF ENUMS
// ==============================================================================

export const issfInitiativeTypeEnum = pgEnum('issf_initiative_type_enum', [
  'PVR_COMPLIANCE',
  'VOSI_PARTICIPATION',
  'CONSERVATION_INITIATIVE',
  'FAD_MANAGEMENT',
  'BYCATCH_REDUCTION',
  'OBSERVER_PROGRAM',
  'TRACEABILITY_PROGRAM',
  'SUSTAINABILITY_INITIATIVE',
  'RESEARCH_PROJECT',
  'CAPACITY_BUILDING',
  'POLICY_DEVELOPMENT',
  'OTHER'
]);

// ==============================================================================
// ISSF PVR TABLE (ProActive Vessel Register)
// ==============================================================================

// ISSF ProActive Vessel Register compliance tracking
export const vesselsIssfPvr = pgTable(
  'vessels_issf_pvr',
  {
    issfPvrUuid: uuid('issf_pvr_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    // UVI ISSF Compliance
    isUviIssfCompliant: boolean('is_uvi_issf_compliant').default(false),
    isActiveRegAuth: boolean('is_active_reg_auth').default(false),

    // Authority Reference
    flagOrRfmo: boolean('flag_or_rfmo').default(false),
    flagId: uuid('flag_id').references(() => countryIso.id), // ✅ FK to country_iso(id)
    rfmoId: uuid('rfmo_id').references(() => rfmos.id), // ✅ FK to rfmos(id)

    // Compliance Flags
    notListedIuu: boolean('not_listed_iuu').default(false),
    hasSharkFinningPolicy: boolean('has_shark_finning_policy').default(false),
    hasObserver: boolean('has_observer').default(false),
    fullTunaRetention: boolean('full_tuna_retention').default(false),
    skipperWsGb: boolean('skipper_ws_gb').default(false),
    noLsDriftnet: boolean('no_ls_driftnet').default(false),
    neFads: boolean('ne_fads').default(false),
    sharkTurtleSeabirdBestPractices: boolean('shark_turtle_seabird_best_practices').default(false),
    hasFadManagementPolicy: boolean('has_fad_management_policy').default(false),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_issf_pvr_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_issf_pvr_source_idx').on(table.sourceId),
    uviCompliantIdx: index('vessels_issf_pvr_uvi_compliant_idx').on(table.isUviIssfCompliant),
    flagIdx: index('vessels_issf_pvr_flag_idx').on(table.flagId),
    rfmoIdx: index('vessels_issf_pvr_rfmo_idx').on(table.rfmoId),
    // Composite indexes for common query patterns
    vesselCompliantIdx: index('vessels_issf_pvr_vessel_compliant_idx').on(table.vesselUuid, table.isUviIssfCompliant),
    complianceFlagsIdx: index('vessels_issf_pvr_compliance_flags_idx').on(table.isUviIssfCompliant, table.isActiveRegAuth, table.notListedIuu),
  })
);

// ==============================================================================
// ISSF VOSI TABLE (Vessel Online Survey Initiative)
// ==============================================================================

// ISSF Vessel Online Survey Initiative participation and practices
export const vesselsIssfVosi = pgTable(
  'vessels_issf_vosi',
  {
    issfVosiUuid: uuid('issf_vosi_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    // PVR Participation
    onPvr: boolean('on_pvr').default(false),

    // FAD (Fish Aggregating Device) Practices
    biodegradableFadTrial: boolean('biodegradable_fad_trial').default(false),
    fadRecoveryInitiative: boolean('fad_recovery_initiative').default(false),
    neFadsNoNetting: boolean('ne_fads_no_netting').default(false),

    // Data Collection and Monitoring
    fadsBuoyPositionData: boolean('fads_buoy_position_data').default(false),
    fadEchosounderBiomassData: boolean('fad_echosounder_biomass_data').default(false),
    electricMonitoring: boolean('electric_monitoring').default(false),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_issf_vosi_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_issf_vosi_source_idx').on(table.sourceId),
    onPvrIdx: index('vessels_issf_vosi_on_pvr_idx').on(table.onPvr),
    // Composite indexes for FAD-related queries
    fadInitiativesIdx: index('vessels_issf_vosi_fad_initiatives_idx').on(table.biodegradableFadTrial, table.fadRecoveryInitiative, table.neFadsNoNetting),
    dataCollectionIdx: index('vessels_issf_vosi_data_collection_idx').on(table.fadsBuoyPositionData, table.fadEchosounderBiomassData, table.electricMonitoring),
  })
);

// ==============================================================================
// ISSF INITIATIVES TABLE
// ==============================================================================

// ISSF sustainability initiatives and programs tracking
export const vesselsIssfInitiatives = pgTable(
  'vessels_issf_initiatives',
  {
    issfInitiativeUuid: uuid('issf_initiative_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    type: issfInitiativeTypeEnum('type').notNull(),
    description: varchar('description', { length: 300 }), // Alphanumeric field
    startDate: date('start_date'), // DATE format YYYY-MM-DD
    endDate: date('end_date'), // DATE format YYYY-MM-DD
    initiativeUrl: text('initiative_url'), // Clickable URL

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_issf_initiatives_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_issf_initiatives_source_idx').on(table.sourceId),
    typeIdx: index('vessels_issf_initiatives_type_idx').on(table.type),
    startDateIdx: index('vessels_issf_initiatives_start_date_idx').on(table.startDate),
    endDateIdx: index('vessels_issf_initiatives_end_date_idx').on(table.endDate),
    // Composite indexes for date range queries
    dateRangeIdx: index('vessels_issf_initiatives_date_range_idx').on(table.startDate, table.endDate),
    vesselTypeIdx: index('vessels_issf_initiatives_vessel_type_idx').on(table.vesselUuid, table.type),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsIssfPvr = typeof vesselsIssfPvr.$inferSelect;
export type NewVesselsIssfPvr = typeof vesselsIssfPvr.$inferInsert;

export type VesselsIssfVosi = typeof vesselsIssfVosi.$inferSelect;
export type NewVesselsIssfVosi = typeof vesselsIssfVosi.$inferInsert;

export type VesselsIssfInitiatives = typeof vesselsIssfInitiatives.$inferSelect;
export type NewVesselsIssfInitiatives = typeof vesselsIssfInitiatives.$inferInsert;

// ==============================================================================
// CONSTANTS FOR VALIDATION AND ANALYSIS
// ==============================================================================

// PVR Core compliance requirements
export const PVR_CORE_REQUIREMENTS = [
  'isUviIssfCompliant',
  'isActiveRegAuth',
  'notListedIuu'
] as const;

// PVR Conservation compliance flags
export const PVR_CONSERVATION_COMPLIANCE_FLAGS = [
  'hasSharkFinningPolicy',
  'fullTunaRetention',
  'sharkTurtleSeabirdBestPractices',
  'hasFadManagementPolicy'
] as const;

// PVR Operational compliance flags
export const PVR_OPERATIONAL_COMPLIANCE_FLAGS = [
  'hasObserver',
  'skipperWsGb',
  'noLsDriftnet',
  'neFads'
] as const;

// All PVR compliance flag field names
export const ALL_PVR_COMPLIANCE_FLAGS = [
  ...PVR_CORE_REQUIREMENTS,
  ...PVR_CONSERVATION_COMPLIANCE_FLAGS,
  ...PVR_OPERATIONAL_COMPLIANCE_FLAGS
] as const;

// VOSI FAD-related practices for sustainability analysis
export const VOSI_FAD_SUSTAINABILITY_PRACTICES = [
  'biodegradableFadTrial',
  'fadRecoveryInitiative',
  'neFadsNoNetting'
] as const;

// VOSI Data collection and monitoring practices
export const VOSI_MONITORING_DATA_PRACTICES = [
  'fadsBuoyPositionData',
  'fadEchosounderBiomassData',
  'electricMonitoring'
] as const;

// All VOSI practice field names
export const ALL_VOSI_PRACTICES = [
  'onPvr',
  ...VOSI_FAD_SUSTAINABILITY_PRACTICES,
  ...VOSI_MONITORING_DATA_PRACTICES
] as const;

// VOSI FAD management categories for analysis
export const VOSI_FAD_MANAGEMENT_CATEGORIES = {
  SUSTAINABILITY: VOSI_FAD_SUSTAINABILITY_PRACTICES,
  DATA_COLLECTION: VOSI_MONITORING_DATA_PRACTICES
} as const;

// Initiative categories for analysis and reporting
export const INITIATIVE_CATEGORIES = {
  COMPLIANCE: ['PVR_COMPLIANCE', 'VOSI_PARTICIPATION'],
  CONSERVATION: ['CONSERVATION_INITIATIVE', 'FAD_MANAGEMENT', 'BYCATCH_REDUCTION'],
  MONITORING: ['OBSERVER_PROGRAM', 'TRACEABILITY_PROGRAM'],
  IMPROVEMENT: ['SUSTAINABILITY_INITIATIVE', 'RESEARCH_PROJECT'],
  DEVELOPMENT: ['CAPACITY_BUILDING', 'POLICY_DEVELOPMENT']
} as const;

// Priority levels for different initiative types
export const INITIATIVE_PRIORITY_LEVELS = {
  HIGH: ['PVR_COMPLIANCE', 'CONSERVATION_INITIATIVE', 'OBSERVER_PROGRAM'],
  MEDIUM: ['FAD_MANAGEMENT', 'BYCATCH_REDUCTION', 'TRACEABILITY_PROGRAM'],
  LOW: ['RESEARCH_PROJECT', 'CAPACITY_BUILDING', 'OTHER']
} as const;

// Common initiative duration patterns (in months)
export const TYPICAL_INITIATIVE_DURATIONS = {
  SHORT_TERM: 6,    // 6 months or less
  MEDIUM_TERM: 18,  // 6-18 months
  LONG_TERM: 36     // 18+ months
} as const;

// ==============================================================================
// UTILITY TYPES
// ==============================================================================

// Utility type for PVR compliance flag field names
export type ComplianceFlagField = typeof ALL_PVR_COMPLIANCE_FLAGS[number];

// Utility type for VOSI practice field names
export type VosiPracticeField = typeof ALL_VOSI_PRACTICES[number];

// Utility type for initiative type values
export type IssfInitiativeType = typeof issfInitiativeTypeEnum.enumValues[number];
