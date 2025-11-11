# Phase 1 Technical Design: Real NER Prediction Logic

**Date**: 2025-10-16
**Status**: Implementation Ready
**Component**: `apps/ls-triton-adapter/main.go`

---

## Discovery Summary

### BERT Tokenizer (✅ DECISION: Use `sugarme/tokenizer`)

**Library**: `github.com/sugarme/tokenizer` v0.1.15+
**Why**: Pure Go, no Python dependency, provides character offsets

**API**:
```go
import "github.com/sugarme/tokenizer/pretrained"

tk := pretrained.BertBaseUncased()
en, err := tk.EncodeSingle(text)

// Get required outputs:
tokenIds := en.GetIds()          // []uint32 - token IDs for Triton
offsets := en.GetOffsets()       // [][2]uint - character offsets (start, end)
tokens := en.GetTokens()         // []string - for debugging
```

**Benefits**:
- ✅ Matches HuggingFace BERT tokenization
- ✅ Returns character offsets (needed for Label Studio spans)
- ✅ No external Python service
- ✅ Actively maintained (last commit Dec 2024)

---

### Triton NER Output Format

**Endpoint**: `POST https://gpu.boathou.se/v2/models/ner-distilbert/infer`
**Auth**: Cloudflare Access (CF-Access-Client-Id, CF-Access-Client-Secret)

**Input**:
```json
{
  "inputs": [
    {
      "name": "input_ids",
      "shape": [1, sequence_length],
      "datatype": "INT64",
      "data": [101, 2054, 2003, ..., 102]
    },
    {
      "name": "attention_mask",
      "shape": [1, sequence_length],
      "datatype": "INT64",
      "data": [1, 1, 1, ..., 1]
    }
  ]
}
```

**Output Shape**: `[batch_size, sequence_length, num_labels]`
- `batch_size = 1` (single document)
- `sequence_length` = variable (number of tokens including [CLS]/[SEP])
- `num_labels = 9`: `[O VESSEL HS_CODE PORT COMMODITY IMO FLAG RISK_LEVEL DATE]`

**Response**:
```json
{
  "model_name": "ner-distilbert",
  "model_version": "1",
  "outputs": [
    {
      "name": "logits",
      "datatype": "FP32",
      "shape": [1, sequence_length, 9],
      "data": [0.1, 0.05, 0.85, ...]  // Flattened logits array
    }
  ]
}
```

**Processing**:
1. Reshape flat `data` array to `[sequence_length, 9]`
2. Apply `argmax` over last dimension → `[sequence_length]` of label indices
3. Map index to label: `0=O, 1=VESSEL, 2=HS_CODE, ...`
4. Skip tokens with label `O` (non-entity)
5. Align token predictions to character offsets

---

## Implementation Plan

### 1. Add Dependencies (`apps/ls-triton-adapter/go.mod`)

```go
require (
    github.com/sugarme/tokenizer v0.1.15
)
```

### 2. Replace Stub Tokenization (main.go:250-262)

**Current (BROKEN)**:
```go
words := strings.Fields(req.Text)
tokenIDs := make([]int64, len(words))
for i := range words {
    tokenIDs[i] = int64(100 + i) // FAKE!
}
```

**New (REAL)**:
```go
import "github.com/sugarme/tokenizer/pretrained"

// Initialize tokenizer (cache at service startup)
var bertTokenizer *tokenizer.Tokenizer

func init() {
    var err error
    bertTokenizer, err = pretrained.BertBaseUncased()
    if err != nil {
        log.Fatalf("Failed to load BERT tokenizer: %v", err)
    }
}

func tokenizeText(text string) (*tokenizer.Encoding, error) {
    return bertTokenizer.EncodeSingle(text)
}
```

### 3. Build Proper Triton Inputs (main.go:264-278)

**New**:
```go
en, err := tokenizeText(req.Text)
if err != nil {
    return nil, fmt.Errorf("tokenization failed: %w", err)
}

tokenIds := en.GetIds()
attentionMask := make([]int64, len(tokenIds))
for i := range attentionMask {
    attentionMask[i] = 1
}

inputs := []TritonTensor{
    {
        Name:     "input_ids",
        Shape:    []int{1, len(tokenIds)},
        DataType: "INT64",
        Data:     convertToInt64(tokenIds),  // uint32 -> int64
    },
    {
        Name:     "attention_mask",
        Shape:    []int{1, len(tokenIds)},
        DataType: "INT64",
        Data:     attentionMask,
    },
}
```

