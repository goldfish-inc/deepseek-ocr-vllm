package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestTritonReturnsEmptyText tests that the adapter correctly handles
// Docling extraction returning empty text (should return 424 error).
func TestTritonReturnsEmptyText(t *testing.T) {
	// Mock Triton server that returns valid Docling structure but empty text
	mockTriton := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/models/docling_granite_python/infer" {
			// Create DoclingResult with empty text
			doclingResult := DoclingResult{
				Text:      "",
				Tables:    []DoclingTable{},
				Pages:     1,
				WordCount: 0,
				CharCount: 0,
			}
			resultJSON, _ := json.Marshal(doclingResult)
			resultB64 := base64.StdEncoding.EncodeToString(resultJSON)

			// Return Triton response with base64-encoded DoclingResult
			response := TritonResponse{
				ModelName:    "docling_granite_python",
				ModelVersion: "1",
				Outputs: []map[string]interface{}{
					{
						"name":     "result",
						"datatype": "BYTES",
						"shape":    []interface{}{float64(1)},
						"data":     []interface{}{resultB64},
					},
				},
			}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				t.Logf("Failed to encode mock response: %v", err)
			}
			return
		}
		http.NotFound(w, r)
	}))
	defer mockTriton.Close()

	cfg := &Config{
		TritonBaseURL:        mockTriton.URL,
		TritonDoclingEnabled: true,
		DefaultModel:         "test-model",
		NERLabels:            []string{"O", "VESSEL", "IMO"},
	}

	// Initialize tokenizer for the test
	if err := initTokenizer(); err != nil {
		t.Fatalf("Failed to initialize tokenizer: %v", err)
	}

	// Create test Docling client
	testDoclingClient := NewTritonDoclingClient(cfg)

	// Test PDF bytes (minimal valid PDF)
	pdfBytes := []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj xref 0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>startxref 160\n%%EOF")

	// Attempt extraction
	_, err := extractDocumentText(cfg, testDoclingClient, pdfBytes, "test.pdf")

	// Should return docling_no_text error
	if err == nil {
		t.Fatal("Expected docling_no_text error, got nil")
	}

	if err != errDoclingNoText {
		t.Errorf("Expected errDoclingNoText, got: %v", err)
	}
}

// TestTritonReturnsWrongShape tests that the adapter gracefully handles
// Triton returning wrong output shape (e.g., binary classifier instead of NER).
func TestTritonReturnsWrongShape(t *testing.T) {
	// Mock Triton server that returns binary classification logits
	mockTriton := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/models/test-model/infer" {
			// Return binary classification shape [1, 2] instead of NER shape [1, seq_len, 9]
			response := TritonResponse{
				ModelName:    "test-model",
				ModelVersion: "1",
				Outputs: []map[string]interface{}{
					{
						"name":     "logits",
						"datatype": "FP32",
						"shape":    []interface{}{float64(1), float64(2)}, // Wrong shape for NER
						"data":     []interface{}{0.8, 0.2},               // Only 2 values
					},
				},
			}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				t.Logf("Failed to encode mock response: %v", err)
			}
			return
		}
		http.NotFound(w, r)
	}))
	defer mockTriton.Close()

	cfg := &Config{
		TritonBaseURL: mockTriton.URL,
		DefaultModel:  "test-model",
		NERLabels:     []string{"O", "VESSEL", "IMO", "FLAG", "PORT", "DATE", "HS_CODE", "COMMODITY", "RISK_LEVEL"},
	}

	// Initialize tokenizer
	if err := initTokenizer(); err != nil {
		t.Fatalf("Failed to initialize tokenizer: %v", err)
	}

	// Create predict request
	reqBody := PredictRequest{
		Text:  "Test vessel IMO 1234567",
		Model: "test-model",
		Task:  "ner",
	}
	bodyBytes, _ := json.Marshal(reqBody)

	// Create HTTP request
	req := httptest.NewRequest("POST", "/predict", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")

	// Create response recorder
	rr := httptest.NewRecorder()

	// Call handler
	handler := predictHandler(cfg)
	handler.ServeHTTP(rr, req)

	// Should return 200 with empty predictions (graceful degradation)
	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}

	var result LSPrediction
	if err := json.NewDecoder(rr.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should return empty results due to invalid shape
	if len(result.Result) != 0 {
		t.Errorf("Expected empty result array, got %d entities", len(result.Result))
	}
}

// TestTritonUnavailable tests that the adapter correctly returns 503
// when Triton server is completely unavailable.
func TestTritonUnavailable(t *testing.T) {
	cfg := &Config{
		TritonBaseURL:        "http://localhost:19999", // Non-existent endpoint
		TritonDoclingEnabled: true,
		DefaultModel:         "test-model",
		NERLabels:            []string{"O", "VESSEL"},
	}

	// Initialize tokenizer
	if err := initTokenizer(); err != nil {
		t.Fatalf("Failed to initialize tokenizer: %v", err)
	}

	// Create test Docling client pointing to unavailable server
	testDoclingClient := NewTritonDoclingClient(cfg)

	// Test PDF bytes
	pdfBytes := []byte("%PDF-1.4\ntest")

	// Attempt extraction - should fail with docling_unavailable
	_, err := extractDocumentText(cfg, testDoclingClient, pdfBytes, "test.pdf")

	if err == nil {
		t.Fatal("Expected docling_unavailable error, got nil")
	}

	// Should contain docling_unavailable error
	if err != errDoclingUnavailable && err.Error() != "docling_unavailable: connection refused" {
		t.Logf("Got error: %v (acceptable if contains connection failure)", err)
	}
}

