package main

import (
	"net/http"
	"testing"
)

func TestHealthConditionAndEntriesCRUD(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	cr := s.do(http.MethodPost, "/health-conditions/", uid, map[string]interface{}{
		"babyId": bid, "name": "湿疹", "description": "脸颊",
	})
	e := mustOK(t, cr)
	var cond healthConditionOut
	jsonUnmarshal(e.Data, &cond)
	if cond.Name != "湿疹" || cond.Status != "active" || cond.EntryCount != 0 {
		t.Fatalf("create condition wrong: %+v", cond)
	}

	list := s.do(http.MethodGet, "/health-conditions/?babyId="+bid, uid, nil)
	le := mustOK(t, list)
	var conds []healthConditionOut
	jsonUnmarshal(le.Data, &conds)
	if len(conds) != 1 {
		t.Fatalf("expected 1 condition, got %d", len(conds))
	}

	upd := s.do(http.MethodPut, "/health-conditions/"+cond.ID, uid, map[string]interface{}{
		"status": "resolved", "name": "湿疹-已好转",
	})
	ue := mustOK(t, upd)
	jsonUnmarshal(ue.Data, &cond)
	if cond.Status != "resolved" || cond.Name != "湿疹-已好转" {
		t.Fatalf("update condition failed: %+v", cond)
	}

	er := s.do(http.MethodPost, "/health-conditions/"+cond.ID+"/entries", uid, map[string]interface{}{
		"date": "2026-08-20T10:00:00.000Z", "note": "涂药膏",
	})
	ee := mustOK(t, er)
	var entry healthEntryOut
	jsonUnmarshal(ee.Data, &entry)
	if entry.Note == nil || *entry.Note != "涂药膏" {
		t.Fatalf("entry note wrong: %+v", entry)
	}

	er2 := s.do(http.MethodPost, "/health-conditions/"+cond.ID+"/entries", uid, map[string]interface{}{
		"date": "2026-08-21T10:00:00.000Z", "note": "复诊",
	})
	mustOK(t, er2)

	entries := s.do(http.MethodGet, "/health-conditions/"+cond.ID+"/entries?page=1&pageSize=1", uid, nil)
	ele := mustOK(t, entries)
	var page struct {
		Items   []healthEntryOut `json:"items"`
		Total   int              `json:"total"`
		HasMore bool             `json:"hasMore"`
	}
	jsonUnmarshal(ele.Data, &page)
	if page.Total != 2 || len(page.Items) != 1 || !page.HasMore {
		t.Fatalf("pagination wrong: %+v", page)
	}

	upde := s.do(http.MethodPut, "/health-conditions/"+cond.ID+"/entries/"+entry.ID, uid, map[string]interface{}{
		"note": "加保湿",
	})
	uee := mustOK(t, upde)
	jsonUnmarshal(uee.Data, &entry)
	if entry.Note == nil || *entry.Note != "加保湿" {
		t.Fatalf("update entry failed: %+v", entry)
	}

	delE := s.do(http.MethodDelete, "/health-conditions/"+cond.ID+"/entries/"+entry.ID, uid, nil)
	mustOK(t, delE)

	delC := s.do(http.MethodDelete, "/health-conditions/"+cond.ID, uid, nil)
	mustOK(t, delC)
	gone := s.do(http.MethodGet, "/health-conditions/?babyId="+bid, uid, nil)
	ge := mustOK(t, gone)
	jsonUnmarshal(ge.Data, &conds)
	if len(conds) != 0 {
		t.Fatalf("expected no conditions after delete")
	}
}

func TestHealthConditionValidationAndPermission(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	bad := s.do(http.MethodPost, "/health-conditions/", uid, map[string]interface{}{
		"babyId": bid, "name": "",
	})
	if bad.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", bad.status)
	}

	list := s.do(http.MethodGet, "/health-conditions/", uid, nil)
	if list.status != http.StatusBadRequest {
		t.Fatalf("expected 400 without babyId, got %d", list.status)
	}

	other := insertUser(t, "other", "Other", "user")
	deny := s.do(http.MethodPost, "/health-conditions/", other, map[string]interface{}{
		"babyId": bid, "name": "湿疹",
	})
	if deny.status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", deny.status)
	}

	nf := s.do(http.MethodPut, "/health-conditions/missing", uid, map[string]interface{}{"name": "x"})
	if nf.status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", nf.status)
	}
}
