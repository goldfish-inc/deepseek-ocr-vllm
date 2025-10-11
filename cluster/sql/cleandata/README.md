# Oceanid Cleaned Data Schema

Database for storing ML-cleaned vessel registry data from RFMO sources with JSONB flexibility and comprehensive change tracking.

## Database Information

- **Cluster**: Crunchy Bridge Ebisu (PostgreSQL 17.5)
- **Database**: `cleandata`
- **Schema**: `cleandata`
- **Connection**: Stored in ESC as `oceanid-cluster:cleandataDbUrl`
- **Owner**: `cleandata_owner` (application role with full schema access)
- **Superuser**: `postgres` (administrative access only)

## Schema Design

### Core Tables

#### `vessels`
Primary table for vessel registry data with JSONB fields for flexible schema across different RFMO formats.

**Key Features**:
- JSONB fields for `raw_data`, `cleaned_data`, and `validation_data`
- Normalized fields for common queries (`vessel_name`, `imo_number`, `call_sign`, `flag_state`)
- Processing status tracking (`raw` → `extracted` → `cleaned` → `validated` → `published`)
- Versioning with `previous_version_id` for full change history

**JSONB Structure**:
```json
{
  "raw_data": {
    // Original extracted data from PDF/CSV/Excel
    "vessel_name": "PACIFIC SUNRISE",
    "imo": "9234567",
    "flag": "Panama"
  },
  "cleaned_data": {
    // ML-normalized data
    "vessel_name": "PACIFIC SUNRISE",
    "imo_number": "IMO 9234567",
    "flag_state": "PA"
  },
  "validation_data": {
    // Human corrections from Label Studio
    "corrected_fields": ["flag_state"],
    "notes": "Verified with IMO database"
  }
}
```

#### `vessel_changes`
Audit trail for all changes to vessel records.

**Captures**:
- Field-level changes with old/new values
- Change type (`create`, `update`, `validate`, `publish`)
- User/service attribution
- Full data snapshot at time of change
- Optional Link to Label Studio task ID

#### `data_quality_metrics`
Statistics for tracking data quality per source file.

**Metrics**:
- Total vs complete records
- IMO number presence
- Duplicate detection
- Validation errors by field
- Processing time and correction counts

## Data Sources

The schema supports vessel registries from 12 RFMOs:

| Source | Full Name | Region |
|--------|-----------|--------|
| CCSBT | Commission for the Conservation of Southern Bluefin Tuna | Southern Ocean |
| FFA | Pacific Islands Forum Fisheries Agency | Pacific |
| IATTC | Inter-American Tropical Tuna Commission | Eastern Pacific |
| ICCAT | International Commission for the Conservation of Atlantic Tunas | Atlantic |
| IOTC | Indian Ocean Tuna Commission | Indian Ocean |
| NAFO | Northwest Atlantic Fisheries Organization | NW Atlantic |
| NEAFC | North East Atlantic Fisheries Commission | NE Atlantic |
| NPFC | North Pacific Fisheries Commission | North Pacific |
| PNA | Parties to the Nauru Agreement | Pacific |
| SEAFO | South East Atlantic Fisheries Organisation | SE Atlantic |
| SPRFMO | South Pacific Regional Fisheries Management Organisation | South Pacific |
| WCPFC | Western and Central Pacific Fisheries Commission | West/Central Pacific |

## Usage Examples

### Inserting Raw Data
```sql
INSERT INTO cleandata.vessels (
    source,
    source_file,
    source_date,
    raw_data,
    vessel_name,
    imo_number,
    created_by
) VALUES (
    'WCPFC',
    'WCPFC_vessels_2025-08-26.csv',
    '2025-08-26',
    '{"vessel_name": "PACIFIC SUNRISE", "imo": "9234567", "flag": "Panama"}'::jsonb,
    'PACIFIC SUNRISE',
    '9234567',
    'pdf-extraction-service'
);
```

### Updating with ML Cleaned Data
```sql
UPDATE cleandata.vessels
SET
    cleaned_data = '{"vessel_name": "PACIFIC SUNRISE", "imo_number": "IMO 9234567", "flag_state": "PA"}'::jsonb,
    status = 'cleaned',
    cleaned_at = NOW(),
    updated_by = 'ml-cleaning-service'
WHERE id = 'uuid-here';
```

### Adding Human Validation
```sql
UPDATE cleandata.vessels
SET
    validation_data = '{"corrected_fields": ["flag_state"], "notes": "Verified with IMO database"}'::jsonb,
    status = 'validated',
    validated_at = NOW(),
    updated_by = 'ryan@goldfish.io'
WHERE id = 'uuid-here';
```

