package main

import (
	"bytes"
	"errors"
	"log"
	"net/http"
	"strings"
	"testing"
	"time"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := log.Writer()
	flags := log.Flags()
	log.SetOutput(buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(prev)
		log.SetFlags(flags)
	})
	return buf
}

func TestSkipHTTPLog(t *testing.T) {
	req := func(method, path string) *http.Request {
		r, err := http.NewRequest(method, path, nil)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	if !skipHTTPLog(req(http.MethodOptions, "/api/v1/records"), 204) {
		t.Fatal("OPTIONS should skip")
	}
	if !skipHTTPLog(req(http.MethodGet, "/api/v1/health"), 200) {
		t.Fatal("health 200 should skip")
	}
	if skipHTTPLog(req(http.MethodGet, "/api/v1/health"), 500) {
		t.Fatal("health 500 should log")
	}
	if !skipHTTPLog(req(http.MethodGet, "/api/v1/uploads/a.mp4"), 200) {
		t.Fatal("media GET 200 should skip")
	}
	if skipHTTPLog(req(http.MethodGet, "/api/v1/uploads/a.mp4"), 404) {
		t.Fatal("media GET 404 should log")
	}
	if skipHTTPLog(req(http.MethodGet, "/api/v1/records"), 200) {
		t.Fatal("API GET should log")
	}
	if !skipHTTPLog(req(http.MethodGet, "/assets/app.js"), 200) {
		t.Fatal("static 200 should skip")
	}
}

func TestFmtHTTPLogIncludesCause(t *testing.T) {
	got := fmtHTTPLog("POST", "/api/v1/records?babyId=x", 500, 12*time.Millisecond, "u1", "Server error", errors.New("UNIQUE constraint"))
	for _, want := range []string{`POST /api/v1/records?babyId=x`, `status=500`, `user=u1`, `msg="Server error"`, `UNIQUE constraint`} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %s", want, got)
		}
	}
}

func TestHTTPLoggerLogsAPIAndSkipsHealth(t *testing.T) {
	s := newTestServer(t)
	buf := captureLogs(t)

	health := s.do(http.MethodGet, "/health", "", nil)
	if health.status != http.StatusOK {
		t.Fatalf("health status=%d", health.status)
	}

	unauth := s.do(http.MethodGet, "/auth/me", "", nil)
	if unauth.status != http.StatusUnauthorized {
		t.Fatalf("me unauth status=%d", unauth.status)
	}

	uid := insertUser(t, "logger", "Logger", "user")
	me := s.do(http.MethodGet, "/auth/me", uid, nil)
	if me.status != http.StatusOK {
		t.Fatalf("me status=%d body=%s", me.status, string(me.body))
	}

	out := buf.String()
	if strings.Contains(out, "/api/v1/health") {
		t.Fatalf("health probe should not be logged: %s", out)
	}
	if !strings.Contains(out, "GET /api/v1/auth/me status=401") {
		t.Fatalf("expected 401 access log, got %s", out)
	}
	if !strings.Contains(out, `msg="Unauthorized"`) {
		t.Fatalf("expected client error message, got %s", out)
	}
	if !strings.Contains(out, "GET /api/v1/auth/me status=200") {
		t.Fatalf("expected 200 access log, got %s", out)
	}
	if !strings.Contains(out, "user="+tokenToUserID(uid)) {
		t.Fatalf("expected authenticated user id, got %s", out)
	}
}

func TestHTTPLoggerLogsValidationError(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "logger2", "Logger", "user")
	buf := captureLogs(t)
	res := s.do(http.MethodGet, "/records/", uid, nil)
	if res.status != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.status, string(res.body))
	}
	out := buf.String()
	if !strings.Contains(out, "GET /api/v1/records/ status=400") {
		t.Fatalf("expected 400 log, got %s", out)
	}
	if !strings.Contains(out, `msg="Required"`) {
		t.Fatalf("expected validation msg, got %s", out)
	}
}
