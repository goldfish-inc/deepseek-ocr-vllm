# Living Schema Implementation Project

**Status**: Planning
**Start Date**: 2025-01-11
**Target Launch**: 2025-03-01 (8 weeks)
**Owner**: Platform Team

**Related Docs**:
- [Living Schema Strategy](../architecture/living-schema-strategy.md)
- [MotherDuck Setup](../operations/motherduck.md)
- [Argilla Parquet Flow](../operations/argilla-parquet-flow.md)

---

## Project Goals

### Primary Objectives
1. **Eliminate schema migrations**: SMEs can add new entity types without engineering intervention
2. **Single source of truth**: MotherDuck is primary database, PostgreSQL deprecated for core data
3. **Automatic discovery**: Schema changes propagate from Argilla/CSV workers to SQLrooms within 1 hour
4. **Query reproducibility**: Point-in-time queries and full lineage tracking

### Non-Goals (v1)
- ❌ Real-time streaming (hourly batch sync is sufficient)
- ❌ Multi-tenant schema isolation (single shared schema catalog)
- ❌ Advanced schema merge/conflict resolution (manual review queue only)
- ❌ Graphile API replacement (keep for auth/users, remove for core data)

---

## Implementation Phases

### Phase 1: MotherDuck Foundation (Week 1-2)

**Goal**: Core schema in MotherDuck, existing Argilla data migrated

#### Tasks

##### 1.1 Create Core Tables
- [ ] Set up MotherDuck database connection from local dev
  - Credentials from Pulumi ESC `motherduckToken`
  - Test connection with sample query
- [ ] Create `raw_documents` table
- [ ] Create `annotations` table
- [ ] Create `structured_data` table
- [ ] Add indexes for common queries (document_id, annotated_at, batch_id)
- [ ] Write smoke tests for table creation

**Files to create**:
- `sql/motherduck/schema_v1.sql` (core tables DDL)
- `scripts/motherduck_setup.sh` (initialization script)

##### 1.2 Create Schema Catalog Tables
- [ ] Create `entity_types` table
- [ ] Create `field_definitions` table
- [ ] Create `schema_snapshots` table
- [ ] Create `entity_conflicts` table
- [ ] Create `query_executions` table
- [ ] Create `saved_queries` table
- [ ] Initialize version 1 snapshot (empty schema)

**Files to create**:
- `sql/motherduck/schema_catalog.sql`

##### 1.3 Migrate Existing Argilla Data
- [ ] Export current Argilla annotations to Parquet
- [ ] Transform to new schema (add schema_version = 1)
- [ ] Load into MotherDuck `annotations` table
- [ ] Verify row counts match
- [ ] Run validation queries (spot-check entities)

**Files to create**:
- `scripts/migrate_argilla_to_motherduck.py`
- `scripts/validate_migration.sql`

##### 1.4 R2 → MotherDuck Ingestion
- [ ] Update vessel-ner OCR processor to write Parquet with schema_version metadata
- [ ] Create MotherDuck ingestion job (reads from R2, inserts to raw_documents)
- [ ] Add batch_id tracking to link documents → annotations
- [ ] Test end-to-end: PDF upload → OCR → R2 → MotherDuck

**Files to modify**:
- `workers/vessel-ner/src/workers/ocr-processor.ts`
- `workers/vessel-ner/src/lib/motherduck.ts`

**Files to create**:
- `workers/vessel-ner/src/workers/parquet-ingestion.ts`

**Deliverables**:
- ✅ Core tables exist in MotherDuck
- ✅ Historical Argilla annotations migrated
- ✅ New OCR data flows to MotherDuck automatically
- ✅ Validation report: row counts, sample queries

---

### Phase 2: Auto-Discovery Pipeline (Week 3-4)

**Goal**: Schema changes detected automatically, catalog updated hourly

#### Tasks

##### 2.1 Schema Discovery Job
- [ ] Create discovery service (Deno/TypeScript)
- [ ] Implement entity type scanner (queries annotations for new types)
- [ ] Implement field definition scanner (queries structured_data for new columns)
- [ ] Add occurrence counting (increment last_seen, occurrence_count)
- [ ] Generate LLM descriptions for new entities/fields
- [ ] Write unit tests for discovery logic

**Files to create**:
- `workers/vessel-ner/src/workers/schema-discovery.ts`
- `workers/vessel-ner/src/lib/schema-catalog.ts`

