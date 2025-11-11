# Living Schema Strategy for Oceanid Intelligence Platform

**Status**: RFC
**Created**: 2025-01-11
**Owner**: Platform Team

## Executive Summary

Oceanid is pivoting to a **living schema** architecture where:
- MotherDuck becomes the primary database (replacing PostgreSQL + Graphile)
- Schema evolves automatically as SMEs discover new entity types in Argilla
- CSV/XLS workers output Parquet → MotherDuck
- SQLrooms provides AI-powered analytics with auto-updating schema awareness
- Point-in-time queries and full lineage tracking are native

**Core Principle**: *"Fresh by default, frozen on demand"*

---

## The Problem We're Solving

### Current Pain Points
1. **Schema rigidity**: Adding new entity types requires migrations
2. **Multiple sources of truth**: PostgreSQL + MotherDuck + Argilla schemas drift
3. **SME friction**: Annotators can't add new labels without engineering changes
4. **Analytics lag**: Schema changes don't propagate to query layer automatically

### What Success Looks Like
- SME annotates document with new entity type → available in SQLrooms within 1 hour
- CSV worker updated → new columns queryable immediately
- Historical queries always reproducible (compliance/audit)
- No manual schema migrations, ever

---

## Architecture

### Data Flow

```
┌─────────────┐
│ PDF Upload  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐         ┌──────────────┐
│ DeepSeek OCR    │────────▶│ R2 Parquet   │
│ (Worker)        │         │ vessel-ocr/  │
└─────────────────┘         └──────┬───────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │ MotherDuck   │
                            │ raw_ocr      │
                            └──────┬───────┘
                                   │
┌─────────────┐                    │
│ Argilla     │◀───────────────────┘
│ Annotation  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐         ┌──────────────┐
│ Argilla Sync    │────────▶│ MotherDuck   │
│ (Queue Worker)  │         │ annotations  │
└─────────────────┘         └──────┬───────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │ Schema       │
                            │ Discovery    │
                            └──────┬───────┘
                                   │
                                   ▼
┌─────────────┐             ┌──────────────┐
│ SQLrooms    │◀────────────│ Schema       │
│ (AI Query)  │             │ Catalog      │
└─────────────┘             └──────────────┘
```

### CSV/XLS Flow

```
┌─────────────┐         ┌──────────────┐
│ CSV Upload  │────────▶│ CSV Worker   │
│             │         │ (Go)         │
└─────────────┘         └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ Parquet      │
                        │ (cleaned)    │
                        └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ MotherDuck   │
                        │ structured_  │
                        │ data         │
                        └──────────────┘
```

---

## Database Schema

### Core Tables

```sql
-- Raw document ingestion (immutable, append-only)
CREATE TABLE raw_documents (
  document_id UUID PRIMARY KEY,
  source_type TEXT, -- 'pdf_ocr', 'csv_manifest', 'csv_port_calls'
  batch_id UUID,
  uploaded_at TIMESTAMP,
  raw_content_hash TEXT, -- SHA256 of original file
  raw_content_url TEXT,  -- R2 URL
  parsed_data JSONB      -- flexible catch-all
);

-- Annotations from Argilla (append-only, never updated)
CREATE TABLE annotations (
  annotation_id UUID PRIMARY KEY,
  document_id UUID,
  record_id TEXT,        -- Argilla record ID
  annotator TEXT,
  annotated_at TIMESTAMP,
  entities JSONB[],      -- [{type: "VESSEL", value: "MSC OSCAR", start: 0, end: 10}]
  metadata JSONB,        -- tags, confidence, project context
  schema_version INT     -- which entity taxonomy was active
);

-- CSV/XLS structured data (schema evolves)
CREATE TABLE structured_data (
  row_id UUID PRIMARY KEY,
  source TEXT,           -- 'openzl_manifest', 'customs_data', worker identifier
  batch_id UUID,
  uploaded_at TIMESTAMP,
  columns JSONB,         -- all columns as key-value pairs
  schema_version INT
);
```

### Schema Catalog (Living Schema)