### Querying JSONB Fields
```sql
-- Find vessels with specific IMO in any data field
SELECT *
FROM cleandata.vessels
WHERE
    raw_data->>'imo' = '9234567'
    OR cleaned_data->>'imo_number' = 'IMO 9234567';

-- Find all Panama-flagged vessels
SELECT *
FROM cleandata.vessels
WHERE
    cleaned_data->>'flag_state' = 'PA'
    OR raw_data->>'flag' ILIKE '%panama%';

-- Get vessels needing validation
SELECT *
FROM cleandata.vessels
WHERE status = 'cleaned'
ORDER BY cleaned_at DESC;
```

### Tracking Changes
```sql
-- Get full change history for a vessel
SELECT
    vc.changed_at,
    vc.changed_by,
    vc.change_type,
    vc.changed_fields,
    vc.change_reason
FROM cleandata.vessel_changes vc
WHERE vessel_id = 'uuid-here'
ORDER BY changed_at DESC;

-- Find recent validations
SELECT
    v.vessel_name,
    v.imo_number,
    vc.changed_at,
    vc.changed_by,
    vc.changed_fields
FROM cleandata.vessels v
JOIN cleandata.vessel_changes vc ON v.id = vc.vessel_id
WHERE vc.change_type = 'validate'
    AND vc.changed_at > NOW() - INTERVAL '7 days';
```

### Data Quality Reports
```sql
-- Quality metrics by source
SELECT
    source,
    source_file,
    total_records,
    complete_records,
    ROUND(100.0 * complete_records / NULLIF(total_records, 0), 2) as completeness_pct,
    imo_present,
    duplicates_found
FROM cleandata.data_quality_metrics
ORDER BY source, source_date DESC;

-- Processing status summary
SELECT
    source,
    status,
    COUNT(*) as count
FROM cleandata.vessels
GROUP BY source, status
ORDER BY source, status;
```

## Automated Triggers

The schema includes automated triggers for:

1. **Timestamp Updates**: `updated_at` automatically updates on row modifications
2. **Change Logging**: All INSERTs and UPDATEs automatically log to `vessel_changes`
3. **Field Tracking**: Changes to `raw_data`, `cleaned_data`, `validation_data`, and `status` are automatically tracked

## Indexes

Performance-optimized with indexes on:

- Source and status fields
- Normalized vessel identifiers (IMO, call sign, flag)
- GIN indexes on all JSONB columns for fast queries
- Change tracking timestamps and types

## Security

- Schema-level permissions for data isolation
- Row-level security can be added for multi-tenant access
- All sensitive operations logged in `vessel_changes`

## Integration Points

### S3 Storage
- SMEs upload raw PDF/CSV/Excel files via web interface
- Files stored in AWS S3 bucket (configured in Label Studio)
- Source of truth for original documents

### Granite-Docling GPU Server
- Reads files from S3
- ML-powered extraction using Granite-Docling-258M model
- Pre-labels data with confidence scores
- Handles complex PDFs (tables, formulas, multi-column layouts)
- Outputs pre-labeled data to Label Studio

### Label Studio
- Loads pre-labeled data from Granite-Docling
- SMEs validate and correct pre-labels
- Exports TWO outputs:
  1. **Annotations → Hugging Face** (training data to improve Granite-Docling)
  2. **Clean data → PostgreSQL** (validated vessel records for applications)
- `vessel_changes.label_studio_task_id` links changes to annotation tasks

### Hugging Face
- **Source of Truth for Training Data**: Stores Label Studio annotations
- Used to retrain/improve Granite-Docling model
- Versioned training datasets
- Hosts trained models

### PostgreSQL `cleandata` Schema
- **Destination**: Receives validated data FROM Label Studio exports
- Stores final clean vessel records for application queries
- NOT a source for Label Studio (Label Studio reads from S3/Granite-Docling)

### Actual Workflow
```
1. SME Upload
   ↓
   S3 Storage (raw PDF/CSV/Excel files)
   ↓
2. Granite-Docling GPU Server
   - Extracts tables, text, formulas
   - Pre-labels vessel data with ML
   ↓
3. Label Studio
   - SME validates pre-labels
   - SME corrects errors
   ↓
4. Export (dual output):
   ├─→ Hugging Face (annotations for model training)
   │   ↓
   │   Retrain Granite-Docling → Improve extraction
   │
   └─→ PostgreSQL cleandata (clean vessel records)
       ↓
       Applications query validated data
```

## Future Enhancements

- Materialized views for common aggregations
- Partitioning by `source` or `source_date` for very large datasets
- Additional indexes based on query patterns
- Row-level security for team-based access control
- Time-series analysis tables for trend tracking

## Connection

Use the ESC-managed connection string:

```bash
# Get connection URL from Pulumi ESC
pulumi env get default/oceanid-cluster --show-secrets | grep cleandataDbUrl

# Or use in application code
DATABASE_URL=$(pulumi config get cleandataDbUrl)
```

The search path is pre-configured to `cleandata,public` so queries don't need schema prefixes.
