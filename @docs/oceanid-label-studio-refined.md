# Label Studio + Triton Technical Workplan (Refined Implementation)

## Overview

Stand up a production-grade annotation, cleaning, and training platform where SMEs do minimal review work, predictions improve continuously (active learning), and Crunchy Bridge Postgres holds clean, queryable, versioned data with full lineage.

### Key Architectural Decisions

- **Language**: Go for all workers (98.5% memory reduction vs Python)
- **Database**: PostgreSQL via CrunchyBridge (labelfish for LS, staging/curated for data)
- **ML Framework**: ONNX models served via Triton Inference Server on dual RTX 4090s
- **Version Control**: HuggingFace Hub for datasets/models
- **Orchestration**: Kubernetes Jobs (no Airflow/Prefect complexity)
- **Secret Management**: Pulumi ESC → K8s Secrets
- **GitOps**: Flux CD for continuous deployment

### Critical Requirements

- **GPU-Only Processing**: All ML workloads on dual RTX 4090s, NO automatic CPU fallback
- **PII Handling**: Names remain unmasked for compliance tracking
- **Resource Efficiency**: Go microservices with <10Mi memory footprint
- **Data Lineage**: Full audit trail from source to curated

---

## Phase 1: CSV/XLSX Cleaning Pipeline (Week 1-2)

### Component: csv-ingestion-worker

**Purpose**: Apply cleaning rules to CSV/XLSX uploads and flag low-confidence cells for review

**Technical Specification**:
```go
// apps/csv-ingestion-worker/main.go
type Config struct {
    DatabaseURL     string
    S3Bucket       string
    S3Region       string
    ConfidenceJSON string // Thresholds by field type
}

type CellExtraction struct {
    DocumentID    int64
    RowIndex      int
    ColumnName    string
    RawValue      string
    CleanedValue  string
    Confidence    float64
    RuleChain     []int     // Applied rule IDs in order
    NeedsReview   bool
    Similarity    float64   // Levenshtein/Jaro-Winkler
    SourceType    string    // RFMO, COUNTRY, etc.
}

// Processing flow:
1. Webhook receives TASK_CREATED event
2. Fetch CSV/XLSX from S3 using presigned URL
3. For each cell:
   - Query stage.cleaning_rules WHERE
     source_type IN (doc.source_type, 'GLOBAL') AND
     (column_name = cell.column OR column_name IS NULL)
     ORDER BY priority ASC
   - Apply rules in priority order (max 3 passes)
   - Calculate composite confidence
   - Compare against field-specific threshold:
     * IMO/MMSI/IRCS: 0.98 (±0.02 for source trust)
     * Dates/Numbers: 0.95 (±0.02)
     * Names/Text: 0.90 (±0.02)
   - If confidence < threshold: needs_review = true
4. Batch insert to stage.csv_extractions
5. If any needs_review cells exist:
   - Call review-queue-manager API
```

**Confidence Calculation**:
```go
func calculateConfidence(rules []Rule, originalValue, cleanedValue string) float64 {
    baseConfidence := 0.5
    for i, rule := range rules {
        ruleConfidence := rule.BaseConfidence
        if i > 0 {
            // Diminishing returns for multiple rules
            ruleConfidence *= math.Pow(0.9, float64(i))
        }
        baseConfidence += ruleConfidence
    }

    // Similarity bonus/penalty
    similarity := calculateSimilarity(originalValue, cleanedValue)
    if similarity > 0.95 {
        baseConfidence += 0.05
    } else if similarity < 0.5 {
        baseConfidence -= 0.10
    }

    return math.Min(baseConfidence, 1.0)
}
```

**Deployment**:
```yaml
# cluster/src/components/csvIngestionWorker.ts
apiVersion: apps/v1
kind: Deployment
metadata:
  name: csv-ingestion-worker
  namespace: apps
spec:
  replicas: 2  # For parallel processing
  template:
    spec:
      containers:
      - name: worker
        image: ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:main
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: url
        - name: S3_BUCKET
          value: "oceanid-ml"
        - name: CONFIDENCE_CONFIG
          value: |
            {
              "IMO": {"base": 0.98, "trusted_bonus": 0.02},
              "MMSI": {"base": 0.98, "trusted_bonus": 0.02},
              "VESSEL_NAME": {"base": 0.90, "trusted_bonus": 0.02},
              "DATE": {"base": 0.95, "trusted_bonus": 0.02}
            }
```

### Component: review-queue-manager

**Purpose**: Create Label Studio tasks for ambiguous data requiring human review

