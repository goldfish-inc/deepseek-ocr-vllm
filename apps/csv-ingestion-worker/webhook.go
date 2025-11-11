package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// IngestionEvent represents an upload webhook emitted by our intake services
type IngestionEvent struct {
	Action      string                 `json:"action"`
	Task        map[string]interface{} `json:"task"`
	Project     map[string]interface{} `json:"project"`
	Annotation  map[string]interface{} `json:"annotation"`
	WebhookData map[string]interface{} `json:"webhook"`
}

// TaskData represents the structured task data for CSV processing
type TaskData struct {
	TaskID     int64
	FileURL    string
	FileName   string
	SourceType string
	SourceName string
	OrgID      string
	DocType    string
	Metadata   map[string]interface{}
}

func (w *Worker) handleWebhook(rw http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Only accept POST requests
	if r.Method != http.MethodPost {
		http.Error(rw, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read body
	body, err := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024)) // 10MB limit
	if err != nil {
		log.Printf("Failed to read webhook body: %v", err)
		w.metrics.webhooksReceived.WithLabelValues("unknown", "error").Inc()
		http.Error(rw, "Failed to read request body", http.StatusBadRequest)
		return
	}

	// Verify webhook signature if secret is configured
	if w.config.WebhookSecret != "" {
		signature := r.Header.Get("X-Oceanid-Signature")
		if !w.verifyWebhookSignature(body, signature) {
			log.Printf("Invalid webhook signature")
			w.metrics.webhooksReceived.WithLabelValues("unknown", "invalid_signature").Inc()
			http.Error(rw, "Invalid signature", http.StatusUnauthorized)
			return
		}
	}

	// Parse webhook payload
	var payload IngestionEvent
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("Failed to parse webhook payload: %v", err)
		w.metrics.webhooksReceived.WithLabelValues("unknown", "invalid_json").Inc()
		http.Error(rw, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	// Log webhook receipt
	log.Printf("Received webhook: action=%s, task_id=%v", payload.Action, payload.Task["id"])
	w.metrics.webhooksReceived.WithLabelValues(payload.Action, "received").Inc()

	// Only process TASK_CREATED events for CSV/XLSX files
	if payload.Action != "TASK_CREATED" && payload.Action != "TASKS_BULK_CREATED" {
		// Acknowledge but don't process
		rw.WriteHeader(http.StatusOK)
		fmt.Fprint(rw, `{"status":"acknowledged","reason":"not a task creation event"}`)
		return
	}

	// Extract task data
	taskData, err := w.extractTaskData(payload)
	if err != nil {
		log.Printf("Failed to extract task data: %v", err)
		w.metrics.webhooksReceived.WithLabelValues(payload.Action, "invalid_task_data").Inc()
		http.Error(rw, fmt.Sprintf("Invalid task data: %v", err), http.StatusBadRequest)
		return
	}

	// Check if it's a CSV/XLSX file
	if !w.isCSVFile(taskData.FileName) {
		rw.WriteHeader(http.StatusOK)
		fmt.Fprint(rw, `{"status":"acknowledged","reason":"not a CSV/XLSX file"}`)
		return
	}

	// Store webhook event in database for audit trail
	if err := w.storeWebhookEvent(payload.Action, body, taskData.TaskID); err != nil {
		log.Printf("Failed to store webhook event: %v", err)
		// Continue processing even if audit log fails
	}

	// Process the CSV file asynchronously
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		if err := w.processCSVTask(ctx, taskData); err != nil {
			log.Printf("Failed to process CSV task %d: %v", taskData.TaskID, err)
			w.metrics.processedTotal.WithLabelValues("error", taskData.SourceType).Inc()

			// Store error in database
			w.updateTaskStatus(taskData.TaskID, "failed", err.Error())
		} else {
			log.Printf("Successfully processed CSV task %d", taskData.TaskID)
			w.metrics.processedTotal.WithLabelValues("success", taskData.SourceType).Inc()
			w.metrics.processingDuration.WithLabelValues(taskData.SourceType).Observe(time.Since(start).Seconds())

			// Update task status
			w.updateTaskStatus(taskData.TaskID, "completed", "")
		}
	}()

	// Return immediate response
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(rw, `{"status":"accepted","task_id":%d,"message":"CSV processing started"}`, taskData.TaskID)
}

