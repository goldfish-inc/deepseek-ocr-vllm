package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"regexp"
	"strings"
	"time"
)

// processCSVTask handles the main CSV processing workflow
func (w *Worker) processCSVTask(ctx context.Context, taskData *TaskData) error {
	log.Printf("Processing CSV task %d: %s", taskData.TaskID, taskData.FileName)

	// Create document record
	documentID, err := w.createDocument(taskData)
	if err != nil {
		return fmt.Errorf("failed to create document: %w", err)
	}

	// Download file from S3
	fileContent, err := w.downloadFile(ctx, taskData.FileURL)
	if err != nil {
		return fmt.Errorf("failed to download file: %w", err)
	}

	// Parse CSV/Excel file
	rows, headers, err := w.parseFile(taskData.FileName, fileContent)
	if err != nil {
		return fmt.Errorf("failed to parse file: %w", err)
	}

	log.Printf("Parsed %d rows with %d columns from %s", len(rows), len(headers), taskData.FileName)

	// Process each row
	var extractions []CellExtraction
	needsReviewCount := 0

	for rowIndex, row := range rows {
		for colIndex, cellValue := range row {
			if colIndex >= len(headers) {
				continue // Skip extra columns without headers
			}

			columnName := headers[colIndex]

			// Process cell through cleaning rules
			extraction := w.processCell(
				documentID,
				rowIndex,
				columnName,
				cellValue,
				taskData.SourceType,
				taskData.SourceName,
			)

			extractions = append(extractions, extraction)

			if extraction.NeedsReview {
				needsReviewCount++
			}

			// Update metrics
			w.metrics.processedTotal.WithLabelValues("processed", taskData.SourceType).Inc()
			w.metrics.confidenceHistogram.WithLabelValues(
				w.getFieldType(columnName),
				taskData.SourceType,
			).Observe(extraction.Confidence)
		}
	}

	// Batch insert extractions to database
	if err := w.storeExtractions(extractions); err != nil {
		return fmt.Errorf("failed to store extractions: %w", err)
	}

	log.Printf("Stored %d extractions, %d need review", len(extractions), needsReviewCount)

	// Update review queue metrics
	w.updateReviewQueueMetrics()

	// Notify review manager if there are cells needing review
	if needsReviewCount > 0 {
		if err := w.notifyReviewManager(documentID, needsReviewCount); err != nil {
			log.Printf("Failed to notify review manager: %v", err)
			// Don't fail the whole process if notification fails
		}
	}

	// Store processing summary
	if err := w.storeProcessingSummary(documentID, len(rows), len(extractions), needsReviewCount); err != nil {
		log.Printf("Failed to store processing summary: %v", err)
	}

	return nil
}

// processCell applies cleaning rules and calculates confidence
func (w *Worker) processCell(
	documentID int64,
	rowIndex int,
	columnName string,
	rawValue string,
	sourceType string,
	sourceName string,
) CellExtraction {
	extraction := CellExtraction{
		DocumentID:   documentID,
		RowIndex:     rowIndex,
		ColumnName:   columnName,
		RawValue:     rawValue,
		CleanedValue: rawValue, // Start with raw value
		SourceType:   sourceType,
		SourceName:   sourceName,
		RuleChain:    []int64{},
		Confidence:   0.5, // Base confidence
	}

	// Skip empty cells
	if strings.TrimSpace(rawValue) == "" {
		extraction.Confidence = 1.0 // Empty is valid
		return extraction
	}

	// Get applicable rules for this column and source
	rules := w.getApplicableRules(columnName, sourceType, sourceName)

	// Apply rules in priority order (max 3 passes)
	maxPasses := 3
	passCount := 0
	previousValue := rawValue

	for passCount < maxPasses && len(rules) > 0 {
		applied := false

		for _, rule := range rules {
			newValue, ruleApplied := w.applyRule(extraction.CleanedValue, rule)
			if ruleApplied {
				extraction.CleanedValue = newValue
				extraction.RuleChain = append(extraction.RuleChain, rule.ID)
				applied = true

				// Update confidence based on rule confidence
				extraction.Confidence = w.updateConfidence(extraction.Confidence, rule.Confidence, passCount)

				// Check if we've reached confidence threshold
				threshold := w.getConfidenceThreshold(columnName, sourceType)
				if extraction.Confidence >= threshold {
					break
				}
			}
		}

		if !applied || extraction.CleanedValue == previousValue {
			break // No more changes
		}

		previousValue = extraction.CleanedValue
		passCount++
	}

	// Calculate similarity between raw and cleaned values
	extraction.Similarity = w.calculateSimilarity(rawValue, extraction.CleanedValue)

	// Normalize placeholder values to empty strings for pandas baseline compatibility
	// This ensures empty cells are consistently represented as "" not "nan"/"NaN"/"None"/etc
	val := strings.TrimSpace(extraction.CleanedValue)
	lower := strings.ToLower(val)
	if lower == "nan" || lower == "none" || lower == "null" || lower == "n/a" || lower == "na" {
		extraction.CleanedValue = ""
	} else {
		// Remove trailing whitespace for non-empty values
		extraction.CleanedValue = val
	}

	// Adjust confidence based on similarity
	if extraction.Similarity > 0.95 {
		extraction.Confidence = math.Min(extraction.Confidence+0.05, 1.0)
	} else if extraction.Similarity < 0.5 {
		extraction.Confidence = math.Max(extraction.Confidence-0.10, 0.0)
	}

	// Determine if review is needed
	threshold := w.getConfidenceThreshold(columnName, sourceType)
	extraction.NeedsReview = extraction.Confidence < threshold

	return extraction
}

