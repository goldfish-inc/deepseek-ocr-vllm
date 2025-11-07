import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  bigint,
  jsonb,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { relations } from 'drizzle-orm'

// Enums for original_sources
export const updateFrequencyEnum = [
  'MONTHLY',
  'ANNUALLY',
  'RANDOM',
  'WEEKLY',
  'DAILY',
  'UNKNOWN',
] as const
export const sourceStatusEnum = ['PENDING', 'LOADED', 'FAILED', 'ARCHIVED'] as const

// ===== CENTRAL SOURCE MANAGEMENT =====

export const originalSources = pgTable(
  'original_sources',
  {
    sourceId: uuid('source_id').primaryKey().defaultRandom(),
    sourceShortname: text('source_shortname').notNull().unique(),
    sourceFullname: text('source_fullname').notNull(),
    versionYear: integer('version_year'),
    sourceTypes: text('source_types').array().notNull(), // Multi-type support
    refreshDate: date('refresh_date'),
    sourceUrls: jsonb('source_urls'), // JSON array of URLs
    updateFrequency: text('update_frequency').$type<(typeof updateFrequencyEnum)[number]>(),
    sizeApprox: bigint('size_approx', { mode: 'number' }),
    status: text('status').$type<(typeof sourceStatusEnum)[number]>().default('PENDING'),
    createdAt: timestamp('created_at').defaultNow(),
    lastUpdated: timestamp('last_updated').defaultNow(),
  },
  (table) => ({
    sourceTypesGinIdx: index('idx_gin_source_types').using('gin', table.sourceTypes),
    sourceUrlsGinIdx: index('idx_gin_source_urls').using('gin', table.sourceUrls),
    shortnameIdx: index('idx_original_sources_shortname').on(table.sourceShortname),
    statusIdx: index('idx_original_sources_status').on(table.status),
    refreshDateIdx: index('idx_original_sources_refresh_date').on(table.refreshDate),
    updateFreqIdx: index('idx_original_sources_update_freq').on(table.updateFrequency),
    sourceTypesCheck: check('chk_source_types_not_empty', sql`array_length(source_types, 1) > 0`),
  })
)

// ===== EXTERNAL REFERENCE TABLES (Source Tracked) =====

export const countryIso = pgTable(
  'country_iso',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    shortNameEn: text('short_name_en').notNull(),
    shortNameFr: text('short_name_fr'),
    alpha2Code: text('alpha_2_code').notNull(),
    alpha3Code: text('alpha_3_code').notNull(),
    numericCode: text('numeric_code').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    alpha2Unique: unique('uk_country_alpha_2').on(table.alpha2Code),
    alpha3Unique: unique('uk_country_alpha_3').on(table.alpha3Code),
    numericUnique: unique('uk_country_numeric').on(table.numericCode),
    numericLengthCheck: check('chk_numeric_code_length', sql`LENGTH(numeric_code) = 3`),
    alpha2Idx: index('idx_country_alpha_2').on(table.alpha2Code),
    alpha3Idx: index('idx_country_alpha_3').on(table.alpha3Code),
    sourceIdx: index('idx_country_source').on(table.sourceId),
  })
)

export const faoMajorAreas = pgTable(
  'fao_major_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    faoMajorArea: text('fao_major_area').notNull(),
    faoMajorAreaName: text('fao_major_area_name').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    faoAreaUnique: unique('uk_fao_major_area').on(table.faoMajorArea),
    faoAreaIdx: index('idx_fao_major_area').on(table.faoMajorArea),
    faoAreasSourceIdx: index('idx_fao_areas_source').on(table.sourceId),
  })
)

export const gearTypesFao = pgTable(
  'gear_types_fao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    faoIsscfgCode: text('fao_isscfg_code').notNull(),
    faoIsscfgAlpha: text('fao_isscfg_alpha'),
    faoIsscfgName: text('fao_isscfg_name').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    faoGearCodeUnique: unique('uk_fao_gear_code').on(table.faoIsscfgCode),
    faoGearAlphaUnique: unique('uk_fao_gear_alpha').on(table.faoIsscfgAlpha),
    faoGearCodeIdx: index('idx_fao_gear_code').on(table.faoIsscfgCode),
    faoGearSourceIdx: index('idx_fao_gear_source').on(table.sourceId),
  })
)

