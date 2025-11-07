// drizzle-schemas/vessels/relations.ts - Complete Drizzle relations for all vessel tables with all FKs
import { relations } from 'drizzle-orm';

// Import all vessel tables from the 8 schema files
import { originalSourcesVessels } from './sources';
import {
  vessels,
  vesselInfo,
  vesselMetrics,
  vesselBuildInformation,
  vesselExternalIdentifiers
} from './core';
import { vesselEquipment, vesselAttributes } from './equipment';
import {
  vesselSources,
  vesselSourceIdentifiers,
  vesselVesselTypes,
  vesselGearTypes
} from './tracking';
import { vesselAssociates } from './associates';
import { vesselAuthorizations } from './authorizations';
import { vesselReportedHistory } from './history';

// Import reference tables for FK relationships
import { countryIso, vesselTypes, gearTypesFao, faoMajorAreas, rfmos } from '../reference';
import { harmonizedSpecies } from '../harmonized-species';
// NOTE: Uncomment these imports when available
// import { speciesNameRegistry } from '../species-registry';

// ==============================================================================
// VESSEL SOURCE RELATIONS
// ==============================================================================

export const originalSourcesVesselsRelations = relations(originalSourcesVessels, ({ many }) => ({
  // One source can be used by many vessel records
  vesselSources: many(vesselSources),
  vesselSourceIdentifiers: many(vesselSourceIdentifiers),
  vesselMetrics: many(vesselMetrics),
  vesselVesselTypes: many(vesselVesselTypes),
  vesselGearTypes: many(vesselGearTypes),
  vesselBuildInformation: many(vesselBuildInformation),
  vesselEquipment: many(vesselEquipment),
  vesselAttributes: many(vesselAttributes),
  vesselExternalIdentifiers: many(vesselExternalIdentifiers),
  vesselAssociates: many(vesselAssociates),
  vesselAuthorizations: many(vesselAuthorizations),
  vesselReportedHistory: many(vesselReportedHistory),
}));

// ==============================================================================
// CORE VESSEL RELATIONS
// ==============================================================================

export const vesselsRelations = relations(vessels, ({ one, many }) => ({
  // One-to-one relationship with vessel info
  vesselInfo: one(vesselInfo, {
    fields: [vessels.vesselUuid],
    references: [vesselInfo.vesselUuid],
  }),

  // ✅ Foreign key to country for vessel flag
  flagCountry: one(countryIso, {
    fields: [vessels.vesselFlag],
    references: [countryIso.id],
  }),

  // One-to-many relationships
  sources: many(vesselSources),
  metrics: many(vesselMetrics),
  sourceIdentifiers: many(vesselSourceIdentifiers),
  externalIdentifiers: many(vesselExternalIdentifiers),
  vesselTypes: many(vesselVesselTypes),
  gearTypes: many(vesselGearTypes),
  buildInformation: many(vesselBuildInformation),
  reportedHistory: many(vesselReportedHistory),
  equipment: many(vesselEquipment),
  attributes: many(vesselAttributes),
  associates: many(vesselAssociates),
  authorizations: many(vesselAuthorizations),
}));

export const vesselInfoRelations = relations(vesselInfo, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselInfo.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  // ✅ Foreign key to vessel types
  vesselType: one(vesselTypes, {
    fields: [vesselInfo.vesselType],
    references: [vesselTypes.id],
  }),
  // ✅ Foreign key to FAO gear types
  primaryGearType: one(gearTypesFao, {
    fields: [vesselInfo.primaryGear],
    references: [gearTypesFao.id],
  }),
}));

export const vesselMetricsRelations = relations(vesselMetrics, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselMetrics.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselMetrics.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

export const vesselBuildInformationRelations = relations(vesselBuildInformation, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselBuildInformation.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  // ✅ Foreign key to country for build country
  buildCountry: one(countryIso, {
    fields: [vesselBuildInformation.buildCountryId],
    references: [countryIso.id],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselBuildInformation.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

export const vesselExternalIdentifiersRelations = relations(vesselExternalIdentifiers, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselExternalIdentifiers.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselExternalIdentifiers.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

// ==============================================================================
// EQUIPMENT RELATIONS
// ==============================================================================

export const vesselEquipmentRelations = relations(vesselEquipment, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselEquipment.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselEquipment.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

export const vesselAttributesRelations = relations(vesselAttributes, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselAttributes.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselAttributes.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

// ==============================================================================
// TRACKING RELATIONS
// ==============================================================================

export const vesselSourcesRelations = relations(vesselSources, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselSources.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselSources.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

export const vesselSourceIdentifiersRelations = relations(vesselSourceIdentifiers, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselSourceIdentifiers.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselSourceIdentifiers.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
  // ✅ Foreign key to country for associated flag
  associatedFlagCountry: one(countryIso, {
    fields: [vesselSourceIdentifiers.associatedFlag],
    references: [countryIso.id],
  }),
}));

export const vesselVesselTypesRelations = relations(vesselVesselTypes, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselVesselTypes.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  // ✅ Foreign key to vessel types
  vesselType: one(vesselTypes, {
    fields: [vesselVesselTypes.vesselTypeId],
    references: [vesselTypes.id],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselVesselTypes.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

export const vesselGearTypesRelations = relations(vesselGearTypes, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselGearTypes.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  // ✅ Foreign key to FAO gear types
  faoGear: one(gearTypesFao, {
    fields: [vesselGearTypes.faoGearId],
    references: [gearTypesFao.id],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselGearTypes.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
}));

// ==============================================================================
// ASSOCIATES RELATIONS
// ==============================================================================

export const vesselAssociatesRelations = relations(vesselAssociates, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselAssociates.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselAssociates.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
  // ✅ Foreign key to country for nationality
  nationalityCountry: one(countryIso, {
    fields: [vesselAssociates.nationalityCountryId],
    references: [countryIso.id],
    relationName: 'associateNationality',
  }),
  // ✅ Foreign key to country for address country
  addressCountry: one(countryIso, {
    fields: [vesselAssociates.countryId],
    references: [countryIso.id],
    relationName: 'associateAddress',
  }),
}));

// ==============================================================================
// AUTHORIZATION RELATIONS
// ==============================================================================

export const vesselAuthorizationsRelations = relations(vesselAuthorizations, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselAuthorizations.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselAuthorizations.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
  // ✅ Foreign key to RFMO
  rfmo: one(rfmos, {
    fields: [vesselAuthorizations.rfmoId],
    references: [rfmos.id],
  }),
  // NOTE: JSONB array relationships (species_ids, fao_area_ids) cannot be enforced with FK constraints
  // These are logical relationships that must be validated at the application layer:
  // - species_ids: Array of UUIDs referencing harmonized_species.harmonized_id
  // - fao_area_ids: Array of UUIDs referencing fao_major_areas.id
}));

// ==============================================================================
// HISTORY RELATIONS
// ==============================================================================

export const vesselReportedHistoryRelations = relations(vesselReportedHistory, ({ one }) => ({
  vessel: one(vessels, {
    fields: [vesselReportedHistory.vesselUuid],
    references: [vessels.vesselUuid],
  }),
  source: one(originalSourcesVessels, {
    fields: [vesselReportedHistory.sourceId],
    references: [originalSourcesVessels.sourceId],
  }),
  // ✅ Foreign key to country for flag changes
  flagCountry: one(countryIso, {
    fields: [vesselReportedHistory.flagCountryId],
    references: [countryIso.id],
  }),
}));
