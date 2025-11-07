import {
  pgTable,
  integer,
  smallint,
  varchar,
  char,
  text,
  timestamp,
  date,
  primaryKey,
  index,
  foreignKey,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { originalSources } from './reference'

// ===============================
// 1. ITIS KINGDOMS
// ===============================
export const itisKingdoms = pgTable(
  'itis_kingdoms',
  {
    kingdomId: smallint('kingdom_id').primaryKey(),
    kingdomName: char('kingdom_name', { length: 10 }).notNull(),
    updateDate: date('update_date').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    kingdomNameIdx: index('idx_itis_kingdoms_name').on(table.kingdomName),
  })
)

// ===============================
// 2. ITIS TAXON UNIT TYPES (RANKS)
// ===============================
export const itisTaxonUnitTypes = pgTable(
  'itis_taxon_unit_types',
  {
    kingdomId: smallint('kingdom_id').notNull()
      .references(() => itisKingdoms.kingdomId),
    rankId: smallint('rank_id').notNull(),
    rankName: char('rank_name', { length: 15 }).notNull(),
    dirParentRankId: smallint('dir_parent_rank_id').notNull(),
    reqParentRankId: smallint('req_parent_rank_id').notNull(),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.kingdomId, table.rankId] }),
    rankNameIdx: index('idx_itis_taxon_unit_types_rank_name').on(table.rankName),
  })
)

// ===============================
// 3. ITIS TAXON AUTHORS LOOKUP
// ===============================
export const itisTaxonAuthorsLkp = pgTable(
  'itis_taxon_authors_lkp',
  {
    taxonAuthorId: integer('taxon_author_id').primaryKey(),
    taxonAuthor: varchar('taxon_author', { length: 100 }).notNull(),
    updateDate: date('update_date').notNull(),
    kingdomId: smallint('kingdom_id')
      .references(() => itisKingdoms.kingdomId),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    taxonAuthorIdx: index('idx_itis_taxon_authors_lkp_author').on(table.taxonAuthor),
    kingdomIdIdx: index('idx_itis_taxon_authors_lkp_kingdom').on(table.kingdomId),
  })
)

// ===============================
// 4. ITIS COMMENTS
// ===============================
export const itisComments = pgTable(
  'itis_comments',
  {
    commentId: integer('comment_id').primaryKey(),
    commentDetail: text('comment_detail'),
    updateDate: date('update_date').notNull(),
  }
)

// ===============================
// 5. ITIS TAXONOMIC UNITS (MAIN TABLE)
// ===============================
export const itisTaxonomicUnits = pgTable(
  'itis_taxonomic_units',
  {
    tsn: integer('tsn').primaryKey(),
    unitInd1: char('unit_ind1', { length: 1 }),
    unitName1: varchar('unit_name1', { length: 35 }).notNull(),
    unitInd2: char('unit_ind2', { length: 1 }),
    unitName2: varchar('unit_name2', { length: 35 }),
    unitInd3: varchar('unit_ind3', { length: 7 }),
    unitName3: varchar('unit_name3', { length: 35 }),
    unitInd4: varchar('unit_ind4', { length: 7 }),
    unitName4: varchar('unit_name4', { length: 35 }),
    unnamedTaxonInd: char('unnamed_taxon_ind', { length: 1 }),
    nameUsage: varchar('name_usage', { length: 12 }).notNull(),
    unacceptReason: varchar('unaccept_reason', { length: 50 }),
    credibilityRtng: varchar('credibility_rtng', { length: 40 }).notNull(),
    completenessRtng: char('completeness_rtng', { length: 1 }),
    currencyRating: char('currency_rating', { length: 1 }),
    phyloSortSeq: smallint('phylo_sort_seq'),
    initialTimeStamp: timestamp('initial_time_stamp').notNull(),
    parentTsn: integer('parent_tsn'),
    taxonAuthorId: integer('taxon_author_id'),
    hybridAuthorId: integer('hybrid_author_id'),
    kingdomId: smallint('kingdom_id').notNull(),
    rankId: smallint('rank_id').notNull(),
    updateDate: date('update_date').notNull(),
    uncertainPrntInd: char('uncertain_prnt_ind', { length: 3 }),
    completeName: varchar('complete_name', { length: 300 }),
    sourceId: uuid('source_id').references(() => originalSources.sourceId),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    parentTsnIdx: index('idx_itis_taxonomic_units_parent_tsn').on(table.parentTsn),
    completeNameIdx: index('idx_itis_taxonomic_units_complete_name').on(table.completeName),
    kingdomIdIdx: index('idx_itis_taxonomic_units_kingdom_id').on(table.kingdomId),
    nameUsageIdx: index('idx_itis_taxonomic_units_name_usage').on(table.nameUsage),
    rankIdIdx: index('idx_itis_taxonomic_units_rank_id').on(table.rankId),
    taxonAuthorIdIdx: index('idx_itis_taxonomic_units_taxon_author_id').on(table.taxonAuthorId),
    kingdomRankIdx: index('idx_itis_taxonomic_units_kingdom_rank').on(table.kingdomId, table.rankId),
    kingdomNameUsageIdx: index('idx_itis_taxonomic_units_kingdom_name_usage').on(table.kingdomId, table.nameUsage),
    nameUsageCompleteNameIdx: index('idx_itis_taxonomic_units_name_usage_complete_name').on(table.nameUsage, table.completeName),
  })
)

