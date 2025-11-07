import { pgTable, uuid, text, boolean, date, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ✅ WORKING IMPLEMENTATION - Successfully tested with 249 records each table
import { originalSources, countryIso } from './reference'

// Country Flag of Convenience Table
export const countryIsoFoc = pgTable(
  'country_iso_foc',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countryIso.id, { onDelete: 'cascade' }),
    alpha3Code: text('alpha_3_code'), // Keep for reference and debugging
    isFoc: boolean('is_foc').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Indexes for performance
    countryIdx: index('idx_country_foc_country').on(table.countryId),
    statusIdx: index('idx_country_foc_status').on(table.isFoc),
    sourceIdx: index('idx_country_foc_source').on(table.sourceId),
    alpha3Idx: index('idx_country_foc_alpha3').on(table.alpha3Code),

    // Unique constraint - each country can only have one FOC status
    uniqueCountry: unique('uk_country_foc').on(table.countryId),
  })
)

// Country ILO Convention C188 Table
export const countryIsoIloC188 = pgTable(
  'country_iso_ilo_c188',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countryIso.id, { onDelete: 'cascade' }),
    alpha3Code: text('alpha_3_code'), // Keep for reference and debugging
    isC188Ratified: boolean('is_c188_ratified').notNull(),
    dateEnteredForce: date('date_entered_force'),
    dateRatified: date('date_ratified'),
    dateFutureEnterForceBy: date('date_future_enter_force_by'),
    conventionOrg: text('convention_org'),
    conventionShortname: text('convention_shortname'),
    conventionFullname: text('convention_fullname'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Indexes for performance
    countryIdx: index('idx_country_ilo_c188_country').on(table.countryId),
    statusIdx: index('idx_country_ilo_c188_status').on(table.isC188Ratified),
    sourceIdx: index('idx_country_ilo_c188_source').on(table.sourceId),
    alpha3Idx: index('idx_country_ilo_c188_alpha3').on(table.alpha3Code),
    orgIdx: index('idx_country_ilo_c188_org').on(table.conventionOrg),

    // Unique constraint - each country can only have one C188 status
    uniqueCountry: unique('uk_country_ilo_c188').on(table.countryId),
  })
)

// Relations
export const countryIsoFocRelations = relations(countryIsoFoc, ({ one }) => ({
  // Relationship to country
  country: one(countryIso, {
    fields: [countryIsoFoc.countryId],
    references: [countryIso.id],
  }),
  // Relationship to source
  source: one(originalSources, {
    fields: [countryIsoFoc.sourceId],
    references: [originalSources.sourceId],
  }),
}))

export const countryIsoIloC188Relations = relations(countryIsoIloC188, ({ one }) => ({
  // Relationship to country
  country: one(countryIso, {
    fields: [countryIsoIloC188.countryId],
    references: [countryIso.id],
  }),
  // Relationship to source
  source: one(originalSources, {
    fields: [countryIsoIloC188.sourceId],
    references: [originalSources.sourceId],
  }),
}))

// Extend country relations to include profile data
export const countryIsoProfileRelations = relations(countryIso, ({ one }) => ({
  // One-to-one relationships with profile data
  focStatus: one(countryIsoFoc, {
    fields: [countryIso.id],
    references: [countryIsoFoc.countryId],
  }),
  iloC188Status: one(countryIsoIloC188, {
    fields: [countryIso.id],
    references: [countryIsoIloC188.countryId],
  }),
}))

// Type exports for use in queries
export type CountryIsoFoc = typeof countryIsoFoc.$inferSelect
export type NewCountryIsoFoc = typeof countryIsoFoc.$inferInsert

export type CountryIsoIloC188 = typeof countryIsoIloC188.$inferSelect
export type NewCountryIsoIloC188 = typeof countryIsoIloC188.$inferInsert

// Query helpers
export type CountryProfileComplete = CountryIsoFoc & {
  country: typeof countryIso.$inferSelect
  source: typeof originalSources.$inferSelect
  iloC188Status?: CountryIsoIloC188
}

// Example usage types for API responses
export interface CountryProfileSummary {
  countryId: string
  countryName: string
  alpha3Code: string
  isFoc: boolean
  isC188Ratified: boolean
  c188DateRatified?: Date
  focSource: string
  iloSource: string
}

// Example query builder helpers
export interface CountryProfileFilters {
  isFoc?: boolean
  isC188Ratified?: boolean
  alpha3Codes?: string[]
  conventionOrg?: string
}

export interface CountryProfileQueryOptions {
  includeSource?: boolean
  includeCountryDetails?: boolean
  filters?: CountryProfileFilters
  limit?: number
  offset?: number
}