func (w *Worker) verifyWebhookSignature(body []byte, signature string) bool {
	if signature == "" {
		return false
	}

	// Oceanid ingestion events use HMAC-SHA256
	mac := hmac.New(sha256.New, []byte(w.config.WebhookSecret))
	mac.Write(body)
	expectedMAC := hex.EncodeToString(mac.Sum(nil))

	// Constant time comparison to prevent timing attacks
	return hmac.Equal([]byte(signature), []byte(expectedMAC))
}

func (w *Worker) extractTaskData(payload IngestionEvent) (*TaskData, error) {
	task := payload.Task
	if task == nil {
		return nil, fmt.Errorf("no task data in payload")
	}

	// Extract task ID
	taskID, ok := task["id"].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid or missing task ID")
	}

	// Extract data section
	data, ok := task["data"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("no data section in task")
	}

	// Extract file URL (could be in various fields)
	fileURL := ""
	fileName := ""

	// Check common field names for CSV file URL. Legacy pipelines may still emit
	// "file_upload" or "document_url" fields; keep them for backward compatibility.
	for _, field := range []string{"csv", "file", "csv_url", "file_url", "file_upload", "document_url"} {
		if url, ok := data[field].(string); ok && url != "" {
			fileURL = url
			// Extract filename from URL (works for both HTTP and S3 URLs)
			parts := strings.Split(url, "/")
			if len(parts) > 0 {
				fileName = parts[len(parts)-1]
			}
			break
		}
	}

	if fileURL == "" {
		return nil, fmt.Errorf("no file URL found in task data")
	}

	// Extract metadata
	meta, _ := data["meta"].(map[string]interface{})
	if meta == nil {
		meta = make(map[string]interface{})
	}

	// Extract source information
	sourceType, _ := meta["source_type"].(string)
	if sourceType == "" {
		sourceType = "UNKNOWN"
	}

	sourceName, _ := meta["source_name"].(string)
	if sourceName == "" {
		sourceName = "UNKNOWN"
	}

	orgID, _ := meta["org_id"].(string)
	docType, _ := meta["doc_type"].(string)

	return &TaskData{
		TaskID:     int64(taskID),
		FileURL:    fileURL,
		FileName:   fileName,
		SourceType: sourceType,
		SourceName: sourceName,
		OrgID:      orgID,
		DocType:    docType,
		Metadata:   meta,
	}, nil
}

func (w *Worker) isCSVFile(filename string) bool {
	lower := strings.ToLower(filename)
	return strings.HasSuffix(lower, ".csv") ||
		strings.HasSuffix(lower, ".xlsx") ||
		strings.HasSuffix(lower, ".xls") ||
		strings.HasSuffix(lower, ".tsv")
}

func (w *Worker) storeWebhookEvent(action string, payload []byte, taskID int64) error {
	_, err := w.db.Exec(`
		INSERT INTO stage.event_log (
			event_type, event_action, task_id, payload, created_at
		) VALUES ($1, $2, $3, $4, NOW())
	`, "webhook", action, taskID, payload)

	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("store_webhook").Inc()
	}
	return err
}

func (w *Worker) updateTaskStatus(taskID int64, status string, errorMsg string) {
	_, err := w.db.Exec(`
		UPDATE stage.document_processing_log
		SET processing_status = $1,
			error_message = $2,
			updated_at = NOW()
		WHERE task_id = $3
	`, status, errorMsg, taskID)

	if err != nil {
		log.Printf("Failed to update task status: %v", err)
		w.metrics.databaseErrors.WithLabelValues("update_status").Inc()
	}
}

// notifyReviewManager sends a notification to the review queue manager
func (w *Worker) notifyReviewManager(documentID int64, cellCount int) error {
	payload := map[string]interface{}{
		"document_id":          documentID,
		"cells_needing_review": cellCount,
		"timestamp":            time.Now().Format(time.RFC3339),
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal notification: %w", err)
	}

	req, err := http.NewRequest("POST", w.config.ReviewManagerURL+"/notify", bytes.NewReader(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send notification: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("review manager returned status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
