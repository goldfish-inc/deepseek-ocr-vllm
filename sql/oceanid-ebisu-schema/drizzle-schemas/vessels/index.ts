// drizzle-schemas/vessels/index.ts - Main export file for vessels domain (11 intuitive groupings)
// This file provides a clean interface to all vessel tables, organized by intuitive groupings

// ==============================================================================
// GROUP 1: VESSEL SOURCES
// ==============================================================================
export {
  // Tables
  originalSourcesVessels,

  // Types
  type OriginalSourcesVessels,
  type NewOriginalSourcesVessels
} from './sources';

// ==============================================================================
// GROUP 2: CORE VESSEL DATA
// ==============================================================================
export {
  // Tables
  vessels,
  vesselInfo,
  vesselMetrics,
  vesselBuildInformation,
  vesselExternalIdentifiers,

  // Enums
  hullMaterialEnum,
  unitEnum,
  metricTypeEnum,
  externalIdentifierTypeEnum,

  // Types
  type Vessels,
  type NewVessels,
  type VesselInfo,
  type NewVesselInfo,
  type VesselMetrics,
  type NewVesselMetrics,
  type VesselBuildInformation,
  type NewVesselBuildInformation,
  type VesselExternalIdentifiers,
  type NewVesselExternalIdentifiers
} from './core';

// ==============================================================================
// GROUP 3: EQUIPMENT AND ATTRIBUTES
// ==============================================================================
export {
  // Tables
  vesselEquipment,
  vesselAttributes,

  // Enums
  freezerTypeEnum,

  // Types
  type VesselEquipment,
  type NewVesselEquipment,
  type VesselAttributes,
  type NewVesselAttributes,
  type FreezerType,
  type FreezerTypesArray,
  type VesselEquipmentWithTypedArrays
} from './equipment';

// ==============================================================================
// GROUP 4: SOURCE TRACKING AND CLASSIFICATIONS
// ==============================================================================
export {
  // Tables
  vesselSources,
  vesselSourceIdentifiers,
  vesselVesselTypes,
  vesselGearTypes,

  // Enums
  identifierTypeEnum,

  // Types
  type VesselSources,
  type NewVesselSources,
  type VesselSourceIdentifiers,
  type NewVesselSourceIdentifiers,
  type VesselVesselTypes,
  type NewVesselVesselTypes,
  type VesselGearTypes,
  type NewVesselGearTypes
} from './tracking';

// ==============================================================================
// GROUP 5: VESSEL ASSOCIATES
// ==============================================================================
export {
  // Tables
  vesselAssociates,

  // Enums
  associateTypeEnum,

  // Types
  type VesselAssociates,
  type NewVesselAssociates
} from './associates';

// ==============================================================================
// GROUP 6: VESSEL AUTHORIZATIONS
// ==============================================================================
export {
  // Tables
  vesselAuthorizations,

  // Enums
  authorizationTypeEnum,

  // Types
  type VesselAuthorizations,
  type NewVesselAuthorizations
} from './authorizations';

// ==============================================================================
// GROUP 7: VESSEL HISTORY
// ==============================================================================
export {
  // Tables
  vesselReportedHistory,

  // Enums
  reportedHistoryEnum,

  // Types
  type VesselReportedHistory,
  type NewVesselReportedHistory
} from './history';

// ==============================================================================
// GROUP 8: ICCAT STAGING
// ==============================================================================
export {
  // Tables
  stagingIccatVessels,

  // Types
  type StagingIccatVessels,
  type NewStagingIccatVessels
} from './staging';

// ==============================================================================
// GROUP 9: COMPLIANCE AND INVESTIGATIONS
// ==============================================================================
export {
  // Tables
  vesselsSdnSimple,

  // Types
  type VesselsSdnSimple,
  type NewVesselsSdnSimple
} from './sdn';

export {
  // Tables
  vesselsIuuSimple,

  // Types
  type VesselsIuuSimple,
  type NewVesselsIuuSimple,
  type ListedIuuArray,
  type VesselsIuuSimpleWithTypedArrays
} from './iuu';

export {
  // Tables
  vesselsOutlawOcean,

  // Enums
  crimeTypeEnum,

  // Types
  type VesselsOutlawOcean,
  type NewVesselsOutlawOcean,
  type CrimesArray,
  type VesselsOutlawOceanWithTypedArrays
} from './outlaw-ocean';

// ==============================================================================
// GROUP 10: ISSF PROGRAMS (COMBINED)
// ==============================================================================
export {
  // Tables
  vesselsIssfPvr,
  vesselsIssfVosi,
  vesselsIssfInitiatives,

  // Enums
  issfInitiativeTypeEnum,

  // Types
  type VesselsIssfPvr,
  type NewVesselsIssfPvr,
  type VesselsIssfVosi,
  type NewVesselsIssfVosi,
  type VesselsIssfInitiatives,
  type NewVesselsIssfInitiatives,
  type ComplianceFlagField,
  type VosiPracticeField,
  type IssfInitiativeType
} from './issf';

