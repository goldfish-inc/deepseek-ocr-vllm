package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/sugarme/tokenizer"
	"github.com/sugarme/tokenizer/pretrained"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Config holds all environment variables
type Config struct {
	ListenAddr            string
	TritonBaseURL         string
	DocumentExtractionURL string
	DefaultModel          string
	NERLabels             []string
	CFAccessClientID      string
	CFAccessSecret        string
	TrainAsync            bool
	TrainDryRun           bool
	TrainUseK8sJobs       bool
	TrainJobImage         string
	TrainJobNS            string
	TrainJobTTL           int32
	TrainNodeSel          string // key=value
	TrainGPURsrc          string // e.g., nvidia.com/gpu
	TrainGPUCount         string // e.g., "1"
	HfToken               string
	HfDatasetRepo         string
	HfModelRepo           string
	HFSecretName          string
	HFSecretKey           string
	TritonModelName       string
	// S3 and webhook configuration for Docling integration
	S3Bucket             string
	WebhookSecret        string
	CSVWorkerWebhookURL  string
	TritonDoclingEnabled bool
}

// Global BERT tokenizer (initialized at startup)
var bertTokenizer *tokenizer.Tokenizer

// Global document extraction client (initialized at startup)
var docExtractionClient *DocumentExtractionClient

// Global S3 client for Docling table uploads (initialized if S3_BUCKET configured)
var s3Client *s3.Client

// Global Triton Docling client (initialized if TRITON_DOCLING_ENABLED=true)
var tritonDoclingClient *TritonDoclingClient

func initTokenizer() error {
	bertTokenizer = pretrained.BertBaseUncased()
	if bertTokenizer == nil {
		return fmt.Errorf("failed to load BERT tokenizer: tokenizer is nil")
	}
	log.Println("✅ BERT tokenizer loaded successfully")
	return nil
}

func initDocumentExtraction(cfg *Config) error {
	if cfg.DocumentExtractionURL == "" {
		log.Println("⚠️  Document extraction service not configured, PDF/image support disabled")
		return nil
	}

	docExtractionClient = NewDocumentExtractionClient(cfg.DocumentExtractionURL)

	// Test connection
	if err := docExtractionClient.Health(); err != nil {
		log.Printf("⚠️  Document extraction service health check failed: %v", err)
		return nil // Don't fail startup, just warn
	}

	log.Println("✅ Document extraction service connected")
	return nil
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
		ListenAddr:            getEnv("LISTEN_ADDR", ":9090"),
		TritonBaseURL:         getEnv("TRITON_BASE_URL", "http://localhost:8000"),
		DocumentExtractionURL: getEnv("DOCUMENT_EXTRACTION_URL", "http://document-extraction:8080"),
		DefaultModel:          getEnv("DEFAULT_MODEL", "bert-base-uncased"),
		NERLabels:             nerLabels,
		CFAccessClientID:      os.Getenv("CF_ACCESS_CLIENT_ID"),
		CFAccessSecret:        os.Getenv("CF_ACCESS_CLIENT_SECRET"),
		TrainAsync:            getEnvBool("TRAIN_ASYNC", true),
		TrainDryRun:           getEnvBool("TRAIN_DRY_RUN", false),
		TrainUseK8sJobs:       getEnvBool("TRAIN_USE_K8S_JOBS", false),
		TrainJobImage:         getEnv("TRAINING_JOB_IMAGE", "ghcr.io/goldfish-inc/oceanid/training-worker:main"),
		TrainJobNS:            getEnv("TRAINING_JOB_NAMESPACE", "apps"),
		TrainJobTTL:           int32(getEnvInt("TRAINING_JOB_TTL_SECONDS", 3600)),
		TrainNodeSel:          getEnv("TRAIN_NODE_SELECTOR", "node-role.kubernetes.io/gpu=true"),
		TrainGPURsrc:          getEnv("TRAIN_GPU_RESOURCE", "nvidia.com/gpu"),
		TrainGPUCount:         getEnv("TRAIN_GPU_COUNT", "1"),
		HfToken:               os.Getenv("HF_TOKEN"),
		HfDatasetRepo:         getEnv("HF_DATASET_REPO", "goldfish-inc/oceanid-annotations"),
		HfModelRepo:           getEnv("HF_MODEL_REPO", "goldfish-inc/oceanid-ner-distilbert"),
		HFSecretName:          getEnv("TRAIN_HF_SECRET_NAME", ""),
		HFSecretKey:           getEnv("TRAIN_HF_SECRET_KEY", "token"),
		TritonModelName:       getEnv("TRITON_MODEL_NAME", "ner-distilbert"),
		// S3 and webhook configuration for Docling integration
		S3Bucket:             getEnv("S3_BUCKET", ""),
		WebhookSecret:        os.Getenv("WEBHOOK_SECRET"),
		CSVWorkerWebhookURL:  getEnv("CSV_WORKER_WEBHOOK_URL", "http://csv-ingestion-worker:8080/webhook"),
		TritonDoclingEnabled: getEnvBool("TRITON_DOCLING_ENABLED", false),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	if value := os.Getenv(key); value != "" {
		v := strings.ToLower(strings.TrimSpace(value))
		return v == "1" || v == "true" || v == "yes" || v == "on"
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		_, err := fmt.Sscanf(v, "%d", &n)
		if err == nil {
			return n
		}
	}
	return fallback
}

