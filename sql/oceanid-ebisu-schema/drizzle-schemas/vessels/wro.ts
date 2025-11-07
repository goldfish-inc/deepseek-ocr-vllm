// drizzle-schemas/vessels/wro.ts - Polymorphic WRO enforcement for vessels and companies
import {
  pgTable,
  uuid,
  boolean,
  date,
  varchar,
  timestamp,
  jsonb,
  index,
  check,
  sql
} from 'drizzle-orm/pg-core';

// Import reference tables for FK relationships
import { vessels } from './core';
import { originalSourcesVessels } from './sources';
import { vesselAssociatesMaster } from './associates';

// ==============================================================================
// POLYMORPHIC WRO ENFORCEMENT TABLE
// ==============================================================================

// WRO (US Withhold Release Orders) - handles both vessel-specific and company-specific enforcement
export const wroEnforcement = pgTable(
  'wro_enforcement',
  {
    wroUuid: uuid('wro_uuid').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull().references(() => originalSourcesVessels.sourceId),

    // Polymorphic relationship - EITHER vessel OR company, never both
    vesselUuid: uuid('vessel_uuid').references(() => vessels.vesselUuid), // Nullable - for vessel-specific WROs
    associateMasterUuid: uuid('associate_master_uuid').references(() => vesselAssociatesMaster.associateMasterUuid), // Nullable - for company-specific WROs

    // WRO enforcement data (single source of truth)
    isWro: boolean('is_wro').notNull().default(false),
    wroEffectiveDate: date('wro_effective_date'), // DATE format YYYY-MM-DD
    wroEndDate: date('wro_end_date'), // DATE format YYYY-MM-DD
    wroReason: varchar('wro_reason', { length: 50 }),
    wroDetails: varchar('wro_details', { length: 500 }),

    isFinding: boolean('is_finding').notNull().default(false),
    findingDate: date('finding_date'), // DATE format YYYY-MM-DD

    // Contextual metadata
    merchandise: varchar('merchandise', { length: 150 }),
    industry: varchar('industry', { length: 150 }),
    detailUrls: jsonb('detail_urls'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Core indexes for both query patterns
    vesselIdx: index('wro_enforcement_vessel_idx').on(table.vesselUuid),
    associateIdx: index('wro_enforcement_associate_idx').on(table.associateMasterUuid),
    sourceIdx: index('wro_enforcement_source_idx').on(table.sourceId),

    // WRO status indexes
    isWroIdx: index('wro_enforcement_is_wro_idx').on(table.isWro),
    wroEffectiveDateIdx: index('wro_enforcement_wro_effective_date_idx').on(table.wroEffectiveDate),
    wroEndDateIdx: index('wro_enforcement_wro_end_date_idx').on(table.wroEndDate),
    isFindingIdx: index('wro_enforcement_is_finding_idx').on(table.isFinding),
    findingDateIdx: index('wro_enforcement_finding_date_idx').on(table.findingDate),

    // Contextual indexes
    merchandiseIdx: index('wro_enforcement_merchandise_idx').on(table.merchandise),
    industryIdx: index('wro_enforcement_industry_idx').on(table.industry),

    // Composite indexes for common query patterns
    vesselActiveIdx: index('wro_enforcement_vessel_active_idx').on(table.vesselUuid, table.isWro),
    associateActiveIdx: index('wro_enforcement_associate_active_idx').on(table.associateMasterUuid, table.isWro),
    wroFindingIdx: index('wro_enforcement_wro_finding_idx').on(table.isWro, table.isFinding),
    dateRangeIdx: index('wro_enforcement_date_range_idx').on(table.wroEffectiveDate, table.wroEndDate),
    industryMerchandiseIdx: index('wro_enforcement_industry_merchandise_idx').on(table.industry, table.merchandise),

    // GIN index for JSONB detail URLs
    detailUrlsGinIdx: index('wro_enforcement_detail_urls_gin_idx').using('gin', table.detailUrls),

    // CRITICAL: Polymorphic constraint - exactly one of vessel_uuid OR associate_master_uuid must be non-null
    polymorphicConstraint: check(
      'wro_enforcement_polymorphic_check',
      sql`(
        (vessel_uuid IS NOT NULL AND associate_master_uuid IS NULL) OR
        (vessel_uuid IS NULL AND associate_master_uuid IS NOT NULL)
      )`
    ),

    // Business rule: prevent duplicate enforcement actions for same entity from same source
    uniqueVesselEnforcement: index('wro_enforcement_unique_vessel_source_idx').on(
      table.vesselUuid,
      table.sourceId
    ).where(sql`vessel_uuid IS NOT NULL`),

    uniqueAssociateEnforcement: index('wro_enforcement_unique_associate_source_idx').on(
      table.associateMasterUuid,
      table.sourceId
    ).where(sql`associate_master_uuid IS NOT NULL`),
  })
);

// ==============================================================================
// TYPE EXPORTS
// ==============================================================================

export type WroEnforcement = typeof wroEnforcement.$inferSelect;
export type NewWroEnforcement = typeof wroEnforcement.$inferInsert;

// ==============================================================================
// UTILITY TYPES FOR APPLICATION LOGIC
// ==============================================================================

// Discriminated union types for type safety
export type VesselWroEnforcement = WroEnforcement & {
  vesselUuid: string;
  associateMasterUuid: null;
};

export type CompanyWroEnforcement = WroEnforcement & {
  vesselUuid: null;
  associateMasterUuid: string;
};

// Type guards for runtime checking
export const isVesselWro = (wro: WroEnforcement): wro is VesselWroEnforcement =>
  wro.vesselUuid !== null && wro.associateMasterUuid === null;

export const isCompanyWro = (wro: WroEnforcement): wro is CompanyWroEnforcement =>
  wro.vesselUuid === null && wro.associateMasterUuid !== null;