```sql
-- Entity types discovered from Argilla
CREATE TABLE entity_types (
  type_name TEXT PRIMARY KEY,
  first_seen TIMESTAMP,
  last_seen TIMESTAMP,
  occurrence_count INT DEFAULT 0,
  example_values TEXT[],
  description TEXT,          -- LLM-generated or SME-provided
  active BOOLEAN DEFAULT TRUE,
  review_status TEXT         -- 'auto_approved', 'flagged', 'approved', 'merged'
);

-- Field definitions from CSV workers
CREATE TABLE field_definitions (
  field_name TEXT,
  source TEXT,               -- which CSV worker/source
  data_type TEXT,
  nullable BOOLEAN,
  first_seen TIMESTAMP,
  last_seen TIMESTAMP,
  occurrence_count INT DEFAULT 0,
  description TEXT,
  active BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (field_name, source)
);

-- Schema versions (point-in-time snapshots)
CREATE TABLE schema_snapshots (
  version INT PRIMARY KEY,
  created_at TIMESTAMP,
  entity_types JSONB,        -- snapshot of active entities
  field_definitions JSONB,   -- snapshot of active fields
  changes JSONB,             -- what changed from previous version
  trigger_reason TEXT        -- 'new_entity', 'new_field', 'manual_consolidation'
);

-- Entity type conflicts (human review queue)
CREATE TABLE entity_conflicts (
  conflict_id UUID PRIMARY KEY,
  entity_a TEXT,
  entity_b TEXT,
  similarity_score FLOAT,     -- Levenshtein distance or embedding similarity
  first_flagged TIMESTAMP,
  resolution TEXT,            -- 'merge', 'keep_both', 'rename'
  resolved_by TEXT,
  resolved_at TIMESTAMP
);
```

### Query Execution Tracking

```sql
-- Every query execution logs context
CREATE TABLE query_executions (
  execution_id UUID PRIMARY KEY,
  query_id UUID,              -- links to saved queries
  user_id TEXT,
  executed_at TIMESTAMP,
  schema_version INT,
  data_range_start TIMESTAMP, -- what data was queried
  data_range_end TIMESTAMP,
  query_text TEXT,
  result_hash TEXT,           -- for change detection
  row_count INT,
  execution_time_ms INT,
  mode TEXT                   -- 'live', 'snapshot', 'time_travel'
);

-- Saved reports/queries
CREATE TABLE saved_queries (
  query_id UUID PRIMARY KEY,
  user_id TEXT,
  name TEXT,
  description TEXT,
  query_text TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  schema_version INT,         -- pinned to schema at creation
  data_snapshot_id UUID,      -- optional: materialized results
  refresh_strategy TEXT       -- 'frozen', 'time_travel', 'always_latest'
);
```

---

## Auto-Discovery Pipeline

### Trigger Conditions
1. **Argilla sync completes** (hourly via Queue Worker)
2. **CSV worker finishes batch** (webhook from worker)
3. **Manual schema review** (SME flags entity conflict)

### Discovery Algorithm