// PredictRequest represents the prediction request
type PredictRequest struct {
	Text        string                 `json:"text,omitempty"`
	PDFBase64   string                 `json:"pdf_base64,omitempty"`
	ImageBase64 string                 `json:"image_base64,omitempty"`
	FileUpload  string                 `json:"file_upload,omitempty"` // S3 URL for PDF/image files
	DocType     string                 `json:"doc_type,omitempty"`    // pdf, image, csv, xlsx, etc.
	FileName    string                 `json:"file_name,omitempty"`
	Prompt      string                 `json:"prompt,omitempty"`
	Model       string                 `json:"model,omitempty"`
	Task        string                 `json:"task,omitempty"`
	TaskID      int64                  `json:"task_id,omitempty"`    // Label Studio task ID
	ProjectID   int64                  `json:"project_id,omitempty"` // Label Studio project ID
	Inputs      map[string]interface{} `json:"inputs,omitempty"`
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
	Model      string      `json:"model"`
	ModelRun   string      `json:"model_run"`
	Result     []LSResult  `json:"result"`
	Score      float64     `json:"score,omitempty"`
	ClusterID  int         `json:"cluster,omitempty"`
	Neighbors  []int       `json:"neighbors,omitempty"`
	MMLConfigs []MMLConfig `json:"mml_configs,omitempty"`
}

