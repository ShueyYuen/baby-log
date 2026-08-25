package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIdempotentCreateRecordReplaysCachedResponse(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	body := map[string]interface{}{
		"babyId": bid, "category": "feeding", "type": "bottle",
		"data": map[string]interface{}{"amountMl": 100}, "occurredAt": "2026-08-01T08:00:00.000Z",
	}

	r1 := doWithIdempotency(s, http.MethodPost, "/records/", uid, "key-1", body)
	e1 := mustOK(t, r1)
	var rec1 recordOut
	jsonUnmarshal(e1.Data, &rec1)
	if rec1.ID == "" {
		t.Fatal("missing id")
	}

	r2 := doWithIdempotency(s, http.MethodPost, "/records/", uid, "key-1", body)
	if r2.status != http.StatusOK {
		t.Fatalf("replay expected 200, got %d %s", r2.status, string(r2.body))
	}
	if r2.header.Get("X-Idempotent-Replayed") != "true" {
		t.Fatalf("expected replay header, got %v", r2.header)
	}
	e2 := r2.envelope(t)
	var rec2 recordOut
	jsonUnmarshal(e2.Data, &rec2)
	if rec2.ID != rec1.ID {
		t.Fatalf("replay should return the original record, got %s vs %s", rec2.ID, rec1.ID)
	}

	list := s.do(http.MethodGet, "/records/?babyId="+bid, uid, nil)
	le := mustOK(t, list)
	items := extractItems(le.Data)
	var recs []recordOut
	json.Unmarshal(items, &recs)
	if len(recs) != 1 {
		t.Fatalf("idempotent replay must not create a second record, got %d", len(recs))
	}
}

func TestIdempotencyIsScopedPerUser(t *testing.T) {
	s := newTestServer(t)
	u1 := insertUser(t, "u1", "U1", "user")
	u2 := insertUser(t, "u2", "U2", "user")
	bid := createBabyFor(t, u1, "宝宝")
	_ = ensureAllMemberships()
	body := map[string]interface{}{
		"babyId": bid, "category": "nursing", "type": "diaper",
		"data": map[string]interface{}{"type": "wet"}, "occurredAt": "2026-08-01T08:00:00.000Z",
	}
	r1 := doWithIdempotency(s, http.MethodPost, "/records/", u1, "shared-key", body)
	mustOK(t, r1)
	r2 := doWithIdempotency(s, http.MethodPost, "/records/", u2, "shared-key", body)
	mustOK(t, r2)
	e1 := r1.envelope(t)
	e2 := r2.envelope(t)
	var a, b recordOut
	jsonUnmarshal(e1.Data, &a)
	jsonUnmarshal(e2.Data, &b)
	if a.ID == b.ID {
		t.Fatalf("different users should not share idempotency keys")
	}
}

func TestCleanupIdempotencyKeys(t *testing.T) {
	setupTestDB(t)
	if _, err := db.Exec(`INSERT INTO "IdempotencyKey" (key, userId, statusCode, responseBody, contentType, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
		"old", "u", 200, "{}", "application/json", int64(0)); err != nil {
		t.Fatal(err)
	}
	cleanupIdempotencyKeys()
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM "IdempotencyKey"`).Scan(&n)
	if n != 0 {
		t.Fatalf("expected expired keys to be deleted, got %d", n)
	}
}

func doWithIdempotency(s *testServer, method, path, token, key string, body interface{}) resp {
	s.t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		s.t.Fatal(err)
	}
	req := httptest.NewRequest(method, apiPrefix+path, bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Idempotency-Key", key)
	return s.rawRequest(req)
}
