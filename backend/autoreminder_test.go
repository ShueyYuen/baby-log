package main

import (
	"testing"
	"time"
)

// TestCreateAutoFeedingReminder 构造规律喂养记录，验证生成一条 feeding_auto 提醒。
func TestCreateAutoFeedingReminder(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	// 每 3 小时一次奶瓶喂养，最后一次在 30 分钟前，预测下一次在未来。
	now := time.Now()
	times := []time.Time{
		now.Add(-30 * time.Minute),
		now.Add(-3*time.Hour - 30*time.Minute),
		now.Add(-6*time.Hour - 30*time.Minute),
		now.Add(-9*time.Hour - 30*time.Minute),
	}
	for _, ts := range times {
		insertFeeding(t, bid, uid, "bottle", 120, ts)
	}

	createAutoFeedingReminder(bid)

	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM "Reminder" WHERE babyId = ? AND source = 'feeding_auto' AND sent = 0`, bid).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("expected 1 auto reminder, got %d", cnt)
	}
}

func TestCreateAutoFeedingReminderInsufficient(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	insertFeeding(t, bid, uid, "bottle", 120, time.Now().Add(-30*time.Minute))
	createAutoFeedingReminder(bid)

	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM "Reminder" WHERE babyId = ?`, bid).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("insufficient data should create no reminder, got %d", cnt)
	}
}
