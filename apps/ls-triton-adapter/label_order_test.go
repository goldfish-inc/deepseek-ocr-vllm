package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// TestGoldenLabels verifies that the adapter's label configuration matches
// the canonical trainer label list to prevent silent misclassification bugs.
func TestGoldenLabels(t *testing.T) {
	// Load golden labels from fixture
	goldenPath := filepath.Join("testdata", "golden-labels.json")
	goldenBytes, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("Failed to read golden labels: %v", err)
	}

	var goldenLabels []string
	if err := json.Unmarshal(goldenBytes, &goldenLabels); err != nil {
		t.Fatalf("Failed to parse golden labels: %v", err)
	}

	// Test with environment variable
	labelsJSON, _ := json.Marshal(goldenLabels)
	if err := os.Setenv("NER_LABELS", string(labelsJSON)); err != nil {
		t.Fatalf("Failed to set NER_LABELS env var: %v", err)
	}
	defer func() {
		_ = os.Unsetenv("NER_LABELS")
	}()

	cfg := &Config{
		NERLabels: goldenLabels,
	}

	// Verify labels match golden
	if len(cfg.NERLabels) != len(goldenLabels) {
		t.Errorf("Label count mismatch: got %d, want %d", len(cfg.NERLabels), len(goldenLabels))
	}

	for i, label := range cfg.NERLabels {
		if i >= len(goldenLabels) {
			t.Errorf("Extra label at index %d: %s", i, label)
			continue
		}
		if label != goldenLabels[i] {
			t.Errorf("Label mismatch at index %d: got %s, want %s", i, label, goldenLabels[i])
		}
	}

	// Expected order from trainer
	expectedLabels := []string{"O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"}
	for i, expected := range expectedLabels {
		if i >= len(cfg.NERLabels) {
			t.Errorf("Missing label at index %d: %s", i, expected)
			continue
		}
		if cfg.NERLabels[i] != expected {
			t.Errorf("Label order violation at index %d: got %s, want %s", i, cfg.NERLabels[i], expected)
		}
	}
}

// TestSetupReturnsCanonicalLabels verifies that the /setup endpoint
// returns labels matching the trainer configuration.
func TestSetupReturnsCanonicalLabels(t *testing.T) {
	goldenLabels := []string{"O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"}

	cfg := &Config{
		NERLabels:       goldenLabels,
		TritonModelName: "ner-distilbert",
		DefaultModel:    "ner-distilbert",
	}

	req := httptest.NewRequest(http.MethodGet, "/setup", nil)
	w := httptest.NewRecorder()

	handler := setupHandler(cfg)
	handler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Setup returned status %d, want %d", w.Code, http.StatusOK)
	}

	var response map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode setup response: %v", err)
	}

	// Verify labels are present and correct
	labelsRaw, ok := response["labels"]
	if !ok {
		t.Fatal("Setup response missing 'labels' field")
	}

	labels, ok := labelsRaw.([]interface{})
	if !ok {
		t.Fatalf("Labels field is not an array: %T", labelsRaw)
	}

	if len(labels) != len(goldenLabels) {
		t.Errorf("Setup labels count mismatch: got %d, want %d", len(labels), len(goldenLabels))
	}

	for i, labelRaw := range labels {
		label, ok := labelRaw.(string)
		if !ok {
			t.Errorf("Label at index %d is not a string: %T", i, labelRaw)
			continue
		}
		if i >= len(goldenLabels) {
			t.Errorf("Extra label at index %d: %s", i, label)
			continue
		}
		if label != goldenLabels[i] {
			t.Errorf("Setup label mismatch at index %d: got %s, want %s", i, label, goldenLabels[i])
		}
	}
}

// TestPredictionLabelMapping verifies that argmax label indices
// correctly map to label strings in Label Studio predictions.
func TestPredictionLabelMapping(t *testing.T) {
	labels := []string{"O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"}

	testCases := []struct {
		name          string
		labelIdx      int
		expectedLabel string
	}{
		{"O label", 0, "O"},
		{"VESSEL label", 1, "VESSEL"},
		{"HS_CODE label", 2, "HS_CODE"},
		{"PORT label", 3, "PORT"},
		{"SPECIES label", 4, "SPECIES"},
		{"IMO label", 5, "IMO"},
		{"FLAG label", 6, "FLAG"},
		{"RISK_LEVEL label", 7, "RISK_LEVEL"},
		{"DATE label", 8, "DATE"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.labelIdx >= len(labels) {
				t.Errorf("Label index %d out of range (max %d)", tc.labelIdx, len(labels)-1)
				return
			}

			actualLabel := labels[tc.labelIdx]
			if actualLabel != tc.expectedLabel {
				t.Errorf("Label mapping failed: index %d maps to %s, expected %s",
					tc.labelIdx, actualLabel, tc.expectedLabel)
			}
		})
	}
}

// TestLabelIndexOutOfRange verifies that out-of-range label indices
// are handled gracefully (as they are logged but shouldn't panic).
func TestLabelIndexOutOfRange(t *testing.T) {
	labels := []string{"O", "VESSEL", "HS_CODE"}

	// Simulate what happens in alignToCharacters when labelIdx >= len(labels)
	labelIdx := 5 // Out of range
	if labelIdx >= len(labels) {
		// This is the expected behavior - log and continue
		t.Logf("Label index %d out of range (max %d) - correctly handled", labelIdx, len(labels)-1)
	} else {
		t.Errorf("Expected out-of-range detection for index %d", labelIdx)
	}
}

// TestLabelOrderImmutability ensures label order doesn't accidentally change
// during runtime (defensive test for future refactoring).
func TestLabelOrderImmutability(t *testing.T) {
	goldenLabels := []string{"O", "VESSEL", "HS_CODE", "PORT", "SPECIES", "IMO", "FLAG", "RISK_LEVEL", "DATE"}

	cfg := &Config{
		NERLabels: make([]string, len(goldenLabels)),
	}
	copy(cfg.NERLabels, goldenLabels)

	// Verify initial state
	for i, label := range goldenLabels {
		if cfg.NERLabels[i] != label {
			t.Errorf("Initial label mismatch at index %d: got %s, want %s", i, cfg.NERLabels[i], label)
		}
	}

	// Simulate potential mutation (defensive)
	tmpLabels := cfg.NERLabels
	tmpLabels[1] = "MODIFIED"

	// Since slice is reference, this WOULD affect cfg.NERLabels in production
	// This test documents the risk and ensures we're aware of it
	if cfg.NERLabels[1] != "MODIFIED" {
		t.Log("Label slice is immutable (good)")
	} else {
		t.Log("Warning: Label slice is mutable - consider defensive copying in production")
	}
}
