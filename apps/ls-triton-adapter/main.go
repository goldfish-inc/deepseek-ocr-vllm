package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "strings"
    "time"
    "context"

    batchv1 "k8s.io/api/batch/v1"
    corev1 "k8s.io/api/core/v1"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/apimachinery/pkg/api/resource"
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/rest"
)

// Config holds all environment variables
type Config struct {
    ListenAddr       string
    TritonBaseURL    string
    DefaultModel     string
    NERLabels        []string
    CFAccessClientID string
    CFAccessSecret   string
    GitHubToken      string
    GitHubRepo       string
    GitHubWorkflow   string
    TrainAsync       bool
    TrainDryRun      bool
    TrainUseK8sJobs  bool
    TrainJobImage    string
    TrainJobNS       string
    TrainJobTTL      int32
    TrainNodeSel     string // key=value
    TrainGPURsrc     string // e.g., nvidia.com/gpu
    TrainGPUCount    string // e.g., "1"
    HfToken          string
    HfDatasetRepo    string
    HfModelRepo      string
    FallbackToGH     bool
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
        GitHubToken:      os.Getenv("GITHUB_TOKEN"),
        GitHubRepo:       getEnv("GITHUB_REPO", "goldfish-inc/oceanid"),
        GitHubWorkflow:   getEnv("GITHUB_WORKFLOW", "train-ner.yml"),
        TrainAsync:       getEnvBool("TRAIN_ASYNC", true),
        TrainDryRun:      getEnvBool("TRAIN_DRY_RUN", false),
        TrainUseK8sJobs:  getEnvBool("TRAIN_USE_K8S_JOBS", false),
        TrainJobImage:    getEnv("TRAINING_JOB_IMAGE", "ghcr.io/goldfish-inc/oceanid/training-worker:main"),
        TrainJobNS:       getEnv("TRAINING_JOB_NAMESPACE", "apps"),
        TrainJobTTL:      int32(getEnvInt("TRAINING_JOB_TTL_SECONDS", 3600)),
        TrainNodeSel:     getEnv("TRAIN_NODE_SELECTOR", "node-role.kubernetes.io/gpu=true"),
        TrainGPURsrc:     getEnv("TRAIN_GPU_RESOURCE", "nvidia.com/gpu"),
        TrainGPUCount:    getEnv("TRAIN_GPU_COUNT", "1"),
        HfToken:          os.Getenv("HF_TOKEN"),
        HfDatasetRepo:    getEnv("HF_DATASET_REPO", "goldfish-inc/oceanid-annotations"),
        HfModelRepo:      getEnv("HF_MODEL_REPO", "goldfish-inc/oceanid-ner-distilbert"),
        FallbackToGH:     getEnvBool("TRAIN_FALLBACK_GH", true),
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
		json.NewEncoder(w).Encode(setup)
	}
}

func makeOnes(n int) []int64 {
	ones := make([]int64, n)
	for i := range ones {
		ones[i] = 1
	}
	return ones
}

// trainHandler triggers GitHub Actions workflow for model retraining
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
        log.Printf("/train request %s received (annotations~%d, async=%v, dry_run=%v, k8s_jobs=%v)", requestID, annCount, cfg.TrainAsync, cfg.TrainDryRun, cfg.TrainUseK8sJobs)

        // Prepare immediate response
        respObj := map[string]interface{}{
            "status":     "queued",
            "message":    "Training request accepted",
            "request_id": requestID,
            "async":      cfg.TrainAsync,
            "dry_run":    cfg.TrainDryRun,
        }
        // Include workflow URL if known
        respObj["workflow_url"] = fmt.Sprintf("https://github.com/%s/actions/workflows/%s", cfg.GitHubRepo, cfg.GitHubWorkflow)

        // Kick off training via K8s Job or GitHub workflow
        trigger := func() {
            if cfg.TrainDryRun {
                log.Printf("/train %s dry-run: would trigger training (k8s_jobs=%v)", requestID, cfg.TrainUseK8sJobs)
                return
            }
            if cfg.TrainUseK8sJobs {
                if err := triggerK8sJob(cfg, requestID, annCount); err != nil {
                    log.Printf("/train %s K8s Job creation failed: %v", requestID, err)
                    if cfg.FallbackToGH {
                        log.Printf("/train %s falling back to GitHub workflow", requestID)
                        triggerGitHub(cfg, requestID)
                    }
                }
                return
            }
            triggerGitHub(cfg, requestID)
        }

        if cfg.TrainAsync {
            go trigger()
        } else {
            trigger()
        }

        // Respond immediately
        w.Header().Set("Content-Type", "application/json")
        // Keep 200 for Label Studio compatibility
        json.NewEncoder(w).Encode(respObj)
    }
}

