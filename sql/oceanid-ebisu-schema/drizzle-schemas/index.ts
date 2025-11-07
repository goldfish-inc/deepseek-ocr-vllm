// Taxonomic Data System Schemas
// Core schemas for multi-source species integration

// Source data schemas
export * from './worms'
export * from './itis'
export * from './asfis'

// NEW: Streamlined harmonization (replaces complex species-registry)
export * from './harmonized-species'

// Reference data schemas
export * from './reference'
export * from './country-profile'
export * from './msc-gear'

// Vessel domain schemas (8 intuitive groupings)
export * from './vessels'