// LSResult represents a single Label Studio result
type LSResult struct {
	Value  map[string]interface{} `json:"value"`
	From   string                 `json:"from_name"`
	To     string                 `json:"to_name"`
	Type   string                 `json:"type"`
	Score  float64                `json:"score,omitempty"`
	Hidden bool                   `json:"hidden,omitempty"`
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
	defer func() {
		if err := resp.Body.Close(); err != nil {
			log.Printf("Failed to close response body: %v", err)
		}
	}()

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

// extractDocumentText extracts text from PDF/image using Triton Docling or HTTP extractor
// Returns (text, error) with fallback pattern
func extractDocumentText(cfg *Config, tritonDoclingClient *TritonDoclingClient, pdfBytes []byte, filename string) (string, error) {
	// Try Triton Docling first if enabled
	if cfg.TritonDoclingEnabled && tritonDoclingClient != nil {
		log.Printf("Attempting Triton Docling extraction for %s", filename)
		doclingResult, err := tritonDoclingClient.ExtractFromPDF(pdfBytes)
		if err == nil {
			log.Printf("Triton Docling extraction successful for %s (%d words)", filename, doclingResult.WordCount)
			return doclingResult.Text, nil
		}
		log.Printf("Triton Docling extraction failed for %s: %v, falling back to HTTP extractor", filename, err)
	}

	// Fallback to HTTP document extraction service
	if docExtractionClient == nil {
		return "", fmt.Errorf("no extraction method available (Triton disabled and HTTP client nil)")
	}

	log.Printf("Using HTTP extractor for %s", filename)
	result, err := docExtractionClient.ExtractFromBytes(pdfBytes, filename)
	if err != nil {
		return "", fmt.Errorf("HTTP extraction failed: %w", err)
	}

	return result.Text, nil
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

		// Extract text from documents if needed
		if req.Text == "" && (req.PDFBase64 != "" || req.ImageBase64 != "") {
			if docExtractionClient == nil {
				http.Error(w, "document extraction not configured", http.StatusServiceUnavailable)
				return
			}

			var docBytes []byte
			var filename string

			if req.PDFBase64 != "" {
				var err error
				docBytes, err = base64.StdEncoding.DecodeString(req.PDFBase64)
				if err != nil {
					http.Error(w, fmt.Sprintf("invalid base64: %v", err), http.StatusBadRequest)
					return
				}
				filename = "document.pdf"
			} else if req.ImageBase64 != "" {
				var err error
				docBytes, err = base64.StdEncoding.DecodeString(req.ImageBase64)
				if err != nil {
					http.Error(w, fmt.Sprintf("invalid base64: %v", err), http.StatusBadRequest)
					return
				}
				// Use filename hint if provided, otherwise default to .jpg
				if req.FileName != "" {
					filename = req.FileName
				} else {
					filename = "image.jpg"
				}
			}

			// Extract text from document
			result, err := docExtractionClient.ExtractFromBytes(docBytes, filename)
			if err != nil {
				http.Error(w, fmt.Sprintf("document extraction failed: %v", err), http.StatusInternalServerError)
				return
			}

			req.Text = result.Text
			log.Printf("Extracted %d chars from %s", result.CharCount, filename)
		}

		// Text is required (either directly provided or extracted from document)
		if req.Text == "" {
			http.Error(w, "text field is required (or provide pdf_base64/image_base64)", http.StatusBadRequest)
			return
		}

		// BERT tokenization (using sugarme/tokenizer)
		encoding, err := bertTokenizer.EncodeSingle(req.Text)
		if err != nil {
			http.Error(w, fmt.Sprintf("Tokenization failed: %v", err), http.StatusInternalServerError)
			return
		}

		// Get token IDs and create attention mask
		tokenIDs := encoding.GetIds()
		if len(tokenIDs) == 0 {
			http.Error(w, "empty text after tokenization", http.StatusBadRequest)
			return
		}

		// Convert uint32 token IDs to int64 for Triton
		tokenIDsInt64 := make([]int64, len(tokenIDs))
		for i, id := range tokenIDs {
			tokenIDsInt64[i] = int64(id)
		}

		// Create Triton input tensors
		inputs := []TritonTensor{
			{
				Name:     "input_ids",
				Shape:    []int{1, len(tokenIDsInt64)},
				DataType: "INT64",
				Data:     tokenIDsInt64,
			},
			{
				Name:     "attention_mask",
				Shape:    []int{1, len(tokenIDsInt64)},
				DataType: "INT64",
				Data:     makeOnes(len(tokenIDsInt64)),
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
			result := processNEROutput(cfg, tritonResp, encoding, req.Text)
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(result); err != nil {
				log.Printf("Failed to encode NER result: %v", err)
			}
		} else {
			// Return raw Triton response for other tasks
			w.Header().Set("Content-Type", "application/json")
			if err := json.NewEncoder(w).Encode(tritonResp); err != nil {
				log.Printf("Failed to encode Triton response: %v", err)
			}
		}
	}
}

func processNEROutput(cfg *Config, resp *TritonResponse, encoding *tokenizer.Encoding, originalText string) LSPrediction {
	// Extract logits from Triton response
	if len(resp.Outputs) == 0 {
		log.Println("Warning: No outputs in Triton response")
		return emptyPrediction(cfg)
	}

	output := resp.Outputs[0]
	logitsFlat, ok := output["data"].([]interface{})
	if !ok {
		log.Println("Warning: Invalid data format in Triton response")
		return emptyPrediction(cfg)
	}

	// Extract shape [batch_size, sequence_length, num_labels]
	shape, ok := output["shape"].([]interface{})
	if !ok || len(shape) != 3 {
		log.Printf("Warning: Invalid shape in Triton response: %v", output["shape"])
		return emptyPrediction(cfg)
	}

	// Safe type conversion for shape values
	seqLenFloat, ok := shape[1].(float64)
	if !ok {
		log.Printf("Warning: Invalid sequence length type in shape: %T", shape[1])
		return emptyPrediction(cfg)
	}
	numLabelsFloat, ok := shape[2].(float64)
	if !ok {
		log.Printf("Warning: Invalid num_labels type in shape: %T", shape[2])
		return emptyPrediction(cfg)
	}
	seqLen := int(seqLenFloat)
	numLabels := int(numLabelsFloat)

	if len(logitsFlat) != seqLen*numLabels {
		log.Printf("Warning: Logits size mismatch. Expected %d, got %d", seqLen*numLabels, len(logitsFlat))
		return emptyPrediction(cfg)
	}

	// Reshape logits to [sequence_length, num_labels]
	logits := make([][]float32, seqLen)
	for i := 0; i < seqLen; i++ {
		logits[i] = make([]float32, numLabels)
		for j := 0; j < numLabels; j++ {
			idx := i*numLabels + j
			val, ok := logitsFlat[idx].(float64)
			if !ok {
				log.Printf("Warning: Invalid logit value type at [%d,%d]: %T", i, j, logitsFlat[idx])
				return emptyPrediction(cfg)
			}
			logits[i][j] = float32(val)
		}
	}

	// Apply argmax to get predicted label indices
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
		// Calculate confidence using softmax
		softmaxProbs := softmax(logits[i])
		confidences[i] = softmaxProbs[maxIdx]
	}

	// Convert token predictions to character spans
	return alignToCharacters(predictions, confidences, encoding, originalText, cfg.NERLabels, cfg)
}

