// drizzle-schemas/vessels/msc.ts - MSC (Marine Stewardship Council) certification data
import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  index
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';

// ==============================================================================
// VESSEL MSC TABLE
// ==============================================================================

// MSC (Marine Stewardship Council) certification tracking for vessels
export const vesselsMsc = pgTable(
  'vessels_msc',
  {
    mscUuid: uuid('msc_uuid').primaryKey().defaultRandom(),
    vesselUuid: uuid('vessel_uuid').notNull().references(() => vessels.vesselUuid), // ✅ FK to vessels(vessel_uuid)
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId), // ✅ FK to original_sources_vessels(source_id)

    isMsc: boolean('is_msc').default(false), // MSC certification (MSC source only)
    mscFisheryCertCode: uuid('msc_fishery_cert_code'), // FK to msc_fisheries table (when available)

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    vesselIdx: index('vessels_msc_vessel_idx').on(table.vesselUuid),
    sourceIdx: index('vessels_msc_source_idx').on(table.sourceId),
    isMscIdx: index('vessels_msc_is_msc_idx').on(table.isMsc),
    fisheryCertIdx: index('vessels_msc_fishery_cert_idx').on(table.mscFisheryCertCode),
    // Composite index for MSC certified vessels
    vesselCertifiedIdx: index('vessels_msc_vessel_certified_idx').on(table.vesselUuid, table.isMsc),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type VesselsMsc = typeof vesselsMsc.$inferSelect;
export type NewVesselsMsc = typeof vesselsMsc.$inferInsert;

// ==============================================================================
// CONSTANTS FOR VALIDATION AND ANALYSIS
// ==============================================================================

// MSC certification status levels
export const MSC_CERTIFICATION_STATUS = {
  CERTIFIED: 'CERTIFIED',
  IN_ASSESSMENT: 'IN_ASSESSMENT',
  SUSPENDED: 'SUSPENDED',
  WITHDRAWN: 'WITHDRAWN',
  NOT_CERTIFIED: 'NOT_CERTIFIED'
} as const;

// MSC fishery types commonly associated with vessels
export const MSC_FISHERY_TYPES = {
  TUNA: 'TUNA_FISHERIES',
  PELAGIC: 'PELAGIC_FISHERIES',
  DEMERSAL: 'DEMERSAL_FISHERIES',
  CRUSTACEAN: 'CRUSTACEAN_FISHERIES',
  BIVALVE: 'BIVALVE_FISHERIES',
  SALMON: 'SALMON_FISHERIES'
} as const;

// MSC certificate validity patterns
export const MSC_CERTIFICATE_VALIDITY = {
  STANDARD_TERM: 36, // 3 years in months
  MAXIMUM_TERM: 60,  // 5 years in months
  MINIMUM_TERM: 12   // 1 year in months
} as const;

// Data quality indicators for MSC data
export const MSC_DATA_QUALITY_INDICATORS = {
  DIRECT_MSC_SOURCE: 'Source data directly from MSC',
  VERIFIED_THIRD_PARTY: 'Verified by trusted third party',
  UNVERIFIED_THIRD_PARTY: 'Reported by third party, unverified',
  VESSEL_SELF_REPORTED: 'Self-reported by vessel operator'
} as const;

// Utility type for MSC certification status
export type MscCertificationStatus = typeof MSC_CERTIFICATION_STATUS[keyof typeof MSC_CERTIFICATION_STATUS];
