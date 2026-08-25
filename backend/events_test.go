package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSSEDeliversEventsFromOtherUsers(t *testing.T) {
	s := newTestServer(t)
	a := insertUser(t, "a", "A", "user")
	b := insertUser(t, "b", "B", "user")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, apiPrefix+"/events", nil)
	req = req.WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+a)
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		s.handler.ServeHTTP(rec, req)
		close(done)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(rec.Body.String(), "connected") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	publishEvent(DataEvent{Type: EventRecordCreated, BabyID: "baby", ID: "rec-1", UserID: tokenToUserID(a)})
	publishEvent(DataEvent{Type: EventRecordCreated, BabyID: "baby", ID: "rec-2", UserID: tokenToUserID(b)})

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(rec.Body.String(), "rec-2") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("SSE handler did not exit")
	}

	body := rec.Body.String()
	if !strings.Contains(body, "connected") {
		t.Fatalf("missing connected keepalive: %q", body)
	}
	if strings.Contains(body, "rec-1") {
		t.Fatalf("should skip events from the same user: %q", body)
	}
	if !strings.Contains(body, "rec-2") || !strings.Contains(body, "record.created") {
		t.Fatalf("missing event from other user: %q", body)
	}
}