// ===============================
// 6. ITIS VERNACULARS (COMMON NAMES)
// ===============================
export const itisVernaculars = pgTable(
  'itis_vernaculars',
  {
    vernId: integer('vern_id').primaryKey(),
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    vernacularName: varchar('vernacular_name', { length: 80 }).notNull(),
    language: varchar('language', { length: 15 }).notNull(),
    approvedInd: char('approved_ind', { length: 1 }),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    tsnIdx: index('idx_itis_vernaculars_tsn').on(table.tsn),
    vernacularNameIdx: index('idx_itis_vernaculars_vernacular_name').on(table.vernacularName),
  })
)

// ===============================
// 7. ITIS HIERARCHY (MATERIALIZED PATHS)
// ===============================
export const itisHierarchy = pgTable(
  'itis_hierarchy',
  {
    tsn: integer('tsn').primaryKey()
      .references(() => itisTaxonomicUnits.tsn),
    parentTsn: integer('parent_tsn'),
    level: integer('level'),
    childrenCount: integer('children_count'),
    hierarchyString: text('hierarchy_string'),
  },
  (table) => ({
    parentTsnIdx: index('idx_itis_hierarchy_parent_tsn').on(table.parentTsn),
    hierarchyStringIdx: index('idx_itis_hierarchy_hierarchy_string').on(table.hierarchyString),
  })
)

// ===============================
// 8. ITIS LONGNAMES (COMPLETE NAMES)
// ===============================
export const itisLongnames = pgTable(
  'itis_longnames',
  {
    tsn: integer('tsn').primaryKey()
      .references(() => itisTaxonomicUnits.tsn),
    completename: text('completename'),
  },
  (table) => ({
    completenameIdx: index('idx_itis_longnames_completename').on(table.completename),
  })
)

// ===============================
// 9. ITIS SYNONYM LINKS
// ===============================
export const itisSynonymLinks = pgTable(
  'itis_synonym_links',
  {
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    tsnAccepted: integer('tsn_accepted').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tsn, table.tsnAccepted] }),
    tsnIdx: index('idx_itis_synonym_links_tsn').on(table.tsn),
    tsnAcceptedIdx: index('idx_itis_synonym_links_tsn_accepted').on(table.tsnAccepted),
  })
)

// ===============================
// 10. ITIS GEOGRAPHIC DIVISIONS
// ===============================
export const itisGeographicDiv = pgTable(
  'itis_geographic_div',
  {
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    geographicValue: varchar('geographic_value', { length: 45 }).notNull(),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tsn, table.geographicValue] }),
    tsnIdx: index('idx_itis_geographic_div_tsn').on(table.tsn),
  })
)

// ===============================
// 11. ITIS JURISDICTION
// ===============================
export const itisJurisdiction = pgTable(
  'itis_jurisdiction',
  {
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    jurisdictionValue: varchar('jurisdiction_value', { length: 45 }).notNull(),
    origin: char('origin', { length: 3 }),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tsn, table.jurisdictionValue] }),
    tsnIdx: index('idx_itis_jurisdiction_tsn').on(table.tsn),
  })
)

// ===============================
// 12. ITIS NODC IDS
// ===============================
export const itisNodcIds = pgTable(
  'itis_nodc_ids',
  {
    nodcId: integer('nodc_id').notNull(),
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.nodcId, table.tsn] }),
    tsnIdx: index('idx_itis_nodc_ids_tsn').on(table.tsn),
  })
)