// emptyPrediction returns a prediction with no entities
func emptyPrediction(cfg *Config) LSPrediction {
	return LSPrediction{
		Model:    cfg.DefaultModel,
		ModelRun: fmt.Sprintf("oceanid-%d", time.Now().Unix()),
		Result:   []LSResult{},
		Score:    0.0,
	}
}

// softmax converts logits to probabilities (numerically stable version)
func softmax(logits []float32) []float32 {
	if len(logits) == 0 {
		return []float32{}
	}

	// Find max for numerical stability
	maxLogit := logits[0]
	for _, v := range logits[1:] {
		if v > maxLogit {
			maxLogit = v
		}
	}

	// Compute exp(logit - max) and sum
	expSum := float32(0.0)
	exp := make([]float32, len(logits))
	for i, v := range logits {
		exp[i] = float32(math.Exp(float64(v - maxLogit)))
		expSum += exp[i]
	}

	// Normalize
	if expSum > 0 {
		for i := range exp {
			exp[i] /= expSum
		}
	}
	return exp
}

// alignToCharacters converts token-level predictions to character-level spans
func alignToCharacters(
	predictions []int,
	confidences []float32,
	encoding *tokenizer.Encoding,
	originalText string,
	labels []string,
	cfg *Config,
) LSPrediction {
	offsets := encoding.GetOffsets()
	tokens := encoding.GetTokens()

	result := LSPrediction{
		Model:    cfg.DefaultModel,
		ModelRun: fmt.Sprintf("oceanid-%d", time.Now().Unix()),
		Result:   []LSResult{},
		Score:    0.0,
	}

	// Validate array lengths match
	if len(predictions) != len(offsets) || len(predictions) != len(tokens) {
		log.Printf("Warning: Length mismatch - predictions:%d, offsets:%d, tokens:%d",
			len(predictions), len(offsets), len(tokens))
		return result
	}

	// Track current entity being built
	var currentEntity *struct {
		label      string
		start, end int
		tokens     []string
		confidence float32
	}

	// Merge consecutive tokens with same label
	for i := 0; i < len(predictions); i++ {
		labelIdx := predictions[i]
		if labelIdx >= len(labels) {
			log.Printf("Warning: Label index %d out of range (max %d)", labelIdx, len(labels)-1)
			continue
		}
		label := labels[labelIdx]

		// Skip "O" (non-entity) and special tokens
		if label == "O" || tokens[i] == "[CLS]" || tokens[i] == "[SEP]" || tokens[i] == "[PAD]" {
			if currentEntity != nil {
				// Flush current entity
				result.Result = append(result.Result, createLSResult(currentEntity, originalText))
				currentEntity = nil
			}
			continue
		}

		// Start new entity or continue current
		if currentEntity == nil || currentEntity.label != label {
			if currentEntity != nil {
				// Flush previous entity
				result.Result = append(result.Result, createLSResult(currentEntity, originalText))
			}
			// Start new entity
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
			// Average confidence
			currentEntity.confidence = (currentEntity.confidence + confidences[i]) / 2
		}
	}

	// Flush last entity
	if currentEntity != nil {
		result.Result = append(result.Result, createLSResult(currentEntity, originalText))
	}

	// Calculate overall score (average confidence of all entities)
	if len(result.Result) > 0 {
		totalScore := 0.0
		for _, res := range result.Result {
			totalScore += res.Score
		}
		result.Score = totalScore / float64(len(result.Result))
	}

	return result
}

