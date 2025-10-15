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
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Config holds all environment variables
type Config struct {
	ListenAddr        string
	DatabaseURL       string
	HFToken           string
	HFRepo            string
	HFRepoNER         string
	HFRepoDocling     string
	HFBranch          string
	SchemaVersion     string
	EnableDBIndex     bool
	OutboxBatchSize   int
	OutboxInterval    time.Duration
	OutboxLockTimeout time.Duration
	OutboxMaxAttempts int
}

func loadConfig() *Config {
	batchSize := getIntEnv("OUTBOX_BATCH_SIZE", 100)
	interval := getDurationEnv("OUTBOX_INTERVAL", 15*time.Second)
	lockTimeout := getDurationEnv("OUTBOX_LOCK_TIMEOUT", 5*time.Minute)
	maxAttempts := getIntEnv("OUTBOX_MAX_ATTEMPTS", 12)
	enableIndex := getBoolEnv("ENABLE_DB_INDEX", true)

	return &Config{
		ListenAddr:        getEnv("LISTEN_ADDR", ":8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		HFToken:           os.Getenv("HF_TOKEN"),
		HFRepo:            getEnv("HF_REPO", "goldfish-inc/oceanid-annotations"),
		HFRepoNER:         getEnv("HF_REPO_NER", "goldfish-inc/oceanid-annotations-ner"),
		HFRepoDocling:     getEnv("HF_REPO_DOCLING", "goldfish-inc/oceanid-annotations-docling"),
		HFBranch:          getEnv("HF_BRANCH", "main"),
		SchemaVersion:     getEnv("SCHEMA_VERSION", "1.0.0"),
		EnableDBIndex:     enableIndex,
		OutboxBatchSize:   batchSize,
		OutboxInterval:    interval,
		OutboxLockTimeout: lockTimeout,
		OutboxMaxAttempts: maxAttempts,
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getIntEnv(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if v, err := strconv.Atoi(value); err == nil {
			return v
		}
		log.Printf("Invalid integer for %s: %s", key, value)
	}
	return fallback
}

func getDurationEnv(key string, fallback time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if dur, err := time.ParseDuration(value); err == nil {
			return dur
		}
		if secs, err := strconv.Atoi(value); err == nil {
			return time.Duration(secs) * time.Second
		}
		log.Printf("Invalid duration for %s: %s", key, value)
	}
	return fallback
}

func getBoolEnv(key string, fallback bool) bool {
	if value := os.Getenv(key); value != "" {
		if v, err := strconv.ParseBool(value); err == nil {
			return v
		}
		log.Printf("Invalid boolean for %s: %s", key, value)
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
	);

    CREATE TABLE IF NOT EXISTS stage.annotations_outbox (
        id BIGSERIAL PRIMARY KEY,
        event_id TEXT UNIQUE,
        project_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        schema_version TEXT,
        target_repo TEXT,
        task_type TEXT,
        vertical TEXT,
        source_tag TEXT,
        shard_path TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        attempts INT DEFAULT 0,
        last_error TEXT,
        locked_at TIMESTAMPTZ
    );

	CREATE INDEX IF NOT EXISTS idx_annotations_outbox_pending
		ON stage.annotations_outbox (processed_at, created_at);

    CREATE INDEX IF NOT EXISTS idx_annotations_outbox_project
        ON stage.annotations_outbox (project_id, processed_at);
    `

	if _, err := db.ExecContext(ctx, schema); err != nil {
		// Log but don't fail - tables might already exist
		log.Printf("Warning: schema creation had issues (may already exist): %v", err)
	}

	// Ensure new columns exist for routing and vertical dimension
	alters := `
    ALTER TABLE stage.annotations_outbox ADD COLUMN IF NOT EXISTS target_repo TEXT;
    ALTER TABLE stage.annotations_outbox ADD COLUMN IF NOT EXISTS task_type TEXT;
    ALTER TABLE stage.annotations_outbox ADD COLUMN IF NOT EXISTS vertical TEXT;
    ALTER TABLE stage.annotations_outbox ADD COLUMN IF NOT EXISTS source_tag TEXT;
    CREATE INDEX IF NOT EXISTS idx_annotations_outbox_repo ON stage.annotations_outbox(target_repo, processed_at);
    CREATE INDEX IF NOT EXISTS idx_annotations_outbox_vertical ON stage.annotations_outbox(vertical) WHERE processed_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_annotations_outbox_source_tag ON stage.annotations_outbox(source_tag) WHERE processed_at IS NULL;
    `
	if _, err := db.ExecContext(ctx, alters); err != nil {
		log.Printf("Warning: annotations_outbox alter had issues: %v", err)
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

		if db != nil && cfg.EnableDBIndex && payload.Action == "ANNOTATION_CREATED" {
			go processAnnotation(payload)
		}

		if db != nil && cfg.HFToken != "" && cfg.HFRepo != "" && shouldEnqueueAction(payload.Action) {
			// Determine task type for metrics
			_, taskType, _ := determineTarget(payload, cfg)
			valid := "false"
			if ok, reason := validateAnnotation(payload); !ok {
				log.Printf("Validation failed, skipping enqueue: %s", reason)
				webhooksTotal.WithLabelValues(strings.ToUpper(payload.Action), valid, taskType).Inc()
			} else {
				valid = "true"
				webhooksTotal.WithLabelValues(strings.ToUpper(payload.Action), valid, taskType).Inc()
				repo, _, _ := determineTarget(payload, cfg)
				if err := enqueueAnnotation(payload, cfg); err != nil {
					log.Printf("Failed to enqueue annotation for HuggingFace: %v", err)
					enqueueTotal.WithLabelValues(repo, taskType, "error").Inc()
				} else {
					enqueueTotal.WithLabelValues(repo, taskType, "ok").Inc()
				}
			}
		}

		// Return success immediately
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"action": payload.Action,
		})
	}
}

// determineTarget determines the HF dataset repo, task type, and vertical for a payload
func determineTarget(payload WebhookPayload, cfg *Config) (repo string, taskType string, vertical string) {
	// Default values
	repo = cfg.HFRepo
	taskType = ""
	vertical = ""

	// Try to get vertical from task.data.vertical
	if payload.Task != nil {
		if dataAny, ok := payload.Task["data"]; ok {
			if data, ok := dataAny.(map[string]interface{}); ok {
				if v, ok := data["vertical"].(string); ok {
					vertical = strings.TrimSpace(strings.ToLower(v))
				}
			}
		}
	}
	if vertical == "" {
		// Default to maritime until projects carry vertical explicitly
		vertical = "maritime"
	}

	// Detect annotation result types
	if payload.Annotation != nil {
		if results, ok := payload.Annotation["result"].([]interface{}); ok {
			for _, r := range results {
				rm, ok := r.(map[string]interface{})
				if !ok {
					continue
				}
				t, _ := rm["type"].(string)
				switch strings.ToLower(t) {
				case "labels", "choices":
					// Text NER
					taskType = "ner"
					if cfg.HFRepoNER != "" {
						repo = cfg.HFRepoNER
					}
					return repo, taskType, vertical
				case "rectanglelabels", "polygonlabels":
					// PDF layout boxes (Docling)
					taskType = "docling"
					if cfg.HFRepoDocling != "" {
						repo = cfg.HFRepoDocling
					}
					return repo, taskType, vertical
				}
			}
		}
	}

	return repo, taskType, vertical
}

// validateAnnotation performs minimal schema validation on LS payloads
func validateAnnotation(payload WebhookPayload) (bool, string) {
	// Determine task type from results
	repo := ""
	taskType := ""
	vert := ""
	repo, taskType, vert = determineTarget(payload, &Config{HFRepo: repo})
	_ = vert // not used in validation

	// General checks
	if payload.Annotation == nil {
		return false, "missing annotation"
	}
	results, ok := payload.Annotation["result"].([]interface{})
	if !ok || len(results) == 0 {
		return false, "annotation.result missing or empty"
	}
	// Task-specific checks
	switch taskType {
	case "ner":
		// Require at least one valid span
		valid := 0
		for _, r := range results {
			rm, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			if t, _ := rm["type"].(string); strings.ToLower(t) != "labels" && strings.ToLower(t) != "choices" {
				continue
			}
			val, _ := rm["value"].(map[string]interface{})
			if val == nil {
				continue
			}
			_, hasStart := val["start"].(float64)
			_, hasEnd := val["end"].(float64)
			labs, _ := val["labels"].([]interface{})
			if hasStart && hasEnd && len(labs) > 0 {
				valid++
			}
		}
		if valid == 0 {
			return false, "no valid NER spans"
		}
		return true, ""
	case "docling":
		// Require at least one valid bbox
		valid := 0
		for _, r := range results {
			rm, ok := r.(map[string]interface{})
			if !ok {
				continue
			}
			t, _ := rm["type"].(string)
			lt := strings.ToLower(t)
			if lt != "rectanglelabels" && lt != "polygonlabels" {
				continue
			}
			val, _ := rm["value"].(map[string]interface{})
			if val == nil {
				continue
			}
			// rectangle: x,y,width,height present
			_, hx := val["x"].(float64)
			_, hy := val["y"].(float64)
			_, hw := val["width"].(float64)
			_, hh := val["height"].(float64)
			if hx && hy && hw && hh {
				valid++
			}
		}
		if valid == 0 {
			return false, "no valid Docling boxes"
		}
		return true, ""
	default:
		// Unknown type: allow but warn if needed
		return true, ""
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
		if db != nil && cfg.EnableDBIndex {
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

func shouldEnqueueAction(action string) bool {
	switch strings.ToUpper(action) {
	case "ANNOTATION_CREATED", "ANNOTATION_UPDATED":
		return true
	default:
		return false
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

	// Metrics registry
	initMetrics()

	var outboxCancel context.CancelFunc
	if db != nil && cfg.HFToken != "" && cfg.HFRepo != "" {
		processor := newOutboxProcessor(db, cfg)
		ctx, cancel := context.WithCancel(context.Background())
		outboxCancel = cancel
		log.Printf("Outbox processor enabled: repo=%s batch=%d interval=%s branch=%s",
			cfg.HFRepo, cfg.OutboxBatchSize, cfg.OutboxInterval, cfg.HFBranch)
		go processor.run(ctx)
	}
	if outboxCancel != nil {
		defer outboxCancel()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/webhook", webhookHandler(cfg))
	mux.HandleFunc("/ingest", ingestHandler(cfg))
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/audit/source", auditSourceHandler)

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

// auditSourceHandler returns outbox entries matching a source_tag
func auditSourceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if db == nil {
		http.Error(w, "Database not configured", http.StatusServiceUnavailable)
		return
	}
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	if tag == "" {
		http.Error(w, "missing tag", http.StatusBadRequest)
		return
	}
	includePayload := r.URL.Query().Get("include_payload") == "1"

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var rows *sql.Rows
	var err error
	if includePayload {
		rows, err = db.QueryContext(ctx, `
            SELECT id, event_id, project_id, schema_version, target_repo, task_type, vertical, source_tag, shard_path, created_at, processed_at, payload
            FROM stage.annotations_outbox
            WHERE source_tag = $1
            ORDER BY created_at DESC
            LIMIT 200`, tag)
	} else {
		rows, err = db.QueryContext(ctx, `
            SELECT id, event_id, project_id, schema_version, target_repo, task_type, vertical, source_tag, shard_path, created_at, processed_at
            FROM stage.annotations_outbox
            WHERE source_tag = $1
            ORDER BY created_at DESC
            LIMIT 200`, tag)
	}
	if err != nil {
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type item struct {
		ID          int64           `json:"id"`
		EventID     string          `json:"event_id"`
		ProjectID   string          `json:"project_id"`
		Schema      string          `json:"schema_version"`
		Repo        string          `json:"target_repo"`
		TaskType    string          `json:"task_type"`
		Vertical    string          `json:"vertical"`
		SourceTag   string          `json:"source_tag"`
		ShardPath   string          `json:"shard_path"`
		CreatedAt   time.Time       `json:"created_at"`
		ProcessedAt *time.Time      `json:"processed_at,omitempty"`
		Payload     json.RawMessage `json:"payload,omitempty"`
	}

	var out struct {
		Items []item `json:"items"`
	}

	for rows.Next() {
		var it item
		if includePayload {
			if err := rows.Scan(&it.ID, &it.EventID, &it.ProjectID, &it.Schema, &it.Repo, &it.TaskType, &it.Vertical, &it.SourceTag, &it.ShardPath, &it.CreatedAt, &it.ProcessedAt, &it.Payload); err != nil {
				http.Error(w, "scan failed", http.StatusInternalServerError)
				return
			}
		} else {
			if err := rows.Scan(&it.ID, &it.EventID, &it.ProjectID, &it.Schema, &it.Repo, &it.TaskType, &it.Vertical, &it.SourceTag, &it.ShardPath, &it.CreatedAt, &it.ProcessedAt); err != nil {
				http.Error(w, "scan failed", http.StatusInternalServerError)
				return
			}
		}
		out.Items = append(out.Items, it)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "rows error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