**Technical Specification**:
```go
// apps/review-queue-manager/main.go

type ReviewBatch struct {
    DocumentID   int64
    ColumnName   string
    ReviewType   string  // "cell" or "column_batch"
    Priority     int     // Based on confidence gap
    CellCount    int
}

func createReviewTasks() error {
    // Query cells needing review, grouped for efficiency
    rows, err := db.Query(`
        WITH review_batches AS (
            SELECT
                document_id,
                column_name,
                COUNT(*) as cell_count,
                AVG(1.0 - confidence) as avg_uncertainty
            FROM stage.csv_extractions
            WHERE needs_review = true
              AND review_status IS NULL
            GROUP BY document_id, column_name
        )
        SELECT * FROM review_batches
        ORDER BY avg_uncertainty DESC, cell_count DESC
    `)

    for rows.Next() {
        var batch ReviewBatch
        rows.Scan(&batch)

        if batch.CellCount > 200 {
            // Create column batch task for systematic issues
            createColumnBatchTask(batch)
        } else {
            // Create individual cell tasks with context
            createCellTasks(batch)
        }
    }
}

func createCellTask(cell CellExtraction) {
    // Fetch row context
    rowContext := getRowContext(cell.DocumentID, cell.RowIndex)

    // Create Label Studio task
    task := map[string]interface{}{
        "data": map[string]interface{}{
            "raw_value":     cell.RawValue,
            "auto_cleaned":  cell.CleanedValue,
            "confidence":    cell.Confidence,
            "column_name":   cell.ColumnName,
            "row_context":   rowContext,
            "reason":        explainLowConfidence(cell),
            "suggestions":   getSimilarCorrections(cell),
        },
    }

    // POST to Label Studio API
    createLSTask(task)
}
```

**Label Studio Interface Configuration**:
```xml
<!-- CSV Review Interface -->
<View>
  <Header value="Review Data Cleaning: $column_name"/>

  <!-- Show full row for context -->
  <View style="background: #f5f5f5; padding: 10px; margin-bottom: 20px;">
    <Header value="Row Context" size="3"/>
    <Table name="context" value="$row_context"/>
  </View>

  <!-- Main review area -->
  <View style="display: flex; gap: 20px;">
    <View style="flex: 1;">
      <Header value="Original Value" size="4"/>
      <Text name="original" value="$raw_value"
            style="font-family: monospace; background: #ffe0e0;"/>
    </View>

    <View style="flex: 1;">
      <Header value="Auto-Cleaned Value" size="4"/>
      <Text name="cleaned" value="$auto_cleaned"
            style="font-family: monospace; background: #e0ffe0;"/>
    </View>
  </View>

  <!-- Review actions -->
  <Choices name="action" toName="cleaned" required="true">
    <Choice value="Accept" selected="true"/>
    <Choice value="Reject"/>
    <Choice value="Custom"/>
  </Choices>

  <!-- Custom correction input -->
  <TextArea name="correction" toName="cleaned"
            placeholder="Enter corrected value (if Custom selected)"
            showSubmitButton="false"
            visibleWhen="choice-selected"
            whenTagName="action"
            whenChoiceValue="Custom"/>

  <!-- Confidence and reasoning -->
  <View style="margin-top: 20px; padding: 10px; background: #f0f8ff;">
    <Text name="confidence_display" value="Confidence: $confidence"/>
    <Text name="reason_display" value="Flagged because: $reason"/>
  </View>

  <!-- Similar corrections from history -->
  <View style="margin-top: 10px;" visibleWhen="suggestions-exist">
    <Header value="Previous similar corrections" size="4"/>
    <List name="suggestions" value="$suggestions"/>
  </View>
</View>
```

---

## Phase 2: PDF Processing Pipeline (Week 3-4)

### Component: Docling GPU Model Configuration

**Purpose**: Configure Docling/Granite model for GPU-accelerated PDF extraction

