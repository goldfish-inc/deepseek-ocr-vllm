package main

import (
	"encoding/json"
	"testing"
)

func TestValidateAnnotation_NER_Valid(t *testing.T) {
	payload := WebhookPayload{
		Action: "ANNOTATION_CREATED",
		Annotation: map[string]interface{}{
			"result": []interface{}{
				map[string]interface{}{
					"type": "labels",
					"value": map[string]interface{}{
						"start": 0.0, "end": 5.0, "labels": []interface{}{"VESSEL"},
					},
				},
			},
		},
		Task: map[string]interface{}{
			"id":   1,
			"data": map[string]interface{}{"text": "TITAN sails", "vertical": "maritime"},
		},
		Project: map[string]interface{}{"id": 1, "title": "NER Maritime"},
	}
	ok, _ := validateAnnotation(payload)
	if !ok {
		b, _ := json.Marshal(payload)
		t.Fatalf("expected valid NER payload, got invalid for %s", string(b))
	}
}

func TestValidateAnnotation_NER_Invalid_NoSpans(t *testing.T) {
	payload := WebhookPayload{
		Action:     "ANNOTATION_CREATED",
		Annotation: map[string]interface{}{"result": []interface{}{}},
		Task:       map[string]interface{}{"id": 2, "data": map[string]interface{}{"text": "no spans"}},
		Project:    map[string]interface{}{"id": 1},
	}
	ok, _ := validateAnnotation(payload)
	if ok {
		t.Fatalf("expected invalid NER payload when no spans present")
	}
}

func TestValidateAnnotation_Docling_Valid(t *testing.T) {
	payload := WebhookPayload{
		Action: "ANNOTATION_CREATED",
		Annotation: map[string]interface{}{
			"result": []interface{}{
				map[string]interface{}{
					"type": "rectanglelabels",
					"value": map[string]interface{}{
						"x": 10.0, "y": 10.0, "width": 20.0, "height": 10.0,
						"labels": []interface{}{"TABLE"},
					},
				},
			},
		},
		Task:    map[string]interface{}{"id": 3, "data": map[string]interface{}{"text": "irrelevant", "vertical": "maritime"}},
		Project: map[string]interface{}{"id": 2, "title": "Docling Maritime"},
	}
	ok, _ := validateAnnotation(payload)
	if !ok {
		t.Fatalf("expected valid Docling payload")
	}
}

func TestValidateAnnotation_Docling_Invalid_NoDims(t *testing.T) {
	payload := WebhookPayload{
		Action: "ANNOTATION_CREATED",
		Annotation: map[string]interface{}{
			"result": []interface{}{
				map[string]interface{}{
					"type":  "rectanglelabels",
					"value": map[string]interface{}{"labels": []interface{}{"TABLE"}},
				},
			},
		},
		Task:    map[string]interface{}{"id": 4, "data": map[string]interface{}{"text": "irrelevant"}},
		Project: map[string]interface{}{"id": 2},
	}
	ok, _ := validateAnnotation(payload)
	if ok {
		t.Fatalf("expected invalid Docling payload when no geometry present")
	}
}

func TestValidateAnnotation_Unknown_Allows(t *testing.T) {
	payload := WebhookPayload{
		Action: "ANNOTATION_CREATED",
		Annotation: map[string]interface{}{
			"result": []interface{}{
				map[string]interface{}{
					"type":  "rating",
					"value": map[string]interface{}{"rating": 5.0},
				},
			},
		},
		Task:    map[string]interface{}{"id": 5, "data": map[string]interface{}{"text": "N/A"}},
		Project: map[string]interface{}{"id": 3},
	}
	ok, _ := validateAnnotation(payload)
	if !ok {
		t.Fatalf("expected unknown type to be allowed (noop)")
	}
}

func TestParseS3FromURL(t *testing.T) {
	// virtual hosted style
	b, k, v := parseS3FromURL("https://mybucket.s3.amazonaws.com/path/to/file.pdf?versionId=abc123")
	if b != "mybucket" || k != "path/to/file.pdf" || v != "abc123" {
		t.Fatalf("unexpected parse result: %s %s %s", b, k, v)
	}
	// path style
	b, k, v = parseS3FromURL("https://s3.amazonaws.com/other-bucket/docs/report.pdf")
	if b != "other-bucket" || k != "docs/report.pdf" || v != "" {
		t.Fatalf("unexpected parse result: %s %s %s", b, k, v)
	}
}