// ==============================================================================
// GROUP 11: CERTIFICATIONS AND PROGRAMS
// ==============================================================================
export {
  // Tables
  vesselsQuickBoolean,

  // Types
  type VesselsQuickBoolean,
  type NewVesselsQuickBoolean,
  type BooleanFlagField
} from './quick-boolean';

export {
  // Tables
  vesselsMsc,

  // Types
  type VesselsMsc,
  type NewVesselsMsc,
  type MscCertificationStatus
} from './msc';

// ==============================================================================
// GROUP 12: ADDITIONAL REGISTRIES
// ==============================================================================
export {
  // Tables
  vesselsMex,

  // Enums
  mexUseTypeSpanishEnum,
  mexOperationSpanishEnum,
  mexSpeciesGroupSpanishEnum,
  mexHullTypeSpanishEnum,
  mexGearTypeSpanishEnum,
  mexDetectionEquipmentSpanishEnum,
  mexStorageMethodSpanishEnum,

  // Types
  type VesselsMex,
  type NewVesselsMex,
  type MexGearTypeSpanishArray,
  type VesselsMexWithTypedArrays,
  type MexUseTypeSpanish,
  type MexOperationSpanish,
  type MexSpeciesGroupSpanish,
  type MexHullTypeSpanish,
  type MexGearTypeSpanish,
  type MexStorageMethodSpanish,
  type MexDetectionEquipmentSpanish
} from './additional';

// ==============================================================================
// RELATIONS EXPORTS
// ==============================================================================
export {
  originalSourcesVesselsRelations,
  vesselsRelations,
  vesselInfoRelations,
  vesselMetricsRelations,
  vesselBuildInformationRelations,
  vesselExternalIdentifiersRelations,
  vesselEquipmentRelations,
  vesselAttributesRelations,
  vesselSourcesRelations,
  vesselSourceIdentifiersRelations,
  vesselVesselTypesRelations,
  vesselGearTypesRelations,
  vesselAssociatesRelations,
  vesselAuthorizationsRelations,
  vesselReportedHistoryRelations
} from './relations';

// ==============================================================================
// DOMAIN METADATA AND UTILITIES (UPDATED)
// ==============================================================================

// All vessel table names organized by intuitive groupings
export const vesselTablesByGroup = {
  sources: ['original_sources_vessels'],
  core: ['vessels', 'vessel_info', 'vessel_metrics', 'vessel_build_information', 'vessel_external_identifiers'],
  equipment: ['vessel_equipment', 'vessel_attributes'],
  tracking: ['vessel_sources', 'vessel_source_identifiers', 'vessel_vessel_types', 'vessel_gear_types'],
  associates: ['vessel_associates'],
  authorizations: ['vessel_authorizations'],
  history: ['vessel_reported_history'],
  staging: ['staging_iccat_vessels'],
  compliance: ['vessels_sdn_simple', 'vessels_iuu_simple', 'vessels_outlaw_ocean'],
  issf: ['vessels_issf_pvr', 'vessels_issf_vosi', 'vessels_issf_initiatives'],
  certifications: ['vessels_quick_boolean', 'vessels_msc'],
  additional: ['vessels_mex']
} as const;

// Flattened array of all vessel table names
export const vesselTableNames = [
  ...vesselTablesByGroup.sources,
  ...vesselTablesByGroup.core,
  ...vesselTablesByGroup.equipment,
  ...vesselTablesByGroup.tracking,
  ...vesselTablesByGroup.associates,
  ...vesselTablesByGroup.authorizations,
  ...vesselTablesByGroup.history,
  ...vesselTablesByGroup.staging,
  ...vesselTablesByGroup.compliance,
  ...vesselTablesByGroup.issf,
  ...vesselTablesByGroup.certifications
] as const;

// Domain statistics (UPDATED)
export const VESSEL_DOMAIN_STATS = {
  totalTables: vesselTableNames.length, // Should be 25 tables now
  totalGroups: 12,
  coreTable: 'vessels',
  primaryKey: 'vessel_uuid',
  sourceTracking: true,
  stagingSupported: true,
  relationsMapped: true,
  complianceTracking: true,
  certificationTracking: true,
  issfIntegration: true,
  internationalRegistries: true
} as const;

// Core vessel identifier fields for queries and validation
export const vesselIdentifierFields = [
  'vessel_name',
  'imo',
  'ircs',
  'mmsi',
  'national_registry',
  'eu_cfr'
] as const;

// Vessel source types for validation and categorization
export const vesselSourceTypes = [
  'VESSEL_REGISTRY',
  'RFMO_VESSELS',
  'NATIONAL_REGISTRY',
  'FLEET_REGISTER',
  'IUU_LIST',
  'AUTHORIZATION_LIST',
  'SURVEILLANCE_SYSTEM',
  'INSPECTION_REPORT',
  'SDN_LIST',
  'COMPLIANCE_DATABASE',
  'ISSF_DATABASE',
  'MSC_DATABASE',
  'CERTIFICATION_BODY',
  'INVESTIGATION_REPORT',
  'MEXICAN_REGISTRY',
  'INTERNATIONAL_REGISTRY',
  'OTHER'
] as const;

