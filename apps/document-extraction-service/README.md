# Document Extraction Service

Lightweight HTTP service for extracting text from documents using IBM Granite Docling.

## Features

- **Multi-format support**: PDF, images (JPEG/PNG/HEIC), CSV, XLSX, DOCX, PPTX, HTML, MD, XML
- **High-quality extraction**:
  - Tables: 0.97 TEDS accuracy
  - OCR: 0.84 F1 on scanned documents
  - Layout preservation
- **MLX acceleration**: On Apple Silicon (M1/M2/M3/M4)
- **Prometheus metrics**: Latency, throughput, error rates

## API Endpoints

### POST /extract
Extract text from an uploaded document.

**Request**:
```bash
curl -X POST http://localhost:8080/extract \
  -F "file=@crew_manifest.pdf"
```

**Response**:
```json
{
  "text": "CREW MANIFEST - MV PACIFIC SEAFOOD\n\nPort: Seattle...",
  "format": "pdf",
  "pages": 2,
  "word_count": 345,
  "char_count": 2156
}
```

### GET /health
Health check endpoint.

**Response**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "mlx_enabled": false
}
```

### GET /formats
List all supported document formats.

**Response**:
```json
{
  "supported_formats": [
    "pdf", "image", "csv", "xlsx", "docx", "pptx", "html", "md", ...
  ],
  "total_count": 15
}
```

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run service (Mac with MLX)
DOCLING_USE_MLX=1 python main.py

# Run service (Linux/x86_64, no MLX)
DOCLING_USE_MLX=0 python main.py

# Test endpoint
curl -X POST http://localhost:8080/extract \
  -F "file=@test.pdf"
```

## Docker Build

```bash
# Build image
docker build -t ghcr.io/goldfish-inc/document-extraction:latest .

# Run container
docker run -p 8080:8080 \
  -e DOCLING_USE_MLX=0 \
  ghcr.io/goldfish-inc/document-extraction:latest
```

## Kubernetes Deployment

```bash
# Deploy via Flux
kubectl apply -f deployment.yaml

# Check status
kubectl -n apps get pods -l app=document-extraction
kubectl -n apps logs -l app=document-extraction --tail=50

# Test from within cluster
kubectl -n apps run curl --rm -it --image=curlimages/curl -- \
  curl -X POST http://document-extraction:8080/extract \
  -F "file=@/tmp/test.pdf"
```

## Integration with ls-triton-adapter

```go
// In ls-triton-adapter predictHandler
if req.PDFBase64 != "" {
    // Call document extraction service
    resp, err := http.Post(
        "http://document-extraction:8080/extract",
        "multipart/form-data",
        pdfFile,
    )
    var result ExtractionResult
    json.NewDecoder(resp.Body).Decode(&result)

    // Use extracted text for NER
    req.Text = result.Text
}
```

## Performance

- **Latency**:
  - Small PDFs (1-5 pages): 1-3s
  - Large PDFs (10+ pages): 5-15s
  - Images: 0.5-2s
  - Spreadsheets: 0.1-0.5s
- **Throughput**: ~10-20 documents/min per replica
- **Memory**: 2-4GB per replica (model cache)

## Configuration

Environment variables:
- `PORT`: HTTP port (default: 8080)
- `HF_HOME`: HuggingFace cache directory (default: /data/hf-cache)
- `DOCLING_USE_MLX`: Enable MLX acceleration (default: 0 for x86_64, 1 for arm64)
- `LOG_LEVEL`: Logging level (default: INFO)