// ===============================
// 13. ITIS REFERENCE LINKS
// ===============================
export const itisReferenceLinks = pgTable(
  'itis_reference_links',
  {
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    docIdPrefix: char('doc_id_prefix', { length: 3 }).notNull(),
    documentationId: integer('documentation_id').notNull(),
    originalDescInd: char('original_desc_ind', { length: 1 }),
    initItisDescInd: char('init_itis_desc_ind', { length: 1 }),
    changeTrackId: integer('change_track_id'),
    vernacularName: varchar('vernacular_name', { length: 80 }),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tsn, table.docIdPrefix, table.documentationId] }),
    tsnIdx: index('idx_itis_reference_links_tsn').on(table.tsn),
  })
)

// ===============================
// 14. ITIS TU COMMENTS LINKS
// ===============================
export const itisTuCommentsLinks = pgTable(
  'itis_tu_comments_links',
  {
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    commentId: integer('comment_id').notNull()
      .references(() => itisComments.commentId),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tsn, table.commentId] }),
    tsnIdx: index('idx_itis_tu_comments_links_tsn').on(table.tsn),
    commentIdIdx: index('idx_itis_tu_comments_links_comment_id').on(table.commentId),
  })
)

// ===============================
// 15. ITIS VERNACULAR REFERENCE LINKS
// ===============================
export const itisVernRefLinks = pgTable(
  'itis_vern_ref_links',
  {
    tsn: integer('tsn').notNull()
      .references(() => itisTaxonomicUnits.tsn),
    vernId: integer('vern_id').notNull()
      .references(() => itisVernaculars.vernId),
    docIdPrefix: char('doc_id_prefix', { length: 3 }).notNull(),
    documentationId: integer('documentation_id').notNull(),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tsn, table.vernId, table.docIdPrefix, table.documentationId] }),
    tsnIdx: index('idx_itis_vern_ref_links_tsn').on(table.tsn),
    vernIdIdx: index('idx_itis_vern_ref_links_vern_id').on(table.vernId),
  })
)

// ===============================
// 16. ITIS STRIPPED AUTHOR
// ===============================
export const itisStrippedauthor = pgTable(
  'itis_strippedauthor',
  {
    taxonAuthorId: integer('taxon_author_id').primaryKey()
      .references(() => itisTaxonAuthorsLkp.taxonAuthorId),
    shortauthor: varchar('shortauthor', { length: 100 }),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    taxonAuthorIdIdx: index('idx_itis_strippedauthor_taxon_author_id').on(table.taxonAuthorId),
  })
)

// ===============================
// 17. ITIS OTHER SOURCES
// ===============================
export const itisOtherSources = pgTable(
  'itis_other_sources',
  {
    sourceIdPrefix: char('source_id_prefix', { length: 3 }).notNull(),
    sourceId: integer('source_id').notNull(),
    source: text('source').notNull(),
    version: varchar('version', { length: 10 }),
    sourceType: varchar('source_type', { length: 10 }),
    sourceComment: text('source_comment'),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sourceIdPrefix, table.sourceId] }),
  })
)

// ===============================
// 18. ITIS EXPERTS
// ===============================
export const itisExperts = pgTable(
  'itis_experts',
  {
    expertIdPrefix: char('expert_id_prefix', { length: 3 }).notNull(),
    expertId: integer('expert_id').notNull(),
    expert: varchar('expert', { length: 100 }).notNull(),
    expertComment: text('expert_comment'),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.expertIdPrefix, table.expertId] }),
  })
)

// ===============================
// 19. ITIS PUBLICATIONS
// ===============================
export const itisPublications = pgTable(
  'itis_publications',
  {
    pubIdPrefix: char('pub_id_prefix', { length: 3 }).notNull(),
    publicationId: integer('publication_id').notNull(),
    referenceAuthor: text('reference_author'),
    title: text('title'),
    publicationName: text('publication_name'),
    listedPubDate: varchar('listed_pub_date', { length: 10 }),
    actualPubDate: date('actual_pub_date'),
    publisher: varchar('publisher', { length: 80 }),
    pages: varchar('pages', { length: 15 }),
    pubComment: text('pub_comment'),
    doi: varchar('doi', { length: 125 }),
    updateDate: date('update_date').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pubIdPrefix, table.publicationId] }),
  })
)

// ===============================
// TABLE RELATIONS
// ===============================
export const itisKingdomsRelations = relations(itisKingdoms, ({ many }) => ({
  taxonomicUnits: many(itisTaxonomicUnits),
  taxonUnitTypes: many(itisTaxonUnitTypes),
  authors: many(itisTaxonAuthorsLkp),
}))

export const itisTaxonUnitTypesRelations = relations(itisTaxonUnitTypes, ({ one, many }) => ({
  kingdom: one(itisKingdoms, {
    fields: [itisTaxonUnitTypes.kingdomId],
    references: [itisKingdoms.kingdomId],
  }),
  taxonomicUnits: many(itisTaxonomicUnits),
}))

