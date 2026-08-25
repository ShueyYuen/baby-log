package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCreateMomentComment(t *testing.T) {
	ts := newTestServer(t)
	uid := insertUser(t, "alice", "Alice", "user")
	_ = createBabyFor(t, uid, "Baby")

	r := ts.do("POST", "/moments", uid, map[string]interface{}{
		"content": "hello world",
	})
	e := mustOK(t, r)
	var moment momentOut
	json.Unmarshal(e.Data, &moment)
	if moment.ID == "" || moment.Content == nil || *moment.Content != "hello world" {
		t.Fatalf("moment payload wrong: %+v body=%s", moment, string(r.body))
	}

	r2 := ts.do("POST", "/moments/"+moment.ID+"/comments", uid, map[string]interface{}{
		"content": "nice photo!",
	})
	e2 := mustOK(t, r2)
	var comment momentCommentOut
	json.Unmarshal(e2.Data, &comment)
	if comment.Content != "nice photo!" {
		t.Fatalf("comment payload wrong: %+v", comment)
	}

	list := ts.do("GET", "/moments?page=1&pageSize=10", uid, nil)
	le := mustOK(t, list)
	var page MomentsList
	json.Unmarshal(le.Data, &page)
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("list expected 1 moment, got %+v", page)
	}
}

type MomentsList struct {
	Items    []momentOut `json:"items"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
}

func TestMomentRejectsEmptyAndSupportsLikeUpdateDelete(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	empty := s.do(http.MethodPost, "/moments", uid, map[string]interface{}{"content": ""})
	if empty.status != http.StatusBadRequest {
		t.Fatalf("empty moment expected 400, got %d", empty.status)
	}

	created := s.do(http.MethodPost, "/moments", uid, map[string]interface{}{"content": "hi"})
	e := mustOK(t, created)
	var m momentOut
	json.Unmarshal(e.Data, &m)

	like := s.do(http.MethodPost, "/moments/"+m.ID+"/like", uid, map[string]interface{}{})
	le := mustOK(t, like)
	var likeOut struct {
		Liked     bool `json:"liked"`
		LikeCount int  `json:"likeCount"`
	}
	json.Unmarshal(le.Data, &likeOut)
	if !likeOut.Liked || likeOut.LikeCount != 1 {
		t.Fatalf("like failed: %+v", likeOut)
	}
	unlike := s.do(http.MethodPost, "/moments/"+m.ID+"/like", uid, map[string]interface{}{})
	ule := mustOK(t, unlike)
	json.Unmarshal(ule.Data, &likeOut)
	if likeOut.Liked || likeOut.LikeCount != 0 {
		t.Fatalf("unlike failed: %+v", likeOut)
	}

	upd := s.do(http.MethodPut, "/moments/"+m.ID, uid, map[string]interface{}{"content": "edited"})
	ue := mustOK(t, upd)
	json.Unmarshal(ue.Data, &m)
	if m.Content == nil || *m.Content != "edited" {
		// update may return {id} only; fetch list instead
		list := s.do(http.MethodGet, "/moments", uid, nil)
		le2 := mustOK(t, list)
		var page MomentsList
		json.Unmarshal(le2.Data, &page)
		if len(page.Items) != 1 || page.Items[0].Content == nil || *page.Items[0].Content != "edited" {
			t.Fatalf("update did not persist: body=%s list=%s", string(upd.body), string(list.body))
		}
	}

	cmt := s.do(http.MethodPost, "/moments/"+m.ID+"/comments", uid, map[string]interface{}{"content": "c1"})
	ce := mustOK(t, cmt)
	var comment momentCommentOut
	json.Unmarshal(ce.Data, &comment)

	delC := s.do(http.MethodDelete, "/moments/"+m.ID+"/comments/"+comment.ID, uid, nil)
	mustOK(t, delC)

	other := insertUser(t, "other", "Other", "user")
	forbid := s.do(http.MethodDelete, "/moments/"+m.ID, other, nil)
	if forbid.status != http.StatusForbidden && forbid.status != http.StatusNotFound {
		t.Fatalf("non-owner delete expected 403/404, got %d %s", forbid.status, string(forbid.body))
	}

	del := s.do(http.MethodDelete, "/moments/"+m.ID, uid, nil)
	mustOK(t, del)
	list := s.do(http.MethodGet, "/moments", uid, nil)
	le3 := mustOK(t, list)
	var page MomentsList
	json.Unmarshal(le3.Data, &page)
	if page.Total != 0 {
		t.Fatalf("expected 0 moments after delete, got %d", page.Total)
	}
}
