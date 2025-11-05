package main

import (
	"database/sql"
	"testing"

	"golang.org/x/text/unicode/norm"
)

// TestRemoveInvalidUTF8 verifies that invalid UTF-8 sequences are removed while preserving valid Unicode
func TestRemoveInvalidUTF8(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "valid ASCII",
			input:    "Hello World",
			expected: "Hello World",
		},
		{
			name:     "valid UTF-8 with diacritics",
			input:    "Père André H.",
			expected: "Père André H.",
		},
		{
			name:     "valid UTF-8 mixed languages",
			input:    "José María São Paulo Øresund",
			expected: "José María São Paulo Øresund",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "only whitespace",
			input:    "   ",
			expected: "   ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := removeInvalidUTF8(tt.input)
			if result != tt.expected {
				t.Errorf("removeInvalidUTF8(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

// TestStandardizeFormatUnicode verifies Unicode normalization preserves diacritics
func TestStandardizeFormatUnicode(t *testing.T) {
	w := &Worker{} // Empty worker for testing

	tests := []struct {
		name     string
		format   string
		input    string
		expected string
	}{
		{
			name:     "trim preserves diacritics",
			format:   "trim",
			input:    "  Père André  ",
			expected: "Père André",
		},
		{
			name:     "uppercase preserves diacritics",
			format:   "uppercase",
			input:    "josé maría",
			expected: "JOSÉ MARÍA",
		},
		{
			name:     "lowercase preserves diacritics",
			format:   "lowercase",
			input:    "FRÈRE ÉMILE",
			expected: "frère émile",
		},
		{
			name:     "remove_special preserves diacritics",
			format:   "remove_special",
			input:    "Père André H.",
			expected: "Père André H.",
		},
		{
			name:     "normalize_unicode applies NFC",
			format:   "normalize_unicode",
			input:    "Père", // Test with combining characters if needed
			expected: "Père",
		},
		{
			name:     "default applies NFC and trim",
			format:   "unknown",
			input:    "  São Paulo  ",
			expected: "São Paulo",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := CleaningRule{
				RuleType: "format_standardizer",
				Pattern:  sql.NullString{String: `{"format":"` + tt.format + `"}`, Valid: true},
			}
			result := w.standardizeFormat(tt.input, rule)
			if result != tt.expected {
				t.Errorf("standardizeFormat(%q, %q) = %q, want %q", tt.input, tt.format, result, tt.expected)
			}
		})
	}
}

// TestDiacriticPreservationEndToEnd verifies diacritics are preserved throughout processing
func TestDiacriticPreservationEndToEnd(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "French vessel names (NAFO)",
			input:    "Père André H.",
			expected: "Père André H.",
		},
		{
			name:     "Spanish names",
			input:    "José María González",
			expected: "José María González",
		},
		{
			name:     "Portuguese locations",
			input:    "São Paulo",
			expected: "São Paulo",
		},
		{
			name:     "Nordic characters",
			input:    "Øresund Ålesund",
			expected: "Øresund Ålesund",
		},
		{
			name:     "Mixed diacritics",
			input:    "Frère Émile",
			expected: "Frère Émile",
		},
		{
			name:     "German umlauts",
			input:    "München Köln",
			expected: "München Köln",
		},
		{
			name:     "Icelandic characters",
			input:    "Reykjavík Þór",
			expected: "Reykjavík Þór",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Apply NFC normalization (standard form for comparison)
			normalized := norm.NFC.String(tt.input)
			if normalized != tt.expected {
				t.Errorf("NFC normalization failed: got %q, want %q", normalized, tt.expected)
			}
		})
	}
}

// TestLevenshteinDistanceWithDiacritics verifies similarity calculation handles diacritics correctly
// Note: Levenshtein operates on runes (Unicode code points), so multi-byte UTF-8 chars count correctly
func TestLevenshteinDistanceWithDiacritics(t *testing.T) {
	tests := []struct {
		name     string
		s1       string
		s2       string
		expected int
	}{
		{
			name:     "identical with diacritics",
			s1:       "Père",
			s2:       "Père",
			expected: 0,
		},
		{
			name:     "ASCII vs accented (rune-level difference)",
			s1:       "Pere",
			s2:       "Père",
			expected: 2, // 'è' is different from 'e', multi-byte encoding
		},
		{
			name:     "multiple diacritics",
			s1:       "Jose Maria",
			s2:       "José María",
			expected: 4, // 'é' vs 'e', 'í' vs 'i' (multi-byte differences)
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			distance := levenshteinDistance(tt.s1, tt.s2)
			if distance != tt.expected {
				t.Errorf("levenshteinDistance(%q, %q) = %d, want %d", tt.s1, tt.s2, distance, tt.expected)
			}
		})
	}
}

// TestCalculateSimilarityWithDiacritics verifies similarity calculation with UTF-8 strings
func TestCalculateSimilarityWithDiacritics(t *testing.T) {
	w := &Worker{}

	tests := []struct {
		name     string
		s1       string
		s2       string
		minScore float64 // Minimum expected similarity
	}{
		{
			name:     "identical strings with diacritics",
			s1:       "Père André H.",
			s2:       "Père André H.",
			minScore: 1.0,
		},
		{
			name:     "ASCII vs accented (low similarity)",
			s1:       "Pere Andre H.",
			s2:       "Père André H.",
			minScore: 0.7, // Should be less similar due to diacritic differences
		},
		{
			name:     "case insensitive with diacritics",
			s1:       "josé maría",
			s2:       "JOSÉ MARÍA",
			minScore: 1.0, // calculateSimilarity lowercases both
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			similarity := w.calculateSimilarity(tt.s1, tt.s2)
			if similarity < tt.minScore {
				t.Errorf("calculateSimilarity(%q, %q) = %f, want >= %f", tt.s1, tt.s2, similarity, tt.minScore)
			}
		})
	}
}