##### 2.2 Entity Conflict Detection
- [ ] Implement Levenshtein distance similarity check
- [ ] Set similarity threshold (start at 0.85)
- [ ] Auto-approve if no conflicts, flag if similar entity exists
- [ ] Insert into `entity_conflicts` table
- [ ] Create Slack webhook integration for notifications

**Files to modify**:
- `workers/vessel-ner/src/workers/schema-discovery.ts`

##### 2.3 Schema Version Management
- [ ] Implement `trigger_schema_version_increment()` function
- [ ] Snapshot current entity_types + field_definitions
- [ ] Calculate diff from previous version
- [ ] Insert into `schema_snapshots`
- [ ] Invalidate LLM cache (placeholder for Phase 4)

**Files to create**:
- `workers/vessel-ner/src/lib/schema-versioning.ts`

##### 2.4 Integration with Argilla Sync
- [ ] Add post-sync hook to argilla-sync worker
- [ ] Call discovery pipeline after new annotations loaded
- [ ] Log discovery results (new entities, conflicts flagged)
- [ ] Update Grafana dashboard with schema metrics

**Files to modify**:
- `workers/vessel-ner/src/workers/argilla-sync.ts`

**Files to create**:
- `workers/vessel-ner/wrangler.schema-discovery.toml` (Cloudflare Queue Worker config)

**Deliverables**:
- ✅ Discovery pipeline runs on schedule (hourly)
- ✅ New entity types auto-detected and cataloged
- ✅ Conflicts flagged to Slack channel
- ✅ Schema versions increment correctly

---

### Phase 3: CSV Worker Updates (Week 5)

**Goal**: CSV/XLS workers output Parquet to MotherDuck with schema tracking

#### Tasks

##### 3.1 Update CSV Workers to Output Parquet
- [ ] Add Parquet library to Go workers (apache/arrow)
- [ ] Modify `processor.go` to write Parquet instead of DB insert
- [ ] Include schema_version in Parquet metadata
- [ ] Upload Parquet to R2 bucket (new: `vessel-csv`)
- [ ] Test with OpenZL manifest CSV

**Files to modify**:
- `apps/csv-ingestion-worker/processor.go`
- `apps/csv-ingestion-worker/go.mod` (add arrow dependency)

##### 3.2 CSV Parquet → MotherDuck Ingestion
- [ ] Create ingestion job (similar to OCR ingestion)
- [ ] Load Parquet files from R2 to `structured_data` table
- [ ] Trigger schema discovery after batch load
- [ ] Verify column extraction works correctly

**Files to create**:
- `workers/vessel-ner/src/workers/csv-ingestion.ts`

##### 3.3 Backfill Historical CSV Data
- [ ] Export existing CSV data from PostgreSQL
- [ ] Convert to Parquet format
- [ ] Load into MotherDuck with batch_id tracking
- [ ] Run field discovery to populate `field_definitions`

**Files to create**:
- `scripts/backfill_csv_data.py`

**Deliverables**:
- ✅ CSV workers produce Parquet files
- ✅ CSV data flows to MotherDuck automatically
- ✅ Field definitions auto-discovered
- ✅ Historical CSV data migrated

---

### Phase 4: SQLrooms Query Layer (Week 6-8)

**Goal**: AI-powered query interface with schema awareness, multiple query modes

#### Tasks

##### 4.1 Schema Context API
- [ ] Create REST endpoint: `GET /api/schema/current`
- [ ] Return entity_types, field_definitions, examples
- [ ] Create endpoint: `GET /api/schema/at/:date` (time-travel)
- [ ] Cache responses (invalidate on schema version change)

**Files to create**:
- `apps/sqlrooms/src/api/schema.ts`

##### 4.2 LLM Query Generation
- [ ] Create prompt template with schema context
- [ ] Implement `generateSQL()` function
- [ ] Add example queries for few-shot learning
- [ ] Test with Claude/GPT-4 for SQL accuracy
- [ ] Add validation layer (syntax check, dangerous queries blocked)

**Files to create**:
- `apps/sqlrooms/src/lib/llm-query-generator.ts`
- `apps/sqlrooms/src/lib/query-validator.ts`

##### 4.3 Query Mode Handler
- [ ] Implement `executeQuery()` with mode switch
  - `live`: Query latest data
  - `snapshot`: Load from saved results or re-run with pinned schema
  - `time_travel`: Add date filters + schema version constraint
- [ ] Log execution to `query_executions` table
- [ ] Calculate result hash for change detection