### 4. Parse Triton NER Output (main.go:304-347)

**Current (BROKEN)**:
```go
// Line 326-344: Every 3rd word is an "entity" (!!!)
if i%3 == 0 && i > 0 {
    result.Result = append(result.Result, LSResult{...})
}
```

**New (REAL)**:
```go
func parseNEROutput(
    resp *TritonResponse,
    encoding *tokenizer.Encoding,
    originalText string,
    labels []string,
) LSPrediction {
    // Extract logits from response
    if len(resp.Outputs) == 0 {
        return emptyPrediction()
    }

    logitsFlat, ok := resp.Outputs[0]["data"].([]interface{})
    if !ok {
        return emptyPrediction()
    }

    // Reshape to [sequence_length, num_labels]
    shape := resp.Outputs[0]["shape"].([]interface{})
    seqLen := int(shape[1].(float64))
    numLabels := int(shape[2].(float64))

    logits := make([][]float32, seqLen)
    for i := 0; i < seqLen; i++ {
        logits[i] = make([]float32, numLabels)
        for j := 0; j < numLabels; j++ {
            logits[i][j] = float32(logitsFlat[i*numLabels+j].(float64))
        }
    }

    // Apply argmax to get label indices
    predictions := make([]int, seqLen)
    confidences := make([]float32, seqLen)
    for i := 0; i < seqLen; i++ {
        maxIdx := 0
        maxVal := logits[i][0]
        for j := 1; j < numLabels; j++ {
            if logits[i][j] > maxVal {
                maxVal = logits[i][j]
                maxIdx = j
            }
        }
        predictions[i] = maxIdx
        confidences[i] = softmax(logits[i])[maxIdx]  // Confidence score
    }

    // Convert token predictions to character spans
    return alignToCharacters(predictions, confidences, encoding, originalText, labels)
}

func softmax(logits []float32) []float32 {
    expSum := float32(0.0)
    exp := make([]float32, len(logits))
    for i, v := range logits {
        exp[i] = float32(math.Exp(float64(v)))
        expSum += exp[i]
    }
    for i := range exp {
        exp[i] /= expSum
    }
    return exp
}
```

### 5. Align Token Predictions to Character Offsets

```go
func alignToCharacters(
    predictions []int,
    confidences []float32,
    encoding *tokenizer.Encoding,
    originalText string,
    labels []string,
) LSPrediction {
    offsets := encoding.GetOffsets()
    tokens := encoding.GetTokens()

    result := LSPrediction{
        Model:    "distilbert-ner",
        ModelRun: fmt.Sprintf("oceanid-%d", time.Now().Unix()),
        Result:   []LSResult{},
        Score:    0.0,
    }

    // Merge consecutive tokens with same label (B-I-O tagging)
    var currentEntity *struct {
        label      string
        start, end int
        tokens     []string
        confidence float32
    }

    for i := 0; i < len(predictions); i++ {
        labelIdx := predictions[i]
        label := labels[labelIdx]

        // Skip "O" (non-entity) and special tokens ([CLS], [SEP])
        if label == "O" || tokens[i] == "[CLS]" || tokens[i] == "[SEP]" {
            if currentEntity != nil {
                // Flush current entity
                result.Result = append(result.Result, createLSResult(
                    currentEntity, originalText,
                ))
                currentEntity = nil
            }
            continue
        }

        // Start new entity or continue current
        if currentEntity == nil || currentEntity.label != label {
            if currentEntity != nil {
                result.Result = append(result.Result, createLSResult(
                    currentEntity, originalText,
                ))
            }
            currentEntity = &struct {
                label      string
                start, end int
                tokens     []string
                confidence float32
            }{
                label:      label,
                start:      int(offsets[i][0]),
                end:        int(offsets[i][1]),
                tokens:     []string{tokens[i]},
                confidence: confidences[i],
            }
        } else {
            // Extend current entity
            currentEntity.end = int(offsets[i][1])
            currentEntity.tokens = append(currentEntity.tokens, tokens[i])
            currentEntity.confidence = (currentEntity.confidence + confidences[i]) / 2
        }
    }

    // Flush last entity
    if currentEntity != nil {
        result.Result = append(result.Result, createLSResult(currentEntity, originalText))
    }

    return result
}

func createLSResult(entity *struct {
    label      string
    start, end int
    tokens     []string
    confidence float32
}, originalText string) LSResult {
    return LSResult{
        Value: map[string]interface{}{
            "start":  entity.start,
            "end":    entity.end,
            "text":   originalText[entity.start:entity.end],
            "labels": []string{entity.label},
        },
        From:  "label",
        To:    "text",
        Type:  "labels",
        Score: float64(entity.confidence),
    }
}
```