func triggerGitHub(cfg *Config, requestID string) {
    if cfg.GitHubToken == "" {
        log.Printf("/train %s skipped: GITHUB_TOKEN not configured", requestID)
        return
    }
    workflowURL := fmt.Sprintf("https://api.github.com/repos/%s/actions/workflows/%s/dispatches", cfg.GitHubRepo, cfg.GitHubWorkflow)
    payload := map[string]interface{}{
        "ref": "main",
    }
    payloadBytes, _ := json.Marshal(payload)
    ghReq, err := http.NewRequest("POST", workflowURL, bytes.NewReader(payloadBytes))
    if err != nil {
        log.Printf("/train %s error creating GH request: %v", requestID, err)
        return
    }
    ghReq.Header.Set("Accept", "application/vnd.github+json")
    ghReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", cfg.GitHubToken))
    ghReq.Header.Set("X-GitHub-Api-Version", "2022-11-28")
    ghReq.Header.Set("Content-Type", "application/json")

    client := &http.Client{Timeout: 10 * time.Second}
    ghResp, err := client.Do(ghReq)
    if err != nil {
        log.Printf("/train %s failed to trigger workflow: %v", requestID, err)
        return
    }
    defer ghResp.Body.Close()
    if ghResp.StatusCode != 204 {
        bodyBytes, _ := io.ReadAll(ghResp.Body)
        log.Printf("/train %s GitHub API error %d: %s", requestID, ghResp.StatusCode, string(bodyBytes))
        return
    }
    log.Printf("/train %s triggered workflow %s successfully", requestID, cfg.GitHubWorkflow)
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
    gpuQty := resource.MustParse(cfg.TrainGPUCount)
    limits := corev1.ResourceList{
        corev1.ResourceCPU:    cpuReq,
        corev1.ResourceMemory: memReq,
    }
    requests := corev1.ResourceList{
        corev1.ResourceCPU:    cpuReq,
        corev1.ResourceMemory: memReq,
    }
    if cfg.TrainGPURsrc != "" && cfg.TrainGPUCount != "0" {
        rn := corev1.ResourceName(cfg.TrainGPURsrc)
        limits[rn] = gpuQty
        requests[rn] = gpuQty
    }

    jobName := fmt.Sprintf("train-%d", time.Now().Unix())
    backoff := int32(0)
    ttl := cfg.TrainJobTTL
    env := []corev1.EnvVar{
        {Name: "HF_TOKEN", Value: cfg.HfToken},
        {Name: "HF_DATASET_REPO", Value: cfg.HfDatasetRepo},
        {Name: "HF_MODEL_REPO", Value: cfg.HfModelRepo},
        {Name: "ANNOTATION_COUNT", Value: fmt.Sprintf("%d", annCount)},
    }

    podSpec := corev1.PodSpec{
        RestartPolicy: corev1.RestartPolicyNever,
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
            TtlSecondsAfterFinished: &ttl,
            Template: corev1.PodTemplateSpec{
                Spec: podSpec,
            },
        },
    }

    ctx, cancel := time.WithTimeout(context.Background(), 10*time.Second)
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

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/setup", setupHandler(cfg))
	mux.HandleFunc("/predict", predictHandler(cfg))
	mux.HandleFunc("/predict_ls", predictLSHandler(cfg))
	mux.HandleFunc("/train", trainHandler(cfg))

    log.Printf("Starting ls-triton-adapter on %s", cfg.ListenAddr)
    log.Printf("Triton base URL: %s", cfg.TritonBaseURL)
    log.Printf("NER labels: %v", cfg.NERLabels)
    log.Printf("/train async=%v dry_run=%v k8sJobs=%v workflow=%s repo=%s", cfg.TrainAsync, cfg.TrainDryRun, cfg.TrainUseK8sJobs, cfg.GitHubWorkflow, cfg.GitHubRepo)

	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}