export const gearTypesCbp = pgTable(
  'gear_types_cbp',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    cbpGearCode: text('cbp_gear_code').notNull(),
    cbpGearName: text('cbp_gear_name').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    cbpGearCodeUnique: unique('uk_cbp_gear_code').on(table.cbpGearCode),
    cbpGearCodeIdx: index('idx_cbp_gear_code').on(table.cbpGearCode),
    cbpGearSourceIdx: index('idx_cbp_gear_source').on(table.sourceId),
  })
)

export const vesselTypes = pgTable(
  'vessel_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    vesselTypeCat: text('vessel_type_cat').notNull(),
    vesselTypeSubcat: text('vessel_type_subcat'),
    vesselTypeIsscfvCode: text('vessel_type_isscfv_code').notNull(),
    vesselTypeIsscfvAlpha: text('vessel_type_isscfv_alpha'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    vesselTypeCodeUnique: unique('uk_vessel_type_code').on(table.vesselTypeIsscfvCode),
    vesselTypeAlphaUnique: unique('uk_vessel_type_alpha').on(table.vesselTypeIsscfvAlpha),
    vesselTypeCodeIdx: index('idx_vessel_type_code').on(table.vesselTypeIsscfvCode),
    vesselTypesSourceIdx: index('idx_vessel_types_source').on(table.sourceId),
  })
)

// ===== INTERNAL REFERENCE TABLES (No Source Tracking) =====

export const vesselHullMaterial = pgTable(
  'vessel_hull_material',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hullMaterial: text('hull_material').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    hullMaterialUnique: unique('uk_hull_material').on(table.hullMaterial),
    hullMaterialIdx: index('idx_hull_material').on(table.hullMaterial),
  })
)

export const rfmos = pgTable(
  'rfmos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rfmoAcronym: text('rfmo_acronym').notNull(),
    rfmoName: text('rfmo_name').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    rfmoAcronymUnique: unique('uk_rfmo_acronym').on(table.rfmoAcronym),
    rfmoAcronymIdx: index('idx_rfmo_acronym').on(table.rfmoAcronym),
  })
)

// ===== RELATIONSHIP TABLES (UUID Mapped) =====

export const gearTypesRelationshipFaoCbp = pgTable(
  'gear_types_relationship_fao_cbp',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    faoGearId: uuid('fao_gear_id')
      .notNull()
      .references(() => gearTypesFao.id, { onDelete: 'cascade' }),
    cbpGearId: uuid('cbp_gear_id')
      .notNull()
      .references(() => gearTypesCbp.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    gearRelationshipUnique: unique('uk_gear_relationship_fao_cbp').on(
      table.faoGearId,
      table.cbpGearId
    ),
    gearRelFaoIdx: index('idx_gear_rel_fao').on(table.faoGearId),
    gearRelCbpIdx: index('idx_gear_rel_cbp').on(table.cbpGearId),
  })
)

export const countryIsoEu = pgTable(
  'country_iso_eu',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countryIso.id, { onDelete: 'cascade' }),
    isEu: boolean('is_eu').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    countryEuUnique: unique('uk_country_eu').on(table.countryId),
    countryEuIdx: index('idx_country_eu').on(table.countryId),
  })
)

// ===== DRIZZLE RELATIONS =====

export const originalSourcesRelations = relations(originalSources, ({ many }) => ({
  countries: many(countryIso),
  faoAreas: many(faoMajorAreas),
  faoGearTypes: many(gearTypesFao),
  cbpGearTypes: many(gearTypesCbp),
  vesselTypes: many(vesselTypes),
}))

export const countryIsoRelations = relations(countryIso, ({ one, many }) => ({
  source: one(originalSources, {
    fields: [countryIso.sourceId],
    references: [originalSources.sourceId],
  }),
  euStatus: many(countryIsoEu),
}))

export const faoMajorAreasRelations = relations(faoMajorAreas, ({ one }) => ({
  source: one(originalSources, {
    fields: [faoMajorAreas.sourceId],
    references: [originalSources.sourceId],
  }),
}))

export const gearTypesFaoRelations = relations(gearTypesFao, ({ one, many }) => ({
  source: one(originalSources, {
    fields: [gearTypesFao.sourceId],
    references: [originalSources.sourceId],
  }),
  cbpRelationships: many(gearTypesRelationshipFaoCbp, {
    relationName: 'faoGearToCbp',
  }),
}))

