# Drizzle ORM Guide for Ebisu Database

This guide explains how to use the Drizzle ORM schemas included with the Ebisu database.

## What is Drizzle?

Drizzle is a TypeScript ORM that provides:
- Type-safe database queries
- Schema management
- Migration generation
- Excellent IDE support

## Directory Structure

```
drizzle-schemas/
├── index.ts              # Main export file
├── drizzle.config.ts     # Drizzle configuration
├── asfis.ts             # ASFIS species tables
├── cascade.ts           # Trade code cascade tables
├── country-profile.ts   # Country data tables
├── itis.ts              # ITIS taxonomic tables
├── msc-gear.ts          # MSC gear type tables
├── reference.ts         # Reference data tables
├── species-registry.ts  # Species integration tables
└── worms.ts             # WoRMS taxonomic tables
```

## Setup (Optional - for TypeScript development)

If you want to use these schemas in a TypeScript project:

```bash
# Install dependencies
npm install

# Generate SQL migrations from schemas
npm run drizzle:generate

# Push schema changes to database
npm run drizzle:push
```

## Using the Schemas

### Example: Query Species with Type Safety

```typescript
import { db } from './db-connection';
import { speciesNameRegistry, wormsSpeciesMappings } from './drizzle-schemas';
import { eq, like } from 'drizzle-orm';

// Find all tuna species
const tunaSpecies = await db
  .select()
  .from(speciesNameRegistry)
  .where(like(speciesNameRegistry.normalizedName, '%thunnus%'));

// Get species with WoRMS mappings
const speciesWithWorms = await db
  .select({
    species: speciesNameRegistry,
    worms: wormsSpeciesMappings
  })
  .from(speciesNameRegistry)
  .leftJoin(
    wormsSpeciesMappings,
    eq(speciesNameRegistry.speciesId, wormsSpeciesMappings.speciesId)
  );
```

### Example: Insert New Data

```typescript
import { countryIso } from './drizzle-schemas/reference';

// Insert a new country
await db.insert(countryIso).values({
  sourceId: 'source-uuid-here',
  shortNameEn: 'Example Country',
  shortNameFr: 'Pays Exemple',
  alpha2Code: 'EX',
  alpha3Code: 'EXM',
  numericCode: '999'
});
```

## Schema Features

### 1. Composite Primary Keys
Some tables use composite keys for performance:
```typescript
// worms.ts
export const wormsTaxonomicCore = pgTable('worms_taxonomic_core', {
  taxonID: text('taxonID').notNull(),
  kingdom: text('kingdom').notNull(),
  // ... other fields
}, (table) => ({
  pk: primaryKey({ columns: [table.taxonID, table.kingdom] })
}));
```

### 2. Foreign Key Relationships
All relationships are properly defined:
```typescript
// species-registry.ts
export const wormsSpeciesMappings = pgTable('worms_species_mappings', {
  speciesId: uuid('species_id')
    .notNull()
    .references(() => speciesNameRegistry.speciesId),
  // ... other fields
});
```

### 3. Indexes for Performance
Critical indexes are defined in schemas:
```typescript
// reference.ts
export const countryIso = pgTable('country_iso', {
  // ... fields
}, (table) => ({
  alpha2Idx: index('idx_country_iso_alpha2').on(table.alpha2Code),
  alpha3Idx: index('idx_country_iso_alpha3').on(table.alpha3Code),
}));
```

## Benefits of Using Drizzle Schemas

1. **Type Safety**: Catch errors at compile time
2. **Auto-completion**: IDE knows all table and column names
3. **Refactoring**: Rename columns safely across your codebase
4. **Documentation**: Schemas serve as living documentation
5. **Migration Generation**: Generate SQL migrations from schema changes

## Connection Configuration

The `drizzle.config.ts` file is configured for the Ebisu database:
```typescript
export default {
  schema: './schema/*',
  out: './migrations',
  driver: 'pg',
  dbCredentials: {
    host: 'localhost',
    port: 5433,
    user: 'ebisu_user',
    password: 'ebisu_password',
    database: 'ebisu'
  }
};
```

## Note for Non-TypeScript Users

If you're not using TypeScript, you can ignore these schema files. The database is fully functional through standard SQL queries. These schemas are provided for developers who want type-safe database access in their applications.
