// drizzle-schemas/vessels/staging.ts - ICCAT vessel staging table for batch imports
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  date,
  timestamp,
  boolean,
  jsonb,
  index
} from 'drizzle-orm/pg-core';

// ==============================================================================
// ICCAT VESSEL STAGING TABLE
// ==============================================================================

// Staging table specifically for ICCAT vessel imports
export const stagingIccatVessels = pgTable(
  'staging_iccat_vessels',
  {
    // STAGING METADATA
    stagingId: uuid('staging_id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id'), // Groups records from same import batch
    processed: boolean('processed').default(false),

    // SOURCE DATA IDENTIFIERS
    sourceVesselId: varchar('source_vessel_id', { length: 100 }), // Original ID from ICCAT

    // RAW VESSEL DATA (as received from source)
    vesselName: text('vessel_name'),
    flagState: varchar('flag_state', { length: 5 }), // ISO country code
    imo: varchar('imo', { length: 20 }), // Allow varchar for validation
    ircs: varchar('ircs', { length: 20 }),
    mmsi: varchar('mmsi', { length: 15 }),
    vesselType: varchar('vessel_type', { length: 100 }),
    gearType: varchar('gear_type', { length: 100 }),
    buildYear: integer('build_year'),
    tonnage: varchar('tonnage', { length: 50 }), // Keep as text for parsing
    length: varchar('length', { length: 50 }), // Keep as text for parsing

    // ICCAT-SPECIFIC FIELDS
    iccatNumber: varchar('iccat_number', { length: 50 }),
    activityFlag: varchar('activity_flag', { length: 10 }), // 'ACTIVE', 'INACTIVE', etc.
    status: varchar('status', { length: 50 }),

    // AUTHORIZATION DATA
    authStartDate: date('auth_start_date'),
    authEndDate: date('auth_end_date'),
    species: text('species'), // Raw species list from source
    fishingArea: text('fishing_area'), // Raw fishing areas from source

    // RAW DATA PRESERVATION
    rawData: jsonb('raw_data'), // Complete original record as JSONB

    // PROCESSING METADATA
    errorLog: text('error_log'), // Validation and processing errors
    processingNotes: text('processing_notes'), // Manual notes
    importedAt: timestamp('imported_at').defaultNow(),
  },
  (table) => ({
    // Core processing indexes
    processedIdx: index('staging_iccat_processed_idx').on(table.processed),
    batchIdx: index('staging_iccat_batch_idx').on(table.batchId),
    importedIdx: index('staging_iccat_imported_idx').on(table.importedAt),

    // Lookup indexes for deduplication and matching
    sourceVesselIdx: index('staging_iccat_source_vessel_idx').on(table.sourceVesselId),
    iccatNumberIdx: index('staging_iccat_number_idx').on(table.iccatNumber),

    // Query indexes for data analysis
    flagIdx: index('staging_iccat_flag_idx').on(table.flagState),
    activityIdx: index('staging_iccat_activity_idx').on(table.activityFlag),

    // Composite indexes for processing workflows
    batchProcessedIdx: index('staging_iccat_batch_processed_idx').on(table.batchId, table.processed),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type StagingIccatVessels = typeof stagingIccatVessels.$inferSelect;
export type NewStagingIccatVessels = typeof stagingIccatVessels.$inferInsert;