export const gearTypesCbpRelations = relations(gearTypesCbp, ({ one, many }) => ({
  source: one(originalSources, {
    fields: [gearTypesCbp.sourceId],
    references: [originalSources.sourceId],
  }),
  faoRelationships: many(gearTypesRelationshipFaoCbp, {
    relationName: 'cbpGearToFao',
  }),
}))

export const vesselTypesRelations = relations(vesselTypes, ({ one }) => ({
  source: one(originalSources, {
    fields: [vesselTypes.sourceId],
    references: [originalSources.sourceId],
  }),
}))

export const gearTypesRelationshipFaoCbpRelations = relations(
  gearTypesRelationshipFaoCbp,
  ({ one }) => ({
    faoGearType: one(gearTypesFao, {
      fields: [gearTypesRelationshipFaoCbp.faoGearId],
      references: [gearTypesFao.id],
      relationName: 'faoGearToCbp',
    }),
    cbpGearType: one(gearTypesCbp, {
      fields: [gearTypesRelationshipFaoCbp.cbpGearId],
      references: [gearTypesCbp.id],
      relationName: 'cbpGearToFao',
    }),
  })
)

export const countryIsoEuRelations = relations(countryIsoEu, ({ one }) => ({
  country: one(countryIso, {
    fields: [countryIsoEu.countryId],
    references: [countryIso.id],
  }),
}))

// ===== TYPESCRIPT TYPES =====

export type OriginalSource = typeof originalSources.$inferSelect
export type NewOriginalSource = typeof originalSources.$inferInsert

export type CountryIso = typeof countryIso.$inferSelect
export type NewCountryIso = typeof countryIso.$inferInsert

export type FaoMajorArea = typeof faoMajorAreas.$inferSelect
export type NewFaoMajorArea = typeof faoMajorAreas.$inferInsert

export type GearTypeFao = typeof gearTypesFao.$inferSelect
export type NewGearTypeFao = typeof gearTypesFao.$inferInsert

export type GearTypeCbp = typeof gearTypesCbp.$inferSelect
export type NewGearTypeCbp = typeof gearTypesCbp.$inferInsert

export type VesselType = typeof vesselTypes.$inferSelect
export type NewVesselType = typeof vesselTypes.$inferInsert

export type VesselHullMaterial = typeof vesselHullMaterial.$inferSelect
export type NewVesselHullMaterial = typeof vesselHullMaterial.$inferInsert

export type Rfmo = typeof rfmos.$inferSelect
export type NewRfmo = typeof rfmos.$inferInsert

export type GearTypesRelationshipFaoCbp = typeof gearTypesRelationshipFaoCbp.$inferSelect
export type NewGearTypesRelationshipFaoCbp = typeof gearTypesRelationshipFaoCbp.$inferInsert

export type CountryIsoEu = typeof countryIsoEu.$inferSelect
export type NewCountryIsoEu = typeof countryIsoEu.$inferInsert

// ===== UTILITY TYPES =====

export type UpdateFrequency = (typeof updateFrequencyEnum)[number]
export type SourceStatus = (typeof sourceStatusEnum)[number]

// Multi-type source query helpers
export type SourceTypeArray = string[]

// ===== QUERY HELPERS =====

// Helper for multi-type source queries
export const hasSourceType = (sourceType: string) =>
  sql`${sourceType} = ANY(${originalSources.sourceTypes})`

// Helper for JSON URL queries
export const hasUrl = (url: string) => sql`${originalSources.sourceUrls} ? ${url}`

// Helper for source status filtering
export const isSourceLoaded = sql`${originalSources.status} = 'LOADED'`

// ===== MIGRATION HELPERS =====

// For CrunchyBridge migration - create all tables in correct order
export const migrationOrder = [
  originalSources,
  countryIso,
  faoMajorAreas,
  gearTypesFao,
  gearTypesCbp,
  vesselTypes,
  vesselHullMaterial,
  rfmos,
  gearTypesRelationshipFaoCbp,
  countryIsoEu,
] as const

// Historical change tracking setup (for tomorrow's task)
export interface HistoricalChangeConfig {
  enableFor: Array<string> // Table names as strings
  trackColumns: string[]
  retentionDays: number
}

export const defaultHistoricalConfig: HistoricalChangeConfig = {
  enableFor: ['countryIso', 'faoMajorAreas', 'gearTypesFao', 'gearTypesCbp', 'vesselTypes'],
  trackColumns: ['*'], // Track all columns
  retentionDays: 365,
}