// createLSResult converts an entity to Label Studio result format
func createLSResult(entity *struct {
	label      string
	start, end int
	tokens     []string
	confidence float32
}, originalText string) LSResult {
	// Ensure offsets are valid
	if entity.start < 0 {
		entity.start = 0
	}
	if entity.end > len(originalText) {
		entity.end = len(originalText)
	}
	if entity.start >= entity.end {
		// Fix invalid span - use minimum valid range
		if entity.start < len(originalText) {
			entity.end = entity.start + 1
		} else {
			// Start is at end of text, reset to valid range
			entity.start = len(originalText) - 1
			entity.end = len(originalText)
		}
	}
	// Final safety check
	if entity.start >= len(originalText) {
		entity.start = 0
		entity.end = 1
	}

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

		// Extract text or file_upload
		text, hasText := data["text"].(string)
		fileUpload, hasFileUpload := data["file_upload"].(string)

		// If no text but file_upload exists, extract from S3
		if !hasText && hasFileUpload && strings.HasPrefix(fileUpload, "s3://") {
			if s3Client == nil {
				http.Error(w, "S3 client not configured", http.StatusServiceUnavailable)
				return
			}

			// Parse S3 URL (s3://bucket/key)
			s3URL := strings.TrimPrefix(fileUpload, "s3://")
			parts := strings.SplitN(s3URL, "/", 2)
			if len(parts) != 2 {
				http.Error(w, "Invalid S3 URL format", http.StatusBadRequest)
				return
			}
			bucket, key := parts[0], parts[1]

			// Download PDF from S3
			log.Printf("Downloading %s from S3 bucket %s", key, bucket)
			getResp, err := s3Client.GetObject(r.Context(), &s3.GetObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(key),
			})
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to download from S3: %v", err), http.StatusInternalServerError)
				return
			}
			defer func() { _ = getResp.Body.Close() }()

			pdfBytes, err := io.ReadAll(getResp.Body)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to read S3 object: %v", err), http.StatusInternalServerError)
				return
			}

			// Extract text from PDF using Triton Docling or HTTP extractor
			filename := filepath.Base(key)
			extractedText, err := extractDocumentText(cfg, tritonDoclingClient, pdfBytes, filename)
			if err != nil {
				http.Error(w, fmt.Sprintf("Document extraction failed: %v", err), http.StatusInternalServerError)
				return
			}

			text = extractedText
			log.Printf("Extracted %d chars from %s", len(text), filename)

			// If Triton Docling extracted tables, upload to S3 and trigger webhook
			if cfg.TritonDoclingEnabled && tritonDoclingClient != nil {
				doclingResult, err := tritonDoclingClient.ExtractFromPDF(pdfBytes)
				if err == nil && len(doclingResult.Tables) > 0 {
					// Extract task ID and project ID from task data
					taskID, _ := task["id"].(float64)
					var projectID float64
					if proj, ok := task["project"].(float64); ok {
						projectID = proj
					} else if projMap, ok := task["project"].(map[string]interface{}); ok {
						if pid, ok := projMap["id"].(float64); ok {
							projectID = pid
						}
					}

					if taskID > 0 && projectID > 0 {
						s3Keys, err := uploadDoclingTablesToS3(r.Context(), s3Client, bucket, int64(projectID), int64(taskID), doclingResult.Tables)
						if err != nil {
							log.Printf("Failed to upload Docling tables: %v", err)
						} else {
							// Trigger CSV worker webhook
							if err := triggerCSVWorkerWebhook(cfg, int64(taskID), int64(projectID), s3Keys); err != nil {
								log.Printf("Failed to trigger CSV worker webhook: %v", err)
							}
						}
					}
				}
			}
		} else if !hasText {
			http.Error(w, "No text or file_upload field in task", http.StatusBadRequest)
			return
		}

		// Tokenize text
		encoding, err := bertTokenizer.EncodeSingle(text)
		if err != nil {
			http.Error(w, fmt.Sprintf("Tokenization failed: %v", err), http.StatusInternalServerError)
			return
		}

		tokenIDs := encoding.GetIds()
		if len(tokenIDs) == 0 {
			http.Error(w, "empty text after tokenization", http.StatusBadRequest)
			return
		}

		// Convert uint32 token IDs to int64 for Triton
		tokenIDsInt64 := make([]int64, len(tokenIDs))
		for i, id := range tokenIDs {
			tokenIDsInt64[i] = int64(id)
		}

		// Build Triton request
		inputs := []TritonTensor{
			{
				Name:     "input_ids",
				Shape:    []int{1, len(tokenIDsInt64)},
				DataType: "INT64",
				Data:     tokenIDsInt64,
			},
			{
				Name:     "attention_mask",
				Shape:    []int{1, len(tokenIDsInt64)},
				DataType: "INT64",
				Data:     makeOnes(len(tokenIDsInt64)),
			},
		}

		// Call Triton
		tritonResp, err := makeTritonRequest(cfg, cfg.DefaultModel, inputs)
		if err != nil {
			http.Error(w, fmt.Sprintf("Triton error: %v", err), http.StatusBadGateway)
			return
		}

		// Process NER results
		result := processNEROutput(cfg, tritonResp, encoding, text)

		// Return predictions in Label Studio format
		response := map[string]interface{}{
			"results": []LSPrediction{result},
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			log.Printf("Failed to encode prediction result: %v", err)
		}
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]bool{"ok": true}); err != nil {
		log.Printf("Failed to encode health response: %v", err)
	}
}