```python
def discover_schema_changes(batch_id: str, source_type: str):
    """
    Scans new data for schema changes and updates catalog.
    Returns: schema_version (int) if changed, None if no changes
    """

    if source_type == 'argilla_annotations':
        # Scan for new entity types
        new_entities = db.query("""
            SELECT DISTINCT
                entity->>'type' as entity_type,
                array_agg(entity->>'value') as examples
            FROM annotations,
            LATERAL unnest(entities) as entity
            WHERE batch_id = ?
            GROUP BY entity->>'type'
        """, batch_id)

        for entity in new_entities:
            existing = db.query(
                "SELECT * FROM entity_types WHERE type_name = ?",
                entity.type
            )

            if not existing:
                # New entity type discovered
                similar = find_similar_entity_types(entity.type)

                if similar:
                    # Flag for human review
                    db.insert('entity_conflicts', {
                        'entity_a': entity.type,
                        'entity_b': similar[0].type_name,
                        'similarity_score': similar[0].score,
                        'first_flagged': now()
                    })
                    notify_slack(f"⚠️ New entity type '{entity.type}' similar to '{similar[0].type_name}'")
                else:
                    # Auto-approve
                    db.insert('entity_types', {
                        'type_name': entity.type,
                        'first_seen': now(),
                        'example_values': entity.examples[:5],
                        'description': llm_describe(entity),
                        'review_status': 'auto_approved'
                    })
                    trigger_schema_version_increment(f"New entity type: {entity.type}")
            else:
                # Update last_seen and occurrence_count
                db.update('entity_types', {
                    'last_seen': now(),
                    'occurrence_count': existing.occurrence_count + 1
                }, where={'type_name': entity.type})

    elif source_type == 'csv_structured':
        # Scan for new columns
        new_columns = db.query("""
            SELECT DISTINCT
                jsonb_object_keys(columns) as field_name,
                source
            FROM structured_data
            WHERE batch_id = ?
        """, batch_id)

        for col in new_columns:
            existing = db.query(
                "SELECT * FROM field_definitions WHERE field_name = ? AND source = ?",
                col.field_name, col.source
            )

            if not existing:
                # Infer data type from sample values
                sample_values = db.query("""
                    SELECT columns->>? as value
                    FROM structured_data
                    WHERE batch_id = ?
                    LIMIT 100
                """, col.field_name, batch_id)

                data_type = infer_type(sample_values)

                db.insert('field_definitions', {
                    'field_name': col.field_name,
                    'source': col.source,
                    'data_type': data_type,
                    'first_seen': now(),
                    'description': llm_describe_field(col.field_name, sample_values)
                })
                trigger_schema_version_increment(f"New field: {col.field_name} from {col.source}")
            else:
                db.update('field_definitions', {
                    'last_seen': now(),
                    'occurrence_count': existing.occurrence_count + 1
                }, where={'field_name': col.field_name, 'source': col.source})


def trigger_schema_version_increment(reason: str):
    """Create new schema snapshot and notify systems."""
    current_version = db.query("SELECT MAX(version) FROM schema_snapshots")[0]
    new_version = current_version + 1

    # Snapshot current state
    entity_types = db.query("SELECT * FROM entity_types WHERE active = TRUE")
    field_defs = db.query("SELECT * FROM field_definitions WHERE active = TRUE")

    # Calculate changes
    prev_snapshot = db.query("SELECT * FROM schema_snapshots WHERE version = ?", current_version)
    changes = calculate_diff(prev_snapshot, entity_types, field_defs)

    db.insert('schema_snapshots', {
        'version': new_version,
        'created_at': now(),
        'entity_types': entity_types.to_json(),
        'field_definitions': field_defs.to_json(),
        'changes': changes,
        'trigger_reason': reason
    })

    # Notify systems
    notify_slack(f"📊 Schema version {new_version}: {reason}")
    invalidate_llm_cache()  # Force SQLrooms to refresh schema context
```

### Entity Conflict Detection

```python
def find_similar_entity_types(new_type: str, threshold: float = 0.85) -> list:
    """
    Find existing entity types similar to new_type.
    Uses Levenshtein distance and optionally embedding similarity.
    """
    existing = db.query("SELECT type_name FROM entity_types WHERE active = TRUE")

    similar = []
    for entity in existing:
        # Levenshtein distance normalized
        distance = levenshtein(new_type.lower(), entity.type_name.lower())
        max_len = max(len(new_type), len(entity.type_name))
        similarity = 1 - (distance / max_len)

        if similarity >= threshold:
            similar.append({
                'type_name': entity.type_name,
                'score': similarity
            })

    return sorted(similar, key=lambda x: x['score'], reverse=True)
```

---

## SQLrooms Query Modes

### 1. Live Queries (Default)

**Use case**: Dashboards, real-time analytics
**Behavior**: Always query latest data with current schema

```typescript
interface LiveQuery {
  mode: 'live';
  query_text: string;
}

// Example
const query: LiveQuery = {
  mode: 'live',
  query_text: "SELECT vessel_name, COUNT(*) FROM annotations WHERE entities @> '[{\"type\": \"VESSEL\"}]' GROUP BY vessel_name"
};
```

### 2. Snapshot Queries

**Use case**: Saved reports, compliance documents
**Behavior**: Data frozen at creation time, schema pinned

```typescript
interface SnapshotQuery {
  mode: 'snapshot';
  query_text: string;
  schema_version: number;
  data_as_of: Date;
  snapshot_id?: string;  // Optional: pre-computed results
}

// When user clicks "Save Report"
const savedReport = await createSnapshot(liveQuery);
// Returns: { snapshot_id, schema_version, data_as_of, row_count }
```

### 3. Time-Travel Queries

**Use case**: Historical analysis, "what did we know on date X?"
**Behavior**: Query data as it existed at specific point in time

