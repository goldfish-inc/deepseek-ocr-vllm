package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

// Config holds all environment variables
type Config struct {
	ListenAddr       string
	LabelStudioURL   string
	LabelStudioPAT   string
	NERBackendURL    string
	TabertBackendURL string
	SinkIngestURL    string
	SinkWebhookURL   string
	NERLabelsJSON    string
	AllowedOrigins   []string
}

var (
	httpDialer = &net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	httpTransport = &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           httpDialer.DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          10,
		MaxConnsPerHost:       10,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 5 * time.Second,
		DisableKeepAlives:     true,
	}

	httpClient = &http.Client{
		Timeout:   15 * time.Second,
		Transport: httpTransport,
	}
)

func loadConfig() *Config {
	allowedOrigins := []string{"*"}
	if orig := os.Getenv("ALLOWED_ORIGINS"); orig != "" {
		var origins []string
		if err := json.Unmarshal([]byte(orig), &origins); err == nil {
			allowedOrigins = origins
		}
	}

	return &Config{
		ListenAddr:       getEnv("LISTEN_ADDR", ":8080"),
		LabelStudioURL:   os.Getenv("LS_URL"),
		LabelStudioPAT:   os.Getenv("LS_PAT"),
		NERBackendURL:    os.Getenv("NER_BACKEND_URL"),
		TabertBackendURL: os.Getenv("TABERT_BACKEND_URL"),
		SinkIngestURL:    os.Getenv("SINK_INGEST_URL"),
		SinkWebhookURL:   os.Getenv("SINK_WEBHOOK_URL"),
		NERLabelsJSON:    os.Getenv("NER_LABELS_JSON"),
		AllowedOrigins:   allowedOrigins,
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

// doRequest performs HTTP calls with hardened networking configuration and retries
func doRequest(method, url string, headers map[string]string, body []byte) (int, []byte, error) {
	const maxAttempts = 3

	var lastStatus int
	var lastBody []byte
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
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

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = err
			if attempt < maxAttempts {
				delay := time.Duration(1<<uint(attempt-1)) * time.Second
				log.Printf("⚠️  HTTP %s %s failed (attempt %d/%d): %v – retrying in %s", method, url, attempt, maxAttempts, err, delay)
				time.Sleep(delay)
				continue
			}
			return 0, nil, err
		}

		respBody, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()

		lastStatus = resp.StatusCode
		lastBody = respBody

		if readErr != nil {
			lastErr = readErr
		} else if resp.StatusCode < http.StatusInternalServerError {
			return resp.StatusCode, respBody, nil
		} else {
			lastErr = fmt.Errorf("server returned status %d: %s", resp.StatusCode, string(respBody))
		}

		if attempt < maxAttempts {
			delay := time.Duration(1<<uint(attempt-1)) * time.Second
			log.Printf("⚠️  HTTP %s %s attempt %d/%d failed: %v – retrying in %s", method, url, attempt, maxAttempts, lastErr, delay)
			time.Sleep(delay)
		}
	}

	if lastErr != nil {
		return lastStatus, lastBody, lastErr
	}

	return lastStatus, lastBody, fmt.Errorf("request failed with status %d", lastStatus)
}

// getAccessToken exchanges PAT for access token
func getAccessToken(cfg *Config) (string, error) {
	payload := map[string]string{"refresh": cfg.LabelStudioPAT}
	body, _ := json.Marshal(payload)

	headers := map[string]string{"Content-Type": "application/json"}
	url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/token/refresh"

	status, respBody, err := doRequest("POST", url, headers, body)
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
	headers := map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/json",
	}

	url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/webhooks"
	status, respBody, err := doRequest("GET", url, headers, nil)
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

	// Register PROJECT_CREATED webhook for automatic S3 configuration
	// Use cluster-internal service URL for webhook callback
	bootstrapperURL := "http://project-bootstrapper.apps.svc.cluster.local:8080/webhook"
	if !hasURL(bootstrapperURL) {
		payload := map[string]interface{}{
			"url":          bootstrapperURL,
			"send_payload": true,
			"events":       []string{"PROJECT_CREATED"},
		}
		body, _ := json.Marshal(payload)
		status, respBody, err := doRequest("POST", url, headers, body)
		if err == nil && (status == 200 || status == 201) {
			log.Printf("✅ Registered PROJECT_CREATED webhook: %s", bootstrapperURL)
		} else {
			log.Printf("⚠️  Failed to register PROJECT_CREATED webhook: %d %s", status, string(respBody))
		}
	}

	if cfg.SinkIngestURL != "" && !hasURL(cfg.SinkIngestURL) {
		payload := map[string]interface{}{
			"url":          cfg.SinkIngestURL,
			"send_payload": true,
			"events":       []string{"TASK_CREATED", "TASKS_BULK_CREATED"},
		}
		body, _ := json.Marshal(payload)
		doRequest("POST", url, headers, body)
	}

	if cfg.SinkWebhookURL != "" && !hasURL(cfg.SinkWebhookURL) {
		payload := map[string]interface{}{
			"url":          cfg.SinkWebhookURL,
			"send_payload": true,
			"events":       []string{"ANNOTATION_CREATED", "ANNOTATION_UPDATED", "ANNOTATION_DELETED"},
		}
		body, _ := json.Marshal(payload)
		doRequest("POST", url, headers, body)
	}

	return nil
}