// setupHandler returns Label Studio ML backend configuration
func setupHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		setup := map[string]interface{}{
			"model_version": "oceanid-ner-v1",
			"hostname":      "ls-triton-adapter",
			"status":        "ready",
			"model_name":    cfg.DefaultModel,
			"labels":        cfg.NERLabels,
		}
		if err := json.NewEncoder(w).Encode(setup); err != nil {
			log.Printf("Failed to encode setup response: %v", err)
		}
	}
}

func makeOnes(n int) []int64 {
	ones := make([]int64, n)
	for i := range ones {
		ones[i] = 1
	}
	return ones
}

// trainHandler triggers K8s training Job for model retraining
func trainHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Label Studio sends annotation data in request body
		// Read body but do not block on downstream call
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			log.Printf("Train request body parse error: %v", err)
		}

		// Best-effort count of annotations if present
		annCount := 0
		if anns, ok := body["annotations"].([]interface{}); ok {
			annCount = len(anns)
		} else if data, ok := body["data"].([]interface{}); ok {
			annCount = len(data)
		}
		requestID := fmt.Sprintf("trn-%d", time.Now().UnixNano())
		log.Printf("/train request %s received (annotations~%d, async=%v, dry_run=%v, k8s_jobs=%v)", requestID, annCount, cfg.TrainAsync, cfg.TrainDryRun, true)

		// Prepare immediate response
		respObj := map[string]interface{}{
			"status":     "queued",
			"message":    "Training request accepted",
			"request_id": requestID,
			"async":      cfg.TrainAsync,
			"dry_run":    cfg.TrainDryRun,
		}
		// Add job discovery hint
		respObj["job_namespace"] = cfg.TrainJobNS

		// Kick off training via K8s Job
		trigger := func() {
			if cfg.TrainDryRun {
				log.Printf("/train %s dry-run: would create training Job in %s", requestID, cfg.TrainJobNS)
				return
			}
			if err := triggerK8sJob(cfg, requestID, annCount); err != nil {
				log.Printf("/train %s K8s Job creation failed: %v", requestID, err)
			}
		}

		if cfg.TrainAsync {
			go trigger()
		} else {
			trigger()
		}

		// Respond immediately
		w.Header().Set("Content-Type", "application/json")
		// Keep 200 for Label Studio compatibility
		if err := json.NewEncoder(w).Encode(respObj); err != nil {
			log.Printf("Failed to encode train response: %v", err)
		}
	}
}

