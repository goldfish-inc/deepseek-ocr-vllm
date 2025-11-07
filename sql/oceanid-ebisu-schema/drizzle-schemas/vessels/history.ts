// drizzle-schemas/vessels/history.ts - Vessel historical tracking and changes with FK references - FIXED
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

// Import the countryIso table for FK references - FIXED: Added missing import
import { countryIso } from '../reference';
import { vessels } from './core';
import { originalSourcesVessels } from './sources'; // ✅ FIXED: Added missing import

// ==============================================================================
// HISTORY ENUMS
// ==============================================================================

export const reportedHistoryEnum = pgEnum('reported_history_enum', [
  'VESSEL_NAME_CHANGE',
  'FLAG_CHANGE',
  'IMO_CHANGE',
  'IRCS_CHANGE',
  'MMSI_CHANGE',
  'REGISTRY_CHANGE',
  'VESSEL_TYPE_CHANGE',
  'OWNERSHIP_CHANGE',
  'OTHER_CHANGE'
]);

// ==============================================================================
// VESSEL REPORTED HISTORY TABLE
// ==============================================================================

// Historical changes to vessel identifiers and characteristics
export const vesselReportedHistory = pgTable(
  'vessel_reported_history',
  {
    historyUuid: uuid('history_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FIXED: Added FK constraint

    reportedHistoryType: reportedHistoryEnum('reported_history_type').notNull(),
    identifierValue: text('identifier_value'), // The old or new value
    flagCountryId: uuid('flag_country_id').references(() => countryIso.id), // ✅ FK to country_iso(id) - for flag changes

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessel_history_vessel_idx').on(table.vesselUuid),
    typeIdx: index('vessel_history_type_idx').on(table.reportedHistoryType),
    flagIdx: index('vessel_history_flag_idx').on(table.flagCountryId),
    valueIdx: index('vessel_history_value_idx').on(table.identifierValue),
    sourceIdx: index('vessel_history_source_idx').on(table.sourceId), // ✅ FIXED: Index for source FK

    // Composite indexes for historical analysis
    vesselTypeIdx: index('vessel_history_vessel_type_idx').on(table.vesselUuid, table.reportedHistoryType),
    typeCreatedIdx: index('vessel_history_type_created_idx').on(table.reportedHistoryType, table.createdAt),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselReportedHistory = typeof vesselReportedHistory.$inferSelect;
export type NewVesselReportedHistory = typeof vesselReportedHistory.$inferInsert;