**Triton Model Setup**:
```python
# triton-models/docling-granite-python/1/model.py
import triton_python_backend_utils as pb_utils
import numpy as np
import torch
from docling import DocumentConverter
from docling.config import DocumentConverterConfig
import os
import json

class TritonPythonModel:
    def initialize(self, args):
        """Initialize Docling with GPU support"""
        self.model_config = model_config = json.loads(args['model_config'])

        # GPU assignment (round-robin on dual 4090s)
        self.device_id = int(os.environ.get('CUDA_VISIBLE_DEVICES', '0'))
        torch.cuda.set_device(self.device_id)

        # Configure Docling for GPU
        config = DocumentConverterConfig(
            ocr_enabled=True,           # GPU OCR via PaddleOCR
            table_detection=True,        # GPU table detection
            table_structure=True,        # Extract cell structure
            form_detection=True,         # Key-value pairs
            device='cuda',
            batch_size=8,               # Optimal for 24GB VRAM
            num_workers=2,
        )

        self.converter = DocumentConverter(config)

    def execute(self, requests):
        """Process PDF pages through Docling"""
        responses = []

        for request in requests:
            # Get PDF bytes from request
            pdf_bytes = pb_utils.get_input_tensor_by_name(
                request, "pdf_content"
            ).as_numpy().tobytes()

            # Process with Docling
            with torch.cuda.amp.autocast():  # Mixed precision
                result = self.converter.convert(pdf_bytes)

            # Extract structured data
            output = {
                "pages": [],
                "tables": [],
                "text_blocks": [],
                "key_values": [],
            }

            for page_num, page in enumerate(result.pages):
                # Page-level extractions
                page_data = {
                    "page_num": page_num,
                    "width": page.width,
                    "height": page.height,
                    "elements": []
                }

                # Tables with cells
                for table in page.tables:
                    table_data = {
                        "type": "table",
                        "bbox": [table.x0, table.y0, table.x1, table.y1],
                        "confidence": table.confidence,
                        "cells": []
                    }

                    for cell in table.cells:
                        table_data["cells"].append({
                            "row": cell.row_idx,
                            "col": cell.col_idx,
                            "text": cell.text,
                            "bbox": cell.bbox,
                        })

                    page_data["elements"].append(table_data)
                    output["tables"].append(table_data)

                # Text blocks with OCR
                for text in page.text_blocks:
                    text_data = {
                        "type": "text",
                        "bbox": [text.x0, text.y0, text.x1, text.y1],
                        "text": text.content,
                        "confidence": text.confidence,
                    }
                    page_data["elements"].append(text_data)
                    output["text_blocks"].append(text_data)

                output["pages"].append(page_data)

            # Create output tensor
            output_tensor = pb_utils.Tensor(
                "extraction_result",
                np.array([json.dumps(output).encode('utf-8')])
            )

            responses.append(pb_utils.InferenceResponse([output_tensor]))

        return responses

    def finalize(self):
        """Cleanup GPU resources"""
        torch.cuda.empty_cache()
```

**Triton Configuration**:
```protobuf
# triton-models/docling-granite-python/config.pbtxt
name: "docling-granite-python"
backend: "python"
max_batch_size: 8

input [
  {
    name: "pdf_content"
    data_type: TYPE_STRING
    dims: [-1]
  }
]

output [
  {
    name: "extraction_result"
    data_type: TYPE_STRING
    dims: [-1]
  }
]

# GPU configuration for dual 4090s
instance_group [
  {
    count: 2
    kind: KIND_GPU
    gpus: [0, 1]
  }
]

# Dynamic batching for efficiency
dynamic_batching {
  preferred_batch_size: [4, 8]
  max_queue_delay_microseconds: 100000
}

# Optimization settings
optimization {
  cuda {
    graphs: true
  }
  execution_accelerators {
    gpu_execution_accelerator {
      name: "tensorrt"
      parameters {
        key: "precision_mode"
        value: "FP16"
      }
    }
  }
}

# Model warmup for faster first inference
model_warmup [
  {
    name: "warmup"
    batch_size: 1
    inputs {
      key: "pdf_content"
      value {
        data_type: TYPE_STRING
        dims: [1]
        input_data_file: "warmup_sample.pdf"
      }
    }
  }
]
```

### Component: pdf-ingestion-worker

**Purpose**: Process PDFs through Docling and generate page images for Label Studio

