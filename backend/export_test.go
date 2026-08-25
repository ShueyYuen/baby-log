package main

import (
	"net/http"
	"testing"
)

func TestExportBabyData(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	createRecord(t, s, uid, bid, "feeding", "bottle",
		map[string]interface{}{"amountMl": 90}, "2025-06-01T08:00:00.000Z")

	e := mustOK(t, s.do(http.MethodGet, "/export?babyId="+bid, uid, nil))
	var data struct {
		Baby struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"baby"`
		Records []recordOut `json:"records"`
	}
	jsonUnmarshal(e.Data, &data)
	if data.Baby.ID != bid || data.Baby.Name != "宝宝" {
		t.Fatalf("baby payload wrong: %+v", data.Baby)
	}
	if len(data.Records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(data.Records))
	}

	other := insertUser(t, "other", "Other", "user")
	denied := s.do(http.MethodGet, "/export?babyId="+bid, other, nil)
	if denied.status != http.StatusForbidden {
		t.Fatalf("non-member expected 403, got %d", denied.status)
	}

	missing := s.do(http.MethodGet, "/export", uid, nil)
	if missing.status != http.StatusBadRequest {
		t.Fatalf("missing babyId expected 400, got %d", missing.status)
	}
}