**Files to create**:
- `apps/sqlrooms/src/lib/query-executor.ts`

##### 4.4 Saved Reports UI
- [ ] Create "Save Report" button in query interface
- [ ] Store query + schema_version + snapshot
- [ ] Show "Report changed" badge if data/schema updated
- [ ] Add "Refresh" and "View Diff" actions
- [ ] Time-travel selector for historical queries

**Files to create**:
- `apps/sqlrooms/src/components/SavedReports.tsx`
- `apps/sqlrooms/src/components/QueryDiff.tsx`

##### 4.5 Change Detection
- [ ] Implement `detectReportChanges()` function
- [ ] Run on-demand or scheduled (daily for saved reports)
- [ ] Send email/Slack notifications for changed reports
- [ ] Show inline diff in UI

**Files to modify**:
- `apps/sqlrooms/src/api/reports.ts`

**Deliverables**:
- ✅ SQLrooms can query MotherDuck
- ✅ LLM generates accurate SQL from natural language
- ✅ Users can save reports with schema pinning
- ✅ Change detection alerts users to data updates

---

### Phase 5: Monitoring & Refinement (Week 9+)

**Goal**: Observability, performance optimization, SME training

#### Tasks

##### 5.1 Schema Churn Dashboard (Grafana)
- [ ] Create `schema_churn` view in MotherDuck
- [ ] Add Grafana panel: schema versions over time
- [ ] Add panel: new entity types per week
- [ ] Add panel: entity conflict queue depth
- [ ] Set up alerts for thresholds (>10 versions/day)

**Files to create**:
- `dashboards/living-schema-metrics.json`

##### 5.2 Query Performance Monitoring
- [ ] Create `slow_queries` view in MotherDuck
- [ ] Add Grafana panel: query execution time (p50, p95, p99)
- [ ] Add panel: slow queries by schema version
- [ ] Set up alert for queries >5s avg

##### 5.3 Entity Type Health Report
- [ ] Create `entity_health` view
- [ ] Weekly automated report: stale/rare entity types
- [ ] Manual review process for cleanup
- [ ] Document entity consolidation workflow

**Files to create**:
- `docs/operations/schema-consolidation.md`

##### 5.4 SME Training
- [ ] Write user guide for adding new entity types
- [ ] Document conflict resolution workflow
- [ ] Record demo video: Argilla → SQLrooms flow
- [ ] Hold training session with pilot SME group

**Files to create**:
- `docs/guides/SME/adding-entity-types.md`

##### 5.5 Performance Optimization
- [ ] Add indexes based on slow query analysis
- [ ] Create materialized views for common joins (if needed)
- [ ] Implement query result caching (Redis/KV)
- [ ] Partition large tables by month (if >10M rows)

**Deliverables**:
- ✅ Grafana dashboard shows schema health
- ✅ Automated alerts for anomalies
- ✅ SMEs trained on new workflow
- ✅ Query performance optimized

---

## Rollback Plan

### Phase 1-2 Rollback
- Keep PostgreSQL operational in parallel
- Argilla still writes to both PostgreSQL + MotherDuck
- If issues found, disable MotherDuck ingestion, continue with PostgreSQL

### Phase 3-4 Rollback
- SQLrooms can fall back to direct PostgreSQL queries
- Feature flag: `USE_MOTHERDUCK_SCHEMA` (default false until stable)
- Gradual rollout: pilot users → full team

### Phase 5 (Post-Launch)
- MotherDuck is primary, PostgreSQL deprecated
- If critical bug, restore from MotherDuck WAL backup
- Point-in-time recovery available via schema_versions

---

## Success Criteria

### Must-Have (Launch Blockers)
- [ ] Zero data loss during migration (validation queries pass)
- [ ] New entity types available in SQLrooms < 1 hour after annotation
- [ ] Saved reports return consistent results (reproducibility test)
- [ ] Query performance: 95th percentile < 3 seconds

### Should-Have (Post-Launch)
- [ ] LLM query accuracy > 80% (tested with sample queries)
- [ ] Schema churn < 5 versions/week after initial ramp-up
- [ ] Entity conflict detection catches >90% of duplicates

