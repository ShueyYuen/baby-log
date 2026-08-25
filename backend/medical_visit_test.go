package main

import (
	"net/http"
	"net/url"
	"testing"
)

func TestMedicalVisitCRUDAndSearch(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	r := s.do(http.MethodPost, "/medical-visits/", uid, map[string]interface{}{
		"babyId":       bid,
		"visitDate":    "2026-08-01T09:00:00.000Z",
		"hospital":     "市妇幼",
		"department":   "儿科",
		"doctor":       "王医生",
		"diagnosis":    "感冒",
		"prescription": "布洛芬",
		"notes":        "多喝水",
		"ocrData":      []map[string]string{{"key": "k1", "text": "处方笺"}},
	})
	e := mustOK(t, r)
	var created medicalVisitOut
	jsonUnmarshal(e.Data, &created)
	if created.Hospital != "市妇幼" || created.Diagnosis != "感冒" {
		t.Fatalf("create payload wrong: %+v", created)
	}
	if len(created.OcrData) != 1 || created.OcrData[0].Text != "处方笺" {
		t.Fatalf("ocrData not stored: %+v", created.OcrData)
	}

	got := s.do(http.MethodGet, "/medical-visits/"+created.ID, uid, nil)
	ge := mustOK(t, got)
	var one medicalVisitOut
	jsonUnmarshal(ge.Data, &one)
	if one.ID != created.ID {
		t.Fatalf("get id mismatch")
	}

	upd := s.do(http.MethodPut, "/medical-visits/"+created.ID, uid, map[string]interface{}{
		"diagnosis": "支气管炎",
		"notes":     "复诊",
	})
	ue := mustOK(t, upd)
	jsonUnmarshal(ue.Data, &created)
	if created.Diagnosis != "支气管炎" || created.Notes != "复诊" {
		t.Fatalf("update failed: %+v", created)
	}

	list := s.do(http.MethodGet, "/medical-visits/?babyId="+bid+"&q="+url.QueryEscape("支气管"), uid, nil)
	le := mustOK(t, list)
	var page struct {
		Items    []medicalVisitOut `json:"items"`
		Total    int               `json:"total"`
		HasMore  bool              `json:"hasMore"`
		Page     int               `json:"page"`
		PageSize int               `json:"pageSize"`
	}
	jsonUnmarshal(le.Data, &page)
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("search expected 1, got total=%d items=%d", page.Total, len(page.Items))
	}

	miss := s.do(http.MethodGet, "/medical-visits/?babyId="+bid+"&q="+url.QueryEscape("不存在的诊断"), uid, nil)
	me := mustOK(t, miss)
	jsonUnmarshal(me.Data, &page)
	if page.Total != 0 {
		t.Fatalf("expected 0 search hits, got %d", page.Total)
	}

	del := s.do(http.MethodDelete, "/medical-visits/"+created.ID, uid, nil)
	mustOK(t, del)
	nf := s.do(http.MethodGet, "/medical-visits/"+created.ID, uid, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", nf.status)
	}
}

func TestMedicalVisitValidationAndPermission(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	missingBaby := s.do(http.MethodPost, "/medical-visits/", uid, map[string]interface{}{
		"hospital": "x",
	})
	if missingBaby.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", missingBaby.status)
	}

	list := s.do(http.MethodGet, "/medical-visits/", uid, nil)
	if list.status != http.StatusBadRequest {
		t.Fatalf("expected 400 without babyId, got %d", list.status)
	}

	other := insertUser(t, "other", "Other", "user")
	deny := s.do(http.MethodPost, "/medical-visits/", other, map[string]interface{}{
		"babyId": bid, "hospital": "x",
	})
	if deny.status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", deny.status)
	}

	created := s.do(http.MethodPost, "/medical-visits/", uid, map[string]interface{}{
		"babyId": bid, "hospital": "A",
	})
	e := mustOK(t, created)
	var mv medicalVisitOut
	jsonUnmarshal(e.Data, &mv)

	getDeny := s.do(http.MethodGet, "/medical-visits/"+mv.ID, other, nil)
	if getDeny.status != http.StatusForbidden {
		t.Fatalf("non-member get expected 403, got %d", getDeny.status)
	}
}
