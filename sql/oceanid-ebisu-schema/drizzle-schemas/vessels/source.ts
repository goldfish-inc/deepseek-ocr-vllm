// drizzle-schemas/vessels/sources.ts - Original vessel sources table with year-only DATE fields
import {
  pgTable,
  uuid,
  text,
  date,
  timestamp,
  integer,
  jsonb,
  index,
  unique,
  pgEnum
} from 'drizzle-orm/pg-core';

// ==============================================================================
// VESSEL SOURCE ENUMS
// ==============================================================================

export const vesselSourceTypeEnum = pgEnum('vessel_source_type_enum', [
  'RFMO',
  'RFMO_IUU',
  'COUNTRY',
  'COUNTRY_IUU',
  'INTERGOVERNMENTAL',
  'ORGANIZATION',
  'CERTIFICATION_BODY',
  'CIVIL_SOCIETY',
  'OUTLAW_OCEAN',
  'WRO',
  'SDN_GLOMAG'
]);

export const vesselUpdateFrequencyEnum = pgEnum('vessel_update_frequency_enum', [
  'MONTHLY',
  'ANNUALLY',
  'RANDOM',
  'WEEKLY',
  'BIWEEKLY',
  'DAILY',
  'UNKNOWN'
]);

export const vesselSourceStatusEnum = pgEnum('vessel_source_status_enum', [
  'PENDING',
  'LOADED',
  'FAILED',
  'ARCHIVED'
]);

// ==============================================================================
// VESSEL-SPECIFIC ORIGINAL SOURCES TABLE
// ==============================================================================

export const originalSourcesVessels = pgTable(
  'original_sources_vessels',
  {
    sourceId: uuid('source_id').primaryKey().defaultRandom(),
    sourceShortname: text('source_shortname').notNull(),
    sourceFullname: text('source_fullname').notNull(),
    versionYear: date('version_year'), // ✅ DATE type for year-only (store as 'YYYY-01-01')
    sourceTypes: vesselSourceTypeEnum('source_types').array().notNull(), // Enum array for type safety
    refreshDate: date('refresh_date'),
    sourceUrls: jsonb('source_urls'),
    updateFrequency: vesselUpdateFrequencyEnum('update_frequency'),
    sizeApprox: integer('size_approx'),
    status: vesselSourceStatusEnum('status').default('PENDING'),
    createdAt: timestamp('created_at').defaultNow(),
    lastUpdated: timestamp('last_updated').defaultNow(),

    // Foreign key relationships
    rfmoId: uuid('rfmo_id'), // FK to rfmos(id) for RFMO-specific sources
    countryId: uuid('country_id'), // FK to country_iso(id) for country-specific sources

    // Additional metadata
    metadata: jsonb('metadata')
  },
  (table) => ({
    // GIN indexes for array and JSONB fields
    sourceTypesGinIdx: index('idx_gin_vessel_source_types').using('gin', table.sourceTypes),
    sourceUrlsGinIdx: index('idx_gin_vessel_source_urls').using('gin', table.sourceUrls),
    metadataGinIdx: index('idx_gin_vessel_source_metadata').using('gin', table.metadata),

    // B-tree indexes for common lookups
    shortnameIdx: index('idx_vessel_sources_shortname').on(table.sourceShortname),
    statusIdx: index('idx_vessel_sources_status').on(table.status),
    refreshDateIdx: index('idx_vessel_sources_refresh_date').on(table.refreshDate),
    versionYearIdx: index('idx_vessel_sources_version_year').on(table.versionYear), // ✅ Index for year queries
    updateFreqIdx: index('idx_vessel_sources_update_freq').on(table.updateFrequency),

    // Foreign key indexes
    rfmoIdIdx: index('idx_vessel_sources_rfmo_id').on(table.rfmoId),
    countryIdIdx: index('idx_vessel_sources_country_id').on(table.countryId),

    // Unique constraints
    shortnameUnique: unique('uk_vessel_source_shortname').on(table.sourceShortname),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type OriginalSourcesVessels = typeof originalSourcesVessels.$inferSelect;
export type NewOriginalSourcesVessels = typeof originalSourcesVessels.$inferInsert;

// Enum type exports for use in other files
export type VesselSourceType = typeof vesselSourceTypeEnum.enumValues[number];
export type VesselUpdateFrequency = typeof vesselUpdateFrequencyEnum.enumValues[number];
export type VesselSourceStatus = typeof vesselSourceStatusEnum.enumValues[number];
