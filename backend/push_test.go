package main

import (
	"net/http"
	"testing"
	"time"
)

func TestVapidKey(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	e := mustOK(t, s.do(http.MethodGet, "/push/vapid-key", uid, nil))
	var data struct {
		PublicKey string `json:"publicKey"`
	}
	jsonUnmarshal(e.Data, &data)
	// 未配置时应为空字符串，字段仍存在
	_ = data.PublicKey
}

func TestPushSubscribeAndUnsubscribe(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	sub := map[string]interface{}{
		"endpoint": "https://push.example.com/abc",
		"keys":     map[string]string{"p256dh": "key1", "auth": "auth1"},
	}
	mustOK(t, s.do(http.MethodPost, "/push/subscribe", uid, sub))

	userID := tokenToUserID(uid)
	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM "PushSubscription" WHERE userId = ?`, userID).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("expected 1 subscription, got %d", cnt)
	}

	// 相同 endpoint 再订阅应 upsert，不新增
	mustOK(t, s.do(http.MethodPost, "/push/subscribe", uid, sub))
	db.QueryRow(`SELECT COUNT(*) FROM "PushSubscription" WHERE userId = ?`, userID).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("upsert should keep 1 subscription, got %d", cnt)
	}

	// 退订
	mustOK(t, s.do(http.MethodDelete, "/push/subscribe", uid, map[string]string{"endpoint": "https://push.example.com/abc"}))
	db.QueryRow(`SELECT COUNT(*) FROM "PushSubscription" WHERE userId = ?`, uid).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("expected 0 after unsubscribe, got %d", cnt)
	}
}

func TestPushSubscribeInvalid(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	r := s.do(http.MethodPost, "/push/subscribe", uid, map[string]interface{}{"endpoint": ""})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", r.status)
	}
}

func TestCreateAndListReminder(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	future := time.Now().Add(1 * time.Hour).UTC().Format(isoLayout)
	r := s.do(http.MethodPost, "/push/reminder", uid, map[string]interface{}{
		"babyId":   bid,
		"remindAt": future,
		"source":   "feeding_manual",
		"title":    "喂奶",
		"body":     "该喂奶了",
	})
	e := mustOK(t, r)
	var rem reminderOut
	jsonUnmarshal(e.Data, &rem)
	if rem.Source != "feeding_manual" || rem.Sent {
		t.Fatalf("reminder wrong: %+v", rem)
	}

	// 列表（未来 & 未发送）
	le := mustOK(t, s.do(http.MethodGet, "/push/reminder?babyId="+bid, uid, nil))
	var list []reminderOut
	jsonUnmarshal(le.Data, &list)
	if len(list) != 1 {
		t.Fatalf("expected 1 reminder, got %d", len(list))
	}
}

func TestCreateReminderInvalidSource(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	future := time.Now().Add(1 * time.Hour).UTC().Format(isoLayout)
	r := s.do(http.MethodPost, "/push/reminder", uid, map[string]interface{}{
		"babyId": bid, "remindAt": future, "source": "bogus",
	})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", r.status)
	}
}

func TestDueReminders(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	// 过去的提醒 -> 到期
	past := time.Now().Add(-1 * time.Minute).UTC().Format(isoLayout)
	// 直接插入过期提醒（handler 不接受过去时间的自动过滤，这里手动构造）
	insertReminder(t, bid, past, "到点了", "body")

	e := mustOK(t, s.do(http.MethodPost, "/push/due-reminders", uid, nil))
	var notifs []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	jsonUnmarshal(e.Data, &notifs)
	if len(notifs) != 1 || notifs[0].Title != "到点了" {
		t.Fatalf("expected 1 due notif, got %+v", notifs)
	}

	// 领取后再次调用应返回空（已记录为已投递）
	e2 := mustOK(t, s.do(http.MethodPost, "/push/due-reminders", uid, nil))
	var notifs2 []interface{}
	jsonUnmarshal(e2.Data, &notifs2)
	if len(notifs2) != 0 {
		t.Fatalf("second poll should be empty, got %d", len(notifs2))
	}
}