func triggerK8sJob(cfg *Config, requestID string, annCount int) error {
	// In-cluster config
	restCfg, err := rest.InClusterConfig()
	if err != nil {
		return fmt.Errorf("in-cluster config: %w", err)
	}
	clientset, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return fmt.Errorf("clientset: %w", err)
	}

	// Parse node selector key=value
	nsKey := ""
	nsVal := ""
	if kv := strings.SplitN(cfg.TrainNodeSel, "=", 2); len(kv) == 2 {
		nsKey, nsVal = strings.TrimSpace(kv[0]), strings.TrimSpace(kv[1])
	}

	// Resources
	cpuReq := resource.MustParse("4")
	memReq := resource.MustParse("8Gi")
	var gpuQty resource.Quantity
	if cfg.TrainGPUCount != "" {
		gpuQty = resource.MustParse(cfg.TrainGPUCount)
	}
	limits := corev1.ResourceList{
		corev1.ResourceCPU:    cpuReq,
		corev1.ResourceMemory: memReq,
	}
	requests := corev1.ResourceList{
		corev1.ResourceCPU:    cpuReq,
		corev1.ResourceMemory: memReq,
	}
	if cfg.TrainGPURsrc != "" && cfg.TrainGPUCount != "0" && cfg.TrainGPUCount != "" {
		rn := corev1.ResourceName(cfg.TrainGPURsrc)
		limits[rn] = gpuQty
		requests[rn] = gpuQty
	}

	jobName := fmt.Sprintf("train-%d", time.Now().Unix())
	backoff := int32(0)
	ttl := cfg.TrainJobTTL
	env := []corev1.EnvVar{}
	// Prefer SecretKeyRef from k8s Secret created via ESC
	if cfg.HFSecretName != "" {
		env = append(env, corev1.EnvVar{
			Name: "HF_TOKEN",
			ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
				LocalObjectReference: corev1.LocalObjectReference{Name: cfg.HFSecretName},
				Key:                  cfg.HFSecretKey,
			}},
		})
	} else if cfg.HfToken != "" { // fallback to plain env (not recommended)
		env = append(env, corev1.EnvVar{Name: "HF_TOKEN", Value: cfg.HfToken})
	}
	env = append(env,
		corev1.EnvVar{Name: "HF_DATASET_REPO", Value: cfg.HfDatasetRepo},
		corev1.EnvVar{Name: "HF_MODEL_REPO", Value: cfg.HfModelRepo},
		corev1.EnvVar{Name: "ANNOTATION_COUNT", Value: fmt.Sprintf("%d", annCount)},
		corev1.EnvVar{Name: "TRITON_URL", Value: cfg.TritonBaseURL},
		corev1.EnvVar{Name: "TRITON_MODEL_NAME", Value: cfg.TritonModelName},
	)

	podSpec := corev1.PodSpec{
		RestartPolicy:    corev1.RestartPolicyNever,
		ImagePullSecrets: []corev1.LocalObjectReference{{Name: "ghcr-creds"}},
		Containers: []corev1.Container{{
			Name:  "trainer",
			Image: cfg.TrainJobImage,
			Env:   env,
			Resources: corev1.ResourceRequirements{
				Limits:   limits,
				Requests: requests,
			},
		}},
	}
	if nsKey != "" && nsVal != "" {
		podSpec.NodeSelector = map[string]string{nsKey: nsVal}
	}
	// Common GPU taints on Calypso
	podSpec.Tolerations = []corev1.Toleration{
		{Key: "nvidia.com/gpu", Operator: corev1.TolerationOpEqual, Value: "true", Effect: corev1.TaintEffectNoSchedule},
		{Key: "workload-type", Operator: corev1.TolerationOpEqual, Value: "gpu-compute", Effect: corev1.TaintEffectNoSchedule},
	}

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: cfg.TrainJobNS,
			Labels: map[string]string{
				"app":     "training-worker",
				"trigger": "label-studio",
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            &backoff,
			TTLSecondsAfterFinished: &ttl,
			Template: corev1.PodTemplateSpec{
				Spec: podSpec,
			},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err = clientset.BatchV1().Jobs(cfg.TrainJobNS).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return err
	}
	log.Printf("/train %s created Job %s/%s (image=%s)", requestID, cfg.TrainJobNS, jobName, cfg.TrainJobImage)
	return nil
}

