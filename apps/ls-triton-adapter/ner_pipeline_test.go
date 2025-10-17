package main

import (
	"testing"
)

func TestNERPipelineEndToEnd(t *testing.T) {
	// Initialize tokenizer
	if bertTokenizer == nil {
		err := initTokenizer()
		if err != nil {
			t.Fatalf("Failed to initialize tokenizer: %v", err)
		}
	}

	cfg := &Config{
		DefaultModel: "ner-distilbert",
		NERLabels:    []string{"O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"},
	}

	// Test text with known entities
	testText := "VESSEL: Arctic Explorer IMO: 1234567 FLAG: Norway"

	// Step 1: Tokenize
	encoding, err := bertTokenizer.EncodeSingle(testText)
	if err != nil {
		t.Fatalf("Tokenization failed: %v", err)
	}

	tokenIDs := encoding.GetIds()
	tokens := encoding.GetTokens()
	offsets := encoding.GetOffsets()

	t.Logf("Input text: %s", testText)
	t.Logf("Tokenized to %d tokens", len(tokens))
	t.Logf("Sample tokens: %v", tokens[0:min(5, len(tokens))])

	// Verify tokenization worked
	if len(tokenIDs) == 0 {
		t.Fatal("Tokenization produced no tokens")
	}
	if len(tokens) != len(offsets) {
		t.Fatalf("Token/offset length mismatch: %d vs %d", len(tokens), len(offsets))
	}

	// Step 2: Create mock Triton response
	// Simulate Triton returning logits for each token
	// Shape: [batch_size=1, sequence_length, num_labels=9]
	seqLen := len(tokenIDs)
	numLabels := len(cfg.NERLabels)

	// Create mock logits (flattened array)
	logitsFlat := make([]interface{}, seqLen*numLabels)
	for i := 0; i < seqLen; i++ {
		// Default all tokens to "O" (index 0) with high confidence
		for j := 0; j < numLabels; j++ {
			if j == 0 {
				logitsFlat[i*numLabels+j] = float64(5.0) // High logit for "O"
			} else {
				logitsFlat[i*numLabels+j] = float64(-3.0) // Low logits for other labels
			}
		}

		// Override specific tokens to be entities
		token := tokens[i]
		switch token {
		case "arctic", "explorer":
			// Mark as VESSEL (index 1)
			logitsFlat[i*numLabels+0] = float64(-3.0) // Low for "O"
			logitsFlat[i*numLabels+1] = float64(5.0)  // High for "VESSEL"
		case "norway":
			// Mark as FLAG (index 6)
			logitsFlat[i*numLabels+0] = float64(-3.0) // Low for "O"
			logitsFlat[i*numLabels+6] = float64(5.0)  // High for "FLAG"
		case "1234567", "##34567":
			// Mark as IMO (index 5)
			logitsFlat[i*numLabels+0] = float64(-3.0) // Low for "O"
			logitsFlat[i*numLabels+5] = float64(5.0)  // High for "IMO"
		}
	}

	mockTritonResp := &TritonResponse{
		Outputs: []map[string]interface{}{
			{
				"name":     "logits",
				"datatype": "FP32",
				"shape":    []interface{}{float64(1), float64(seqLen), float64(numLabels)},
				"data":     logitsFlat,
			},
		},
	}

	// Step 3: Process NER output
	prediction := processNEROutput(cfg, mockTritonResp, encoding, testText)

	// Step 4: Validate results
	t.Logf("Prediction model: %s", prediction.Model)
	t.Logf("Number of entities: %d", len(prediction.Result))
	t.Logf("Overall score: %f", prediction.Score)

	if len(prediction.Result) == 0 {
		t.Error("Expected at least one entity prediction")
	}

	// Verify entity structure
	for i, entity := range prediction.Result {
		t.Logf("Entity %d:", i)
		value := entity.Value
		start, startOk := value["start"].(int)
		end, endOk := value["end"].(int)
		text, textOk := value["text"].(string)
		labels, labelsOk := value["labels"].([]string)

		if !startOk || !endOk || !textOk || !labelsOk {
			t.Errorf("  Invalid entity structure: %+v", value)
			continue
		}

		t.Logf("  Text: %q (offset %d:%d)", text, start, end)
		t.Logf("  Labels: %v", labels)
		t.Logf("  Score: %f", entity.Score)

		// Validate offsets
		if start < 0 || end > len(testText) || start >= end {
			t.Errorf("  Invalid offsets: start=%d, end=%d, text_len=%d", start, end, len(testText))
		}

		// Validate extracted text matches original
		expectedText := testText[start:end]
		if text != expectedText {
			t.Errorf("  Extracted text mismatch: got %q, expected %q", text, expectedText)
		}

		// Validate confidence score
		if entity.Score < 0.0 || entity.Score > 1.0 {
			t.Errorf("  Invalid confidence score: %f", entity.Score)
		}
	}

	// Success!
	t.Logf("✅ End-to-end NER pipeline test passed")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
