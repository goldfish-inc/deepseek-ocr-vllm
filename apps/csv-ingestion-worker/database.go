package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/lib/pq"
)

// loadCleaningRules loads all active cleaning rules from the database
func (w *Worker) loadCleaningRules() error {
	// Backward-compatible wrapper: no timeout
	return w.loadCleaningRulesContext(context.Background())
}

// loadCleaningRulesContext loads rules with a context (useful for timeouts)
func (w *Worker) loadCleaningRulesContext(ctx context.Context) error {
	query := `
        SELECT
            id, rule_name, rule_type, pattern, replacement,
            priority, confidence, source_type, source_name,
            column_name, is_active
        FROM stage.cleaning_rules
        WHERE is_active = true
        ORDER BY priority ASC, id ASC
    `

	rows, err := w.db.QueryContext(ctx, query)
	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("load_rules").Inc()
		return fmt.Errorf("failed to query cleaning rules: %w", err)
	}
	defer rows.Close()

	w.cleaningRules = make(map[string][]CleaningRule)

	for rows.Next() {
		var rule CleaningRule
		err := rows.Scan(
			&rule.ID, &rule.RuleName, &rule.RuleType, &rule.Pattern, &rule.Replacement,
			&rule.Priority, &rule.Confidence, &rule.SourceType, &rule.SourceName,
			&rule.ColumnName, &rule.IsActive,
		)
		if err != nil {
			log.Printf("Failed to scan rule: %v", err)
			continue
		}

		// Create key for rule grouping
		sourceType := "GLOBAL"
		if rule.SourceType.Valid {
			sourceType = rule.SourceType.String
		}

		sourceName := ""
		if rule.SourceName.Valid {
			sourceName = rule.SourceName.String
		}

		key := fmt.Sprintf("%s:%s", sourceType, sourceName)
		if rule.ColumnName.Valid {
			key = fmt.Sprintf("%s:%s", key, rule.ColumnName.String)
		}

		w.cleaningRules[key] = append(w.cleaningRules[key], rule)
	}

	// Also load global rules
	globalRules := w.cleaningRules["GLOBAL:"]
	for key := range w.cleaningRules {
		if key != "GLOBAL:" {
			w.cleaningRules[key] = append(w.cleaningRules[key], globalRules...)
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("error reading cleaning rules: %w", err)
	}

	log.Printf("Loaded %d cleaning rule groups", len(w.cleaningRules))
	return nil
}

// getApplicableRules returns rules applicable to a specific column and source
func (w *Worker) getApplicableRules(columnName, sourceType, sourceName string) []CleaningRule {
	var applicableRules []CleaningRule

	// Try specific column + source
	key := fmt.Sprintf("%s:%s:%s", sourceType, sourceName, columnName)
	if rules, exists := w.cleaningRules[key]; exists {
		applicableRules = append(applicableRules, rules...)
	}

	// Try source type + column
	key = fmt.Sprintf("%s::%s", sourceType, columnName)
	if rules, exists := w.cleaningRules[key]; exists {
		applicableRules = append(applicableRules, rules...)
	}

	// Try just source type
	key = fmt.Sprintf("%s:", sourceType)
	if rules, exists := w.cleaningRules[key]; exists {
		applicableRules = append(applicableRules, rules...)
	}

	// Add global rules for column
	key = fmt.Sprintf("GLOBAL::%s", columnName)
	if rules, exists := w.cleaningRules[key]; exists {
		applicableRules = append(applicableRules, rules...)
	}

	// Add completely global rules
	if rules, exists := w.cleaningRules["GLOBAL:"]; exists {
		applicableRules = append(applicableRules, rules...)
	}

	// Sort by priority
	// Rules are already sorted when loaded, but we're combining multiple groups
	for i := 0; i < len(applicableRules)-1; i++ {
		for j := i + 1; j < len(applicableRules); j++ {
			if applicableRules[j].Priority < applicableRules[i].Priority {
				applicableRules[i], applicableRules[j] = applicableRules[j], applicableRules[i]
			}
		}
	}

	return applicableRules
}