---

## Testing Plan

### Unit Tests

```go
func TestTokenization(t *testing.T) {
    text := "VESSEL: Arctic Explorer IMO: 1234567"
    en, err := tokenizeText(text)
    require.NoError(t, err)

    tokens := en.GetTokens()
    offsets := en.GetOffsets()

    // Verify offsets match original text
    for i, offset := range offsets {
        if tokens[i] == "[CLS]" || tokens[i] == "[SEP]" {
            continue
        }
        expected := text[offset[0]:offset[1]]
        // Account for wordpiece tokenization (##)
        tokenCleaned := strings.TrimPrefix(tokens[i], "##")
        assert.Contains(t, expected, tokenCleaned)
    }
}

func TestNERParsing(t *testing.T) {
    // Mock Triton response
    resp := &TritonResponse{
        Outputs: []map[string]interface{}{
            {
                "name":  "logits",
                "shape": []interface{}{float64(1), float64(10), float64(9)},
                "data":  /* sample logits */,
            },
        },
    }

    // Parse and verify
    pred := parseNEROutput(resp, encoding, text, labels)
    assert.Greater(t, len(pred.Result), 0)

    // Verify spans are valid
    for _, res := range pred.Result {
        start := res.Value["start"].(int)
        end := res.Value["end"].(int)
        assert.GreaterOrEqual(t, end, start)
        assert.Less(t, end, len(text))
    }
}
```

### Integration Test

1. Deploy updated adapter to dev cluster
2. Call `/predict` endpoint with sample vessel text
3. Verify predictions match expected entities
4. Measure latency (target: < 500ms)

---

## Performance Targets

- **Tokenization**: < 50ms (pure Go, very fast)
- **Triton inference**: < 300ms (GPU acceleration)
- **Post-processing**: < 50ms (alignment, entity merging)
- **Total latency**: < 500ms per document

---

## Implementation Status

1. ✅ **Research complete** - tokenizer and Triton output format documented
2. ✅ **Implementation complete** - replaced stub code with real prediction logic
3. 🔄 **Testing in progress** - code review + integration test with Triton
4. ⏭️ **Metrics** - add Prometheus instrumentation
5. ⏭️ **Deploy** - test in dev, promote to production

---

**Implementation Start**: 2025-10-16
**Implementation Complete**: 2025-10-16
**Target Testing/Deploy**: 2025-10-17

## Changes Implemented

### Dependencies (`go.mod`)
- Added `github.com/sugarme/tokenizer v0.3.0`
- Pure Go BERT tokenizer, no Python dependency

### Core Implementation (`main.go`)

**1. Tokenizer Initialization (lines 51-61)**
```go
var bertTokenizer *tokenizer.Tokenizer

func initTokenizer() error {
    bertTokenizer = pretrained.BertBaseUncased()
    if bertTokenizer == nil {
        return fmt.Errorf("failed to load BERT tokenizer: tokenizer is nil")
    }
    log.Println("✅ BERT tokenizer loaded successfully")
    return nil
}
```

**2. Real Tokenization (lines 266-300)**
- Replaced `strings.Fields()` with BERT wordpiece tokenization
- Returns `*tokenizer.Encoding` with character offsets
- Converts `uint32` token IDs to `int64` for Triton compatibility

**3. NER Output Parsing (lines 326-384)**
- Extracts logits from `TritonResponse.Outputs[0]["data"]`
- Validates shape `[batch_size, sequence_length, num_labels]`
- Reshapes flat array to 2D matrix
- Applies argmax to get predicted labels
- Calculates softmax confidence scores

**4. Token-to-Character Alignment (lines 410-531)**
- Uses `encoding.GetOffsets()` for character positions
- Merges consecutive tokens with same entity label
- Skips "O" (non-entity) and special tokens ([CLS], [SEP], [PAD])
- Returns Label Studio prediction format with `start`, `end`, `text`, `labels`, `score`

**5. Updated Both Endpoints**
- `/predict`: Main prediction endpoint with full Triton integration
- `/predict-ls`: Label Studio ML backend endpoint (returns `{"results": [...]}`)