// slugify converts a string to a URL-safe slug
func slugify(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, " ", "-")
	// Remove non-alphanumeric characters except hyphens
	var result strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// configureS3Storage configures S3 storage for a project with per-project prefix
func configureS3Storage(cfg *Config, token string, projectID int, projectTitle string) error {
	slug := slugify(projectTitle)
	prefix := fmt.Sprintf("projects/%s/", slug)

	storagePayload := map[string]interface{}{
		"type":           "s3",
		"title":          "S3 Storage",
		"description":    fmt.Sprintf("Per-project S3 storage (prefix: %s)", prefix),
		"bucket":         os.Getenv("S3_BUCKET"),
		"prefix":         prefix,
		"region":         os.Getenv("AWS_REGION"),
		"s3_endpoint":    os.Getenv("S3_ENDPOINT"),
		"presign":        true,
		"presign_ttl":    3600,
		"recursive_scan": true,
		"use_blob_urls":  true,
	}

	// Add AWS credentials if available
	if accessKey := os.Getenv("AWS_ACCESS_KEY_ID"); accessKey != "" {
		storagePayload["aws_access_key_id"] = accessKey
	}
	if secretKey := os.Getenv("AWS_SECRET_ACCESS_KEY"); secretKey != "" {
		storagePayload["aws_secret_access_key"] = secretKey
	}

	body, _ := json.Marshal(storagePayload)
	headers := map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/json",
	}

	url := fmt.Sprintf("%s/api/storages/s3?project=%d", strings.TrimSuffix(cfg.LabelStudioURL, "/"), projectID)
	status, respBody, err := doRequest("POST", url, headers, body)
	if err != nil || (status != 200 && status != 201) {
		return fmt.Errorf("S3 storage config failed: %d %s", status, string(respBody))
	}

	log.Printf("✅ Configured S3 storage for project %d (%s) with prefix: %s", projectID, projectTitle, prefix)
	return nil
}

// WebhookEvent represents a Label Studio webhook event
type WebhookEvent struct {
	Action  string                 `json:"action"`
	Project map[string]interface{} `json:"project"`
}

// webhookHandler handles POST /webhook for Label Studio webhooks
func webhookHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var event WebhookEvent
		if err := json.NewDecoder(r.Body).Decode(&event); err != nil {
			http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
			return
		}

		// Only handle PROJECT_CREATED events
		if event.Action != "PROJECT_CREATED" {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "ignored", "action": event.Action})
			return
		}

		// Extract project ID and title
		projectID, ok := event.Project["id"].(float64)
		if !ok {
			http.Error(w, "Missing project ID", http.StatusBadRequest)
			return
		}

		projectTitle, ok := event.Project["title"].(string)
		if !ok {
			projectTitle = fmt.Sprintf("project-%d", int(projectID))
		}

		log.Printf("📦 Received PROJECT_CREATED webhook for project %d: %s", int(projectID), projectTitle)

		// Get access token
		token, err := getAccessToken(cfg)
		if err != nil {
			http.Error(w, fmt.Sprintf("Auth failed: %v", err), http.StatusBadGateway)
			return
		}

		// Configure S3 storage with per-project prefix
		if err := configureS3Storage(cfg, token, int(projectID), projectTitle); err != nil {
			log.Printf("⚠️  Failed to configure S3 storage: %v", err)
			http.Error(w, fmt.Sprintf("S3 config failed: %v", err), http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "success",
			"project_id": int(projectID),
			"title":      projectTitle,
		})
	}
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
		status, respBody, err := doRequest("POST", url, headers, body)
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
		status, respBody, err = doRequest("PATCH", url, headers, body)
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
			doRequest("POST", url, headers, body)
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
			doRequest("POST", url, headers, body)
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

	// Validate required configuration
	if cfg.LabelStudioURL == "" {
		log.Fatal("❌ FATAL: LS_URL environment variable is required")
	}
	if cfg.LabelStudioPAT == "" {
		log.Fatal("❌ FATAL: LS_PAT environment variable is required")
	}
	// S3 credentials are optional for initial startup (may not be configured until Label Studio is set up)
	log.Printf("✅ Configuration validated: LS_URL=%s", cfg.LabelStudioURL)

	// Register webhook on startup with retry logic
	go func() {
		time.Sleep(5 * time.Second) // Wait for server to start

		retryDelay := 5 * time.Second
		maxBackoff := 60 * time.Second
		attempt := 0

		for {
			attempt++
			token, err := getAccessToken(cfg)
			if err != nil {
				log.Printf("⚠️  Attempt %d: Failed to get access token: %v", attempt, err)
				// Exponential backoff with max of 60s
				backoff := time.Duration(attempt) * retryDelay
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
				time.Sleep(backoff)
				continue
			}

			if err := ensureWebhooks(cfg, token); err != nil {
				log.Printf("⚠️  Attempt %d: Failed to register webhooks: %v", attempt, err)
				// Exponential backoff with max of 60s
				backoff := time.Duration(attempt) * retryDelay
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
				time.Sleep(backoff)
				continue
			}

			log.Printf("✅ Successfully registered webhooks on attempt %d", attempt)
			return
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/create", createProjectHandler(cfg))
	mux.HandleFunc("/webhook", webhookHandler(cfg))

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
