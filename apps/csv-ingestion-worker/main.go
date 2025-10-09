package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Config holds application configuration
type Config struct {
	DatabaseURL      string
	S3Bucket         string
	S3Region         string
	S3Endpoint       string // For testing with MinIO
	Port             string
	ConfidenceConfig string
	MaxWorkers       int
	WebhookSecret    string // For signature verification
	LabelStudioURL   string
	ReviewManagerURL string
}

// Worker handles CSV processing
type Worker struct {
	config           *Config
	db               *sql.DB
	s3Client         *s3.Client
	metrics          *Metrics
	cleaningRules    map[string][]CleaningRule
	confidenceConfig map[string]FieldConfig
}

// CleaningRule represents a data cleaning rule from the database
type CleaningRule struct {
	ID          int64
	RuleName    string
	RuleType    string
	Pattern     sql.NullString
	Replacement sql.NullString
	Priority    int
	Confidence  float64
	SourceType  sql.NullString
	SourceName  sql.NullString
	ColumnName  sql.NullString
	IsActive    bool
}

// FieldConfig holds confidence thresholds for different field types
type FieldConfig struct {
	BaseThreshold  float64 `json:"base"`
	TrustedBonus   float64 `json:"trusted_bonus"`
	UntrustedMalus float64 `json:"untrusted_malus"`
}

// CellExtraction represents a processed cell
type CellExtraction struct {
	DocumentID   int64
	RowIndex     int
	ColumnName   string
	RawValue     string
	CleanedValue string
	Confidence   float64
	RuleChain    []int64
	NeedsReview  bool
	Similarity   float64
	SourceType   string
	SourceName   string
}

// Metrics holds Prometheus metrics
type Metrics struct {
	processedTotal      *prometheus.CounterVec
	confidenceHistogram *prometheus.HistogramVec
	reviewQueueDepth    *prometheus.GaugeVec
	processingDuration  *prometheus.HistogramVec
	webhooksReceived    *prometheus.CounterVec
	databaseErrors      *prometheus.CounterVec
}

func main() {
	// Load configuration
	cfg := loadConfig()

	// Initialize database
	db, err := initDatabase(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialize S3 client
	s3Client, err := initS3Client(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize S3 client: %v", err)
	}

	// Initialize metrics
	metrics := initMetrics()

	// Parse confidence configuration
	var confidenceConfig map[string]FieldConfig
	if err := json.Unmarshal([]byte(cfg.ConfidenceConfig), &confidenceConfig); err != nil {
		log.Fatalf("Failed to parse confidence config: %v", err)
	}

	// Create worker
	worker := &Worker{
		config:           cfg,
		db:               db,
		s3Client:         s3Client,
		metrics:          metrics,
		confidenceConfig: confidenceConfig,
	}

	// Load cleaning rules from database
	if err := worker.loadCleaningRules(); err != nil {
		log.Fatalf("Failed to load cleaning rules: %v", err)
	}

	// Set up HTTP handlers
	http.HandleFunc("/webhook", worker.handleWebhook)
	http.HandleFunc("/health", worker.handleHealth)
	http.Handle("/metrics", promhttp.Handler())

	// Start HTTP server
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Println("Shutting down gracefully...")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("Server shutdown error: %v", err)
		}
	}()

	log.Printf("CSV Ingestion Worker starting on port %s", cfg.Port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

func loadConfig() *Config {
	cfg := &Config{
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		S3Bucket:         os.Getenv("S3_BUCKET"),
		S3Region:         getEnvOrDefault("S3_REGION", "us-east-1"),
		S3Endpoint:       os.Getenv("S3_ENDPOINT"), // Optional, for MinIO testing
		Port:             getEnvOrDefault("PORT", "8080"),
		MaxWorkers:       getIntEnvOrDefault("MAX_WORKERS", 10),
		WebhookSecret:    os.Getenv("WEBHOOK_SECRET"),
		LabelStudioURL:   os.Getenv("LABEL_STUDIO_URL"),
		ReviewManagerURL: getEnvOrDefault("REVIEW_MANAGER_URL", "http://review-queue-manager.apps:8080"),
		ConfidenceConfig: getEnvOrDefault("CONFIDENCE_CONFIG", `{
			"IMO": {"base": 0.98, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"MMSI": {"base": 0.98, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"IRCS": {"base": 0.98, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"VESSEL_NAME": {"base": 0.90, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"FLAG": {"base": 0.95, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"DATE": {"base": 0.95, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"NUMBER": {"base": 0.95, "trusted_bonus": 0.02, "untrusted_malus": -0.02},
			"DEFAULT": {"base": 0.85, "trusted_bonus": 0.02, "untrusted_malus": -0.02}
		}`),
	}

	// Validate required configuration
	if cfg.DatabaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	if cfg.S3Bucket == "" {
		log.Fatal("S3_BUCKET is required")
	}

	return cfg
}

func initDatabase(dbURL string) (*sql.DB, error) {
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, err
	}

	// Configure connection pool
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(5 * time.Minute)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("database ping failed: %w", err)
	}

	// Ensure schema exists
	if err := ensureSchema(db); err != nil {
		return nil, fmt.Errorf("schema setup failed: %w", err)
	}

	return db, nil
}

