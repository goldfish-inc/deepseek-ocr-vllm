// drizzle-schemas/vessels/sdn.ts - Vessel SDN (Specially Designated Nationals) tracking
import {
  pgTable,
  uuid,
  boolean,
  date,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// VESSEL SDN TABLE
// ==============================================================================

// SDN (Specially Designated Nationals) tracking for vessels
export const vesselsSdnSimple = pgTable(
  'vessels_sdn_simple',
  {
    sdnUuid: uuid('sdn_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    isSdn: boolean('is_sdn').notNull().default(false),
    dateIssuedSdn: date('date_issued_sdn'), // DATE format YYYY-MM-DD

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_sdn_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_sdn_source_idx').on(table.sourceId),
    isSdnIdx: index('vessels_sdn_is_sdn_idx').on(table.isSdn),
    dateIssuedIdx: index('vessels_sdn_date_issued_idx').on(table.dateIssuedSdn),
    // Composite index for active SDN lookups
    vesselActiveIdx: index('vessels_sdn_vessel_active_idx').on(table.vesselUuid, table.isSdn),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsSdnSimple = typeof vesselsSdnSimple.$inferSelect;
export type NewVesselsSdnSimple = typeof vesselsSdnSimple.$inferInsert;