// applyRule applies a single cleaning rule to a value
func (w *Worker) applyRule(value string, rule CleaningRule) (string, bool) {
	switch rule.RuleType {
	case "regex_replace":
		if !rule.Pattern.Valid {
			return value, false
		}
		re, err := regexp.Compile(rule.Pattern.String)
		if err != nil {
			log.Printf("Invalid regex pattern in rule %d: %v", rule.ID, err)
			return value, false
		}
		replacement := ""
		if rule.Replacement.Valid {
			replacement = rule.Replacement.String
		}
		newValue := re.ReplaceAllString(value, replacement)
		return newValue, newValue != value

	case "field_merger":
		// For merging multiple fields (handled at row level)
		return value, false

	case "validator":
		// Validation rules don't change the value, just affect confidence
		if !rule.Pattern.Valid {
			return value, false
		}
		matched, _ := regexp.MatchString(rule.Pattern.String, value)
		return value, matched

	case "type_coercion":
		// Type conversion (e.g., date formatting)
		return w.coerceType(value, rule), true

	case "format_standardizer":
		// Standardize format (e.g., uppercase, trim)
		return w.standardizeFormat(value, rule), true

	default:
		return value, false
	}
}

// coerceType handles type coercion rules
func (w *Worker) coerceType(value string, rule CleaningRule) string {
	// Parse rule metadata for type information
	var metadata map[string]interface{}
	if rule.Pattern.Valid && rule.Pattern.String != "" {
		json.Unmarshal([]byte(rule.Pattern.String), &metadata)
	}

	targetType, _ := metadata["type"].(string)

	switch targetType {
	case "date":
		// Attempt to parse and reformat date
		formats := []string{
			"2006-01-02",
			"01/02/2006",
			"02/01/2006",
			"2006/01/02",
			"Jan 2, 2006",
			"2 Jan 2006",
		}
		for _, format := range formats {
			if t, err := time.Parse(format, value); err == nil {
				return t.Format("2006-01-02") // ISO format
			}
		}
		return value

	case "number":
		// Remove non-numeric characters
		re := regexp.MustCompile(`[^0-9.-]`)
		return re.ReplaceAllString(value, "")

	case "boolean":
		lower := strings.ToLower(strings.TrimSpace(value))
		if lower == "yes" || lower == "y" || lower == "true" || lower == "1" {
			return "true"
		}
		if lower == "no" || lower == "n" || lower == "false" || lower == "0" {
			return "false"
		}
		return value

	default:
		return value
	}
}

// standardizeFormat applies format standardization
func (w *Worker) standardizeFormat(value string, rule CleaningRule) string {
	var metadata map[string]interface{}
	if rule.Pattern.Valid && rule.Pattern.String != "" {
		json.Unmarshal([]byte(rule.Pattern.String), &metadata)
	}

	format, _ := metadata["format"].(string)

	switch format {
	case "uppercase":
		return strings.ToUpper(value)
	case "lowercase":
		return strings.ToLower(value)
	case "trim":
		return strings.TrimSpace(value)
	case "remove_quotes":
		return strings.Trim(value, `"'`)
	case "remove_special":
		re := regexp.MustCompile(`[^a-zA-Z0-9\s.-]`)
		return re.ReplaceAllString(value, "")
	default:
		// Default: trim whitespace
		return strings.TrimSpace(value)
	}
}

