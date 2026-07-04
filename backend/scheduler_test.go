package main

import (
	"testing"
	"time"
)

// TestRunReminderTickMarksSent 验证到期提醒在 tick 后被标记为 sent。
// 未配置 VAPID 时推送发送为 no-op，因此不会产生网络请求。
func TestRunReminderTickMarksSent(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	past := time.Now().Add(-2 * time.Minute).UTC().Format(isoLayout)
	id := insertReminder(t, bid, past, "到期提醒", "body")

	runReminderTick()

	var sent int
	db.QueryRow(`SELECT sent FROM "Reminder" WHERE id = ?`, id).Scan(&sent)
	if sent != 1 {
		t.Fatalf("reminder should be marked sent, got %d", sent)
	}
}

// TestRunReminderTickSkipsFuture 未到期提醒不应被标记。
func TestRunReminderTickSkipsFuture(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	future := time.Now().Add(1 * time.Hour).UTC().Format(isoLayout)
	id := insertReminder(t, bid, future, "未来提醒", "body")

	runReminderTick()

	var sent int
	db.QueryRow(`SELECT sent FROM "Reminder" WHERE id = ?`, id).Scan(&sent)
	if sent != 0 {
		t.Fatalf("future reminder should not be sent, got %d", sent)
	}
}
