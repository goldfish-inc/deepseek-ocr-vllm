# Living Schema Implementation – Staged Execution Plan

**Program Issue**: [#291](https://github.com/goldfish-inc/oceanid/issues/291)
**Project Board**: [Project #11](https://github.com/orgs/goldfish-inc/projects/11)
**Duration**: 8-12 weeks
**Start Date**: TBD

---

## Execution Overview

Each phase must be completed sequentially. All tasks within a phase can be worked in parallel where dependencies allow.

**Phase completion criteria**:
- ✅ All child issues closed
- ✅ Acceptance criteria met (listed below)
- ✅ Epic issue updated with completion notes
- ✅ System verified working in production

---

## Phase 1: MotherDuck Foundation (Week 1-2)

**Epic**: [#292 Phase 1 – MotherDuck Foundation](https://github.com/goldfish-inc/oceanid/issues/292)
**Milestone**: Phase 1 – MotherDuck Foundation (Week 1-2)
**Goal**: Core schema in MotherDuck, existing Argilla data migrated

### Execution Order

#### Week 1, Day 1-2: Foundation Setup
1. **[#297 P1.1 Create core tables and bootstrap scripts](https://github.com/goldfish-inc/oceanid/issues/297)**
   - Set up MotherDuck connection (use `motherduckToken` from Pulumi ESC)
   - Create `raw_documents`, `annotations`, `structured_data` tables
   - Add indexes for `document_id`, `annotated_at`, `batch_id`
   - Write smoke tests
   - **Deliverable**: `sql/motherduck/schema_v1.sql`, `scripts/motherduck_setup.sh`

2. **[#298 P1.2 Create schema catalog tables](https://github.com/goldfish-inc/oceanid/issues/298)** *(can run in parallel with #297)*
   - Create `entity_types`, `field_definitions`, `schema_snapshots`, `entity_conflicts`, `query_executions`, `saved_queries` tables
   - Initialize version 1 snapshot (empty schema)
   - **Deliverable**: `sql/motherduck/schema_catalog.sql`

#### Week 1, Day 3-5: Data Migration
3. **[#299 P1.3 Migrate Argilla annotations → MotherDuck](https://github.com/goldfish-inc/oceanid/issues/299)** *(depends on #297, #298)*
   - Export current Argilla annotations to Parquet
   - Transform with `schema_version = 1`
   - Load into MotherDuck `annotations` table
   - Verify row counts, run spot-check queries
   - **Deliverable**: `scripts/migrate_argilla_to_motherduck.py`, `scripts/validate_migration.sql`
   - **Validation**: Row counts match, sample entities query correctly

#### Week 2: Real-time Ingestion
4. **[#300 P1.4 R2 → MotherDuck OCR ingestion](https://github.com/goldfish-inc/oceanid/issues/300)** *(depends on #297)*
   - Update vessel-ner OCR processor to write Parquet with `schema_version` metadata
   - Create MotherDuck ingestion job (R2 → `raw_documents`)
   - Add `batch_id` tracking (documents → annotations linkage)
   - Test end-to-end: PDF upload → OCR → R2 → MotherDuck
   - **Deliverable**:
     - `workers/vessel-ner/src/workers/ocr-processor.ts` (modified)
     - `workers/vessel-ner/src/lib/motherduck.ts` (new)
     - `workers/vessel-ner/src/workers/parquet-ingestion.ts` (new)

### Phase 1 Acceptance Criteria
- [ ] Core tables exist in MotherDuck (verify with `SHOW TABLES`)
- [ ] Historical Argilla annotations migrated (row count validation)
- [ ] New OCR data flows to MotherDuck automatically (test with sample PDF)
- [ ] Validation report produced with row counts and sample queries

**Checkpoint**: MotherDuck tables populated and queryable

---

## Phase 2: Auto-Discovery Pipeline (Week 3-4)

**Epic**: [#293 Phase 2 – Auto-Discovery Pipeline](https://github.com/goldfish-inc/oceanid/issues/293)
**Milestone**: Phase 2 – Auto-Discovery Pipeline (Week 3-4)
**Goal**: Schema changes detected automatically, catalog updated hourly

### Execution Order

#### Week 3, Day 1-3: Discovery Service
1. **[#301 P2.1 Build schema discovery service](https://github.com/goldfish-inc/oceanid/issues/301)**
   - Create discovery service (Deno/TypeScript)
   - Entity type scanner (queries `annotations` for new types)
   - Field definition scanner (queries `structured_data` for new columns)
   - Add occurrence counting (`last_seen`, `occurrence_count`)
   - Generate LLM descriptions for new entities/fields
   - Write unit tests
   - **Deliverable**:
     - `workers/vessel-ner/src/workers/schema-discovery.ts`
     - `workers/vessel-ner/src/lib/schema-catalog.ts`

#### Week 3, Day 4-5: Conflict Detection
2. **[#302 P2.2 Entity conflict detection + Slack](https://github.com/goldfish-inc/oceanid/issues/302)** *(depends on #301)*
   - Levenshtein distance similarity check (threshold 0.85)
   - Auto-approve if no conflicts, flag if similar entity exists
   - Insert into `entity_conflicts` table
   - Slack webhook integration
   - **Deliverable**: Updated `workers/vessel-ner/src/workers/schema-discovery.ts`
   - **Validation**: Create test entity similar to existing one, verify Slack notification

#### Week 4, Day 1-2: Versioning
3. **[#303 P2.3 Schema versioning + snapshots](https://github.com/goldfish-inc/oceanid/issues/303)** *(depends on #301)*
   - `trigger_schema_version_increment()` function
   - Snapshot current `entity_types` + `field_definitions`
   - Calculate diff from previous version
   - Insert into `schema_snapshots`
   - Invalidate LLM cache (placeholder for Phase 4)
   - **Deliverable**: `workers/vessel-ner/src/lib/schema-versioning.ts`

#### Week 4, Day 3-5: Integration
4. **[#304 P2.4 Integrate discovery with Argilla sync](https://github.com/goldfish-inc/oceanid/issues/304)** *(depends on #301, #302, #303)*
   - Add post-sync hook to argilla-sync worker
   - Call discovery pipeline after new annotations loaded
   - Log discovery results (new entities, conflicts flagged)
   - Update Grafana dashboard with schema metrics
   - **Deliverable**:
     - `workers/vessel-ner/src/workers/argilla-sync.ts` (modified)
     - `workers/vessel-ner/wrangler.schema-discovery.toml`

### Phase 2 Acceptance Criteria
- [ ] Discovery pipeline runs on schedule (hourly via Cloudflare Cron)
- [ ] New entity types auto-detected and cataloged (test with new annotation)
- [ ] Conflicts flagged to Slack channel (test with similar entity)
- [ ] Schema versions increment correctly (verify `schema_snapshots` table)

**Checkpoint**: Auto-discovery working end-to-end (new entity → catalog within 1 hour)

---

## Phase 3: CSV Workers → Parquet (Week 5)

**Epic**: [#294 Phase 3 – CSV Workers → Parquet](https://github.com/goldfish-inc/oceanid/issues/294)
**Milestone**: Phase 3 – CSV Workers → Parquet (Week 5)
**Goal**: CSV/XLS workers output Parquet to MotherDuck with schema tracking

### Execution Order

#### Week 5, Day 1-2: Worker Updates
1. **[#305 P3.1 Update Go CSV workers to Parquet](https://github.com/goldfish-inc/oceanid/issues/305)**
   - Add Parquet library to Go workers (`apache/arrow`)
   - Modify `processor.go` to write Parquet instead of DB insert
   - Include `schema_version` in Parquet metadata
   - Upload Parquet to R2 bucket (`vessel-csv`)
   - Test with OpenZL manifest CSV
   - **Deliverable**:
     - `apps/csv-ingestion-worker/processor.go` (modified)
     - `apps/csv-ingestion-worker/go.mod` (add arrow dependency)

#### Week 5, Day 3: Ingestion Job
2. **[#306 P3.2 Ingest CSV Parquet into MotherDuck](https://github.com/goldfish-inc/oceanid/issues/306)** *(depends on #305)*
   - Create ingestion job (similar to OCR ingestion)
   - Load Parquet files from R2 to `structured_data` table
   - Trigger schema discovery after batch load
   - Verify column extraction works
   - **Deliverable**: `workers/vessel-ner/src/workers/csv-ingestion.ts`

#### Week 5, Day 4-5: Backfill
3. **[#307 P3.3 Backfill historical CSV data](https://github.com/goldfish-inc/oceanid/issues/307)** *(depends on #306)*
   - Export existing CSV data from PostgreSQL
   - Convert to Parquet format
   - Load into MotherDuck with `batch_id` tracking
   - Run field discovery to populate `field_definitions`
   - **Deliverable**: `scripts/backfill_csv_data.py`
   - **Validation**: Historical CSV data visible in MotherDuck, field definitions auto-discovered

### Phase 3 Acceptance Criteria
- [ ] CSV workers produce Parquet files (verify R2 bucket)
- [ ] CSV data flows to MotherDuck automatically (test with sample CSV)
- [ ] Field definitions auto-discovered (check `field_definitions` table)
- [ ] Historical CSV data migrated (row count validation)

**Checkpoint**: CSV data flowing to MotherDuck, historical data queryable

---

## Phase 4: SQLrooms Query Layer (Week 6-8)

**Epic**: [#295 Phase 4 – SQLrooms Query Layer](https://github.com/goldfish-inc/oceanid/issues/295)
**Milestone**: Phase 4 – SQLrooms Query Layer (Week 6-8)
**Goal**: AI-powered query interface with schema awareness, multiple query modes

### Execution Order

#### Week 6, Day 1-2: Schema API
1. **[#308 P4.1 Schema context API (current + at/:date)](https://github.com/goldfish-inc/oceanid/issues/308)**
   - Create `GET /api/schema/current` endpoint
   - Return `entity_types`, `field_definitions`, examples
   - Create `GET /api/schema/at/:date` (time-travel)
   - Cache responses (invalidate on schema version change)
   - **Deliverable**: `apps/sqlrooms/src/api/schema.ts`

#### Week 6, Day 3-5: LLM Integration
2. **[#309 P4.2 LLM SQL generation + validation](https://github.com/goldfish-inc/oceanid/issues/309)** *(depends on #308)*
   - Prompt template with schema context
   - `generateSQL()` function
   - Add example queries for few-shot learning
   - Test with Claude/GPT-4 for SQL accuracy
   - Validation layer (syntax check, dangerous queries blocked)
   - **Deliverable**:
     - `apps/sqlrooms/src/lib/llm-query-generator.ts`
     - `apps/sqlrooms/src/lib/query-validator.ts`

#### Week 7, Day 1-3: Query Execution
3. **[#310 P4.3 Query executor + logging](https://github.com/goldfish-inc/oceanid/issues/310)** *(depends on #309)*
   - `executeQuery()` with mode switch (live/snapshot/time_travel)
   - Log execution to `query_executions` table
   - Calculate result hash for change detection
   - **Deliverable**: `apps/sqlrooms/src/lib/query-executor.ts`

#### Week 7, Day 4-5: UI Components
4. **[#311 P4.4 Saved reports UI + change badges](https://github.com/goldfish-inc/oceanid/issues/311)** *(can run in parallel with #310)*
   - "Save Report" button in query interface
   - Store query + `schema_version` + snapshot
   - "Report changed" badge if data/schema updated
   - "Refresh" and "View Diff" actions
   - Time-travel selector for historical queries
   - **Deliverable**:
     - `apps/sqlrooms/src/components/SavedReports.tsx`
     - `apps/sqlrooms/src/components/QueryDiff.tsx`

#### Week 8: Change Detection
5. **[#312 P4.5 Change detection + notifications](https://github.com/goldfish-inc/oceanid/issues/312)** *(depends on #310, #311)*
   - `detectReportChanges()` function
   - On-demand or scheduled (daily for saved reports)
   - Email/Slack notifications for changed reports
   - Inline diff in UI
   - **Deliverable**: `apps/sqlrooms/src/api/reports.ts` (modified)

### Phase 4 Acceptance Criteria
- [ ] SQLrooms can query MotherDuck (test with simple query)
- [ ] LLM generates accurate SQL from natural language (80%+ accuracy on test set)
- [ ] Save reports with schema pinning working (test save/restore)
- [ ] Change detection working (test with data change)

**Checkpoint**: Natural language query → SQL generation → saved report → change detection all working

---

## Phase 5: Monitoring & Refinement (Week 9+)

**Epic**: [#296 Phase 5 – Monitoring & Refinement](https://github.com/goldfish-inc/oceanid/issues/296)
**Milestone**: Phase 5 – Monitoring & Refinement (Week 9+)
**Goal**: Observability, performance optimization, SME training

### Execution Order

#### Week 9, Day 1-2: Schema Metrics
1. **[#313 P5.1 Schema churn dashboard + alerts](https://github.com/goldfish-inc/oceanid/issues/313)**
   - Create `schema_churn` view in MotherDuck
   - Grafana panel: schema versions over time
   - Panel: new entity types per week
   - Panel: entity conflict queue depth
   - Alert: >10 versions/day threshold
   - **Deliverable**: `dashboards/living-schema-metrics.json`

#### Week 9, Day 3-4: Performance Metrics
2. **[#314 P5.2 Query performance monitoring](https://github.com/goldfish-inc/oceanid/issues/314)** *(can run in parallel with #313)*
   - Create `slow_queries` view in MotherDuck
   - Grafana panel: query execution time (p50, p95, p99)
   - Panel: slow queries by schema version
   - Alert: queries >5s avg
   - **Deliverable**: Updates to `dashboards/living-schema-metrics.json`

#### Week 9, Day 5 + Week 10, Day 1-2: Entity Health
3. **[#315 P5.3 Entity type health + consolidation workflow](https://github.com/goldfish-inc/oceanid/issues/315)**
   - Create `entity_health` view
   - Weekly automated report: stale/rare entity types
   - Manual review process for cleanup
   - Document entity consolidation workflow
   - **Deliverable**: `docs/operations/schema-consolidation.md`

#### Week 10, Day 3-5: Documentation
4. **[#316 P5.4 SME training and guides](https://github.com/goldfish-inc/oceanid/issues/316)** *(can run in parallel with #315)*
   - Write user guide for adding new entity types
   - Document conflict resolution workflow
   - Create Argilla → SQLrooms flow diagram
   - Record demo video if needed
   - **Deliverable**: `docs/guides/SME/adding-entity-types.md`

#### Week 11+: Optimization
5. **[#317 P5.5 Performance optimization follow-ups](https://github.com/goldfish-inc/oceanid/issues/317)** *(based on monitoring data from #313, #314)*
   - Add indexes based on slow query analysis
   - Create materialized views for common joins (if needed)
   - Implement query result caching (Redis/KV)
   - Partition large tables by month (if >10M rows)
   - **Deliverable**: Performance tuning documentation

### Phase 5 Acceptance Criteria
- [ ] Grafana dashboard shows schema health (schema churn, conflicts, query performance)
- [ ] Automated alerts for anomalies (schema churn >10/day, queries >5s)
- [ ] Documentation complete for adding entities and resolving conflicts
- [ ] Query performance optimized (95th percentile <3 seconds)

**Checkpoint**: Living Schema system fully operational and monitored

---

## Cross-Phase Dependencies

```
Phase 1 (Foundation)
  ├── Must complete before Phase 2
  └── #297, #298 must complete before #299

Phase 2 (Auto-Discovery)
  ├── Requires Phase 1 complete
  ├── #301 must complete before #302, #303, #304
  └── Can start Phase 3 in parallel (Week 5)

Phase 3 (CSV Workers)
  ├── Can start after Phase 1
  ├── Benefits from Phase 2 (auto-discovery ready)
  └── #305 must complete before #306, #307

Phase 4 (SQLrooms)
  ├── Requires Phase 1, 2, 3 data flowing
  ├── #308 must complete before #309
  ├── #309, #310 must complete before #312
  └── #311 can run in parallel

Phase 5 (Monitoring)
  ├── Can start monitoring setup early (Week 9)
  ├── #317 depends on data from #313, #314
  └── #316 can run in parallel with infrastructure work
```

---

## Progress Tracking

**Update epic issues** as work progresses:
- Mark child issues complete when verified working
- Document blockers in issue comments
- Adjust approach based on what's actually working

**Phase completion milestones**:
- Week 2: Phase 1 complete (MotherDuck populated)
- Week 4: Phase 2 complete (auto-discovery working)
- Week 5: Phase 3 complete (CSV data flowing)
- Week 8: Phase 4 complete (SQLrooms AI queries working)
- Week 11: Phase 5 complete (monitoring + production ready)

---

## Validation Gates

**After Phase 1**:
- Validate data migration (zero data loss)
- Benchmark query performance
- Decide: proceed to Phase 2 or fix issues

**After Phase 2**:
- Check schema churn rate
- Validate conflict detection accuracy
- Decide: proceed to Phase 3 or tune discovery

**After Phase 4**:
- Test LLM query accuracy (must be >80%)
- Run manual test queries
- Decide: ship to production or iterate

---

## Rollback Strategy

**Phase 1-2**: Keep PostgreSQL operational in parallel. If issues found, disable MotherDuck ingestion.

**Phase 3-4**: Feature flag `USE_MOTHERDUCK_SCHEMA` (default false). Gradual rollout to pilot users.

**Phase 5**: MotherDuck is primary. Point-in-time recovery via `schema_versions` table.

---

## Success Metrics

**Must-Have (Launch Blockers)**:
- [ ] Zero data loss during migration (validation queries pass)
- [ ] New entity types available in SQLrooms <1 hour after annotation
- [ ] Saved reports return consistent results (reproducibility test)
- [ ] Query performance: 95th percentile <3 seconds

**Should-Have (Post-Launch)**:
- [ ] LLM query accuracy >80% (tested with sample queries)
- [ ] Schema churn <5 versions/week after initial ramp-up
- [ ] Entity conflict detection catches >90% of duplicates

---

## Quick Reference

**Repository**: goldfish-inc/oceanid
**Project Board**: https://github.com/orgs/goldfish-inc/projects/11
**Program Issue**: https://github.com/goldfish-inc/oceanid/issues/291

**Epic Issues**:
- Phase 1: https://github.com/goldfish-inc/oceanid/issues/292
- Phase 2: https://github.com/goldfish-inc/oceanid/issues/293
- Phase 3: https://github.com/goldfish-inc/oceanid/issues/294
- Phase 4: https://github.com/goldfish-inc/oceanid/issues/295
- Phase 5: https://github.com/goldfish-inc/oceanid/issues/296

**All Issues**: [Filter by `initiative:living-schema` label](https://github.com/goldfish-inc/oceanid/issues?q=is%3Aissue+label%3Ainitiative%3Aliving-schema)

**Related Documentation**:
- [Living Schema Strategy](../architecture/living-schema-strategy.md)
- [Living Schema Implementation Plan](living-schema-implementation.md)
- [MotherDuck Setup](../operations/motherduck.md)
- [Argilla Parquet Flow](../operations/argilla-parquet-flow.md)