func initS3Client(cfg *Config) (*s3.Client, error) {
	awsCfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(cfg.S3Region),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	opts := []func(*s3.Options){}
	if cfg.S3Endpoint != "" {
		// For MinIO/testing
		opts = append(opts, func(o *s3.Options) {
			o.BaseEndpoint = &cfg.S3Endpoint
			o.UsePathStyle = true
		})
	}

	return s3.NewFromConfig(awsCfg, opts...), nil
}

func initMetrics() *Metrics {
	m := &Metrics{
		processedTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "csv_cells_processed_total",
				Help: "Total number of CSV cells processed",
			},
			[]string{"status", "source_type"},
		),
		confidenceHistogram: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "csv_confidence_distribution",
				Help:    "Distribution of confidence scores by field type",
				Buckets: []float64{0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99, 1.0},
			},
			[]string{"field_type", "source_type"},
		),
		reviewQueueDepth: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "csv_review_queue_depth",
				Help: "Current depth of the review queue",
			},
			[]string{"priority"},
		),
		processingDuration: prometheus.NewHistogramVec(
			prometheus.HistogramOpts{
				Name:    "csv_processing_duration_seconds",
				Help:    "Time taken to process CSV files",
				Buckets: []float64{0.1, 0.5, 1, 2, 5, 10, 30, 60},
			},
			[]string{"source_type"},
		),
		webhooksReceived: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "csv_webhooks_received_total",
				Help: "Total number of webhooks received",
			},
			[]string{"event_type", "status"},
		),
		databaseErrors: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "csv_database_errors_total",
				Help: "Total number of database errors",
			},
			[]string{"operation"},
		),
	}

	// Register metrics
	prometheus.MustRegister(
		m.processedTotal,
		m.confidenceHistogram,
		m.reviewQueueDepth,
		m.processingDuration,
		m.webhooksReceived,
		m.databaseErrors,
	)

	return m
}

func (w *Worker) handleHealth(rw http.ResponseWriter, r *http.Request) {
	// Check database connectivity
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := w.db.PingContext(ctx); err != nil {
		w.metrics.databaseErrors.WithLabelValues("health_check").Inc()
		http.Error(rw, fmt.Sprintf(`{"status":"unhealthy","error":"%v"}`, err), http.StatusServiceUnavailable)
		return
	}

	// Check if we have cleaning rules loaded
	if len(w.cleaningRules) == 0 {
		http.Error(rw, `{"status":"unhealthy","error":"no cleaning rules loaded"}`, http.StatusServiceUnavailable)
		return
	}

	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	fmt.Fprintf(rw, `{"status":"healthy","rules_loaded":%d,"timestamp":"%s"}`,
		len(w.cleaningRules), time.Now().Format(time.RFC3339))
}

func ensureSchema(db *sql.DB) error {
	// Check if stage schema exists
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.schemata
			WHERE schema_name = 'stage'
		)
	`).Scan(&exists)

	if err != nil {
		return fmt.Errorf("failed to check schema existence: %w", err)
	}

	if !exists {
		log.Println("Warning: stage schema does not exist. It should be created by database migrations.")
	}

	return nil
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getIntEnvOrDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var intValue int
		if _, err := fmt.Sscanf(value, "%d", &intValue); err == nil {
			return intValue
		}
	}
	return defaultValue
}