func main() {
	cfg := loadConfig()

	// Initialize BERT tokenizer
	if err := initTokenizer(); err != nil {
		log.Fatalf("Tokenizer initialization failed: %v", err)
	}

	// Initialize document extraction client
	if err := initDocumentExtraction(cfg); err != nil {
		log.Fatalf("Document extraction initialization failed: %v", err)
	}

	// Initialize S3 client if bucket configured
	if cfg.S3Bucket != "" {
		awsCfg, err := config.LoadDefaultConfig(context.Background())
		if err != nil {
			log.Printf("WARNING: Failed to load AWS config: %v (S3 uploads disabled)", err)
		} else {
			s3Client = s3.NewFromConfig(awsCfg)
			log.Printf("S3 client initialized for bucket: %s", cfg.S3Bucket)
		}
	}

	// Initialize Triton Docling client if enabled
	if cfg.TritonDoclingEnabled {
		tritonDoclingClient = NewTritonDoclingClient(cfg)
		log.Printf("Triton Docling client initialized (enabled)")
	} else {
		log.Printf("Triton Docling extraction disabled (using HTTP extractor)")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/setup", setupHandler(cfg))
	mux.HandleFunc("/predict", predictHandler(cfg))
	mux.HandleFunc("/predict_ls", predictLSHandler(cfg))
	mux.HandleFunc("/train", trainHandler(cfg))

	log.Printf("Starting ls-triton-adapter on %s", cfg.ListenAddr)
	log.Printf("Triton base URL: %s", cfg.TritonBaseURL)
	log.Printf("Document extraction URL: %s", cfg.DocumentExtractionURL)
	log.Printf("NER labels: %v", cfg.NERLabels)
	log.Printf("/train async=%v dry_run=%v k8sJobs=true jobImage=%s", cfg.TrainAsync, cfg.TrainDryRun, cfg.TrainJobImage)

	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}