// createDocument creates a new document record
func (w *Worker) createDocument(taskData *TaskData) (int64, error) {
	// Convert metadata to JSON
	var metadataJSON []byte
	var err error
	if taskData.Metadata != nil {
		metadataJSON, err = json.Marshal(taskData.Metadata)
		if err != nil {
			return 0, fmt.Errorf("failed to marshal metadata: %w", err)
		}
	} else {
		metadataJSON = []byte("{}")
	}

	var documentID int64
	err = w.db.QueryRow(`
		INSERT INTO stage.documents (
			task_id, file_name, source_type, source_name,
			org_id, doc_type, metadata, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		RETURNING id
	`,
		taskData.TaskID, taskData.FileName, taskData.SourceType, taskData.SourceName,
		taskData.OrgID, taskData.DocType, metadataJSON,
	).Scan(&documentID)

	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("create_document").Inc()
		return 0, fmt.Errorf("failed to create document: %w", err)
	}

	// Also create initial processing log entry
	_, err = w.db.Exec(`
		INSERT INTO stage.document_processing_log (
			document_id, task_id, processing_status, processing_stage,
			started_at
		) VALUES ($1, $2, 'processing', 'csv_ingestion', NOW())
	`, documentID, taskData.TaskID)

	if err != nil {
		log.Printf("Failed to create processing log: %v", err)
	}

	return documentID, nil
}

// storeExtractions batch inserts all extractions
func (w *Worker) storeExtractions(extractions []CellExtraction) error {
	if len(extractions) == 0 {
		return nil
	}

	// Use a transaction for atomicity
	tx, err := w.db.Begin()
	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("begin_transaction").Inc()
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Prepare the bulk insert statement
	stmt, err := tx.Prepare(pq.CopyInSchema("stage", "csv_extractions",
		"document_id", "row_index", "column_name", "raw_value", "cleaned_value",
		"confidence", "rule_chain", "needs_review", "similarity",
		"source_type", "source_name", "created_at",
	))
	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("prepare_insert").Inc()
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	// Insert all extractions
	for _, extraction := range extractions {
		// Convert rule chain to PostgreSQL array
		ruleChainArray := pq.Array(extraction.RuleChain)

		_, err = stmt.Exec(
			extraction.DocumentID,
			extraction.RowIndex,
			extraction.ColumnName,
			extraction.RawValue,
			extraction.CleanedValue,
			extraction.Confidence,
			ruleChainArray,
			extraction.NeedsReview,
			extraction.Similarity,
			extraction.SourceType,
			extraction.SourceName,
			time.Now(),
		)
		if err != nil {
			log.Printf("Failed to insert extraction: %v", err)
			w.metrics.databaseErrors.WithLabelValues("insert_extraction").Inc()
			// Continue with other insertions
		}
	}

	// Execute the bulk insert
	_, err = stmt.Exec()
	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("exec_bulk_insert").Inc()
		return fmt.Errorf("failed to execute bulk insert: %w", err)
	}

	// Commit the transaction
	if err = tx.Commit(); err != nil {
		w.metrics.databaseErrors.WithLabelValues("commit_transaction").Inc()
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	log.Printf("Successfully stored %d extractions", len(extractions))
	return nil
}

// storeProcessingSummary stores processing statistics
func (w *Worker) storeProcessingSummary(documentID int64, rowCount, cellCount, reviewCount int) error {
	// Calculate statistics
	var stats struct {
		AvgConfidence   float64
		MinConfidence   float64
		MaxConfidence   float64
		HighConfCount   int
		MediumConfCount int
		LowConfCount    int
		UniqueRulesUsed int
	}

	err := w.db.QueryRow(`
		WITH stats AS (
			SELECT
				AVG(confidence) as avg_conf,
				MIN(confidence) as min_conf,
				MAX(confidence) as max_conf,
				COUNT(CASE WHEN confidence >= 0.95 THEN 1 END) as high_conf,
				COUNT(CASE WHEN confidence >= 0.85 AND confidence < 0.95 THEN 1 END) as med_conf,
				COUNT(CASE WHEN confidence < 0.85 THEN 1 END) as low_conf,
				COUNT(DISTINCT unnest(rule_chain)) as unique_rules
			FROM stage.csv_extractions
			WHERE document_id = $1
		)
		SELECT
			COALESCE(avg_conf, 0),
			COALESCE(min_conf, 0),
			COALESCE(max_conf, 0),
			COALESCE(high_conf, 0),
			COALESCE(med_conf, 0),
			COALESCE(low_conf, 0),
			COALESCE(unique_rules, 0)
		FROM stats
	`, documentID).Scan(
		&stats.AvgConfidence,
		&stats.MinConfidence,
		&stats.MaxConfidence,
		&stats.HighConfCount,
		&stats.MediumConfCount,
		&stats.LowConfCount,
		&stats.UniqueRulesUsed,
	)

	if err != nil {
		log.Printf("Failed to calculate statistics: %v", err)
		// Continue anyway
	}

	// Store summary
	processingMetrics := map[string]interface{}{
		"rows_processed":    rowCount,
		"cells_processed":   cellCount,
		"cells_need_review": reviewCount,
		"avg_confidence":    stats.AvgConfidence,
		"min_confidence":    stats.MinConfidence,
		"max_confidence":    stats.MaxConfidence,
		"high_confidence":   stats.HighConfCount,
		"medium_confidence": stats.MediumConfCount,
		"low_confidence":    stats.LowConfCount,
		"unique_rules_used": stats.UniqueRulesUsed,
		"review_percentage": float64(reviewCount) / float64(cellCount) * 100,
	}

	metricsJSON, _ := json.Marshal(processingMetrics)

	_, err = w.db.Exec(`
		UPDATE stage.document_processing_log
		SET
			processing_status = 'completed',
			processing_stage = 'csv_cleaned',
			completed_at = NOW(),
			processing_metrics = $1,
			rows_processed = $2,
			confidence_avg = $3
		WHERE document_id = $4
	`, metricsJSON, rowCount, stats.AvgConfidence, documentID)

	if err != nil {
		w.metrics.databaseErrors.WithLabelValues("update_summary").Inc()
		return fmt.Errorf("failed to update processing log: %w", err)
	}

	return nil
}

