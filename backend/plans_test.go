package main

import (
	"net/http"
	"testing"
	"time"
)

func TestCreatePlan(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	future := time.Now().Add(2 * time.Hour).UTC().Format(isoLayout)
	r := s.do(http.MethodPost, "/plans/", uid, map[string]interface{}{
		"babyId":      bid,
		"title":       "打疫苗",
		"type":        "vaccine",
		"scheduledAt": future,
		"reminder":    "30",
	})
	e := mustOK(t, r)
	var p planOut
	jsonUnmarshal(e.Data, &p)
	if p.Title != "打疫苗" || p.Type != "vaccine" || p.Status != "pending" || p.Repeat != "none" {
		t.Fatalf("plan payload wrong: %+v", p)
	}

	// 未来计划应创建一条 plan 提醒
	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM "Reminder" WHERE refId = ? AND source = 'plan'`, p.ID).Scan(&cnt)
	if cnt != 1 {
		t.Errorf("expected 1 plan reminder, got %d", cnt)
	}
}

func TestCreatePlanInvalidType(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	r := s.do(http.MethodPost, "/plans/", uid, map[string]interface{}{
		"babyId": bid, "title": "x", "type": "bogus", "scheduledAt": "2025-06-01T08:00:00.000Z",
	})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", r.status)
	}
}

func TestListPlansWithStatusFilter(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	future := time.Now().Add(3 * time.Hour).UTC().Format(isoLayout)
	created := s.do(http.MethodPost, "/plans/", uid, map[string]interface{}{
		"babyId": bid, "title": "复查", "type": "checkup", "scheduledAt": future,
	})
	var p planOut
	jsonUnmarshal(mustOK(t, created).Data, &p)

	// 标记完成
	s.do(http.MethodPut, "/plans/"+p.ID, uid, map[string]interface{}{"status": "completed"})

	e := mustOK(t, s.do(http.MethodGet, "/plans/?babyId="+bid+"&status=completed", uid, nil))
	var list []planOut
	jsonUnmarshal(e.Data, &list)
	if len(list) != 1 || list[0].Status != "completed" {
		t.Fatalf("status filter wrong: %+v", list)
	}

	ePending := mustOK(t, s.do(http.MethodGet, "/plans/?babyId="+bid+"&status=pending", uid, nil))
	var pending []planOut
	jsonUnmarshal(ePending.Data, &pending)
	if len(pending) != 0 {
		t.Errorf("expected 0 pending, got %d", len(pending))
	}
}

func TestUpdateAndDeletePlan(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	created := s.do(http.MethodPost, "/plans/", uid, map[string]interface{}{
		"babyId": bid, "title": "旧标题", "type": "custom", "scheduledAt": "2025-06-01T08:00:00.000Z",
	})
	var p planOut
	jsonUnmarshal(mustOK(t, created).Data, &p)

	upd := s.do(http.MethodPut, "/plans/"+p.ID, uid, map[string]interface{}{"title": "新标题"})
	var up planOut
	jsonUnmarshal(mustOK(t, upd).Data, &up)
	if up.Title != "新标题" {
		t.Errorf("title not updated")
	}

	del := s.do(http.MethodDelete, "/plans/"+p.ID, uid, nil)
	mustOK(t, del)

	nf := s.do(http.MethodDelete, "/plans/"+p.ID, uid, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("delete again expected 404, got %d", nf.status)
	}
}
