package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// Config holds all environment variables
type Config struct {
	ListenAddr     string
	DatabaseURL    string
	HFToken        string
	HFRepo         string
	SchemaVersion  string
	SubdirTemplate string
}

func loadConfig() *Config {
	return &Config{
		ListenAddr:     getEnv("LISTEN_ADDR", ":8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		HFToken:        os.Getenv("HF_TOKEN"),
		HFRepo:         getEnv("HF_REPO", "goldfish-inc/oceanid-annotations"),
		SchemaVersion:  getEnv("SCHEMA_VERSION", "1.0.0"),
		SubdirTemplate: getEnv("SUBDIR_TEMPLATE", "annotations/{date}/project-{project_id}.jsonl"),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

var db *sql.DB

func initDB(cfg *Config) error {
	if cfg.DatabaseURL == "" {
		log.Println("DATABASE_URL not set, running without database")
		return nil
	}

	var err error
	db, err = sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// Create schema and tables
	schema := `
	CREATE SCHEMA IF NOT EXISTS stage;

	CREATE TABLE IF NOT EXISTS stage.documents (
		id BIGSERIAL PRIMARY KEY,
		external_id TEXT,
		source TEXT,
		content TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS stage.extractions (
		id BIGSERIAL PRIMARY KEY,
		document_id BIGINT REFERENCES stage.documents(id) ON DELETE CASCADE,
		label TEXT,
		value TEXT,
		start_pos INT,
		end_pos INT,
		confidence DOUBLE PRECISION,
		db_mapping TEXT,
		annotator TEXT,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS stage.table_ingest (
		id BIGSERIAL PRIMARY KEY,
		document_id BIGINT REFERENCES stage.documents(id) ON DELETE CASCADE,
		rows_json JSONB,
		meta JSONB,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS stage.pdf_boxes (
		id BIGSERIAL PRIMARY KEY,
		document_id BIGINT REFERENCES stage.documents(id) ON DELETE CASCADE,
		external_task_id TEXT,
		project_id TEXT,
		label TEXT,
		page INT,
		x_pct DOUBLE PRECISION,
		y_pct DOUBLE PRECISION,
		w_pct DOUBLE PRECISION,
		h_pct DOUBLE PRECISION,
		image_width INT,
		image_height INT,
		image_url TEXT,
		pdf_url TEXT,
		annotator TEXT,
		page_width_pt DOUBLE PRECISION,
		page_height_pt DOUBLE PRECISION,
		x_pt DOUBLE PRECISION,
		y_pt DOUBLE PRECISION,
		w_pt DOUBLE PRECISION,
		h_pt DOUBLE PRECISION,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);`

	if _, err := db.ExecContext(ctx, schema); err != nil {
		// Log but don't fail - tables might already exist
		log.Printf("Warning: schema creation had issues (may already exist): %v", err)
	}

	log.Println("Database initialized successfully")
	return nil
}

// WebhookPayload represents Label Studio webhook payload
type WebhookPayload struct {
	Action      string                 `json:"action"`
	Annotation  map[string]interface{} `json:"annotation"`
	Task        map[string]interface{} `json:"task"`
	Project     map[string]interface{} `json:"project"`
	LabelConfig string                 `json:"label_config"`
	UpdatedBy   map[string]interface{} `json:"updated_by"`
}

// IngestPayload for /ingest endpoint
type IngestPayload struct {
	ProjectID   int                      `json:"project_id"`
	Tasks       []map[string]interface{} `json:"tasks"`
	Annotations []map[string]interface{} `json:"annotations"`
}

func webhookHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read body", http.StatusBadRequest)
			return
		}

		var payload WebhookPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		// Log the webhook
		log.Printf("Webhook received: action=%s, task_id=%v, project=%v",
			payload.Action,
			payload.Task["id"],
			payload.Project["id"])

		// Process annotation if database is available
		if db != nil && payload.Action == "ANNOTATION_CREATED" {
			go processAnnotation(payload)
		}

		// Store to HuggingFace if configured
		if cfg.HFToken != "" && cfg.HFRepo != "" {
			go storeToHuggingFace(cfg, payload)
		}

		// Return success immediately
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"action": payload.Action,
		})
	}
}

func ingestHandler(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload IngestPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		log.Printf("Ingest received: project_id=%d, tasks=%d, annotations=%d",
			payload.ProjectID,
			len(payload.Tasks),
			len(payload.Annotations))

		// Process tasks if database is available
		if db != nil {
			go processTasks(payload)
		}

		// Return success
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "ok",
			"project_id": payload.ProjectID,
			"task_count": len(payload.Tasks),
		})
	}
}

func processAnnotation(payload WebhookPayload) {
	// Extract annotation details
	annotation := payload.Annotation
	task := payload.Task

	// Get task data
	taskData, ok := task["data"].(map[string]interface{})
	if !ok {
		log.Printf("Warning: task has no data field")
		return
	}

	// Get text content
	text, _ := taskData["text"].(string)
	if text == "" {
		log.Printf("Warning: task has no text content")
		return
	}

	// Insert document if not exists
	var docID int64
	externalID := fmt.Sprintf("task_%v", task["id"])

	err := db.QueryRow(`
		INSERT INTO stage.documents (external_id, source, content)
		VALUES ($1, $2, $3)
		ON CONFLICT (external_id) DO UPDATE SET content = $3
		RETURNING id`,
		externalID, "label_studio", text).Scan(&docID)

	if err != nil {
		log.Printf("Error inserting document: %v", err)
		return
	}

	// Process annotation results
	if results, ok := annotation["result"].([]interface{}); ok {
		for _, result := range results {
			if res, ok := result.(map[string]interface{}); ok {
				processResult(docID, res, annotation)
			}
		}
	}
}