```typescript
interface TimeTravelQuery {
  mode: 'time_travel';
  query_text: string;
  as_of_date: Date;
}

// Example: "Show me all VESSEL annotations from October 2024"
const query: TimeTravelQuery = {
  mode: 'time_travel',
  query_text: "SELECT * FROM annotations WHERE entities @> '[{\"type\": \"VESSEL\"}]'",
  as_of_date: new Date('2024-10-31')
};

// Backend transforms to:
// SELECT * FROM annotations
// WHERE annotated_at <= '2024-10-31'
//   AND schema_version <= (SELECT version FROM schema_snapshots WHERE created_at <= '2024-10-31' ORDER BY version DESC LIMIT 1)
```

---

## LLM Integration for SQLrooms

### Schema Context for LLM

```typescript
async function generateSQL(userQuery: string, mode: QueryMode): Promise<string> {
  // Fetch appropriate schema context
  const schema = mode === 'time_travel'
    ? await getSchemaAtDate(mode.as_of_date)
    : await getCurrentSchema();

  // Build context for LLM
  const context = {
    tables: [
      {
        name: 'annotations',
        description: 'Annotated entities from Argilla',
        columns: [
          { name: 'document_id', type: 'UUID', description: 'Source document' },
          { name: 'entities', type: 'JSONB[]', description: 'Array of entity objects' },
          { name: 'annotated_at', type: 'TIMESTAMP', description: 'When annotation was created' }
        ]
      },
      {
        name: 'structured_data',
        description: 'Cleaned CSV/XLS data',
        columns: buildDynamicColumns(schema.field_definitions)
      }
    ],
    entity_types: schema.entity_types.map(e => ({
      type: e.type_name,
      description: e.description,
      examples: e.example_values
    })),
    examples: [
      {
        natural: "Show me all vessels mentioned in October",
        sql: "SELECT DISTINCT entity->>'value' as vessel_name FROM annotations, unnest(entities) as entity WHERE entity->>'type' = 'VESSEL' AND annotated_at BETWEEN '2024-10-01' AND '2024-10-31'"
      }
    ]
  };

  const prompt = `
You are a SQL expert for an intelligence platform. Generate a DuckDB SQL query for:

User query: ${userQuery}

Available schema:
${JSON.stringify(context, null, 2)}

Rules:
- Use JSONB operators for entity queries: @>, ->>, unnest()
- Always filter by date ranges for performance
- Use appropriate JOINs between tables
- Return human-readable column names

Generate SQL:
  `;

  const sql = await llm.generate(prompt);
  return sql;
}
```

### Change Detection for Saved Reports

```typescript
async function detectReportChanges(report_id: string): Promise<ChangeReport> {
  const report = await db.query(
    "SELECT * FROM saved_queries WHERE query_id = ?",
    report_id
  );

  // Re-run query with current data
  const currentResults = await executeQuery({
    mode: 'live',
    query_text: report.query_text
  });

  // Compare to saved snapshot
  const snapshotResults = await db.query(
    "SELECT result_hash, row_count FROM query_executions WHERE query_id = ? ORDER BY executed_at DESC LIMIT 1",
    report_id
  );

  const hashChanged = currentResults.hash !== snapshotResults.result_hash;
  const countChanged = currentResults.row_count !== snapshotResults.row_count;

  if (hashChanged || countChanged) {
    return {
      changed: true,
      row_count_delta: currentResults.row_count - snapshotResults.row_count,
      suggested_action: "Report results have changed. Click 'Refresh' to update or view diff."
    };
  }

  return { changed: false };
}
```

---

## Monitoring & Metrics

### Schema Churn Dashboard

```sql
-- Weekly schema activity
CREATE VIEW schema_churn AS
SELECT
  date_trunc('week', created_at) as week,
  COUNT(*) as new_versions,
  SUM((changes->>'new_entities')::int) as new_entities_count,
  SUM((changes->>'new_fields')::int) as new_fields_count,
  array_agg(trigger_reason) as reasons
FROM schema_snapshots
GROUP BY week
ORDER BY week DESC
LIMIT 12;  -- Last 12 weeks
```

### Entity Type Health

