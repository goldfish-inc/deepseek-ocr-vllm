# ML Document Processing Flow - Technical Architecture

## System Overview

The document processing pipeline consists of three parallel paths that all trigger automatically when a PDF is uploaded to Label Studio:

1. **NER Path**: Text extraction → Entity detection → Pre-annotations in Label Studio UI
2. **Table Path**: Table extraction → CSV export → CSV ingestion worker → Database
3. **Webhook Path**: User annotations → Annotations sink → Database (curated data)

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Label Studio                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  User uploads PDF → Creates Task (task_id, project_id)    │ │
│  │  Triggers: GET /predict_ls?task=[task_id]                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│              ls-triton-adapter (ML Backend)                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. Fetch PDF from Label Studio                          │   │
│  │  2. Send to Triton: docling_granite_python model         │   │
│  │  3. Get DoclingResult:                                   │   │
│  │     - text: string (full document text)                  │   │
│  │     - tables: []DoclingTable (headers + rows)            │   │
│  │     - pages, word_count, char_count                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─── Path A: NER Processing ─────────────────────────────┐    │
│  │  1. Tokenize text with BERT tokenizer                    │   │
│  │  2. Send to Triton: ner-distilbert model                 │   │
│  │  3. Get logits: [batch, seq_len, num_labels]             │   │
│  │  4. Decode to entities with char offsets                 │   │
│  │  5. Return LSPrediction to Label Studio                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─── Path B: Table Extraction (if tables exist) ─────────┐    │
│  │  1. For each table in DoclingResult:                     │   │
│  │     - Convert to CSV format                              │   │
│  │     - Upload to S3:                                      │   │
│  │       s3://[bucket]/docling-tables/[proj]/[task]-table-N │   │
│  │  2. Trigger CSV worker webhook for each table            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Label Studio UI                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Shows:                                                     │ │
│  │  - Extracted text                                           │ │
│  │  - Pre-annotations (colored boxes)                          │ │
│  │  - SME reviews/corrects                                     │ │
│  │  - Clicks "Submit"                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                    annotations-sink                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Receives webhook:                                          │ │
│  │  - ANNOTATION_CREATED                                       │ │
│  │  - ANNOTATION_UPDATED                                       │ │
│  │                                                             │ │
│  │  Routes to database (curated annotations)                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              csv-ingestion-worker (Parallel Path)                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Receives webhook from ls-triton-adapter:                  │ │
│  │  {                                                          │ │
│  │    "action": "TASK_CREATED",                               │ │
│  │    "task": {                                                │ │
│  │      "id": task_id,                                         │ │
│  │      "project": project_id,                                 │ │
│  │      "data": {                                              │ │
│  │        "file_upload": "s3://bucket/docling-tables/..."    │ │
│  │      }                                                       │ │
│  │    }                                                         │ │
│  │  }                                                           │ │
│  │                                                             │ │
│  │  1. Downloads CSV from S3                                  │ │
│  │  2. Processes table data                                   │ │
│  │  3. Inserts into database (raw/stage tables)               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Flow: PDF Upload to Database

### 1. User Action
```
Label Studio UI → Upload PDF
  ↓
Creates Task: {id: 123, project: 5, data: {file_upload: "s3://..."}}
```

### 2. Label Studio Calls ML Backend
```
GET /predict_ls?task=123
  ↓
ls-triton-adapter receives request
```

### 3. ls-triton-adapter Processing

#### Step 3A: Fetch PDF
```go
// main.go:740-760
pdfBytes := downloadPDFFromLabelStudio(task.Data.FileUpload)
```

#### Step 3B: Docling Extraction
```go
// triton_docling.go:extractDocumentText()
tritonRequest := {
  model_name: "docling_granite_python",
  inputs: [{
    name: "pdf_bytes",
    datatype: "BYTES",
    data: [base64(pdfBytes)]
  }]
}

// Triton response
doclingResult := {
  text: "VESSEL REGISTRY\nMV Pacific Explorer\nIMO: 9876543...",
  tables: [
    {
      headers: ["Vessel", "IMO", "Flag"],
      rows: [["Pacific Explorer", "9876543", "Panama"], ...]
    }
  ],
  pages: 2,
  word_count: 450
}
```

#### Step 3C: NER Processing
```go
// main.go:800-850
encoding := bertTokenizer.EncodeSingle(doclingResult.Text)
tokenIDs := encoding.GetIds()

tritonRequest := {
  model_name: "ner-distilbert",
  inputs: [{
    name: "input_ids",
    shape: [1, len(tokenIDs)],
    datatype: "INT64",
    data: tokenIDs
  }]
}

// Triton response: logits [1, seq_len, 9]
// Decode to entities
entities := decodeEntities(logits, encoding)
// Returns: [
//   {label: "VESSEL", text: "Pacific Explorer", start: 20, end: 35},
//   {label: "IMO", text: "9876543", start: 42, end: 49}
// ]
```

#### Step 3D: Table Processing (if tables exist)
```go
// s3_docling.go:uploadDoclingTablesToS3()
if len(doclingResult.Tables) > 0 {
  for i, table := range doclingResult.Tables {
    // Convert to CSV
    csvBytes := tableToCSV(table)

    // Upload to S3
    s3Key := fmt.Sprintf("docling-tables/%d/%d-table-%d.csv", projectID, taskID, i)
    s3Client.PutObject(bucket, s3Key, csvBytes)

    // Trigger CSV worker webhook
    webhookPayload := {
      action: "TASK_CREATED",
      task: {
        id: taskID,
        project: projectID,
        data: {
          file_upload: fmt.Sprintf("s3://%s/%s", bucket, s3Key),
          meta: {
            source_type: "docling-triton",
            doc_type: "extracted-table"
          }
        }
      }
    }

    http.Post(cfg.CSVWorkerWebhookURL, signedPayload)
  }
}
```

