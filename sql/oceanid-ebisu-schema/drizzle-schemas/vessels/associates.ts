// drizzle-schemas/vessels/associates.ts - Vessel associates with deduplication support (WRO ref removed)
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  json,
  timestamp,
  decimal,
  date,
  index,
  unique
} from 'drizzle-orm/pg-core';

// Import reference tables for FK references
import { countryIso } from '../reference';
import { vessels } from './core';
import { originalSourcesVessels } from './sources';
import { vesselsSdnSimple } from './sdn';

// ==============================================================================
// ASSOCIATES ENUMS
// ==============================================================================

export const associateTypeEnum = pgEnum('associate_type_enum', [
  'BENEFICIAL_OWNER',
  'CHARTERER',
  'FISH_MASTER',
  'FISH_PRODUCER_ORGANIZATION',
  'OPERATING_COMPANY',
  'OPERATOR',
  'OTHER_BENEFICIARY',
  'OWNER',
  'OWNING_COMPANY',
  'SDN_LINKED_ENTITY',
  'VESSEL_MASTER'
]);

// ==============================================================================
// VESSEL ASSOCIATES MASTER TABLE (Deduplicated Entities)
// ==============================================================================

export const vesselAssociatesMaster = pgTable(
  'vessel_associates_master',
  {
    associateMasterUuid: uuid('associate_master_uuid').primaryKey().defaultRandom(),

    // Canonical (normalized) name for deduplication
    canonicalName: varchar('canonical_name', { length: 200 }).notNull(),

    // Track all name variations seen across sources
    nameVariations: json('name_variations'), // JSONB for all spellings seen

    // Optional enhanced data (populated from highest-quality source)
    primaryAddress: text('primary_address'),
    primaryCity: varchar('primary_city', { length: 150 }),
    primaryState: varchar('primary_state', { length: 150 }),
    primaryCountryId: uuid('primary_country_id').references(() => countryIso.id),

    // Metadata for master record management
    sourceCount: decimal('source_count').default('1'), // How many sources mention this entity
    lastSeenDate: date('last_seen_date').defaultNow(),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }).default('1.00'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    canonicalNameIdx: index('vessel_associates_master_canonical_idx').on(table.canonicalName),
    primaryCountryIdx: index('vessel_associates_master_country_idx').on(table.primaryCountryId),
    confidenceIdx: index('vessel_associates_master_confidence_idx').on(table.confidenceScore),
    lastSeenIdx: index('vessel_associates_master_last_seen_idx').on(table.lastSeenDate),

    // GIN index for name variations search
    nameVariationsGinIdx: index('vessel_associates_master_name_variations_gin_idx').using('gin', table.nameVariations),

    // Unique constraint on canonical name to prevent duplicates
    uniqueCanonicalName: unique('vessel_associates_master_canonical_unique').on(table.canonicalName),
  })
);

// ==============================================================================
// VESSEL ASSOCIATES TABLE (Cleaned - WRO reference removed)
// ==============================================================================

export const vesselAssociates = pgTable(
  'vessel_associates',
  {
    associateUuid: uuid('associate_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid),
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId),

    // Reference to deduplicated master record
    associateMasterUuid: uuid('associate_master_uuid').notNull().references(() => vesselAssociatesMaster.associateMasterUuid),

    // Relationship-specific data (NOT in master table)
    associateType: associateTypeEnum('associate_type').notNull(),

    // Original data as reported by source (for audit trail)
    originalName: varchar('original_name', { length: 200 }).notNull(), // Exact spelling from source
    address: text('address'),

    // Enhanced address components
    city: varchar('city', { length: 150 }),
    state: varchar('state', { length: 150 }),
    countryId: uuid('country_id').references(() => countryIso.id),

    // Registration/license number (can be vessel-specific)
    regNumber: varchar('reg_number', { length: 150 }),

    // Nationality (can be different from address country)
    nationalityCountryId: uuid('nationality_country_id').references(() => countryIso.id),

    // SDN linking capability (source-specific)
    sdnUuid: uuid('sdn_uuid').references(() => vesselsSdnSimple.sdnUuid),

    // NOTE: WRO reference removed - now handled by polymorphic wro_enforcement table

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Primary indexes
    vesselIdx: index('vessel_associates_vessel_idx').on(table.vesselUuid),
    masterIdx: index('vessel_associates_master_idx').on(table.associateMasterUuid),
    sourceIdx: index('vessel_associates_source_idx').on(table.sourceId),
    typeIdx: index('vessel_associates_type_idx').on(table.associateType),

    // Enhanced indexes for location and details
    countryIdx: index('vessel_associates_country_idx').on(table.countryId),
    nationalityIdx: index('vessel_associates_nationality_idx').on(table.nationalityCountryId),
    originalNameIdx: index('vessel_associates_original_name_idx').on(table.originalName),
    cityIdx: index('vessel_associates_city_idx').on(table.city),
    regNumberIdx: index('vessel_associates_reg_number_idx').on(table.regNumber),
    sdnIdx: index('vessel_associates_sdn_idx').on(table.sdnUuid),

    // Composite indexes for complex queries
    vesselTypeIdx: index('vessel_associates_vessel_type_idx').on(table.vesselUuid, table.associateType),
    masterTypeIdx: index('vessel_associates_master_type_idx').on(table.associateMasterUuid, table.associateType),
    locationIdx: index('vessel_associates_location_idx').on(table.countryId, table.city, table.state),
    sourceTypeIdx: index('vessel_associates_source_type_idx').on(table.sourceId, table.associateType),

    // Unique constraint to prevent duplicate relationships from same source
    uniqueRelationship: unique('vessel_associates_unique_relationship').on(
      table.vesselUuid,
      table.associateMasterUuid,
      table.sourceId,
      table.associateType
    ),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselAssociatesMaster = typeof vesselAssociatesMaster.$inferSelect;
export type NewVesselAssociatesMaster = typeof vesselAssociatesMaster.$inferInsert;

export type VesselAssociates = typeof vesselAssociates.$inferSelect;
export type NewVesselAssociates = typeof vesselAssociates.$inferInsert;