```sql
-- Flag stale or rarely-used entity types
CREATE VIEW entity_health AS
SELECT
  type_name,
  occurrence_count,
  last_seen,
  CASE
    WHEN last_seen < NOW() - INTERVAL '30 days' THEN 'stale'
    WHEN occurrence_count < 10 THEN 'rare'
    WHEN review_status = 'flagged' THEN 'needs_review'
    ELSE 'healthy'
  END as status
FROM entity_types
WHERE active = TRUE
ORDER BY occurrence_count DESC;
```

### Query Performance

```sql
-- Slow queries by schema version
CREATE VIEW slow_queries AS
SELECT
  schema_version,
  AVG(execution_time_ms) as avg_time,
  MAX(execution_time_ms) as max_time,
  COUNT(*) as query_count
FROM query_executions
WHERE executed_at > NOW() - INTERVAL '7 days'
GROUP BY schema_version
HAVING AVG(execution_time_ms) > 5000  -- 5 seconds
ORDER BY avg_time DESC;
```

---

## Decision Triggers

### When to intervene manually:

| Metric | Threshold | Action |
|--------|-----------|--------|
| Schema versions per day | > 10 | Review entity approval process |
| Entity conflicts flagged | > 5 unresolved | Consolidation sprint |
| Query execution time | > 5 seconds avg | Add indexes or materialized views |
| Schema snapshots total | > 1000 | Consolidate old versions |
| Entity types with occurrence_count < 10 | > 20% of total | Review and archive rare types |

### Escape Hatches

1. **Schema consolidation**: Quarterly review to merge similar entity types
2. **Materialized views**: Create pre-computed views for common queries
3. **Partitioning**: If tables > 10M rows, partition by month/year
4. **Archive old versions**: Move schema_snapshots older than 1 year to cold storage

---

## Migration Plan from Current System

### Phase 1: MotherDuck Foundation (Week 1-2)
- [ ] Create core tables (raw_documents, annotations, structured_data)
- [ ] Create schema catalog tables (entity_types, field_definitions, schema_snapshots)
- [ ] Migrate existing Argilla annotations → MotherDuck annotations table
- [ ] Set up R2 → MotherDuck ingestion for Parquet files

### Phase 2: Auto-Discovery Pipeline (Week 3-4)
- [ ] Build schema discovery job (Python/Deno)
- [ ] Integrate with Argilla sync worker
- [ ] Implement entity conflict detection
- [ ] Set up Slack notifications for schema changes

### Phase 3: CSV Worker Updates (Week 5)
- [ ] Update Go CSV workers to output Parquet
- [ ] Add schema_version metadata to Parquet files
- [ ] Wire up CSV ingestion → discovery pipeline

### Phase 4: SQLrooms Integration (Week 6-8)
- [ ] Build LLM schema context API
- [ ] Implement query mode handler (live/snapshot/time_travel)
- [ ] Create saved reports UI
- [ ] Add change detection for reports

### Phase 5: Monitoring & Refinement (Week 9+)
- [ ] Deploy schema churn dashboard
- [ ] Set up automated alerts for thresholds
- [ ] Train SMEs on new workflow
- [ ] Collect feedback and iterate

---

## Open Questions

1. **CSV worker Git tracking**: Should we store Git commit SHA in structured_data.columns metadata to link data to code version?

2. **Entity type lifecycle**: When should we archive/deprecate old entity types that are no longer used?

3. **Schema consolidation frequency**: Manual quarterly review, or automated based on metrics?

4. **Performance optimization**: At what data volume should we introduce materialized views or partitioning?

5. **Multi-tenant schema**: If different teams/projects use different entity taxonomies, do we need project-scoped schema catalogs?

---

## Success Metrics

### Technical
- Schema discovery latency: < 1 hour from annotation to query availability
- Query performance: 95th percentile < 3 seconds
- Zero manual schema migrations after go-live

### Product
- SME time-to-value: New entity type usable without engineering
- Report reproducibility: 100% of saved reports return consistent results
- Schema stability: < 5 schema versions per week after initial ramp

### Business
- Annotation velocity: 2x increase (no schema friction)
- Query adoption: SQLrooms queries grow 10% week-over-week
- Compliance confidence: Audit queries succeed on first attempt

---

## References

- [MotherDuck Schema Evolution](https://motherduck.com/docs/)
- [DuckDB JSONB Functions](https://duckdb.org/docs/sql/functions/json)
- [Argilla Annotation Schema](https://docs.argilla.io/)
- [Parquet Metadata Spec](https://parquet.apache.org/docs/)