// updateConfidence calculates new confidence after applying a rule
func (w *Worker) updateConfidence(currentConfidence, ruleConfidence float64, passNumber int) float64 {
	// Diminishing returns for multiple passes
	adjustment := ruleConfidence * math.Pow(0.9, float64(passNumber))

	// Weighted average with current confidence
	newConfidence := (currentConfidence*0.3 + adjustment*0.7)

	return math.Min(newConfidence, 1.0)
}

// getConfidenceThreshold returns the confidence threshold for a field
func (w *Worker) getConfidenceThreshold(columnName, sourceType string) float64 {
	fieldType := w.getFieldType(columnName)

	if config, exists := w.confidenceConfig[fieldType]; exists {
		threshold := config.BaseThreshold

		// Adjust for source trust
		if w.isTrustedSource(sourceType) {
			threshold -= config.TrustedBonus
		} else if w.isUntrustedSource(sourceType) {
			threshold -= config.UntrustedMalus
		}

		return math.Max(0.5, math.Min(1.0, threshold))
	}

	// Default threshold
	if config, exists := w.confidenceConfig["DEFAULT"]; exists {
		return config.BaseThreshold
	}

	return 0.85 // Fallback default
}

// getFieldType determines the field type from column name
func (w *Worker) getFieldType(columnName string) string {
	upper := strings.ToUpper(columnName)

	// Check for specific field types
	if strings.Contains(upper, "IMO") {
		return "IMO"
	}
	if strings.Contains(upper, "MMSI") {
		return "MMSI"
	}
	if strings.Contains(upper, "IRCS") || strings.Contains(upper, "CALL_SIGN") {
		return "IRCS"
	}
	if strings.Contains(upper, "VESSEL") && strings.Contains(upper, "NAME") {
		return "VESSEL_NAME"
	}
	if strings.Contains(upper, "FLAG") {
		return "FLAG"
	}
	if strings.Contains(upper, "DATE") || strings.Contains(upper, "TIME") {
		return "DATE"
	}
	if strings.Contains(upper, "TONNAGE") || strings.Contains(upper, "LENGTH") ||
		strings.Contains(upper, "YEAR") || strings.Contains(upper, "NUMBER") {
		return "NUMBER"
	}

	return "DEFAULT"
}

// isTrustedSource checks if a source is trusted
func (w *Worker) isTrustedSource(sourceType string) bool {
	trustedSources := []string{"IMO", "LLOYD", "FAO", "OFFICIAL"}
	for _, trusted := range trustedSources {
		if strings.EqualFold(sourceType, trusted) {
			return true
		}
	}
	return false
}

// isUntrustedSource checks if a source is untrusted
func (w *Worker) isUntrustedSource(sourceType string) bool {
	untrustedSources := []string{"CROWD", "UNVERIFIED", "ANONYMOUS"}
	for _, untrusted := range untrustedSources {
		if strings.EqualFold(sourceType, untrusted) {
			return true
		}
	}
	return false
}

// calculateSimilarity calculates the similarity between two strings
func (w *Worker) calculateSimilarity(s1, s2 string) float64 {
	// Simple Levenshtein-based similarity
	if s1 == s2 {
		return 1.0
	}
	if s1 == "" || s2 == "" {
		return 0.0
	}

	// Convert to lowercase for comparison
	s1 = strings.ToLower(s1)
	s2 = strings.ToLower(s2)

	// Calculate Levenshtein distance
	distance := levenshteinDistance(s1, s2)
	maxLen := math.Max(float64(len(s1)), float64(len(s2)))

	return 1.0 - (float64(distance) / maxLen)
}

// levenshteinDistance calculates the Levenshtein distance between two strings
func levenshteinDistance(s1, s2 string) int {
	if len(s1) == 0 {
		return len(s2)
	}
	if len(s2) == 0 {
		return len(s1)
	}

	// Create matrix
	matrix := make([][]int, len(s1)+1)
	for i := range matrix {
		matrix[i] = make([]int, len(s2)+1)
		matrix[i][0] = i
	}
	for j := range matrix[0] {
		matrix[0][j] = j
	}

	// Calculate distances
	for i := 1; i <= len(s1); i++ {
		for j := 1; j <= len(s2); j++ {
			cost := 0
			if s1[i-1] != s2[j-1] {
				cost = 1
			}

			matrix[i][j] = min(
				matrix[i-1][j]+1,      // deletion
				matrix[i][j-1]+1,      // insertion
				matrix[i-1][j-1]+cost, // substitution
			)
		}
	}

	return matrix[len(s1)][len(s2)]
}

func min(values ...int) int {
	minVal := values[0]
	for _, v := range values[1:] {
		if v < minVal {
			minVal = v
		}
	}
	return minVal
}