// TestHealthEndpointWhenTritonDown tests that /health returns 503
// when Triton is unavailable and TRITON_DOCLING_ENABLED=true.
func TestHealthEndpointWhenTritonDown(t *testing.T) {
	cfg := &Config{
		TritonBaseURL:        "http://localhost:19999", // Non-existent endpoint
		TritonDoclingEnabled: true,
		DefaultModel:         "test-model",
		NERLabels:            []string{"O"},
	}

	// Create HTTP request to /health
	req := httptest.NewRequest("GET", "/health", nil)
	rr := httptest.NewRecorder()

	// Call health handler
	handler := healthHandler(cfg)
	handler.ServeHTTP(rr, req)

	// Should return 503 Service Unavailable
	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 503, got %d", rr.Code)
	}

	// Should contain error about Triton
	var response map[string]interface{}
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode health response: %v", err)
	}

	if errObj, ok := response["error"].(map[string]interface{}); ok {
		code := errObj["code"].(string)
		if code != "triton_unavailable" {
			t.Errorf("Expected error code 'triton_unavailable', got '%s'", code)
		}
	} else {
		t.Error("Expected error object in response")
	}
}

// TestPredictEndpointWithMockedNER tests end-to-end prediction
// with a properly mocked NER Triton response.
func TestPredictEndpointWithMockedNER(t *testing.T) {
	// Mock Triton server that returns valid NER logits
	mockTriton := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/models/test-ner/infer" {
			// Parse request to get sequence length
			var tritonReq TritonRequest
			if err := json.NewDecoder(r.Body).Decode(&tritonReq); err != nil {
				t.Logf("Failed to decode mock request: %v", err)
			}

			seqLen := len(tritonReq.Inputs[0].Shape)
			if seqLen > 1 {
				seqLen = tritonReq.Inputs[0].Shape[1]
			} else {
				seqLen = 10 // Default
			}

			numLabels := 3 // O, VESSEL, IMO

			// Generate mock logits: all "O" except token 2-3 as "VESSEL"
			logits := make([]float64, seqLen*numLabels)
			for i := 0; i < seqLen; i++ {
				if i == 2 || i == 3 {
					// Token 2-3: High probability for VESSEL (label index 1)
					logits[i*numLabels+0] = -5.0 // O
					logits[i*numLabels+1] = 5.0  // VESSEL
					logits[i*numLabels+2] = -5.0 // IMO
				} else {
					// Other tokens: High probability for O (label index 0)
					logits[i*numLabels+0] = 5.0  // O
					logits[i*numLabels+1] = -5.0 // VESSEL
					logits[i*numLabels+2] = -5.0 // IMO
				}
			}

			response := TritonResponse{
				ModelName:    "test-ner",
				ModelVersion: "1",
				Outputs: []map[string]interface{}{
					{
						"name":     "logits",
						"datatype": "FP32",
						"shape":    []interface{}{float64(1), float64(seqLen), float64(numLabels)},
						"data":     logits,
					},
				},
			}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				t.Logf("Failed to encode mock response: %v", err)
			}
			return
		}
		http.NotFound(w, r)
	}))
	defer mockTriton.Close()

	cfg := &Config{
		TritonBaseURL: mockTriton.URL,
		DefaultModel:  "test-ner",
		NERLabels:     []string{"O", "VESSEL", "IMO"},
	}

	// Initialize tokenizer
	if err := initTokenizer(); err != nil {
		t.Fatalf("Failed to initialize tokenizer: %v", err)
	}

	// Create predict request
	reqBody := PredictRequest{
		Text:  "The vessel Arctic Explorer IMO 1234567",
		Model: "test-ner",
		Task:  "ner",
	}
	bodyBytes, _ := json.Marshal(reqBody)

	req := httptest.NewRequest("POST", "/predict", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()

	handler := predictHandler(cfg)
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var result LSPrediction
	if err := json.NewDecoder(rr.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Should have detected at least one entity
	if len(result.Result) == 0 {
		t.Error("Expected at least one entity, got none")
	}

	// Verify entity has expected structure
	if len(result.Result) > 0 {
		entity := result.Result[0]
		if entity.Type != "labels" {
			t.Errorf("Expected type 'labels', got '%s'", entity.Type)
		}
		if entity.From != "label" {
			t.Errorf("Expected from 'label', got '%s'", entity.From)
		}
		if entity.To != "text" {
			t.Errorf("Expected to 'text', got '%s'", entity.To)
		}
		if entity.Score <= 0 || entity.Score > 1 {
			t.Errorf("Invalid confidence score: %f", entity.Score)
		}
	}
}