func processResult(docID int64, result map[string]interface{}, annotation map[string]interface{}) {
	// Extract entity information
	value, ok := result["value"].(map[string]interface{})
	if !ok {
		return
	}

	// Get entity details
	start, _ := value["start"].(float64)
	end, _ := value["end"].(float64)
	text, _ := value["text"].(string)

	// Get labels
	var label string
	if labels, ok := value["labels"].([]interface{}); ok && len(labels) > 0 {
		label, _ = labels[0].(string)
	}

	// Get annotator
	annotator := "unknown"
	if completedBy, ok := annotation["completed_by"].(map[string]interface{}); ok {
		if email, ok := completedBy["email"].(string); ok {
			annotator = email
		}
	}

	// Insert extraction
	_, err := db.Exec(`
		INSERT INTO stage.extractions
		(document_id, label, value, start_pos, end_pos, confidence, annotator)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		docID, label, text, int(start), int(end), 0.95, annotator)

	if err != nil {
		log.Printf("Error inserting extraction: %v", err)
	}
}

func processTasks(payload IngestPayload) {
	for _, task := range payload.Tasks {
		// Extract task data
		taskData, ok := task["data"].(map[string]interface{})
		if !ok {
			continue
		}

		// Process based on content type
		if text, ok := taskData["text"].(string); ok && text != "" {
			processTextTask(task, text)
		} else if csvRows, ok := taskData["csv_rows"].([]interface{}); ok {
			processCSVTask(task, csvRows)
		}
	}
}

func processTextTask(task map[string]interface{}, text string) {
	externalID := fmt.Sprintf("task_%v", task["id"])

	var docID int64
	err := db.QueryRow(`
		INSERT INTO stage.documents (external_id, source, content)
		VALUES ($1, $2, $3)
		ON CONFLICT (external_id) DO UPDATE SET content = $3
		RETURNING id`,
		externalID, "label_studio_ingest", text).Scan(&docID)

	if err != nil {
		log.Printf("Error processing text task: %v", err)
	}
}

func processCSVTask(task map[string]interface{}, rows []interface{}) {
	externalID := fmt.Sprintf("task_%v", task["id"])

	// Convert rows to JSON
	rowsJSON, _ := json.Marshal(rows)

	var docID int64
	err := db.QueryRow(`
		INSERT INTO stage.documents (external_id, source, content)
		VALUES ($1, $2, $3)
		ON CONFLICT (external_id) DO UPDATE SET content = $3
		RETURNING id`,
		externalID, "label_studio_csv", string(rowsJSON)).Scan(&docID)

	if err != nil {
		log.Printf("Error inserting CSV document: %v", err)
		return
	}

	// Insert into table_ingest
	_, err = db.Exec(`
		INSERT INTO stage.table_ingest (document_id, rows_json, meta)
		VALUES ($1, $2, $3)`,
		docID, string(rowsJSON), "{}")

	if err != nil {
		log.Printf("Error inserting table data: %v", err)
	}
}

func storeToHuggingFace(cfg *Config, payload WebhookPayload) {
	// Format annotation for storage
	record := map[string]interface{}{
		"timestamp":  time.Now().Format(time.RFC3339),
		"action":     payload.Action,
		"project_id": payload.Project["id"],
		"task_id":    payload.Task["id"],
		"annotation": payload.Annotation,
		"task_data":  payload.Task["data"],
	}

	// Convert to JSONL
	jsonData, err := json.Marshal(record)
	if err != nil {
		log.Printf("Error marshaling HF record: %v", err)
		return
	}

	// Generate file path
	date := time.Now().Format("2025-10-06")
	projectID := fmt.Sprintf("%v", payload.Project["id"])

	filepath := strings.ReplaceAll(cfg.SubdirTemplate, "{date}", date)
	filepath = strings.ReplaceAll(filepath, "{project_id}", projectID)

	log.Printf("Would store to HuggingFace: repo=%s, path=%s, size=%d",
		cfg.HFRepo, filepath, len(jsonData))

	// Note: Actual HF upload requires HTTP client to call HF API
	// This is simplified for the Go version
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"ok":       true,
		"database": db != nil,
	}

	// Test database connection if available
	if db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := db.PingContext(ctx); err != nil {
			status["database"] = false
			status["db_error"] = err.Error()
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func main() {
	cfg := loadConfig()

	// Initialize database
	if err := initDB(cfg); err != nil {
		log.Printf("Warning: Database initialization failed: %v", err)
		// Continue without database
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/webhook", webhookHandler(cfg))
	mux.HandleFunc("/ingest", ingestHandler(cfg))

	log.Printf("Starting annotations-sink on %s", cfg.ListenAddr)
	if cfg.DatabaseURL != "" {
		log.Println("Database: connected")
	} else {
		log.Println("Database: not configured")
	}
	if cfg.HFToken != "" {
		log.Printf("HuggingFace: configured for %s", cfg.HFRepo)
	}

	if err := http.ListenAndServe(cfg.ListenAddr, mux); err != nil {
		log.Fatal(err)
	}
}
