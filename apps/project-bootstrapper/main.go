package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
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
	PollInterval     time.Duration
}

// Project represents a Label Studio project
type Project struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
}

// Webhook represents a Label Studio webhook
type Webhook struct {
	ID          int      `json:"id"`
	URL         string   `json:"url"`
	Events      []string `json:"events"`
	SendPayload bool     `json:"send_payload"`
}

type ProjectSyncStats struct {
	Total             int
	Configured        int
	AlreadyConfigured int
	Failed            int
}

var (
	// Increased timeouts for reliable cluster networking
	httpDialer = &net.Dialer{
		Timeout:   30 * time.Second, // Increased from 5s for cluster DNS resolution
		KeepAlive: 30 * time.Second,
	}

	httpTransport = &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           httpDialer.DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          100,              // Increased for better connection pooling
		MaxConnsPerHost:       20,               // Increased from 10
		MaxIdleConnsPerHost:   20,               // Increased from 10
		IdleConnTimeout:       90 * time.Second, // Increased from 30s
		TLSHandshakeTimeout:   10 * time.Second, // Increased from 5s
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second, // Increased from 5s
		DisableKeepAlives:     false,            // CRITICAL: Enable connection reuse
	}

	httpClient = &http.Client{
		Timeout:   60 * time.Second, // Increased from 15s for reliable operation
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

	pollInterval := 30 * time.Second
	if interval := os.Getenv("POLL_INTERVAL"); interval != "" {
		if d, err := time.ParseDuration(interval); err == nil {
			pollInterval = d
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
		PollInterval:     pollInterval,
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
				slog.Warn("http request attempt failed",
					"method", method,
					"url", url,
					"attempt", attempt,
					"max_attempts", maxAttempts,
					"error", err,
					"retry_in", delay,
				)
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
			slog.Warn("http request retry scheduled",
				"method", method,
				"url", url,
				"attempt", attempt,
				"max_attempts", maxAttempts,
				"error", lastErr,
				"retry_in", delay,
			)
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

// fetchProjects retrieves all projects from Label Studio
func fetchProjects(cfg *Config, token string) ([]Project, error) {
	headers := map[string]string{
		"Authorization": "Bearer " + token,
	}

	url := strings.TrimSuffix(cfg.LabelStudioURL, "/") + "/api/projects"
	status, respBody, err := doRequest("GET", url, headers, nil)
	if err != nil || status != 200 {
		return nil, fmt.Errorf("fetch projects failed: %d %v", status, err)
	}

	var response struct {
		Results []Project `json:"results"`
	}
	if err := json.Unmarshal(respBody, &response); err != nil {
		return nil, fmt.Errorf("parse projects failed: %v", err)
	}

	return response.Results, nil
}

// fetchProjectWebhooks retrieves webhooks for a specific project
func fetchProjectWebhooks(cfg *Config, token string, projectID int) ([]Webhook, error) {
	headers := map[string]string{
		"Authorization": "Bearer " + token,
	}

	// Label Studio uses /api/webhooks/?project={id} not /api/projects/{id}/webhooks
	url := fmt.Sprintf("%s/api/webhooks/?project=%d", strings.TrimSuffix(cfg.LabelStudioURL, "/"), projectID)
	status, respBody, err := doRequest("GET", url, headers, nil)
	if err != nil || status != 200 {
		slog.Error("webhook fetch failed",
			"project_id", projectID,
			"method", "GET",
			"url", url,
			"status", status,
			"response_body", string(respBody),
			"error", err,
		)
		return nil, fmt.Errorf("fetch webhooks failed: %d %v", status, err)
	}

	var webhooks []Webhook
	if err := json.Unmarshal(respBody, &webhooks); err != nil {
		return nil, fmt.Errorf("parse webhooks failed: %v", err)
	}

	return webhooks, nil
}

// hasWebhookURL checks if a webhook with the given URL exists
func hasWebhookURL(webhooks []Webhook, targetURL string) bool {
	for _, wh := range webhooks {
		if wh.URL == targetURL {
			return true
		}
	}
	return false
}

// configureProjectWebhooks registers TASK and ANNOTATION webhooks for a project
func configureProjectWebhooks(cfg *Config, token string, projectID int) (bool, error) {
	// Fetch existing webhooks
	webhooks, err := fetchProjectWebhooks(cfg, token, projectID)
	if err != nil {
		return false, fmt.Errorf("failed to fetch webhooks: %v", err)
	}

	headers := map[string]string{
		"Authorization": "Bearer " + token,
		"Content-Type":  "application/json",
	}

	// Label Studio creates webhooks at /api/webhooks/ with project in body
	webhookURL := fmt.Sprintf("%s/api/webhooks/", strings.TrimSuffix(cfg.LabelStudioURL, "/"))

	registered := false

	// Register TASK webhook if missing
	if cfg.SinkIngestURL != "" && !hasWebhookURL(webhooks, cfg.SinkIngestURL) {
		payload := map[string]interface{}{
			"project":      projectID,
			"url":          cfg.SinkIngestURL,
			"send_payload": true,
			"events":       []string{"TASK_CREATED", "TASKS_BULK_CREATED"},
		}
		body, _ := json.Marshal(payload)
		status, respBody, err := doRequest("POST", webhookURL, headers, body)
		if err == nil && (status == 200 || status == 201) {
			registered = true
			slog.Info("task webhook registered",
				"project_id", projectID,
				"target_url", cfg.SinkIngestURL,
				"status", status,
			)
		} else {
			slog.Error("TASK webhook registration failed",
				"project_id", projectID,
				"method", "POST",
				"url", webhookURL,
				"status", status,
				"response_body", string(respBody),
				"error", err,
			)
			return false, fmt.Errorf("TASK webhook registration failed: %d", status)
		}
	}

	// Register ANNOTATION webhook if missing
	if cfg.SinkWebhookURL != "" && !hasWebhookURL(webhooks, cfg.SinkWebhookURL) {
		payload := map[string]interface{}{
			"project":      projectID,
			"url":          cfg.SinkWebhookURL,
			"send_payload": true,
			"events":       []string{"ANNOTATION_CREATED", "ANNOTATION_UPDATED", "ANNOTATION_DELETED"},
		}
		body, _ := json.Marshal(payload)
		status, respBody, err := doRequest("POST", webhookURL, headers, body)
		if err == nil && (status == 200 || status == 201) {
			registered = true
			slog.Info("annotation webhook registered",
				"project_id", projectID,
				"target_url", cfg.SinkWebhookURL,
				"status", status,
			)
		} else {
			slog.Error("ANNOTATION webhook registration failed",
				"project_id", projectID,
				"method", "POST",
				"url", webhookURL,
				"status", status,
				"response_body", string(respBody),
				"error", err,
			)
			return false, fmt.Errorf("ANNOTATION webhook registration failed: %d", status)
		}
	}

	return registered, nil
}

// configureAllProjects configures webhooks for all existing projects and returns sync statistics.
func configureAllProjects(cfg *Config, token string) (ProjectSyncStats, error) {
	var stats ProjectSyncStats
	var errs []error

	projects, err := fetchProjects(cfg, token)
	if err != nil {
		return stats, fmt.Errorf("failed to fetch projects: %v", err)
	}
	stats.Total = len(projects)

	slog.Debug("project scan started", "projects_total", stats.Total)

	for _, project := range projects {
		changed, cfgErr := configureProjectWebhooks(cfg, token, project.ID)
		if cfgErr != nil {
			stats.Failed++
			errs = append(errs, fmt.Errorf("project %d: %w", project.ID, cfgErr))
			slog.Warn("project configuration failed",
				"project_id", project.ID,
				"project_title", project.Title,
				"error", cfgErr,
			)
			continue
		}
		if changed {
			stats.Configured++
			slog.Info("project webhooks configured",
				"project_id", project.ID,
				"project_title", project.Title,
			)
		} else {
			stats.AlreadyConfigured++
		}
	}

	if stats.Configured == 0 && stats.Failed == 0 {
		slog.Debug("project scan summary",
			"projects_total", stats.Total,
			"projects_configured", stats.Configured,
			"projects_already_configured", stats.AlreadyConfigured,
			"projects_failed", stats.Failed,
		)
	} else {
		slog.Info("project scan summary",
			"projects_total", stats.Total,
			"projects_configured", stats.Configured,
			"projects_already_configured", stats.AlreadyConfigured,
			"projects_failed", stats.Failed,
		)
	}

	return stats, errors.Join(errs...)
}

// WebhookEvent represents a Label Studio webhook event (kept for backward compatibility)
type WebhookEvent struct {
	Action  string                 `json:"action"`
	Project map[string]interface{} `json:"project"`
}

// webhookHandler handles POST /webhook (deprecated - no longer used)
func webhookHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "deprecated",
			"message": "PROJECT_CREATED webhooks require Enterprise license. Webhooks now configured via polling.",
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

		// Configure webhooks for the new project
		if _, err := configureProjectWebhooks(cfg, token, projectID); err != nil {
			slog.Warn("post-create webhook configuration failed",
				"project_id", projectID,
				"error", err,
			)
		}

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

	// Configure structured logging based on LOG_LEVEL (default: info)
	logLevel := slog.LevelInfo
	if os.Getenv("LOG_LEVEL") == "debug" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	}))
	slog.SetDefault(logger)

	// Validate required configuration
	if cfg.LabelStudioURL == "" {
		slog.Error("missing required environment variable", "var", "LS_URL")
		os.Exit(1)
	}
	if cfg.LabelStudioPAT == "" {
		slog.Error("missing required environment variable", "var", "LS_PAT")
		os.Exit(1)
	}
	slog.Info("configuration validated", "label_studio_url", cfg.LabelStudioURL)

	// Configure webhooks on startup with retry logic
	go func() {
		time.Sleep(5 * time.Second) // Wait for server to start

		retryDelay := 5 * time.Second
		maxBackoff := 60 * time.Second
		attempt := 0

		for {
			attempt++
			token, err := getAccessToken(cfg)
			if err != nil {
				slog.Warn("startup configuration attempt failed to get access token",
					"attempt", attempt,
					"error", err,
				)
				backoff := time.Duration(attempt) * retryDelay
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
				time.Sleep(backoff)
				continue
			}

			if stats, err := configureAllProjects(cfg, token); err != nil {
				slog.Warn("startup configuration attempt failed",
					"attempt", attempt,
					"error", err,
					"stats", stats,
				)
				backoff := time.Duration(attempt) * retryDelay
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
				time.Sleep(backoff)
				continue
			}

			slog.Info("startup configuration complete", "attempt", attempt)
			break // Exit retry loop, continue to polling
		}

		// Start polling loop for new projects
		slog.Info("polling loop started", "interval", cfg.PollInterval)
		ticker := time.NewTicker(cfg.PollInterval)
		defer ticker.Stop()

		for range ticker.C {
			token, err := getAccessToken(cfg)
			if err != nil {
				slog.Warn("poll: failed to get access token", "error", err)
				continue
			}

			if stats, err := configureAllProjects(cfg, token); err != nil {
				slog.Warn("poll: project configuration completed with errors",
					"error", err,
					"stats", stats,
				)
				continue
			}

			slog.Debug("poll cycle complete")
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

	slog.Info("project-bootstrapper starting", "listen_addr", cfg.ListenAddr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("server exited", "error", err)
		os.Exit(1)
	}
}
