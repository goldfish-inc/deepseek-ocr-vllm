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
)

// Config holds all environment variables
type Config struct {
	ListenAddr        string
	LabelStudioURL    string
	LabelStudioPAT    string
	NERBackendURL     string
	TabertBackendURL  string
	SinkIngestURL     string
	SinkWebhookURL    string
	NERLabelsJSON     string
	AllowedOrigins    []string
}

func loadConfig() *Config {
	allowedOrigins := []string{"*"}
	if orig := os.Getenv("ALLOWED_ORIGINS"); orig != "" {
		var origins []string
		if err := json.Unmarshal([]byte(orig), &origins); err == nil {
			allowedOrigins = origins
		}
	}

	return &Config{
		ListenAddr:        getEnv("LISTEN_ADDR", ":8080"),
		LabelStudioURL:    os.Getenv("LS_URL"),
		LabelStudioPAT:    os.Getenv("LS_PAT"),
		NERBackendURL:     os.Getenv("NER_BACKEND_URL"),
		TabertBackendURL:  os.Getenv("TABERT_BACKEND_URL"),
		SinkIngestURL:     os.Getenv("SINK_INGEST_URL"),
		SinkWebhookURL:    os.Getenv("SINK_WEBHOOK_URL"),
		NERLabelsJSON:     os.Getenv("NER_LABELS_JSON"),
		AllowedOrigins:    allowedOrigins,
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// getNERLabels parses NER_LABELS_JSON or returns defaults
func getNERLabels(cfg *Config) []string {
	if cfg.NERLabelsJSON != "" {
		var labels []string
		if err := json.Unmarshal([]byte(cfg.NERLabelsJSON), &labels); err == nil {
			return labels
		}
	}
	return []string{"VESSEL_NAME", "IMO", "MMSI", "IRCS", "PORT", "DATE", "COMPANY", "FLAG"}
}

// buildLabelConfig generates Label Studio XML config
func buildLabelConfig(labels []string) string {
	var inner strings.Builder
	for _, label := range labels {
		fmt.Fprintf(&inner, "    <Label value=\"%s\"/>\n", label)
	}

	return fmt.Sprintf(`<View>
  <Header value="Vessel Record - NER Annotation"/>
  <Text name="text" value="$text" granularity="word"/>
  <Labels name="label" toName="text" showInline="true">
%s  </Labels>
</View>`, inner.String())
}

// httpClient makes HTTP requests with timeout
func httpClient(method, url string, headers map[string]string, body []byte) (int, []byte, error) {
	client := &http.Client{Timeout: 20 * time.Second}

	var reqBody io.Reader
	if body != nil {
		reqBody = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, url, reqBody)
	if err != nil {
		return 0, nil, err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}

	return resp.StatusCode, respBody, nil
}

// getAccessToken exchanges PAT for access token
func getAccessToken(cfg *Config) (string, error) {
	payload := map[string]string{"refresh": cfg.LabelStudioPAT}
	body, _ := json.Marshal(payload)

	headers := map[string]string{"Content-Type": "application/json"}
	url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/token/refresh"

	status, respBody, err := httpClient("POST", url, headers, body)
	if err != nil {
		return "", err
	}
	if status != 200 {
		return "", fmt.Errorf("token refresh failed: %d %s", status, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", err
	}

	if token, ok := result["access"].(string); ok {
		return token, nil
	}
	return "", fmt.Errorf("no access token in response")
}

// ensureWebhooks creates webhooks if they don't exist
func ensureWebhooks(cfg *Config, token string) error {
	if cfg.SinkIngestURL == "" && cfg.SinkWebhookURL == "" {
		return nil
	}

	headers := map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/json",
	}

	url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/webhooks"
	status, respBody, err := httpClient("GET", url, headers, nil)
	if err != nil || status != 200 {
		return err
	}

	var existing []map[string]interface{}
	json.Unmarshal(respBody, &existing)

	hasURL := func(targetURL string) bool {
		for _, wh := range existing {
			if u, ok := wh["url"].(string); ok && u == targetURL {
				return true
			}
		}
		return false
	}

	if cfg.SinkIngestURL != "" && !hasURL(cfg.SinkIngestURL) {
		payload := map[string]interface{}{
			"url":          cfg.SinkIngestURL,
			"send_payload": true,
			"events":       []string{"TASK_CREATED", "TASKS_BULK_CREATED"},
		}
		body, _ := json.Marshal(payload)
		httpClient("POST", url, headers, body)
	}

	if cfg.SinkWebhookURL != "" && !hasURL(cfg.SinkWebhookURL) {
		payload := map[string]interface{}{
			"url":          cfg.SinkWebhookURL,
			"send_payload": true,
			"events":       []string{"ANNOTATION_CREATED", "ANNOTATION_UPDATED", "ANNOTATION_DELETED"},
		}
		body, _ := json.Marshal(payload)
		httpClient("POST", url, headers, body)
	}

	return nil
}

// CreateProjectRequest is the POST /create request body
type CreateProjectRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Tabert      bool   `json:"tabert"`
}

// createProjectHandler handles POST /create
func createProjectHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req CreateProjectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			// Try query params as fallback
			req.Title = r.URL.Query().Get("title")
			req.Description = r.URL.Query().Get("description")
			req.Tabert = r.URL.Query().Get("tabert") == "true"
		}

		if req.Title == "" {
			http.Error(w, "title is required", http.StatusBadRequest)
			return
		}

		// Get access token
		token, err := getAccessToken(cfg)
		if err != nil {
			http.Error(w, fmt.Sprintf("Auth failed: %v", err), http.StatusBadGateway)
			return
		}

		headers := map[string]string{
			"Authorization": "Bearer " + token,
			"Content-Type":  "application/json",
		}

		// Create project
		desc := req.Description
		if desc == "" && req.Tabert {
			desc = "TABERT experimental"
		}
		projectPayload := map[string]string{"title": req.Title, "description": desc}
		body, _ := json.Marshal(projectPayload)

		url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/projects/"
		status, respBody, err := httpClient("POST", url, headers, body)
		if err != nil || (status != 200 && status != 201) {
			http.Error(w, fmt.Sprintf("Create project failed: %d %s", status, string(respBody)), http.StatusBadGateway)
			return
		}

		var projectResp map[string]interface{}
		json.Unmarshal(respBody, &projectResp)
		projectID := int(projectResp["id"].(float64))

		// Apply label config
		labels := getNERLabels(cfg)
		labelConfig := buildLabelConfig(labels)
		configPayload := map[string]interface{}{
			"label_config":            labelConfig,
			"show_collab_predictions": true,
			"model_version":           "latest",
		}
		body, _ = json.Marshal(configPayload)

		url = fmt.Sprintf("%s/api/projects/%d", strings.TrimSuffix(cfg.LabelStudioURL, "/"), projectID)
		status, respBody, err = httpClient("PATCH", url, headers, body)
		if err != nil || (status != 200 && status != 201) {
			http.Error(w, fmt.Sprintf("Apply config failed: %d %s", status, string(respBody)), http.StatusBadGateway)
			return
		}

		// Connect NER backend
		if cfg.NERBackendURL != "" {
			mlPayload := map[string]interface{}{
				"url":            cfg.NERBackendURL,
				"project":        projectID,
				"title":          "Triton NER",
				"description":    "DistilBERT NER via adapter",
				"is_interactive": true,
			}
			body, _ = json.Marshal(mlPayload)

			url = strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/ml"
			httpClient("POST", url, headers, body)
		}

		// Connect TaBERT backend (optional)
		if req.Tabert && cfg.TabertBackendURL != "" {
			mlPayload := map[string]interface{}{
				"url":            cfg.TabertBackendURL,
				"project":        projectID,
				"title":          "TaBERT (experimental)",
				"description":    "Experimental table normalization",
				"is_interactive": true,
			}
			body, _ = json.Marshal(mlPayload)

			url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/ml"
			httpClient("POST", url, headers, body)
		}

		// Ensure webhooks
		ensureWebhooks(cfg, token)

		// Return response
		response := map[string]interface{}{
			"project_id":  projectID,
			"project_url": fmt.Sprintf("%s/projects/%d", strings.TrimSuffix(cfg.LabelStudioURL, "/"), projectID),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
}

// healthHandler handles GET /health
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// corsMiddleware adds CORS headers
func corsMiddleware(next http.Handler, allowedOrigins []string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || contains(allowedOrigins, "*") || contains(allowedOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			if origin == "" {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func main() {
	cfg := loadConfig()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/create", createProjectHandler(cfg))

	handler := corsMiddleware(mux, cfg.AllowedOrigins)

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
	}

	log.Printf("Starting project-bootstrapper on %s", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
