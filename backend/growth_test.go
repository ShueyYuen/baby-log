package main

import (
	"net/http"
	"testing"
)

func TestCreateGrowth(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	r := s.do(http.MethodPost, "/growth/", uid, map[string]interface{}{
		"babyId": bid,
		"date":   "2025-06-01T00:00:00.000Z",
		"height": 50.5,
		"weight": 3.6,
	})
	e := mustOK(t, r)
	var g growthOut
	jsonUnmarshal(e.Data, &g)
	if g.Height == nil || *g.Height != 50.5 {
		t.Errorf("height wrong: %v", g.Height)
	}
	if g.Weight == nil || *g.Weight != 3.6 {
		t.Errorf("weight wrong: %v", g.Weight)
	}
	if g.HeadCircumference != nil {
		t.Errorf("head should be nil")
	}
}

func TestCreateGrowthRejectsNonPositive(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	r := s.do(http.MethodPost, "/growth/", uid, map[string]interface{}{
		"babyId": bid, "date": "2025-06-01T00:00:00.000Z", "weight": -1.0,
	})
	if r.status != http.StatusBadRequest {
		t.Fatalf("negative weight expected 400, got %d", r.status)
	}
}

func TestListGrowthSorted(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	s.do(http.MethodPost, "/growth/", uid, map[string]interface{}{"babyId": bid, "date": "2025-06-01T00:00:00.000Z", "weight": 3.0})
	s.do(http.MethodPost, "/growth/", uid, map[string]interface{}{"babyId": bid, "date": "2025-06-10T00:00:00.000Z", "weight": 3.5})

	e := mustOK(t, s.do(http.MethodGet, "/growth/?babyId="+bid, uid, nil))
	var list []growthOut
	jsonUnmarshal(e.Data, &list)
	if len(list) != 2 {
		t.Fatalf("expected 2, got %d", len(list))
	}
	// date DESC
	if list[0].Date < list[1].Date {
		t.Errorf("should be sorted date DESC")
	}
}

func TestUpdateGrowthWithNull(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	created := s.do(http.MethodPost, "/growth/", uid, map[string]interface{}{
		"babyId": bid, "date": "2025-06-01T00:00:00.000Z", "height": 50.0, "weight": 3.5,
	})
	var g growthOut
	jsonUnmarshal(mustOK(t, created).Data, &g)

	// 将 height 显式置空
	upd := s.do(http.MethodPut, "/growth/"+g.ID, uid, map[string]interface{}{"height": nil, "weight": 4.0})
	var ug growthOut
	jsonUnmarshal(mustOK(t, upd).Data, &ug)
	if ug.Height != nil {
		t.Errorf("height should be null after update, got %v", ug.Height)
	}
	if ug.Weight == nil || *ug.Weight != 4.0 {
		t.Errorf("weight should be 4.0, got %v", ug.Weight)
	}
}

func TestDeleteGrowth(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	created := s.do(http.MethodPost, "/growth/", uid, map[string]interface{}{
		"babyId": bid, "date": "2025-06-01T00:00:00.000Z", "weight": 3.5,
	})
	var g growthOut
	jsonUnmarshal(mustOK(t, created).Data, &g)

	mustOK(t, s.do(http.MethodDelete, "/growth/"+g.ID, uid, nil))
	nf := s.do(http.MethodDelete, "/growth/"+g.ID, uid, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", nf.status)
	}
}
