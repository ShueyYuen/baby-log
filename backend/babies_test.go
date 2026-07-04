package main

import (
	"net/http"
	"testing"
)

func TestCreateBaby(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	r := s.do(http.MethodPost, "/babies/", uid, map[string]interface{}{
		"name":      "宝宝",
		"gender":    "male",
		"birthDate": "2025-01-01T00:00:00.000Z",
	})
	e := mustOK(t, r)
	var b babyOut
	jsonUnmarshal(e.Data, &b)
	if b.Name != "宝宝" || b.Gender != "male" {
		t.Fatalf("baby payload wrong: %+v", b)
	}
	if b.BirthDate != Millis(1735689600000) {
		t.Errorf("birthDate got %d", int64(b.BirthDate))
	}
	// 创建者应成为该宝宝成员
	ok, _ := findMembership(b.ID, uid, "admin")
	if !ok {
		t.Errorf("creator should be admin member")
	}
}

func TestCreateBabyInvalidInput(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	bad := []map[string]interface{}{
		{"name": "", "gender": "male", "birthDate": "2025-01-01"},
		{"name": "x", "gender": "unknown", "birthDate": "2025-01-01"},
		{"name": "x", "gender": "male", "birthDate": ""},
	}
	for i, body := range bad {
		r := s.do(http.MethodPost, "/babies/", uid, body)
		if r.status != http.StatusBadRequest {
			t.Errorf("case %d expected 400, got %d", i, r.status)
		}
	}
}

func TestListBabiesSharedAcrossUsers(t *testing.T) {
	s := newTestServer(t)
	u1 := insertUser(t, "u1", "U1", "user")

	// u1 创建宝宝
	r := s.do(http.MethodPost, "/babies/", u1, map[string]interface{}{
		"name": "A", "gender": "female", "birthDate": "2025-01-01T00:00:00.000Z",
	})
	mustOK(t, r)

	// u2 之后注册，应通过回填/自动共享看到宝宝
	u2 := insertUser(t, "u2", "U2", "user")
	if err := ensureAllMemberships(); err != nil {
		t.Fatal(err)
	}
	lr := s.do(http.MethodGet, "/babies/", u2, nil)
	e := mustOK(t, lr)
	var list []babyOut
	jsonUnmarshal(e.Data, &list)
	if len(list) != 1 {
		t.Fatalf("u2 should see 1 shared baby, got %d", len(list))
	}
	if len(list[0].Members) == 0 {
		t.Errorf("baby should include members")
	}
}

func TestGetBaby(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	r := s.do(http.MethodGet, "/babies/"+bid, uid, nil)
	e := mustOK(t, r)
	var b babyOut
	jsonUnmarshal(e.Data, &b)
	if b.ID != bid {
		t.Errorf("got %s", b.ID)
	}

	// 非成员访问 -> 404
	other := insertUser(t, "other", "Other", "user")
	nf := s.do(http.MethodGet, "/babies/"+bid, other, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("non-member expected 404, got %d", nf.status)
	}
}

func TestUpdateBaby(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "旧名")

	r := s.do(http.MethodPut, "/babies/"+bid, uid, map[string]interface{}{
		"name":      "新名",
		"birthDate": "2024-05-05T00:00:00.000Z",
	})
	e := mustOK(t, r)
	var b babyOut
	jsonUnmarshal(e.Data, &b)
	if b.Name != "新名" {
		t.Errorf("name not updated: %s", b.Name)
	}

	// 无权限用户更新 -> 403
	other := insertUser(t, "other", "Other", "user")
	r2 := s.do(http.MethodPut, "/babies/"+bid, other, map[string]interface{}{"name": "x"})
	if r2.status != http.StatusForbidden {
		t.Fatalf("non-member expected 403, got %d", r2.status)
	}
}
