package main

import (
	"testing"
)

func TestInitTokenizer(t *testing.T) {
	// Test tokenizer initialization
	err := initTokenizer()
	if err != nil {
		t.Fatalf("Failed to initialize tokenizer: %v", err)
	}
	if bertTokenizer == nil {
		t.Fatal("Tokenizer is nil after initialization")
	}
}

func TestTokenization(t *testing.T) {
	// Initialize tokenizer first
	if bertTokenizer == nil {
		err := initTokenizer()
		if err != nil {
			t.Fatalf("Failed to initialize tokenizer: %v", err)
		}
	}

	testCases := []struct {
		name string
		text string
	}{
		{"simple", "VESSEL: Arctic Explorer"},
		{"with numbers", "IMO: 1234567"},
		{"empty", ""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.text == "" {
				return // Skip empty text
			}

			encoding, err := bertTokenizer.EncodeSingle(tc.text)
			if err != nil {
				t.Fatalf("Tokenization failed for %q: %v", tc.text, err)
			}

			tokens := encoding.GetTokens()
			offsets := encoding.GetOffsets()
			tokenIDs := encoding.GetIds()

			if len(tokens) == 0 {
				t.Errorf("No tokens generated for %q", tc.text)
			}
			if len(tokens) != len(offsets) {
				t.Errorf("Token/offset length mismatch: %d vs %d", len(tokens), len(offsets))
			}
			if len(tokens) != len(tokenIDs) {
				t.Errorf("Token/ID length mismatch: %d vs %d", len(tokens), len(tokenIDs))
			}

			// Verify offsets are within text bounds
			for i, offset := range offsets {
				if tokens[i] == "[CLS]" || tokens[i] == "[SEP]" {
					continue // Special tokens have zero offsets
				}
				if int(offset[0]) > len(tc.text) || int(offset[1]) > len(tc.text) {
					t.Errorf("Offset out of bounds for token %d: [%d, %d], text len: %d",
						i, offset[0], offset[1], len(tc.text))
				}
			}
		})
	}
}

func TestSoftmax(t *testing.T) {
	testCases := []struct {
		name   string
		logits []float32
	}{
		{"simple", []float32{1.0, 2.0, 3.0}},
		{"negative", []float32{-1.0, -2.0, -3.0}},
		{"large values", []float32{100.0, 200.0, 300.0}}, // Test numerical stability
		{"zero", []float32{0.0, 0.0, 0.0}},
		{"empty", []float32{}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			probs := softmax(tc.logits)

			if len(probs) != len(tc.logits) {
				t.Errorf("Output length mismatch: %d vs %d", len(probs), len(tc.logits))
				return
			}

			if len(probs) == 0 {
				return // Empty case is valid
			}

			// Check probabilities sum to ~1.0
			sum := float32(0.0)
			for _, p := range probs {
				sum += p
				if p < 0 || p > 1 {
					t.Errorf("Invalid probability value: %f", p)
				}
			}

			if sum < 0.99 || sum > 1.01 {
				t.Errorf("Probabilities don't sum to 1.0: %f", sum)
			}
		})
	}
}

func TestEmptyPrediction(t *testing.T) {
	cfg := &Config{
		DefaultModel: "test-model",
	}

	pred := emptyPrediction(cfg)

	if pred.Model != "test-model" {
		t.Errorf("Wrong model name: %s", pred.Model)
	}
	if len(pred.Result) != 0 {
		t.Errorf("Expected empty results, got %d", len(pred.Result))
	}
	if pred.Score != 0.0 {
		t.Errorf("Expected zero score, got %f", pred.Score)
	}
}