// updateReviewQueueMetrics updates Prometheus metrics for review queue
func (w *Worker) updateReviewQueueMetrics() {
	// Query current queue depth by priority
	query := `
		SELECT
			CASE
				WHEN confidence < 0.6 THEN 'high'
				WHEN confidence < 0.8 THEN 'medium'
				ELSE 'low'
			END as priority,
			COUNT(*) as count
		FROM stage.csv_extractions
		WHERE needs_review = true
			AND review_status IS NULL
		GROUP BY priority
	`

	rows, err := w.db.Query(query)
	if err != nil {
		log.Printf("Failed to query review queue metrics: %v", err)
		return
	}
	defer rows.Close()

	// Reset all gauges first
	w.metrics.reviewQueueDepth.Reset()

	for rows.Next() {
		var priority string
		var count float64
		if err := rows.Scan(&priority, &count); err != nil {
			continue
		}
		w.metrics.reviewQueueDepth.WithLabelValues(priority).Set(count)
	}
}

// Helper function for creating table if needed (for testing)
func ensureTables(db *sql.DB) error {
	// Check if csv_extractions table exists
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'stage'
			AND table_name = 'csv_extractions'
		)
	`).Scan(&exists)

	if err != nil {
		return err
	}

	if !exists {
		log.Println("Warning: stage.csv_extractions table does not exist")
		// In production, tables should be created by migrations
		// This is just for development/testing
		// Check if we're in development mode by looking for localhost in DATABASE_URL
		if dbURL := os.Getenv("DATABASE_URL"); strings.Contains(dbURL, "localhost") {
			return createTestTables(db)
		}
	}

	return nil
}

// createTestTables creates minimal tables for testing (development only)
func createTestTables(db *sql.DB) error {
	log.Println("Creating test tables (development mode)")

	queries := []string{
		`CREATE SCHEMA IF NOT EXISTS stage`,
		`CREATE TABLE IF NOT EXISTS stage.documents (
			id BIGSERIAL PRIMARY KEY,
			task_id BIGINT,
			file_name TEXT,
			source_type TEXT,
			source_name TEXT,
			org_id TEXT,
			doc_type TEXT,
			metadata JSONB,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS stage.csv_extractions (
			id BIGSERIAL PRIMARY KEY,
			document_id BIGINT REFERENCES stage.documents(id),
			row_index INTEGER,
			column_name TEXT,
			raw_value TEXT,
			cleaned_value TEXT,
			confidence NUMERIC(4,3),
			rule_chain BIGINT[],
			needs_review BOOLEAN DEFAULT false,
			similarity NUMERIC(4,3),
			source_type TEXT,
			source_name TEXT,
			review_status TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS stage.document_processing_log (
			id BIGSERIAL PRIMARY KEY,
			document_id BIGINT,
			task_id BIGINT,
			processing_status TEXT,
			processing_stage TEXT,
			processing_metrics JSONB,
			rows_processed INTEGER,
			confidence_avg NUMERIC(4,3),
			error_message TEXT,
			started_at TIMESTAMPTZ,
			completed_at TIMESTAMPTZ,
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS stage.event_log (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT,
			event_action TEXT,
			task_id BIGINT,
			payload JSONB,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			return fmt.Errorf("failed to create test table: %w", err)
		}
	}

	return nil
}