### 4. Response to Label Studio
```json
{
  "model_version": "ner-distilbert-v1",
  "score": 0.92,
  "result": [
    {
      "type": "labels",
      "from_name": "label",
      "to_name": "text",
      "value": {
        "start": 20,
        "end": 35,
        "text": "Pacific Explorer",
        "labels": ["VESSEL"]
      },
      "score": 0.95
    },
    {
      "type": "labels",
      "from_name": "label",
      "to_name": "text",
      "value": {
        "start": 42,
        "end": 49,
        "text": "9876543",
        "labels": ["IMO"]
      },
      "score": 0.98
    }
  ]
}
```

### 5. SME Reviews in Label Studio
- Sees text with colored highlights (pre-annotations)
- Accepts, rejects, or adds entities
- Clicks "Submit"

### 6. Annotations Sink Processes Submission
```
Label Studio webhook → annotations-sink
  ↓
{
  action: "ANNOTATION_CREATED",
  annotation: {
    id: 456,
    task: 123,
    result: [accepted/corrected entities],
    completed_by: user_id
  }
}
  ↓
Database: curated.annotations table
```

### 7. CSV Worker Processes Tables (Parallel)
```
csv-ingestion-worker receives webhook
  ↓
Downloads: s3://bucket/docling-tables/5/123-table-0.csv
  ↓
Parses CSV data
  ↓
Inserts into database:
  - raw.docling_tables (original data)
  - stage.vessel_registry (if mapped)
```

---

## Data Flow Summary

### Path 1: Text Entities (User-Facing)
```
PDF → Docling (text) → BERT NER → Pre-annotations → SME Review → Curated DB
```
**User sees**: Label Studio UI with highlights

### Path 2: Tables (Background)
```
PDF → Docling (tables) → S3 CSV → CSV Worker → Raw/Stage DB
```
**User doesn't see**: Happens automatically in background

### Path 3: Manual Annotations (User-Corrected)
```
SME Edits → Submit → Annotations Sink → Curated DB
```
**User sees**: Submit button confirmation

---

## Configuration

### ls-triton-adapter Environment Variables
```yaml
TRITON_BASE_URL: http://triton-server.triton:8000
TRITON_DOCLING_ENABLED: "true"
S3_BUCKET: labelstudio-goldfish-uploads
CSV_WORKER_WEBHOOK_URL: http://csv-ingestion-worker:8080/webhook
WEBHOOK_SECRET: [secret from ESC]
NER_LABELS: "O,VESSEL,IMO,FLAG,PORT,DATE,HS_CODE,COMMODITY,RISK_LEVEL"
```

### Label Studio ML Backend Setup
```
Project Settings → Machine Learning → Add
URL: http://ls-triton-adapter.apps.svc.cluster.local:9090
Title: Triton NER
is_interactive: true
```

### project-bootstrapper
**Note**: Only attaches ML backends when **creating new projects** via its API. For existing projects, backends must be attached manually or via the attach-backends script.

---

## Monitoring & Debugging

### Check if PDF Processed
```bash
# Check ls-triton-adapter logs
kubectl -n apps logs deploy/ls-triton-adapter | grep "task_id"

# Should see:
# "Docling extraction complete" - text extracted
# "Uploaded table to S3" - tables found and uploaded
# "Triggered CSV worker webhook" - CSV worker notified
```

### Verify Tables Extracted
```sql
-- Check S3 for CSV files
SELECT * FROM aws_s3.list_bucket('labelstudio-goldfish-uploads', 'docling-tables/');

-- Check if CSV worker processed
SELECT * FROM raw.docling_tables
WHERE task_id = 123;
```

### Verify NER Annotations
```sql
-- Check pre-annotations sent to Label Studio
-- (logged in ls-triton-adapter)

-- Check user-corrected annotations
SELECT * FROM curated.annotations
WHERE task_id = 123;
```

---

## Key Takeaways

1. **Everything is automatic** - No user action needed beyond uploading PDF
2. **Two parallel paths**:
   - NER → Label Studio UI (user reviews)
   - Tables → CSV worker → Database (background)
3. **SME role**: Review and correct NER pre-annotations only
4. **Tables bypass UI**: Go directly to database for analysis
5. **project-bootstrapper**: Only for **new** projects, not existing ones

---

## Common Issues

### Tables Not Appearing in Database
**Cause**: CSV worker webhook failed or S3 upload failed
**Debug**:
```bash
# Check ls-triton-adapter logs for upload errors
kubectl -n apps logs deploy/ls-triton-adapter | grep -i "s3\|csv"

# Check csv-ingestion-worker logs
kubectl -n apps logs deploy/csv-ingestion-worker | grep "task"
```

### Pre-annotations Not Showing in Label Studio
**Cause**: ML backend not attached to project
**Fix**:
```python
# Run attach-backends.py script
python scripts/attach-backends.py
```

### Docling Extraction Fails
**Cause**: PDF is scanned image or encrypted
**Debug**:
```bash
# Check Triton logs
kubectl -n apps logs deploy/ls-triton-adapter | grep "docling_no_text"
```

**Error codes**:
- `docling_no_text`: PDF extracted but no text found (scanned image)
- `docling_unavailable`: Triton server unreachable
- `s3_upload_failed`: S3 credentials or bucket issue

---

## Future Enhancements

1. **Automatic backend attachment**: Extend project-bootstrapper polling loop to attach ML backends to existing projects
2. **Table preview in UI**: Show extracted tables in Label Studio for SME review
3. **Multi-model ensemble**: Combine multiple NER models for better accuracy
4. **Active learning**: Prioritize tasks where ML model is uncertain