export const itisTaxonAuthorsLkpRelations = relations(itisTaxonAuthorsLkp, ({ one, many }) => ({
  kingdom: one(itisKingdoms, {
    fields: [itisTaxonAuthorsLkp.kingdomId],
    references: [itisKingdoms.kingdomId],
  }),
  taxonomicUnits: many(itisTaxonomicUnits, { relationName: 'primary_author' }),
  hybridTaxonomicUnits: many(itisTaxonomicUnits, { relationName: 'hybrid_author' }),
  strippedAuthor: one(itisStrippedauthor),
}))

export const itisTaxonomicUnitsRelations = relations(itisTaxonomicUnits, ({ one, many }) => ({
  kingdom: one(itisKingdoms, {
    fields: [itisTaxonomicUnits.kingdomId],
    references: [itisKingdoms.kingdomId],
  }),
  parent: one(itisTaxonomicUnits, {
    fields: [itisTaxonomicUnits.parentTsn],
    references: [itisTaxonomicUnits.tsn],
    relationName: 'parent_child'
  }),
  children: many(itisTaxonomicUnits, { relationName: 'parent_child' }),
  primaryAuthor: one(itisTaxonAuthorsLkp, {
    fields: [itisTaxonomicUnits.taxonAuthorId],
    references: [itisTaxonAuthorsLkp.taxonAuthorId],
    relationName: 'primary_author'
  }),
  hybridAuthor: one(itisTaxonAuthorsLkp, {
    fields: [itisTaxonomicUnits.hybridAuthorId],
    references: [itisTaxonAuthorsLkp.taxonAuthorId],
    relationName: 'hybrid_author'
  }),
  vernaculars: many(itisVernaculars),
  hierarchy: one(itisHierarchy),
  longname: one(itisLongnames),
  synonymLinks: many(itisSynonymLinks, { relationName: 'synonym_from' }),
  acceptedSynonymLinks: many(itisSynonymLinks, { relationName: 'accepted_to' }),
  geographicDivisions: many(itisGeographicDiv),
  jurisdictions: many(itisJurisdiction),
  nodcIds: many(itisNodcIds),
  referenceLinks: many(itisReferenceLinks),
  commentLinks: many(itisTuCommentsLinks),
  vernRefLinks: many(itisVernRefLinks),
}))

export const itisVernacularsRelations = relations(itisVernaculars, ({ one, many }) => ({
  taxonomicUnit: one(itisTaxonomicUnits, {
    fields: [itisVernaculars.tsn],
    references: [itisTaxonomicUnits.tsn],
  }),
  vernRefLinks: many(itisVernRefLinks),
}))

export const itisHierarchyRelations = relations(itisHierarchy, ({ one }) => ({
  taxonomicUnit: one(itisTaxonomicUnits, {
    fields: [itisHierarchy.tsn],
    references: [itisTaxonomicUnits.tsn],
  }),
}))

export const itisLongnamesRelations = relations(itisLongnames, ({ one }) => ({
  taxonomicUnit: one(itisTaxonomicUnits, {
    fields: [itisLongnames.tsn],
    references: [itisTaxonomicUnits.tsn],
  }),
}))

export const itisSynonymLinksRelations = relations(itisSynonymLinks, ({ one }) => ({
  synonymTaxon: one(itisTaxonomicUnits, {
    fields: [itisSynonymLinks.tsn],
    references: [itisTaxonomicUnits.tsn],
    relationName: 'synonym_from'
  }),
  acceptedTaxon: one(itisTaxonomicUnits, {
    fields: [itisSynonymLinks.tsnAccepted],
    references: [itisTaxonomicUnits.tsn],
    relationName: 'accepted_to'
  }),
}))

export const itisCommentsRelations = relations(itisComments, ({ many }) => ({
  commentLinks: many(itisTuCommentsLinks),
}))

export const itisTuCommentsLinksRelations = relations(itisTuCommentsLinks, ({ one }) => ({
  taxonomicUnit: one(itisTaxonomicUnits, {
    fields: [itisTuCommentsLinks.tsn],
    references: [itisTaxonomicUnits.tsn],
  }),
  comment: one(itisComments, {
    fields: [itisTuCommentsLinks.commentId],
    references: [itisComments.commentId],
  }),
}))

export const itisStrippedauthorRelations = relations(itisStrippedauthor, ({ one }) => ({
  author: one(itisTaxonAuthorsLkp, {
    fields: [itisStrippedauthor.taxonAuthorId],
    references: [itisTaxonAuthorsLkp.taxonAuthorId],
  }),
}))
