package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// uploadDoclingTablesToS3 uploads extracted tables to S3 and returns uploaded keys
func uploadDoclingTablesToS3(ctx context.Context, s3Client *s3.Client, bucket string, projectID, taskID int64, tables []DoclingTable) ([]string, error) {
	if s3Client == nil {
		return nil, fmt.Errorf("s3 client not initialized")
	}

	uploadedKeys := make([]string, 0, len(tables))

	for i, table := range tables {
		// Generate S3 key for this table
		s3Key := fmt.Sprintf("docling-tables/%d/%d-table-%d.csv", projectID, taskID, i)

		// Convert table to CSV bytes
		csvBytes, err := tableToCSV(table)
		if err != nil {
			return nil, fmt.Errorf("failed to convert table %d to CSV: %w", i, err)
		}

		// Upload to S3
		_, err = s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(bucket),
			Key:         aws.String(s3Key),
			Body:        bytes.NewReader(csvBytes),
			ContentType: aws.String("text/csv"),
			Metadata: map[string]string{
				"source":       "docling-triton",
				"project-id":   fmt.Sprintf("%d", projectID),
				"task-id":      fmt.Sprintf("%d", taskID),
				"table-num":    fmt.Sprintf("%d", i),
				"extracted-at": time.Now().UTC().Format(time.RFC3339),
			},
		})
		if err != nil {
			return nil, fmt.Errorf("failed to upload table %d to S3: %w", i, err)
		}

		log.Printf("Uploaded Docling table %d to s3://%s/%s (%d bytes)", i, bucket, s3Key, len(csvBytes))
		uploadedKeys = append(uploadedKeys, s3Key)
	}

	return uploadedKeys, nil
}

// tableToCSV converts a DoclingTable to CSV bytes
func tableToCSV(table DoclingTable) ([]byte, error) {
	buf := &bytes.Buffer{}
	writer := csv.NewWriter(buf)

	// Write headers
	if len(table.Headers) > 0 {
		if err := writer.Write(table.Headers); err != nil {
			return nil, fmt.Errorf("failed to write CSV headers: %w", err)
		}
	}

	// Write rows
	for _, row := range table.Rows {
		if err := writer.Write(row); err != nil {
			return nil, fmt.Errorf("failed to write CSV row: %w", err)
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, fmt.Errorf("CSV writer error: %w", err)
	}

	return buf.Bytes(), nil
}

// triggerCSVWorkerWebhook sends a signed webhook to csv-ingestion-worker for each uploaded table
func triggerCSVWorkerWebhook(cfg *Config, taskID, projectID int64, s3Keys []string) error {
	if cfg.WebhookSecret == "" {
		return fmt.Errorf("webhook secret not configured")
	}

	client := &http.Client{Timeout: 10 * time.Second}

	for _, s3Key := range s3Keys {
		// Construct webhook payload matching csv-ingestion-worker expectations
		payload := map[string]interface{}{
			"action": "TASK_CREATED",
			"task": map[string]interface{}{
				"id":      taskID,
				"project": projectID,
				"data": map[string]interface{}{
					"file_upload": fmt.Sprintf("s3://%s/%s", cfg.S3Bucket, s3Key),
					"meta": map[string]interface{}{
						"source_type": "docling-triton",
						"source_name": "triton-docling-model",
						"doc_type":    "extracted-table",
					},
				},
			},
		}

		// Marshal payload
		body, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal webhook payload: %w", err)
		}

		// Sign payload with HMAC-SHA256 (matches csv-ingestion-worker verification)
		mac := hmac.New(sha256.New, []byte(cfg.WebhookSecret))
		mac.Write(body)
		signature := hex.EncodeToString(mac.Sum(nil))

		// Create HTTP request
		req, err := http.NewRequest("POST", cfg.CSVWorkerWebhookURL, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("failed to create webhook request: %w", err)
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Label-Studio-Signature", signature)

		// Send request
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("failed to send webhook for %s: %w", s3Key, err)
		}
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
			return fmt.Errorf("webhook returned status %d for %s", resp.StatusCode, s3Key)
		}

		log.Printf("Triggered CSV worker webhook for %s (task %d, project %d)", s3Key, taskID, projectID)
	}

	return nil
}
