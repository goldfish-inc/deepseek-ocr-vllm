# ADR-001: Multi-Layer Database Migration Strategy for Complex Taxonomic Database

## Status
**ACCEPTED** - December 2024

## Context

The ebisu taxonomic database system requires creating a complex relational schema with multiple interdependent domains:

- **Foundation Layer**: Reference data (countries, gear types, vessel types, RFMOs)
- **Species Layer**: Large taxonomic datasets (WoRMS, ITIS, ASFIS)
- **Integration Layer**: Harmonized species mapping
- **Domain Layer**: Vessel tracking and compliance data

### Problems Identified

1. **Dependency Violations**: Original single migration (0001) was missing critical reference tables needed by vessel migrations (0003-0004), causing foreign key constraint failures
2. **Atomic Operation Boundaries**: Mixing unrelated domains in single migrations created inappropriate rollback boundaries
3. **Resource Management**: Large taxonomic datasets (1M+ records) mixed with small reference tables caused memory and performance issues
4. **Maintenance Complexity**: Single large migration files became difficult to debug and maintain

### Migration Execution Error
```sql
psql:/app/migrations/0003_vessel_tables_migration.sql:185:
ERROR: relation "vessel_types" does not exist
```

## Decision

Implement a **3-layer migration strategy** with clear dependency boundaries:

### Migration 0001: Foundation Layer
- **Tables**: `original_sources`, `country_iso`, `fao_major_areas`, `gear_types_fao/cbp/msc`, `vessel_types`, `rfmos`
- **Purpose**: Create all foundational reference data required by other domains
- **Dependencies**: None (foundation layer)
- **Size**: ~15 small tables with reference data

### Migration 0001.5: Species Taxonomic Layer
- **Tables**: WoRMS (4 tables), ITIS (11 tables), ASFIS (3 tables)
- **Purpose**: Create all species and taxonomic data structures
- **Dependencies**: `original_sources` from Migration 0001
- **Size**: ~18 tables, potentially millions of records

### Migrations 0002+: Integration & Domain Layers
- **0002**: `harmonized_species` (depends on species tables)
- **0003-0004**: Vessel domain (depends on foundation tables)
- **Dependencies**: Clear cross-layer references

## Architecture Principles Applied

### ✅ Dependency Layering
- **Foundation → Species → Integration → Domains**
- Each layer depends only on previous layers
- No circular dependencies between domains

### ✅ Atomic Operation Boundaries
- Related tables that should succeed/fail together remain in same migration
- `country_iso` → `country_iso_foc` → `country_iso_ilo_c188` in Migration 0001
- Complete ITIS hierarchy in Migration 0001.5

### ✅ Resource Optimization
- Large datasets isolated in Migration 0001.5 for memory management
- Small reference tables in Migration 0001 for quick foundational setup
- Staging tables separated from production tables

### ✅ Rollback Safety
- Clear rollback boundaries at domain level
- Foundation rollback doesn't affect species data
- Species rollback doesn't affect vessel data

## Implementation Details

### Foreign Key Strategy
```sql
-- UUID-based relationships maintained across migrations
vessel_info.vessel_type → vessel_types.id (0001 → 0003)
asfis_species.source_id → original_sources.source_id (0001 → 0001.5)
harmonized_species.asfis_id → asfis_species.asfis_id (0001.5 → 0002)
```

### Indexing Strategy
- Performance indexes created with their parent tables
- Cross-domain lookup indexes optimized for FK relationships
- Composite indexes for common query patterns

### Source Tracking
- All source-tracked tables reference `original_sources.source_id`
- Consistent metadata tracking across all layers

## Consequences

### Positive
- **Eliminated Dependency Errors**: Vessel tables now reference existing foundation tables
- **Improved Resource Management**: Large taxonomic imports isolated from quick reference setups
- **Enhanced Maintainability**: Clear separation of concerns, easier debugging
- **Flexible Rollback**: Can rollback domains independently without affecting others
- **Parallel Development**: Teams can work on different layers simultaneously
- **Performance Optimization**: Memory allocation optimized per migration size

### Negative
- **Additional Complexity**: 3 migration files vs 1 (manageable with clear documentation)
- **Migration Chain**: Failure in 0001 prevents 0001.5, but this enforces proper dependencies
- **Incremental Deployment**: Cannot deploy species data without foundation (intended behavior)

### Risks Mitigated
- **Cross-Domain Dependency Failures**: Foundation-first approach prevents missing table errors
- **Memory Exhaustion**: Large datasets isolated from small reference data
- **Rollback Cascades**: Domain boundaries prevent unintended rollback propagation

## Database Migration Best Practices Followed

### 1. **Dependency-First Ordering**
- Dependencies created before dependents
- Foundation before specialized domains
- Reference data before transactional data

### 2. **Atomic Transaction Boundaries**
- Related functionality grouped in single migrations
- Complete domains succeed/fail as units
- No partial state between related tables

### 3. **Resource Management**
- Large datasets isolated for memory optimization
- Small reference tables for quick deployment
- Staged loading capabilities for production data

### 4. **Rollback Safety**
- Clear rollback boundaries at logical domain level
- FK constraints ensure referential integrity during rollbacks
- No orphaned data across migration boundaries

### 5. **Schema Versioning**
- Sequential numbering with clear layer identification
- Migration metadata tracking for audit trail
- Version compatibility documented

### 6. **Performance Considerations**
- Indexes created with tables, not retrofitted
- Composite indexes for expected query patterns
- Partitioning-ready structures (WoRMS composite PK)

## Monitoring & Validation

### Migration Success Criteria
- Table count verification per migration
- Foreign key constraint validation
- Index creation confirmation
- Data type consistency checks

### Performance Monitoring
- Migration execution time tracking
- Memory usage per migration
- Index effectiveness measurement

## Future Considerations

### Scaling Strategy
- Migration 0001.5 prepared for data partitioning (WoRMS composite PK)
- Staging tables enable incremental data updates
- Source tracking enables data lineage and refresh strategies

### Domain Expansion
- Additional domains follow same pattern: Foundation → Species → Domain
- New domains reference existing foundation tables
- Clear dependency documentation maintained

---

**Decision Contributors**: Database Architecture Team
**Review Date**: Annual review recommended
**Related ADRs**: Future ADRs for data loading and harmonization strategies