### Nice-to-Have (Future Iterations)
- [ ] Real-time schema updates (sub-minute latency)
- [ ] Advanced conflict resolution (auto-merge with ML)
- [ ] Multi-tenant schema isolation per project
- [ ] GraphQL API for schema introspection

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| MotherDuck performance degrades with JSONB queries | High | Medium | Benchmark early, add indexes, use materialized views |
| LLM generates incorrect SQL | High | Medium | Validation layer, human review for saved reports |
| Schema churn too high (>10 versions/day) | Medium | Low | Manual approval for new entity types, tighter similarity threshold |
| SMEs confused by new workflow | Medium | Medium | Training sessions, documentation, pilot group first |
| Data migration loses records | Critical | Low | Validation scripts, dry-run with sample data, rollback plan |
| Conflict detection false positives | Low | High | Tune similarity threshold, provide override UI |

---

## Resources Required

### Engineering
- **Backend**: 1 engineer full-time (schema discovery, ingestion)
- **Frontend**: 0.5 engineer (SQLrooms UI updates)
- **DevOps**: 0.25 engineer (MotherDuck setup, monitoring)

### Infrastructure
- **MotherDuck**: Standard plan ($0.50/GB scanned, estimate $50-200/month initially)
- **R2 Storage**: Parquet files, estimate 10GB/month → $0.15/month
- **Cloudflare Workers**: Queue workers for discovery, estimate $5-10/month

### External Dependencies
- **Argilla API**: Must remain stable (no breaking changes)
- **MotherDuck**: Service availability (99.9% SLA)
- **LLM provider**: Claude/OpenAI API for SQL generation

---

## Communication Plan

### Milestones to Announce
1. **Phase 1 Complete**: "MotherDuck is live, historical data migrated"
2. **Phase 2 Complete**: "Schema auto-discovery operational"
3. **Phase 4 Complete**: "SQLrooms AI queries enabled for pilot group"
4. **Launch**: "Living schema system fully deployed"

### Channels
- **Slack #oceanid-engineering**: Weekly progress updates
- **All-hands**: Demo at Phase 4 completion
- **Documentation**: Update README, architecture diagrams

### Stakeholders
- **SME Team**: Training before Phase 4 launch
- **Product**: Demo SQLrooms features early
- **Compliance**: Validate point-in-time query reproducibility

---

## Post-Launch Iteration Plan

### Week 1-2 After Launch
- Monitor schema churn metrics daily
- Collect SME feedback on entity conflict workflow
- Optimize slow queries identified in logs

### Week 3-4
- Consolidate rare/stale entity types (first manual review)
- Add missing indexes based on query patterns
- Expand LLM prompt with more examples (improve accuracy)

### Month 2-3
- Implement materialized views for common joins (if needed)
- Add advanced filtering UI for schema catalog
- Build entity type merge tool (resolve conflicts faster)

### Month 4+
- Explore real-time schema updates (sub-minute latency)
- Investigate embedding-based entity similarity (beyond Levenshtein)
- Consider multi-tenant schema isolation for different projects

---

## Open Questions (Need Decisions)

1. **CSV worker changes**: Should we embed Git commit SHA in Parquet metadata to track code versions?
   - **Recommendation**: Yes, helps debugging if worker logic changes

2. **Entity type approval threshold**: Auto-approve all new types, or require SME review?
   - **Recommendation**: Auto-approve if no conflicts, flag similar types for review

3. **Schema consolidation cadence**: Quarterly manual review, or automated based on metrics?
   - **Recommendation**: Start with quarterly, automate if churn is low

4. **Query timeout**: How long should SQLrooms wait for slow queries?
   - **Recommendation**: 10 seconds for live queries, 60 seconds for snapshots

5. **Snapshot storage**: Materialize saved report results, or re-run on-demand?
   - **Recommendation**: Re-run on-demand for v1, add materialization if performance issues

---

## Next Steps (Action Items)

### Immediate (This Week)
1. [ ] Review this plan with team, get feedback
2. [ ] Set up MotherDuck account and connection credentials
3. [ ] Create GitHub project board with Phase 1 tasks
4. [ ] Schedule kickoff meeting

### Week 1
1. [ ] Start Phase 1.1: Create core tables
2. [ ] Set up development environment for MotherDuck
3. [ ] Begin Argilla data export for migration

---

## References

- [Living Schema Strategy](../architecture/living-schema-strategy.md) - Full architecture doc
- [MotherDuck Docs](https://motherduck.com/docs/)
- [Argilla Parquet Flow](../operations/argilla-parquet-flow.md)
- [CSV Ingestion Worker](../../apps/csv-ingestion-worker/README.md)
- [Vessel NER Worker](../../workers/vessel-ner/README.md)
