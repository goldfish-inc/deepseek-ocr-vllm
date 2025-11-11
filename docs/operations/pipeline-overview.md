# Document Processing Pipeline Overview

This is the current production path for PDF processing, NER extraction, SME review, and storage.

```mermaid
flowchart LR
  U[User/Client] -- POST /upload --> W(Upload Worker)
  W --> R2[(R2 bucket: vessel-pdfs)]
  W --> Q1{{Queue: pdf-processing}}
  Q1 --> O[OCR Worker]
  O --> DS[DeepSeek OCR (HF Space)]
  DS --> O
  O -->|INSERT via md-query-proxy| MD[(MotherDuck: raw_ocr)]
  O --> Q2{{Queue: entity-extraction}}
  Q2 --> E[Entity Extractor]
  E -->|NER via Spark + Ollama Worker| E
  E -->|INSERT via md-query-proxy| MD2[(MotherDuck: entities)]
  E --> Q3{{Queue: argilla-sync}}
  Q3 --> A[Argilla Sync Worker]
  A -->|POST records| ARG[Argilla]
  ARG -->|Webhook| W2(Webhook Handler)
  W2 -->|INSERT| MDC[(MotherDuck: entity_corrections)]
```

Key components
- Upload Worker: Receives PDFs, stores in R2, enqueues OCR requests.
- OCR Worker: Calls DeepSeek OCR Space, writes OCR text to MotherDuck (raw_ocr).
- Entity Extractor: Uses Spark + Ollama Worker for NER, writes to MotherDuck (entities).
- Argilla Sync Worker: Sends tasks to Argilla. Webhook writes SME corrections to MotherDuck (entity_corrections).

Tables (MotherDuck)
- `md.raw_ocr(pdf_name, page_number, text, clean_text, has_tables, timestamp, metadata JSON)`
- `md.entities(document_id, entity_type, entity_text, start_char, end_char, confidence DOUBLE, extracted_at TIMESTAMP, model)`
- `md.entity_corrections(document_id, original_entity_type, corrected_entity_type, original_text, corrected_text, corrected_by, corrected_at TIMESTAMP, correction_type)`

Operational notes
- Near real-time writes: Workers use `md-query-proxy` to execute SQL against MotherDuck.
- Backpressure: Cloudflare Queues buffer processing; retry semantics are handled by the platform.
- Fallback: If needed, switch to R2 staging + loader for bulk ingest.
