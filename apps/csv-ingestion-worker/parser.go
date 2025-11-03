package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"strings"

	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/xuri/excelize/v2"
)

// parseFile parses CSV or Excel files and returns rows and headers
func (w *Worker) parseFile(filename string, content []byte) ([][]string, []string, error) {
	lower := strings.ToLower(filename)
	log.Printf("DEBUG parseFile: filename=%s, lower=%s, size=%d bytes", filename, lower, len(content))

	if strings.HasSuffix(lower, ".csv") || strings.HasSuffix(lower, ".tsv") {
		log.Printf("DEBUG parseFile: Routing to parseCSV (isTSV=%v)", strings.HasSuffix(lower, ".tsv"))
		return w.parseCSV(content, strings.HasSuffix(lower, ".tsv"))
	}

	if strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls") {
		log.Printf("DEBUG parseFile: Routing to parseExcel")
		return w.parseExcel(content)
	}

	return nil, nil, fmt.Errorf("unsupported file type: %s", filename)
}

// parseCSV parses CSV or TSV content
func (w *Worker) parseCSV(content []byte, isTSV bool) ([][]string, []string, error) {
	reader := csv.NewReader(bytes.NewReader(content))

	// Configure reader
	if isTSV {
		reader.Comma = '\t'
	}
	reader.LazyQuotes = true
	reader.TrimLeadingSpace = true
	reader.ReuseRecord = false // Important for data integrity

	// Read all rows
	allRows, err := reader.ReadAll()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse CSV: %w", err)
	}

	if len(allRows) == 0 {
		return nil, nil, fmt.Errorf("empty CSV file")
	}

	// First row is headers
	headers := allRows[0]

	// Normalize headers
	for i, header := range headers {
		headers[i] = normalizeColumnName(header)
	}

	// Remaining rows are data
	rows := allRows[1:]

	// Ensure all rows have the same number of columns
	for i, row := range rows {
		if len(row) < len(headers) {
			// Pad with empty strings
			for j := len(row); j < len(headers); j++ {
				rows[i] = append(rows[i], "")
			}
		}
	}

	return rows, headers, nil
}

// parseExcel parses Excel content
func (w *Worker) parseExcel(content []byte) ([][]string, []string, error) {
	// Open Excel file from bytes
	f, err := excelize.OpenReader(bytes.NewReader(content))
	if err != nil {
		return nil, nil, fmt.Errorf("failed to open Excel file: %w", err)
	}
	defer f.Close()

	// Get all sheets
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, nil, fmt.Errorf("no sheets in Excel file")
	}

	log.Printf("DEBUG: Found %d sheets: %v", len(sheets), sheets)

	// Skip metadata sheets and find the data sheet
	// Common metadata sheet names to skip
	skipSheets := map[string]bool{
		"info":     true,
		"metadata": true,
		"about":    true,
		"readme":   true,
		"notes":    true,
	}

	var sheetName string
	for _, sheet := range sheets {
		lowerName := strings.ToLower(sheet)
		log.Printf("DEBUG: Checking sheet '%s' (lower: '%s'), skip=%v", sheet, lowerName, skipSheets[lowerName])
		if !skipSheets[lowerName] {
			sheetName = sheet
			break
		}
	}

	// If all sheets are metadata, use the last one (likely has data)
	if sheetName == "" {
		sheetName = sheets[len(sheets)-1]
		log.Printf("DEBUG: All sheets were metadata, using last: %s", sheetName)
	}

	log.Printf("DEBUG: Selected sheet: %s", sheetName)

	// Get all rows from the sheet
	allRows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read Excel rows: %w", err)
	}

	if len(allRows) == 0 {
		return nil, nil, fmt.Errorf("empty Excel file")
	}

	// First row is headers
	headers := allRows[0]

	// Normalize headers
	for i, header := range headers {
		headers[i] = normalizeColumnName(header)
	}

	// Remaining rows are data
	rows := allRows[1:]

	// Ensure all rows have the same number of columns as headers
	for i, row := range rows {
		if len(row) < len(headers) {
			// Pad with empty strings
			for j := len(row); j < len(headers); j++ {
				rows[i] = append(rows[i], "")
			}
		} else if len(row) > len(headers) {
			// Trim extra columns
			rows[i] = row[:len(headers)]
		}
	}

	return rows, headers, nil
}

// normalizeColumnName standardizes column names
func normalizeColumnName(name string) string {
	// Trim whitespace
	name = strings.TrimSpace(name)

	// Replace multiple spaces with single space
	name = strings.Join(strings.Fields(name), " ")

	// Convert to uppercase for consistency
	name = strings.ToUpper(name)

	// Replace common variations
	replacements := map[string]string{
		"VESSEL NAME":   "VESSEL_NAME",
		"VESSEL-NAME":   "VESSEL_NAME",
		"IMO NUMBER":    "IMO",
		"IMO NO":        "IMO",
		"IMO NO.":       "IMO",
		"CALL SIGN":     "CALL_SIGN",
		"CALLSIGN":      "CALL_SIGN",
		"FLAG STATE":    "FLAG",
		"FLAG-STATE":    "FLAG",
		"GROSS TONNAGE": "GROSS_TONNAGE",
		"GT":            "GROSS_TONNAGE",
		"YEAR BUILT":    "YEAR_BUILT",
		"BUILD YEAR":    "YEAR_BUILT",
	}

	for pattern, replacement := range replacements {
		if name == pattern {
			name = replacement
		}
	}

	return name
}

// downloadFile downloads a file from S3 or presigned URL
func (w *Worker) downloadFile(ctx context.Context, fileURL string) ([]byte, error) {
	// Check if it's a presigned URL or S3 path
	if strings.HasPrefix(fileURL, "http://") || strings.HasPrefix(fileURL, "https://") {
		return w.downloadFromURL(ctx, fileURL)
	}

	// Parse S3 path (s3://bucket/key or just key)
	bucket, key := w.parseS3Path(fileURL)
	return w.downloadFromS3(ctx, bucket, key)
}

// downloadFromURL downloads from a presigned URL
func (w *Worker) downloadFromURL(ctx context.Context, url string) ([]byte, error) {
	// Use AWS SDK's HTTP client for consistency
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed with status %d", resp.StatusCode)
	}

	// Limit file size to 100MB
	limitedReader := io.LimitReader(resp.Body, 100*1024*1024)
	content, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read file content: %w", err)
	}

	return content, nil
}

// downloadFromS3 downloads directly from S3
func (w *Worker) downloadFromS3(ctx context.Context, bucket, key string) ([]byte, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	}

	result, err := w.s3Client.GetObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to get S3 object: %w", err)
	}
	defer result.Body.Close()

	// Limit file size to 100MB
	limitedReader := io.LimitReader(result.Body, 100*1024*1024)
	content, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read S3 object: %w", err)
	}

	return content, nil
}

// parseS3Path parses an S3 path into bucket and key
func (w *Worker) parseS3Path(path string) (string, string) {
	// Handle s3://bucket/key format
	if strings.HasPrefix(path, "s3://") {
		path = strings.TrimPrefix(path, "s3://")
		parts := strings.SplitN(path, "/", 2)
		if len(parts) == 2 {
			return parts[0], parts[1]
		}
		return parts[0], ""
	}

	// Otherwise assume it's just a key in the configured bucket
	return w.config.S3Bucket, path
}
