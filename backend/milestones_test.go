package main

import (
	"net/http"
	"testing"
	"time"
)

func TestCreateMilestone(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	registerUploadKey(t, "a.jpg")
	registerUploadKey(t, "b.jpg")

	r := s.do(http.MethodPost, "/milestones/", uid, map[string]interface{}{
		"babyId":     bid,
		"type":       "first_smile",
		"title":      "第一次笑",
		"occurredAt": "2025-06-01T00:00:00.000Z",
		"images":     []map[string]string{{"key": "a.jpg"}, {"key": "b.jpg"}},
	})
	e := mustOK(t, r)
	var m milestoneOut
	jsonUnmarshal(e.Data, &m)
	if m.Title != "第一次笑" {
		t.Errorf("title wrong")
	}
	if len(m.Images) != 2 {
		t.Errorf("images wrong: %v", m.Images)
	}
}

func TestCreateMilestoneInvalid(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	r := s.do(http.MethodPost, "/milestones/", uid, map[string]interface{}{
		"babyId": bid, "type": "", "title": "x", "occurredAt": "2025-06-01T00:00:00.000Z",
	})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", r.status)
	}
}

func TestListMilestonesWithVideoDoesNotDeadlock(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	registerUploadKey(t, "clip.mp4")
	mustOK(t, s.do(http.MethodPost, "/milestones/", uid, map[string]interface{}{
		"babyId":     bid,
		"type":       "t",
		"title":      "视频里程碑",
		"occurredAt": "2025-06-01T00:00:00.000Z",
		"images":     []map[string]string{{"key": "clip.mp4", "mediaType": "video"}},
	}))

	done := make(chan resp, 1)
	go func() {
		done <- s.do(http.MethodGet, "/milestones/?babyId="+bid+"&page=1&pageSize=20", uid, nil)
	}()
	select {
	case r := <-done:
		e := mustOK(t, r)
		var list []milestoneOut
		jsonUnmarshal(extractItems(e.Data), &list)
		if len(list) != 1 {
			t.Fatalf("expected 1 milestone, got %d", len(list))
		}
		if len(list[0].Images) != 1 || list[0].Images[0].Key != "clip.mp4" {
			t.Errorf("video image missing: %+v", list[0].Images)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("GET /milestones hung: nested DB query while rows open (MaxOpenConns=1 deadlock)")
	}

	mustOK(t, s.do(http.MethodGet, "/babies", uid, nil))
}

func TestListMilestones(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	s.do(http.MethodPost, "/milestones/", uid, map[string]interface{}{
		"babyId": bid, "type": "t1", "title": "早", "occurredAt": "2025-06-01T00:00:00.000Z",
	})
	s.do(http.MethodPost, "/milestones/", uid, map[string]interface{}{
		"babyId": bid, "type": "t2", "title": "晚", "occurredAt": "2025-06-05T00:00:00.000Z",
	})

	e := mustOK(t, s.do(http.MethodGet, "/milestones/?babyId="+bid, uid, nil))
	var list []milestoneOut
	jsonUnmarshal(extractItems(e.Data), &list)
	if len(list) != 2 {
		t.Fatalf("expected 2, got %d", len(list))
	}
	if list[0].Title != "晚" {
		t.Errorf("occurredAt DESC expected 晚 first, got %s", list[0].Title)
	}
	// 没有图片时应返回非 nil 空数组
	if list[0].Images == nil {
		t.Errorf("images should be empty non-nil slice")
	}
}

func TestUpdateAndDeleteMilestone(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	created := s.do(http.MethodPost, "/milestones/", uid, map[string]interface{}{
		"babyId": bid, "type": "t", "title": "旧", "occurredAt": "2025-06-01T00:00:00.000Z",
	})
	var m milestoneOut
	jsonUnmarshal(mustOK(t, created).Data, &m)

	upd := s.do(http.MethodPut, "/milestones/"+m.ID, uid, map[string]interface{}{"title": "新"})
	var um milestoneOut
	jsonUnmarshal(mustOK(t, upd).Data, &um)
	if um.Title != "新" {
		t.Errorf("title not updated")
	}

	mustOK(t, s.do(http.MethodDelete, "/milestones/"+m.ID, uid, nil))
	nf := s.do(http.MethodDelete, "/milestones/"+m.ID, uid, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", nf.status)
	}
}