**Technical Specification**:
```go
// apps/pdf-ingestion-worker/main.go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "os/exec"
    "path/filepath"
)

type PDFProcessor struct {
    db          *sql.DB
    s3Client    *s3.Client
    tritonURL   string
}

func (p *PDFProcessor) processPDF(taskID int64, webhookData map[string]interface{}) error {
    // Extract PDF URL from webhook
    pdfURL := webhookData["data"].(map[string]interface{})["pdf_url"].(string)

    // Download PDF
    pdfBytes, err := p.downloadFromS3(pdfURL)
    if err != nil {
        return fmt.Errorf("download failed: %w", err)
    }

    // Generate page images (parallel processing)
    pageImages, err := p.generatePageImages(pdfBytes, taskID)
    if err != nil {
        return fmt.Errorf("page generation failed: %w", err)
    }

    // Call Triton Docling model
    extractions, err := p.callDocling(pdfBytes)
    if err != nil {
        return fmt.Errorf("docling extraction failed: %w", err)
    }

    // Store in database
    tx, err := p.db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Create document version
    versionID, err := p.createDocumentVersion(tx, taskID, webhookData)

    // Store page data
    for i, pageImage := range pageImages {
        _, err = tx.Exec(`
            INSERT INTO stage.document_pages
            (document_version_id, page_number, image_url, width, height)
            VALUES ($1, $2, $3, $4, $5)
        `, versionID, i+1, pageImage.URL, pageImage.Width, pageImage.Height)
    }

    // Store extraction results
    for _, table := range extractions.Tables {
        tableID, err := p.storeTable(tx, versionID, table)

        // Store table cells
        for _, cell := range table.Cells {
            p.storeTableCell(tx, tableID, cell)
        }
    }

    // Store OCR tokens
    for _, text := range extractions.TextBlocks {
        p.storeOCRToken(tx, versionID, text)
    }

    // Create Label Studio prelabels
    prelabels := p.createPrelabels(extractions, pageImages)
    err = p.sendPrelabelsToLS(taskID, prelabels)

    return tx.Commit()
}

func (p *PDFProcessor) generatePageImages(pdfBytes []byte, taskID int64) ([]PageImage, error) {
    // Use pdftoppm for high-quality rendering
    tmpDir := fmt.Sprintf("/tmp/pdf_%d", taskID)
    os.MkdirAll(tmpDir, 0755)
    defer os.RemoveAll(tmpDir)

    // Write PDF to temp file
    pdfPath := filepath.Join(tmpDir, "input.pdf")
    os.WriteFile(pdfPath, pdfBytes, 0644)

    // Convert to images (150-200 DPI for OCR quality)
    cmd := exec.Command("pdftoppm",
        "-jpeg",
        "-r", "150",
        "-jpegopt", "quality=90",
        pdfPath,
        filepath.Join(tmpDir, "page"))

    if err := cmd.Run(); err != nil {
        return nil, fmt.Errorf("pdftoppm failed: %w", err)
    }

    // Upload to S3 and collect URLs
    var pageImages []PageImage
    files, _ := filepath.Glob(filepath.Join(tmpDir, "page-*.jpg"))

    for i, file := range files {
        // Read image
        imageBytes, _ := os.ReadFile(file)

        // Get dimensions
        width, height := getImageDimensions(imageBytes)

        // Upload to S3
        s3Key := fmt.Sprintf("pdf/%d/v1/pages/%04d.jpg", taskID, i+1)
        url, err := p.uploadToS3(imageBytes, s3Key)

        pageImages = append(pageImages, PageImage{
            PageNum: i + 1,
            URL:     url,
            Width:   width,
            Height:  height,
        })
    }

    return pageImages, nil
}

func (p *PDFProcessor) callDocling(pdfBytes []byte) (*DoclingResult, error) {
    // Prepare Triton request
    request := map[string]interface{}{
        "inputs": []map[string]interface{}{
            {
                "name": "pdf_content",
                "shape": []int{1},
                "datatype": "BYTES",
                "data": []string{base64.StdEncoding.EncodeToString(pdfBytes)},
            },
        },
    }

    // Call Triton
    resp, err := http.Post(
        fmt.Sprintf("%s/v2/models/docling-granite-python/infer", p.tritonURL),
        "application/json",
        bytes.NewReader(jsonBytes(request)),
    )

    // Parse response
    var result DoclingResult
    json.NewDecoder(resp.Body).Decode(&result)

    return &result, nil
}

func (p *PDFProcessor) createPrelabels(extractions *DoclingResult, pageImages []PageImage) []Prelabel {
    var prelabels []Prelabel

    for _, table := range extractions.Tables {
        prelabel := Prelabel{
            Type: "rectanglelabels",
            Value: map[string]interface{}{
                "x": table.BBox[0] * 100.0 / float64(pageImages[table.PageNum].Width),
                "y": table.BBox[1] * 100.0 / float64(pageImages[table.PageNum].Height),
                "width": (table.BBox[2] - table.BBox[0]) * 100.0 / float64(pageImages[table.PageNum].Width),
                "height": (table.BBox[3] - table.BBox[1]) * 100.0 / float64(pageImages[table.PageNum].Height),
                "rectanglelabels": []string{"Table"},
            },
            ItemIndex: table.PageNum,
            Score: table.Confidence,
            Meta: map[string]interface{}{
                "table_id": table.ID,
                "cell_count": len(table.Cells),
            },
        }
        prelabels = append(prelabels, prelabel)
    }

    return prelabels
}
```

