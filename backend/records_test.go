package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func createRecord(t *testing.T, s *testServer, token, babyID, category, typ string, data map[string]interface{}, occurredAt string) recordOut {
	t.Helper()
	body := map[string]interface{}{
		"babyId":     babyID,
		"category":   category,
		"type":       typ,
		"data":       data,
		"occurredAt": occurredAt,
	}
	r := s.do(http.MethodPost, "/records/", token, body)
	e := mustOK(t, r)
	var rec recordOut
	jsonUnmarshal(e.Data, &rec)
	return rec
}

func TestCreateRecord(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	rec := createRecord(t, s, uid, bid, "feeding", "bottle",
		map[string]interface{}{"amountMl": 120}, "2025-06-01T08:00:00.000Z")
	if rec.Category != "feeding" || rec.Type != "bottle" {
		t.Fatalf("wrong record: %+v", rec)
	}
	if rec.OccurredAt != Millis(1748764800000) {
		t.Errorf("occurredAt got %d", int64(rec.OccurredAt))
	}
	// images 应为非 nil 空数组
	if rec.Images == nil {
		t.Errorf("images should be non-nil empty slice")
	}
	var dm map[string]interface{}
	json.Unmarshal(rec.Data, &dm)
	if dm["amountMl"].(float64) != 120 {
		t.Errorf("data.amountMl wrong: %v", dm["amountMl"])
	}
}

func TestCreateRecordInvalidCategory(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	r := s.do(http.MethodPost, "/records/", uid, map[string]interface{}{
		"babyId": bid, "category": "invalid", "type": "x",
		"data": map[string]interface{}{"a": 1}, "occurredAt": "2025-06-01T08:00:00.000Z",
	})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", r.status)
	}
}

func TestCreateRecordPermission(t *testing.T) {
	s := newTestServer(t)
	owner := insertUser(t, "owner", "Owner", "user")
	bid := createBabyFor(t, owner, "宝宝")
	other := insertUser(t, "other", "Other", "user") // 非成员

	r := s.do(http.MethodPost, "/records/", other, map[string]interface{}{
		"babyId": bid, "category": "feeding", "type": "bottle",
		"data": map[string]interface{}{"amountMl": 100}, "occurredAt": "2025-06-01T08:00:00.000Z",
	})
	if r.status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", r.status)
	}
}

func TestListRecordsFiltersAndPagination(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	createRecord(t, s, uid, bid, "feeding", "bottle", map[string]interface{}{"amountMl": 100}, "2025-06-01T08:00:00.000Z")
	createRecord(t, s, uid, bid, "feeding", "breastfeed", map[string]interface{}{"leftMinutes": 10}, "2025-06-01T10:00:00.000Z")
	createRecord(t, s, uid, bid, "nursing", "diaper", map[string]interface{}{"type": "wet"}, "2025-06-01T12:00:00.000Z")

	// babyId 缺失 -> 400
	if r := s.do(http.MethodGet, "/records/", uid, nil); r.status != http.StatusBadRequest {
		t.Fatalf("missing babyId expected 400, got %d", r.status)
	}

	// 全部
	e := mustOK(t, s.do(http.MethodGet, "/records/?babyId="+bid, uid, nil))
	var page struct {
		Items    []recordOut `json:"items"`
		Total    int         `json:"total"`
		Page     int         `json:"page"`
		PageSize int         `json:"pageSize"`
		HasMore  bool        `json:"hasMore"`
	}
	jsonUnmarshal(e.Data, &page)
	if page.Total != 3 || len(page.Items) != 3 {
		t.Fatalf("expected 3 records, got total=%d len=%d", page.Total, len(page.Items))
	}
	// 排序：occurredAt DESC
	if page.Items[0].Type != "diaper" {
		t.Errorf("latest first expected diaper, got %s", page.Items[0].Type)
	}

	// category 过滤
	e2 := mustOK(t, s.do(http.MethodGet, "/records/?babyId="+bid+"&category=feeding", uid, nil))
	var p2 struct {
		Total int `json:"total"`
	}
	jsonUnmarshal(e2.Data, &p2)
	if p2.Total != 2 {
		t.Errorf("feeding filter expected 2, got %d", p2.Total)
	}

	// 分页
	e3 := mustOK(t, s.do(http.MethodGet, "/records/?babyId="+bid+"&pageSize=2&page=1", uid, nil))
	var p3 struct {
		Items   []recordOut `json:"items"`
		HasMore bool        `json:"hasMore"`
	}
	jsonUnmarshal(e3.Data, &p3)
	if len(p3.Items) != 2 || !p3.HasMore {
		t.Errorf("pagination wrong: len=%d hasMore=%v", len(p3.Items), p3.HasMore)
	}
}

func TestUpdateRecord(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	rec := createRecord(t, s, uid, bid, "feeding", "bottle", map[string]interface{}{"amountMl": 100}, "2025-06-01T08:00:00.000Z")

	note := "已喝完"
	r := s.do(http.MethodPut, "/records/"+rec.ID, uid, map[string]interface{}{
		"type": "breastfeed",
		"note": note,
	})
	e := mustOK(t, r)
	var updated recordOut
	jsonUnmarshal(e.Data, &updated)
	if updated.Type != "breastfeed" {
		t.Errorf("type not updated: %s", updated.Type)
	}
	if updated.Note == nil || *updated.Note != note {
		t.Errorf("note not updated: %v", updated.Note)
	}

	// 更新不存在记录 -> 404
	nf := s.do(http.MethodPut, "/records/does-not-exist", uid, map[string]interface{}{"note": "x"})
	if nf.status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", nf.status)
	}
}

func TestDeleteRecord(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	rec := createRecord(t, s, uid, bid, "activity", "sleep", map[string]interface{}{"durationMinutes": 30}, "2025-06-01T08:00:00.000Z")

	ok := s.do(http.MethodDelete, "/records/"+rec.ID, uid, nil)
	mustOK(t, ok)

	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM "Record" WHERE id = ?`, rec.ID).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("record should be deleted")
	}

	nf := s.do(http.MethodDelete, "/records/"+rec.ID, uid, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("delete again expected 404, got %d", nf.status)
	}
}