// Authorization types for quick reference
export const authorizationCategories = [
  'FISHING_AUTHORIZATION',
  'FISHING_LICENSE',
  'TRANSSHIPMENT_AUTHORIZATION',
  'CARRIER_AUTHORIZATION',
  'OBSERVER_AUTHORIZATION',
  'TUNA_AUTHORIZATION'
] as const;

// Compliance and investigation categories (NEW)
export const complianceCategories = {
  sdn: ['SPECIALLY_DESIGNATED_NATIONALS'],
  iuu: ['ILLEGAL_FISHING', 'UNREPORTED_FISHING', 'UNREGULATED_FISHING'],
  investigations: ['OUTLAW_OCEAN', 'LABOR_VIOLATIONS', 'ENVIRONMENTAL_CRIMES']
} as const;

// ISSF program categories (NEW)
export const issfProgramCategories = {
  pvr: ['PROACTIVE_VESSEL_REGISTER'],
  vosi: ['VESSEL_ONLINE_SURVEY_INITIATIVE'],
  initiatives: ['CONSERVATION_INITIATIVES', 'SUSTAINABILITY_PROGRAMS']
} as const;

// Certification program categories (NEW)
export const certificationProgramCategories = {
  sustainability: ['MSC', 'FAIRTRADE', 'FIP'],
  management: ['ISSF', 'ITM', 'CPIB'],
  compliance: ['PVR', 'VOSI', 'UVI']
} as const;

// International registry categories (NEW)
export const internationalRegistryCategories = {
  mexican: ['COMERCIAL', 'INVESTIGACION'],
  spanish_language: ['MEX_REGISTRY'],
  multilingual: ['INTERNATIONAL_REGISTRIES']
} as const;

// External identifier types grouped by category
export const externalIdentifierCategories = {
  rfmo: [
    'RFMO_ICCAT', 'RFMO_WCPFC', 'RFMO_IATTC', 'RFMO_IOTC', 'RFMO_CCAMLR',
    'RFMO_NAFO', 'RFMO_NEAFC', 'RFMO_SEAFO', 'RFMO_SPRFMO', 'RFMO_NPFC', 'RFMO_SIOFA'
  ],
  national: [
    'NATIONAL_USA', 'NATIONAL_CHINA', 'NATIONAL_JAPAN', 'NATIONAL_KOREA',
    'NATIONAL_EU', 'NATIONAL_RUSSIA', 'NATIONAL_OTHER'
  ],
  regional: [
    'REGIONAL_FFA', 'REGIONAL_WCPFC', 'REGIONAL_OTHER'
  ],
  other: [
    'PORT_ID', 'COMPANY_INTERNAL', 'CLASSIFICATION_SOCIETY',
    'INSURANCE_ID', 'CUSTOMS_ID', 'OTHER'
  ]
} as const;

// Equipment categories (NEW)
export const equipmentCategories = {
  freezerTypes: [
    'AIR_BLAST', 'AIR_COIL', 'BAIT_FREEZER', 'BLAST', 'BRINE', 'CHILLED', 'COIL',
    'DIRECT_EXPANSION', 'DRY', 'FREON_REFRIGERATION_SYSTEM', 'GRID_COIL', 'ICE',
    'MYKOM', 'OTHER', 'PIPE', 'PLATE_FREEZER', 'RSW', 'SEMI_AIR_BLAST', 'TUNNEL'
  ]
} as const;

// Unit categories (UPDATED)
export const unitCategories = {
  length: ['METER', 'FEET'],
  volume: ['CUBIC_FEET', 'CUBIC_METER', 'LITER', 'GALLON'],
  power: ['HP', 'KW', 'PS'],
  speed: ['KNOTS', 'MPH', 'KMH'],
  freezer: ['METRIC_TONS / DAY', 'TONS / DAY']
} as const;

// ==============================================================================
// TYPE UTILITIES (UPDATED)
// ==============================================================================

// Utility type for vessel identifier field names
export type VesselIdentifierField = typeof vesselIdentifierFields[number];

// Utility type for vessel source types
export type VesselSourceType = typeof vesselSourceTypes[number];

// Utility type for all vessel table names
export type VesselTableName = typeof vesselTableNames[number];

// Union type of all authorization categories
export type AuthorizationCategory = typeof authorizationCategories[number];

// Utility type for table groups (UPDATED)
export type VesselTableGroup = keyof typeof vesselTablesByGroup;

// New utility types for compliance and certifications
export type ComplianceCategory = keyof typeof complianceCategories;
export type IssfProgramCategory = keyof typeof issfProgramCategories;
export type CertificationProgramCategory = keyof typeof certificationProgramCategories;

// Equipment category utility types
export type EquipmentCategory = keyof typeof equipmentCategories;
export type UnitCategory = keyof typeof unitCategories;
