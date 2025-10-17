package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"time"
)

// DocumentExtractionClient handles communication with document-extraction-service
type DocumentExtractionClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

// ExtractionResult represents the response from document-extraction-service
type ExtractionResult struct {
	Text      string `json:"text"`
	Format    string `json:"format"`
	Pages     *int   `json:"pages,omitempty"`
	WordCount int    `json:"word_count"`
	CharCount int    `json:"char_count"`
	Error     string `json:"error,omitempty"`
}

// NewDocumentExtractionClient creates a new client for document extraction
func NewDocumentExtractionClient(baseURL string) *DocumentExtractionClient {
	return &DocumentExtractionClient{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second, // Documents can take time to process
		},
	}
}

// ExtractFromBytes extracts text from document bytes
func (c *DocumentExtractionClient) ExtractFromBytes(fileBytes []byte, filename string) (*ExtractionResult, error) {
	// Create multipart form data
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}

	_, err = part.Write(fileBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to write file data: %w", err)
	}

	err = writer.Close()
	if err != nil {
		return nil, fmt.Errorf("failed to close writer: %w", err)
	}

	// Make HTTP request
	url := fmt.Sprintf("%s/extract", c.BaseURL)
	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	log.Printf("Calling document-extraction-service for %s (%d bytes)", filename, len(fileBytes))
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call extraction service: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("extraction service error: %s (status: %d)", string(bodyBytes), resp.StatusCode)
	}

	// Parse response
	var result ExtractionResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode extraction result: %w", err)
	}

	log.Printf("Extracted %d words, %d chars from %s", result.WordCount, result.CharCount, filename)
	return &result, nil
}

// Health checks if the document extraction service is healthy
func (c *DocumentExtractionClient) Health() error {
	url := fmt.Sprintf("%s/health", c.BaseURL)
	resp, err := c.HTTPClient.Get(url)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check returned status %d", resp.StatusCode)
	}

	return nil
}
