package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
)

// DoclingTable represents an extracted table from a document
type DoclingTable struct {
	TableNum int        `json:"table_num"`
	Headers  []string   `json:"headers"`
	Rows     [][]string `json:"rows"`
}

// DoclingResult represents the extraction result from Triton Docling model
type DoclingResult struct {
	Text      string         `json:"text"`
	Tables    []DoclingTable `json:"tables"`
	Formulas  []string       `json:"formulas,omitempty"`
	Pages     int            `json:"pages"`
	WordCount int            `json:"word_count"`
	CharCount int            `json:"char_count"`
}

// TritonDoclingClient handles communication with Triton Docling model
type TritonDoclingClient struct {
	cfg *Config // Full config for makeTritonRequest (preserves CF Access headers)
}

// NewTritonDoclingClient creates a new Triton Docling client
func NewTritonDoclingClient(cfg *Config) *TritonDoclingClient {
	return &TritonDoclingClient{
		cfg: cfg,
	}
}

// ExtractFromPDF extracts text, tables, and formulas from PDF bytes using Triton Docling model
func (c *TritonDoclingClient) ExtractFromPDF(pdfBytes []byte) (*DoclingResult, error) {
	// Encode PDF bytes to base64 string (Triton TYPE_BYTES serialization)
	pdfB64 := base64.StdEncoding.EncodeToString(pdfBytes)

	// Prepare Triton inputs (TYPE_BYTES must be base64 strings)
	inputs := []TritonTensor{
		{
			Name:     "pdf_data",
			DataType: "BYTES",
			Shape:    []int{1},
			Data:     []string{pdfB64}, // Base64 string, not raw bytes
		},
		{
			Name:     "text",
			DataType: "BYTES",
			Shape:    []int{1},
			Data:     []string{""}, // Empty for PDF input
		},
	}

	log.Printf("Calling Triton Docling model for PDF (%d bytes)", len(pdfBytes))

	// Call Triton with full config (preserves CF Access headers)
	resp, err := makeTritonRequest(c.cfg, "docling_granite_python", inputs)
	if err != nil {
		return nil, fmt.Errorf("triton docling request failed: %w", err)
	}

	// Parse response (TYPE_BYTES output is base64-encoded string)
	if len(resp.Outputs) == 0 {
		return nil, fmt.Errorf("no outputs in triton response")
	}

	output := resp.Outputs[0]
	responseData, ok := output["data"].([]interface{})
	if !ok {
		return nil, fmt.Errorf("unexpected output data type: %T", output["data"])
	}

	if len(responseData) == 0 {
		return nil, fmt.Errorf("empty output data")
	}

	// Decode base64 response string
	responseB64, ok := responseData[0].(string)
	if !ok {
		return nil, fmt.Errorf("unexpected response data element type: %T", responseData[0])
	}

	responseBytes, err := base64.StdEncoding.DecodeString(responseB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode base64 response: %w", err)
	}

	// Parse JSON result
	var result DoclingResult
	if err := json.Unmarshal(responseBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to parse docling result: %w", err)
	}

	log.Printf("Docling extracted %d words, %d tables, %d formulas from PDF",
		result.WordCount, len(result.Tables), len(result.Formulas))

	return &result, nil
}
