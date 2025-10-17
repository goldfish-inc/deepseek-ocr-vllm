# Test Data Fixtures

This directory contains test fixtures for integration and regression testing of the `ls-triton-adapter` service.

## Contents

### `test-vessel-registry.pdf` (TODO: Create)

**Purpose**: Synthetic PDF document for testing end-to-end Triton Docling extraction and NER prediction.

**Characteristics**:
- **Non-sensitive**: Contains only synthetic/fake data
- **No PII**: All IMO numbers, MMSI, vessel names, and other identifiers are fabricated
- **Format**: Standard PDF 1.4 or higher, 2 pages
- **Content**: Simulates a vessel registry list with:
  - Vessel names (fake, e.g., "Arctic Explorer", "Pacific Star")
  - IMO numbers (fake, e.g., 9999999, 8888888)
  - MMSI numbers (fake)
  - Flag states
  - Port information
  - Dates in ISO 8601 format
  - At least one table structure (for testing Docling table extraction)

**License**: CC0 (Public Domain) or created in-house with no copyright restrictions

**Creation Notes**:
- Can be generated using LibreOffice/Word and "Export as PDF"
- Or use a PDF generation library (e.g., Python's ReportLab)
- Ensure the PDF is not encrypted or password-protected

**Example Content**:
```
VESSEL REGISTRY - TEST DATA

Vessel Name: Arctic Explorer
IMO Number: 9999999
MMSI: 123456789
Flag: Norway
Port of Registry: Bergen
Registration Date: 2024-01-15

Vessel Name: Pacific Star
IMO Number: 8888888
MMSI: 987654321
Flag: Liberia
Port of Registry: Monrovia
Registration Date: 2023-12-01

[Table with columns: Vessel, IMO, Flag, Type, GT]
```

---

### `expected-docling-output.json`

**Purpose**: Expected Docling extraction output for `test-vessel-registry.pdf`

**Format**:
```json
{
  "text": "VESSEL REGISTRY - TEST DATA\\n\\nVessel Name: Arctic Explorer...",
  "word_count": 150,
  "tables": [
    {
      "headers": ["Vessel", "IMO", "Flag", "Type", "GT"],
      "rows": [
        ["Arctic Explorer", "9999999", "Norway", "Container", "25000"]
      ]
    }
  ]
}
```

**Regeneration**: Run integration test with real Triton, capture output, sanitize, save as expected output.

---

### `expected-ner-entities.json`

**Purpose**: Expected NER entities extracted from `test-vessel-registry.pdf`

**Format**:
```json
{
  "entities": [
    {
      "text": "Arctic Explorer",
      "label": "VESSEL",
      "start": 45,
      "end": 60,
      "confidence": 0.95
    },
    {
      "text": "9999999",
      "label": "IMO",
      "start": 75,
      "end": 82,
      "confidence": 0.98
    }
  ]
}
```

**Regeneration**: Run `/predict_ls` endpoint with test PDF, extract entities, save as expected output.

---

## Integration Test Directory

### `integration/run_integration_test.sh`

End-to-end integration test script that:
1. Creates a temporary test project in Label Studio
2. Uploads `test-vessel-registry.pdf`
3. Triggers ML backend prediction via `/predict_ls`
4. Verifies extracted entities match expected output
5. Verifies CSV webhook fired for extracted tables
6. Cleans up test project

**Prerequisites**:
- Triton running on Calypso (192.168.2.110:8000)
- Label Studio accessible
- `LS_PAT` environment variable set

**Usage**:
```bash
cd apps/ls-triton-adapter/testdata/integration
export LS_PAT="your-label-studio-personal-access-token"
./run_integration_test.sh
```

---

## Regression Test Coverage

The `regression_test.go` file in the parent directory tests the following scenarios using these fixtures:

1. **Empty Text Extraction**: Docling returns valid response but empty text (should error)
2. **Wrong Model Shape**: Triton returns binary classifier output instead of NER (should gracefully return empty predictions)
3. **Triton Unavailable**: Connection refused errors (should return 503)
4. **Health Check**: `/health` endpoint returns 503 when Triton down
5. **Valid NER Prediction**: End-to-end prediction with mocked Triton responses

**Running Regression Tests**:
```bash
cd apps/ls-triton-adapter
go test -v -run TestTriton
```

---

## Updating Fixtures

When the NER model or Docling output format changes, update fixtures by:

1. Run integration test against live Triton
2. Capture actual output
3. Verify correctness
4. Update `expected-*` JSON files
5. Re-run regression tests to ensure they pass

---

## Security & Licensing

**⚠️ IMPORTANT**: All test fixtures must be:
- **Non-sensitive**: No real vessel data, personal information, or proprietary content
- **Publicly shareable**: Can be committed to public GitHub repository
- **License-compliant**: CC0, MIT, or in-house created content only

**Prohibited Content**:
- Real IMO/MMSI numbers from active vessels
- Copyrighted vessel registry data
- Personal identifying information (PII)
- Proprietary or confidential documents

---

## See Also

- [Integration Test Results](../INTEGRATION_TEST_RESULTS.md)
- [Triton ML Backend Runbook](../../../docs/operations/triton-ml-backend-runbook.md)
- [NER Model Deployment](../../ner-training/DEPLOYMENT_SUMMARY.md)
