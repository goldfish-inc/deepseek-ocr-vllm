package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Config holds all environment variables
type Config struct {
	ListenAddr       string
	TritonBaseURL    string
	DefaultModel     string
	NERLabels        []string
	CFAccessClientID string
	CFAccessSecret   string
}

func loadConfig() *Config {
	// Load NER labels from environment or defaults
	nerLabelsJSON := os.Getenv("NER_LABELS")
	var nerLabels []string
	if nerLabelsJSON != "" {
		if err := json.Unmarshal([]byte(nerLabelsJSON), &nerLabels); err != nil {
			log.Fatalf("Failed to parse NER_LABELS: %v", err)
		}
	} else {
		nerLabels = []string{"O", "VESSEL", "IMO", "MMSI", "IRCS", "PORT", "DATE", "COMPANY", "FLAG"}
	}

	return &Config{
		ListenAddr:       getEnv("LISTEN_ADDR", ":9090"),
		TritonBaseURL:    getEnv("TRITON_BASE_URL", "http://localhost:8000"),
		DefaultModel:     getEnv("DEFAULT_MODEL", "bert-base-uncased"),
		NERLabels:        nerLabels,
		CFAccessClientID: os.Getenv("CF_ACCESS_CLIENT_ID"),
		CFAccessSecret:   os.Getenv("CF_ACCESS_CLIENT_SECRET"),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// PredictRequest represents the prediction request
type PredictRequest struct {
	Text      string                 `json:"text,omitempty"`
	PDFBase64 string                 `json:"pdf_base64,omitempty"`
	Prompt    string                 `json:"prompt,omitempty"`
	Model     string                 `json:"model,omitempty"`
	Task      string                 `json:"task,omitempty"`
	Inputs    map[string]interface{} `json:"inputs,omitempty"`
}

// TritonRequest represents the request to Triton
type TritonRequest struct {
	Inputs  []TritonTensor `json:"inputs"`
	Outputs []TritonOutput `json:"outputs,omitempty"`
}

// TritonTensor represents a tensor in Triton format
type TritonTensor struct {
	Name     string      `json:"name"`
	Shape    []int       `json:"shape"`
	DataType string      `json:"datatype"`
	Data     interface{} `json:"data"`
}

// TritonOutput specifies desired output
type TritonOutput struct {
	Name string `json:"name"`
}

// TritonResponse represents the response from Triton
type TritonResponse struct {
	ModelName    string                   `json:"model_name"`
	ModelVersion string                   `json:"model_version"`
	Outputs      []map[string]interface{} `json:"outputs"`
}

// LSPrediction represents Label Studio formatted prediction
type LSPrediction struct {
	Model       string       `json:"model"`
	ModelRun    string       `json:"model_run"`
	Result      []LSResult   `json:"result"`
	Score       float64      `json:"score,omitempty"`
	ClusterID   int          `json:"cluster,omitempty"`
	Neighbors   []int        `json:"neighbors,omitempty"`
	MMLConfigs  []MMLConfig  `json:"mml_configs,omitempty"`
}

// LSResult represents a single Label Studio result
type LSResult struct {
	Value  map[string]interface{} `json:"value"`
	From   string                 `json:"from_name"`
	To     string                 `json:"to_name"`
	Type   string                 `json:"type"`
	Score  float64               `json:"score,omitempty"`
	Hidden bool                  `json:"hidden,omitempty"`
}

// MMLConfig for backward compatibility
type MMLConfig struct {
	Model   string `json:"model"`
	Version string `json:"version"`
}

func makeTritonRequest(cfg *Config, model string, inputs []TritonTensor) (*TritonResponse, error) {
	url := fmt.Sprintf("%s/v2/models/%s/infer", cfg.TritonBaseURL, model)

	reqBody := TritonRequest{
		Inputs: inputs,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	// Add Cloudflare Access headers if configured
	if cfg.CFAccessClientID != "" && cfg.CFAccessSecret != "" {
		req.Header.Set("CF-Access-Client-Id", cfg.CFAccessClientID)
		req.Header.Set("CF-Access-Client-Secret", cfg.CFAccessSecret)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("triton error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var tritonResp TritonResponse
	if err := json.NewDecoder(resp.Body).Decode(&tritonResp); err != nil {
		return nil, err
	}

	return &tritonResp, nil
}

func predictHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req PredictRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Default model and task
		if req.Model == "" {
			req.Model = cfg.DefaultModel
		}
		if req.Task == "" {
			req.Task = "ner"
		}

		// For now, we only handle text input
		if req.Text == "" {
			http.Error(w, "text field is required", http.StatusBadRequest)
			return
		}

		// Simple tokenization (word-based for demo)
		// In production, you'd use proper BERT tokenizer
		words := strings.Fields(req.Text)
		if len(words) == 0 {
			http.Error(w, "empty text", http.StatusBadRequest)
			return
		}

		// Create token IDs (simplified - real BERT tokenization needed)
		tokenIDs := make([]int64, len(words))
		for i := range words {
			tokenIDs[i] = int64(100 + i) // Dummy token IDs
		}

		// Create Triton input tensors
		inputs := []TritonTensor{
			{
				Name:     "input_ids",
				Shape:    []int{1, len(tokenIDs)},
				DataType: "INT64",
				Data:     tokenIDs,
			},
			{
				Name:     "attention_mask",
				Shape:    []int{1, len(tokenIDs)},
				DataType: "INT64",
				Data:     makeOnes(len(tokenIDs)),
			},
		}

		// Call Triton
		tritonResp, err := makeTritonRequest(cfg, req.Model, inputs)
		if err != nil {
			http.Error(w, fmt.Sprintf("Triton error: %v", err), http.StatusBadGateway)
			return
		}

		// Process NER results
		if req.Task == "ner" {
			result := processNEROutput(cfg, tritonResp, words, req.Text)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
		} else {
			// Return raw Triton response for other tasks
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(tritonResp)
		}
	}
}

func processNEROutput(cfg *Config, resp *TritonResponse, words []string, originalText string) LSPrediction {
	// Extract logits from Triton response
	// This is simplified - actual processing depends on model output format

	result := LSPrediction{
		Model:    cfg.DefaultModel,
		ModelRun: fmt.Sprintf("oceanid-%d", time.Now().Unix()),
		Result:   []LSResult{},
		Score:    0.9, // Dummy confidence
	}

	// Find entities (simplified - just demo)
	currentPos := 0
	for i, word := range words {
		startPos := strings.Index(originalText[currentPos:], word)
		if startPos == -1 {
			continue
		}
		startPos += currentPos
		endPos := startPos + len(word)
		currentPos = endPos

		// Dummy entity detection - in reality, use model output
		if i%3 == 0 && i > 0 { // Every 3rd word is an "entity"
			labelIdx := i % len(cfg.NERLabels)
			if labelIdx > 0 { // Skip "O" label
				result.Result = append(result.Result, LSResult{
					Value: map[string]interface{}{
						"start":  startPos,
						"end":    endPos,
						"text":   word,
						"labels": []string{cfg.NERLabels[labelIdx]},
					},
					From: "label",
					To:   "text",
					Type: "labels",
					Score: 0.85,
				})
			}
		}
	}

	return result
}

func predictLSHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Extract tasks from Label Studio format
		var tasks []interface{}
		if t, ok := body["tasks"].([]interface{}); ok {
			tasks = t
		} else if d, ok := body["data"].([]interface{}); ok {
			tasks = d
		} else if _, ok := body["data"]; ok {
			tasks = []interface{}{body["data"]}
		} else {
			tasks = []interface{}{body}
		}

		if len(tasks) == 0 {
			http.Error(w, "No tasks provided", http.StatusBadRequest)
			return
		}

		// Get first task
		task := tasks[0].(map[string]interface{})
		data, ok := task["data"].(map[string]interface{})
		if !ok {
			data = task
		}

		// Extract text
		text, ok := data["text"].(string)
		if !ok {
			http.Error(w, "No text field in task", http.StatusBadRequest)
			return
		}

		// Process as regular predict request
		req := PredictRequest{
			Text:  text,
			Model: cfg.DefaultModel,
			Task:  "ner",
		}

		// Reuse predict logic
		// For simplicity, we'll call the predict endpoint internally
		// In production, extract this to a shared function
		words := strings.Fields(req.Text)
		if len(words) == 0 {
			http.Error(w, "empty text", http.StatusBadRequest)
			return
		}

		// Dummy processing for demo
		result := processNEROutput(cfg, &TritonResponse{}, words, text)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func makeOnes(n int) []int64 {
	ones := make([]int64, n)
	for i := range ones {
		ones[i] = 1
	}
	return ones
}

func main() {
	cfg := loadConfig()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/predict", predictHandler(cfg))
	mux.HandleFunc("/predict_ls", predictLSHandler(cfg))

	log.Printf("Starting ls-triton-adapter on %s", cfg.ListenAddr)
	log.Printf("Triton base URL: %s", cfg.TritonBaseURL)
	log.Printf("NER labels: %v", cfg.NERLabels)

	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}
