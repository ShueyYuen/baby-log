package main

import (
	"net/http"
	"testing"
)

func TestOCRStatusReportsAvailability(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	r := s.do(http.MethodGet, "/ocr/status", uid, nil)
	e := mustOK(t, r)
	var data struct {
		Available bool `json:"available"`
	}
	jsonUnmarshal(e.Data, &data)
	if data.Available != isOCRAvailable() {
		t.Fatalf("status mismatch: payload=%v helper=%v", data.Available, isOCRAvailable())
	}
}

func TestOCRRecognizeUnavailable(t *testing.T) {
	if isOCRAvailable() {
		t.Skip("OCR credentials are configured in this environment")
	}
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	r := s.do(http.MethodPost, "/ocr/recognize", uid, map[string]interface{}{
		"images": []map[string]string{{"key": "x"}},
	})
	if r.status != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when OCR is not configured, got %d", r.status)
	}
}