---

## Phase 3: Data Quality & Promotion (Week 5)

### Component: promotion-worker

**Purpose**: Move validated data from staging to curated schema with quality gates

**Technical Specification**:
```go
// apps/promotion-worker/main.go

type PromotionConfig struct {
    MinConfidence   float64            // e.g., 0.95
    MinCoverage     float64            // e.g., 0.95
    RequiredFields  []string           // Must be non-null
    UniqueFields    map[string]string  // field → unique constraint query
}

func (p *PromotionWorker) runPromotion() error {
    // Start transaction
    tx, err := p.db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Get promotable data
    rows, err := tx.Query(`
        SELECT
            e.document_id,
            e.column_name,
            e.cleaned_value,
            e.confidence,
            d.source_type,
            d.source_name
        FROM stage.csv_extractions e
        JOIN stage.documents d ON e.document_id = d.id
        WHERE e.confidence >= $1
          AND (e.review_status = 'approved' OR e.confidence >= $2)
          AND e.promoted_at IS NULL
        ORDER BY e.document_id, e.row_index
    `, p.config.MinConfidence, p.config.MinConfidence)

    // Validate quality gates
    promotableData := make(map[int64][]Extraction)
    for rows.Next() {
        var ext Extraction
        rows.Scan(&ext)
        promotableData[ext.DocumentID] = append(promotableData[ext.DocumentID], ext)
    }

    // Check coverage and required fields
    for docID, extractions := range promotableData {
        if !p.validateQualityGates(extractions) {
            log.Printf("Document %d failed quality gates", docID)
            continue
        }

        // Promote to curated schema
        promotionID, err := p.promoteDocument(tx, docID, extractions)
        if err != nil {
            log.Printf("Promotion failed for document %d: %v", docID, err)
            continue
        }

        // Log promotion
        _, err = tx.Exec(`
            INSERT INTO stage.promotion_log
            (document_id, promotion_timestamp, target_schema, target_table,
             record_count, quality_metrics, status)
            VALUES ($1, NOW(), 'curated', 'vessels', $2, $3, 'success')
        `, docID, len(extractions), p.calculateQualityMetrics(extractions))
    }

    return tx.Commit()
}

func (p *PromotionWorker) validateQualityGates(extractions []Extraction) bool {
    // Check required fields
    fieldMap := make(map[string]string)
    for _, ext := range extractions {
        fieldMap[ext.ColumnName] = ext.CleanedValue
    }

    for _, required := range p.config.RequiredFields {
        if val, exists := fieldMap[required]; !exists || val == "" {
            return false
        }
    }

    // Check coverage
    totalFields := len(p.config.RequiredFields)
    filledFields := 0
    for _, field := range p.config.RequiredFields {
        if fieldMap[field] != "" {
            filledFields++
        }
    }

    coverage := float64(filledFields) / float64(totalFields)
    if coverage < p.config.MinCoverage {
        return false
    }

    // Check uniqueness constraints
    for field, query := range p.config.UniqueFields {
        if value := fieldMap[field]; value != "" {
            var count int
            p.db.QueryRow(query, value).Scan(&count)
            if count > 0 {
                log.Printf("Duplicate value found for %s: %s", field, value)
                return false
            }
        }
    }

    return true
}

func (p *PromotionWorker) promoteDocument(tx *sql.Tx, docID int64, extractions []Extraction) (int64, error) {
    // Transform to curated schema format
    vessel := transformToVessel(extractions)

    // Insert into curated.vessels
    var promotionID int64
    err := tx.QueryRow(`
        INSERT INTO curated.vessels
        (imo_number, vessel_name, mmsi, call_sign, flag_state,
         vessel_type, gross_tonnage, year_built, source_document_id,
         confidence_score, promoted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING id
    `, vessel.IMO, vessel.Name, vessel.MMSI, vessel.CallSign,
       vessel.Flag, vessel.Type, vessel.GRT, vessel.YearBuilt,
       docID, vessel.ConfidenceScore).Scan(&promotionID)

    if err != nil {
        return 0, fmt.Errorf("insert failed: %w", err)
    }

    // Mark extractions as promoted
    _, err = tx.Exec(`
        UPDATE stage.csv_extractions
        SET promoted_at = NOW(), promotion_id = $1
        WHERE document_id = $2
    `, promotionID, docID)

    return promotionID, err
}
```

---

## Phase 4: Active Learning Controller (Week 5-6)

### Component: active-learning-controller

**Purpose**: Manage retraining triggers and dataset builds

**Technical Specification**:
```go
// apps/active-learning-controller/main.go

type ALController struct {
    db           *sql.DB
    hfClient     *HuggingFaceClient
    tritonClient *TritonClient
}

func (a *ALController) checkRetrainingTriggers() bool {
    // Multi-condition triggers

    // 1. Annotation count threshold
    var newAnnotations int
    a.db.QueryRow(`
        SELECT COUNT(*)
        FROM stage.training_corpus
        WHERE created_at > (
            SELECT COALESCE(MAX(training_started_at), '2000-01-01')
            FROM stage.training_runs
        )
    `).Scan(&newAnnotations)

    if newAnnotations >= 100 {
        log.Printf("Trigger: %d new annotations", newAnnotations)
        return true
    }

    // 2. Performance degradation
    var weeklyAcceptance float64
    a.db.QueryRow(`
        WITH weekly_stats AS (
            SELECT
                DATE_TRUNC('week', created_at) as week,
                AVG(CASE WHEN review_status = 'approved' THEN 1.0 ELSE 0.0 END) as acceptance_rate
            FROM stage.csv_extractions
            WHERE created_at > NOW() - INTERVAL '2 weeks'
            GROUP BY week
        )
        SELECT
            (LAG(acceptance_rate) OVER (ORDER BY week) - acceptance_rate) as delta
        FROM weekly_stats
        ORDER BY week DESC
        LIMIT 1
    `).Scan(&weeklyAcceptance)

    if weeklyAcceptance > 0.03 {
        log.Printf("Trigger: Acceptance rate dropped by %.2f%%", weeklyAcceptance*100)
        return true
    }

    // 3. Scheduled retraining (nightly)
    var lastTraining time.Time
    a.db.QueryRow(`
        SELECT COALESCE(MAX(training_started_at), '2000-01-01')
        FROM stage.training_runs
    `).Scan(&lastTraining)

    if time.Since(lastTraining) > 24*time.Hour {
        log.Printf("Trigger: Scheduled daily retraining")
        return true
    }

    return false
}

func (a *ALController) triggerTraining() error {
    // 1. Build dataset from training corpus
    datasetPath, err := a.buildDataset()
    if err != nil {
        return fmt.Errorf("dataset build failed: %w", err)
    }

    // 2. Push to HuggingFace
    commitHash, err := a.hfClient.PushDataset(datasetPath)
    if err != nil {
        return fmt.Errorf("HF push failed: %w", err)
    }

    // 3. Create training job via ls-triton-adapter
    jobConfig := map[string]interface{}{
        "dataset_commit": commitHash,
        "model_type": "distilbert-ner",
        "training_args": map[string]interface{}{
            "batch_size": 32,
            "learning_rate": 2e-5,
            "num_epochs": 3,
            "warmup_steps": 500,
            "weight_decay": 0.01,
            "gradient_accumulation": 4,  // For larger effective batch
            "mixed_precision": "fp16",   // GPU optimization
            "dataloader_num_workers": 4,
            "distributed": true,         // DDP on dual GPUs
        },
    }

    resp, err := http.Post(
        "http://ls-triton-adapter.apps:8080/train",
        "application/json",
        bytes.NewReader(jsonEncode(jobConfig)),
    )

    if err != nil {
        return fmt.Errorf("training trigger failed: %w", err)
    }

    // 4. Log training run
    _, err = a.db.Exec(`
        INSERT INTO stage.training_runs
        (training_started_at, dataset_commit, config, status)
        VALUES (NOW(), $1, $2, 'running')
    `, commitHash, jobConfig)

    return nil
}

func (a *ALController) buildDataset() (string, error) {
    // Build training dataset from corrections
    rows, err := a.db.Query(`
        SELECT
            tc.raw_value,
            tc.corrected_value,
            tc.correction_type,
            tc.context_before,
            tc.context_after,
            tc.column_name,
            tc.difficulty_rating,
            tc.training_split
        FROM stage.training_corpus tc
        WHERE tc.training_split IS NOT NULL
        ORDER BY tc.created_at
    `)

    // Format for HuggingFace datasets
    var trainData, valData, testData []map[string]interface{}

    for rows.Next() {
        var item TrainingItem
        rows.Scan(&item)

        dataPoint := map[string]interface{}{
            "text": item.RawValue,
            "label": item.CorrectedValue,
            "type": item.CorrectionType,
            "context": fmt.Sprintf("%s [SEP] %s", item.ContextBefore, item.ContextAfter),
            "column": item.ColumnName,
            "difficulty": item.Difficulty,
        }

        switch item.Split {
        case "train":
            trainData = append(trainData, dataPoint)
        case "validation":
            valData = append(valData, dataPoint)
        case "test":
            testData = append(testData, dataPoint)
        }
    }

    // Save to temporary directory
    tmpDir := fmt.Sprintf("/tmp/dataset_%d", time.Now().Unix())
    os.MkdirAll(tmpDir, 0755)

    // Write splits
    writeJSONL(filepath.Join(tmpDir, "train.jsonl"), trainData)
    writeJSONL(filepath.Join(tmpDir, "validation.jsonl"), valData)
    writeJSONL(filepath.Join(tmpDir, "test.jsonl"), testData)

    // Create dataset_info.json
    info := map[string]interface{}{
        "created_at": time.Now().Format(time.RFC3339),
        "num_train": len(trainData),
        "num_val": len(valData),
        "num_test": len(testData),
        "features": []string{"text", "label", "type", "context", "column"},
    }

    writeJSON(filepath.Join(tmpDir, "dataset_info.json"), info)

    return tmpDir, nil
}

// Active learning sampling strategies
func (a *ALController) selectSamplesForReview() ([]int64, error) {
    var samples []int64

    // 1. Low confidence samples
    rows, err := a.db.Query(`
        SELECT document_id
        FROM stage.csv_extractions
        WHERE confidence BETWEEN 0.5 AND 0.85
          AND needs_review = false
        ORDER BY confidence ASC
        LIMIT 50
    `)
    for rows.Next() {
        var id int64
        rows.Scan(&id)
        samples = append(samples, id)
    }

    // 2. Model disagreement (if multiple models)
    rows, err = a.db.Query(`
        SELECT document_id
        FROM stage.predictions
        WHERE model_version_1_conf - model_version_2_conf > 0.2
        LIMIT 25
    `)
    for rows.Next() {
        var id int64
        rows.Scan(&id)
        samples = append(samples, id)
    }

    // 3. Distribution drift detection
    rows, err = a.db.Query(`
        WITH recent_distribution AS (
            SELECT column_name, cleaned_value, COUNT(*) as freq
            FROM stage.csv_extractions
            WHERE created_at > NOW() - INTERVAL '7 days'
            GROUP BY column_name, cleaned_value
        ),
        historical_distribution AS (
            SELECT column_name, cleaned_value, COUNT(*) as freq
            FROM stage.csv_extractions
            WHERE created_at < NOW() - INTERVAL '7 days'
              AND created_at > NOW() - INTERVAL '30 days'
            GROUP BY column_name, cleaned_value
        )
        SELECT DISTINCT r.document_id
        FROM recent_distribution r
        LEFT JOIN historical_distribution h USING (column_name, cleaned_value)
        WHERE h.freq IS NULL OR ABS(r.freq - h.freq) > h.freq * 0.5
        LIMIT 25
    `)
    for rows.Next() {
        var id int64
        rows.Scan(&id)
        samples = append(samples, id)
    }

    return samples, nil
}
```

---

## Deployment & Monitoring

### Kubernetes Manifests

```yaml
# cluster/src/components/csvPipeline.ts
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export function createCSVPipeline(args: {
    namespace: string;
    dbSecret: pulumi.Input<string>;
    s3Config: pulumi.Input<any>;
}) {
    // CSV Ingestion Worker
    const csvWorker = new k8s.apps.v1.Deployment("csv-ingestion-worker", {
        metadata: {
            namespace: args.namespace,
            labels: { app: "csv-ingestion-worker" },
        },
        spec: {
            replicas: 2,
            selector: {
                matchLabels: { app: "csv-ingestion-worker" },
            },
            template: {
                metadata: {
                    labels: { app: "csv-ingestion-worker" },
                    annotations: {
                        "prometheus.io/scrape": "true",
                        "prometheus.io/port": "8080",
                    },
                },
                spec: {
                    containers: [{
                        name: "worker",
                        image: "ghcr.io/goldfish-inc/oceanid/csv-ingestion-worker:main",
                        resources: {
                            requests: { memory: "128Mi", cpu: "100m" },
                            limits: { memory: "512Mi", cpu: "500m" },
                        },
                        env: [
                            {
                                name: "DATABASE_URL",
                                valueFrom: {
                                    secretKeyRef: {
                                        name: args.dbSecret,
                                        key: "url",
                                    },
                                },
                            },
                            {
                                name: "S3_CONFIG",
                                value: pulumi.interpolate`${args.s3Config}`,
                            },
                        ],
                        livenessProbe: {
                            httpGet: { path: "/health", port: 8080 },
                            initialDelaySeconds: 10,
                            periodSeconds: 30,
                        },
                    }],
                },
            },
        },
    });

    // Review Queue Manager (CronJob)
    const reviewManager = new k8s.batch.v1.CronJob("review-queue-manager", {
        metadata: {
            namespace: args.namespace,
            labels: { app: "review-queue-manager" },
        },
        spec: {
            schedule: "*/5 * * * *", // Every 5 minutes
            jobTemplate: {
                spec: {
                    template: {
                        spec: {
                            containers: [{
                                name: "manager",
                                image: "ghcr.io/goldfish-inc/oceanid/review-queue-manager:main",
                                env: [/* same as above */],
                            }],
                            restartPolicy: "OnFailure",
                        },
                    },
                },
            },
        },
    });

    return { csvWorker, reviewManager };
}
```

### Prometheus Metrics

```go
// Metrics exposed by each worker
var (
    processedTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "csv_cells_processed_total",
            Help: "Total number of CSV cells processed",
        },
        []string{"status", "source_type"},
    )

    confidenceHistogram = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "csv_confidence_distribution",
            Help: "Distribution of confidence scores",
            Buckets: []float64{0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99, 1.0},
        },
        []string{"field_type"},
    )

    reviewQueueDepth = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "review_queue_depth",
            Help: "Number of items in review queue",
        },
        []string{"priority"},
    )

    gpuUtilization = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "gpu_utilization_percent",
            Help: "GPU utilization percentage",
        },
        []string{"device", "model"},
    )
)
```

### Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "Oceanid Data Pipeline",
    "panels": [
      {
        "title": "CSV Processing Throughput",
        "targets": [
          {
            "expr": "rate(csv_cells_processed_total[5m])",
            "legendFormat": "{{status}}"
          }
        ]
      },
      {
        "title": "Confidence Distribution",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, csv_confidence_distribution)",
            "legendFormat": "P95 Confidence"
          }
        ]
      },
      {
        "title": "GPU Utilization",
        "targets": [
          {
            "expr": "gpu_utilization_percent",
            "legendFormat": "GPU {{device}}"
          }
        ]
      },
      {
        "title": "Review Queue Depth",
        "targets": [
          {
            "expr": "review_queue_depth",
            "legendFormat": "Priority {{priority}}"
          }
        ]
      }
    ]
  }
}
```

---

## Success Criteria & Validation

### Phase 1 (CSV Pipeline)
- [ ] ≥85% of cells auto-cleaned with confidence above threshold
- [ ] <5% of cells routed to SME review
- [ ] Processing speed: 10,000 cells/minute
- [ ] Zero data loss during processing
- [ ] Idempotent webhook handling

### Phase 2 (PDF Pipeline)
- [ ] ≥80% of table regions correctly identified (IoU > 0.5)
- [ ] GPU utilization >70% during batch processing
- [ ] Page image generation at 150-200 DPI
- [ ] OCR accuracy >95% for born-digital PDFs
- [ ] Processing speed: 10 PDFs/minute (5 pages average)

### Phase 3 (Promotion)
- [ ] Daily automated promotions with <1% rollback rate
- [ ] Quality gates prevent bad data from reaching curated
- [ ] Full audit trail with rollback capability
- [ ] Promotion latency <5 minutes for approved data

### Phase 4 (Active Learning)
- [ ] Automatic retraining on 3 trigger conditions
- [ ] Model performance improves week-over-week
- [ ] Blue-green deployment with instant rollback
- [ ] Training completes in <2 hours on dual 4090s

---

## Implementation Timeline

### Week 1-2: CSV Pipeline
- Day 1-3: Build csv-ingestion-worker
- Day 4-5: Build review-queue-manager
- Day 6-7: Integration testing with real data
- Day 8-10: Production deployment and monitoring

### Week 3-4: PDF Pipeline
- Day 11-12: Configure Docling Triton model
- Day 13-15: Build pdf-ingestion-worker
- Day 16-17: Integration with Label Studio
- Day 18-20: Performance optimization

### Week 5: Quality & Promotion
- Day 21-22: Build promotion-worker
- Day 23-25: Build active-learning-controller

### Week 6: Production Hardening
- Day 26-27: Monitoring dashboards
- Day 28-29: Performance tuning
- Day 30: Documentation and runbooks

This refined plan incorporates all decisions, emphasizes future-proofing over shortcuts, and provides detailed implementation specifications for each component.
# Oceanid + Label Studio: Refined Architecture for SMEs
> Archived — November 2025. Label Studio has been removed from the Oceanid stack. This document is retained for historical reference only.
