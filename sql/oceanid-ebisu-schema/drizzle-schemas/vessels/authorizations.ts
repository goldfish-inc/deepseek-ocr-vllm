// drizzle-schemas/vessels/authorizations.ts - Vessel fishing authorizations with FK references
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  boolean,
  jsonb,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { faoMajorAreas, rfmos } from '../reference';
import { harmonizedSpecies } from '../harmonized-species';
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// AUTHORIZATION ENUMS
// ==============================================================================

export const authorizationTypeEnum = pgEnum('authorization_type_enum', [
  'FISHING_AUTHORIZATION',
  'FISHING_LICENSE',
  'TRANSSHIPMENT_AUTHORIZATION',
  'CARRIER_AUTHORIZATION',
  'OBSERVER_AUTHORIZATION',
  'TUNA_AUTHORIZATION',
  'EXEMPT_VESSEL',
  'SUPPORT_VESSEL_AUTHORIZATION',
  'OTHER_AUTHORIZATION'
]);

// ==============================================================================
// VESSEL AUTHORIZATIONS TABLE
// ==============================================================================

// Fishing authorizations, licenses, and permits with enhanced FK relationships
export const vesselAuthorizations = pgTable(
  'vessel_authorizations',
  {
    authorizationUuid: uuid('authorization_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    // AUTHORIZATION DETAILS
    authorizationType: authorizationTypeEnum('authorization_type').notNull(),
    licenseNumber: varchar('license_number', { length: 100 }),
    fishingLicenseType: varchar('fishing_license_type', { length: 100 }),

    // DATE RANGE
    startDate: date('start_date'),
    endDate: date('end_date'),
    reportedDate: date('reported_date'),

    // STATUS AND FLAGS
    status: varchar('status', { length: 50 }),
    isActive: boolean('is_active').default(true),

    // ✅ ENHANCED REGIONAL AUTHORIZATION WITH FK
    rfmoId: uuid('rfmo_id').references(() => rfmos.id), // ✅ FK to rfmos(id)
    regionDescription: text('region_description'),
    faoAreaIds: jsonb('fao_area_ids'), // ✅ JSONB array of UUIDs referencing fao_major_areas.id

    // ✅ ENHANCED SPECIES AUTHORIZATION WITH FK
    speciesDescription: text('species_description'),
    speciesIds: jsonb('species_ids'), // ✅ JSONB array of UUIDs referencing harmonized_species.harmonized_id

    // FLEXIBLE DATA STORAGE FOR SOURCE-SPECIFIC FIELDS
    additionalData: jsonb('additional_data'), // Catch quotas, fleet info, etc.
    contextData: jsonb('context_data'), // Processing metadata, notes, etc.

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_authorizations_vessel_idx').on(table.vesselUuid),
    typeIdx: index('vessel_authorizations_type_idx').on(table.authorizationType),
    statusIdx: index('vessel_authorizations_status_idx').on(table.status),
    activeIdx: index('vessel_authorizations_active_idx').on(table.isActive),
    sourceIdx: index('vessel_authorizations_source_idx').on(table.sourceId),

    // Date range queries (common for active authorization lookups)
    dateRangeIdx: index('vessel_authorizations_date_range_idx').on(table.startDate, table.endDate),
    reportedDateIdx: index('vessel_authorizations_reported_date_idx').on(table.reportedDate),

    // ✅ Enhanced FK indexes
    licenseTypeIdx: index('vessel_authorizations_license_type_idx').on(table.fishingLicenseType),
    rfmoIdx: index('vessel_authorizations_rfmo_idx').on(table.rfmoId), // ✅ RFMO FK index

    // ✅ JSONB indexes for UUID arrays (performance critical)
    faoAreasIdx: index('vessel_authorizations_fao_areas_idx').using('gin', table.faoAreaIds), // ✅ FAO areas array
    speciesIdsIdx: index('vessel_authorizations_species_ids_idx').using('gin', table.speciesIds), // ✅ Species array

    // Specific indexes for commonly queried additional data fields
    quotaBftIdx: index('vessel_authorizations_quota_bft_idx').on(table.additionalData.op('->>', 'catch_quota_bft')),
    quotaYearIdx: index('vessel_authorizations_quota_year_idx').on(table.additionalData.op('->>', 'catch_quota_bft_year')),
    ffaRegistrantIdx: index('vessel_authorizations_ffa_registrant_idx').on(table.additionalData.op('->>', 'ffa_registrant')),

    // Composite indexes for complex queries
    vesselActiveIdx: index('vessel_authorizations_vessel_active_idx').on(table.vesselUuid, table.isActive),
    typeActiveIdx: index('vessel_authorizations_type_active_idx').on(table.authorizationType, table.isActive),
    rfmoActiveIdx: index('vessel_authorizations_rfmo_active_idx').on(table.rfmoId, table.isActive), // ✅ RFMO + active
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselAuthorizations = typeof vesselAuthorizations.$inferSelect;
export type NewVesselAuthorizations = typeof vesselAuthorizations.$inferInsert;

// ==============================================================================
// JSONB ARRAY TYPES FOR UUID REFERENCES
// ==============================================================================

// Type for species_ids JSONB array - contains UUIDs referencing harmonized_species.harmonized_id
export type SpeciesIdsArray = string[]; // Array of UUID strings

// Type for fao_area_ids JSONB array - contains UUIDs referencing fao_major_areas.id
export type FaoAreaIdsArray = string[]; // Array of UUID strings

// Enhanced type for authorization with proper typing for JSONB arrays
export interface VesselAuthorizationWithTypedArrays extends Omit<VesselAuthorizations, 'speciesIds' | 'faoAreaIds'> {
  speciesIds?: SpeciesIdsArray | null;
  faoAreaIds?: FaoAreaIdsArray | null;
}

// ==============================================================================
// VALIDATION HELPERS (Type definitions for application layer)
// ==============================================================================

// Helper types for validation functions (to be implemented in application layer)
export interface AuthorizationValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SpeciesValidationResult {
  validSpeciesIds: string[];
  invalidSpeciesIds: string[];
  missingSpecies: string[];
}

export interface FaoAreaValidationResult {
  validAreaIds: string[];
  invalidAreaIds: string[];
  missingAreas: string[];
}

// ==============================================================================
// CONSTANTS FOR JSONB ARRAY VALIDATION
// ==============================================================================

// Maximum number of species/areas per authorization (for application validation)
export const MAX_SPECIES_PER_AUTHORIZATION = 50;
export const MAX_FAO_AREAS_PER_AUTHORIZATION = 20;

// Common authorization patterns
export const AUTHORIZATION_PATTERNS = {
  // Species patterns
  HIGHLY_MIGRATORY: 'HIGHLY_MIGRATORY_SPECIES',
  TUNA_SPECIES: 'TUNA_AND_TUNA_LIKE_SPECIES',
  ALL_SPECIES: 'ALL_AUTHORIZED_SPECIES',

  // Area patterns
  HIGH_SEAS: 'HIGH_SEAS_AREAS',
  EEZ_ONLY: 'EXCLUSIVE_ECONOMIC_ZONE',
  REGIONAL_WATERS: 'REGIONAL_FISHING_WATERS',
} as const;
