package main

import (
	"testing"
	"time"
)

func TestComputeBabyDailySummary(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	userID := tokenToUserID(uid)
	bid := createBabyFor(t, uid, "宝宝")

	loc := time.Now().Location()
	today := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 10, 0, 0, 0, loc)
	startMs := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc).UnixMilli()
	endMs := startMs + 24*60*60*1000

	insertFeeding(t, bid, uid, "breastfeed", 0, today)
	insertFeeding(t, bid, uid, "bottle", 120, today.Add(30*time.Minute))

	now := int64(nowMillis())
	data := `{"type":"wet"}`
	if _, err := db.Exec(`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, createdBy, createdAt, updatedAt)
		VALUES (?, ?, 'nursing', 'diaper', ?, ?, ?, ?, ?)`,
		"rec-diaper", bid, data, today.Add(time.Hour).UnixMilli(), userID, now, now); err != nil {
		t.Fatalf("insert diaper: %v", err)
	}

	sleepData := `{"durationMinutes":125}`
	if _, err := db.Exec(`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, createdBy, createdAt, updatedAt)
		VALUES (?, ?, 'activity', 'sleep', ?, ?, ?, ?, ?)`,
		"rec-sleep", bid, sleepData, today.Add(2*time.Hour).UnixMilli(), userID, now, now); err != nil {
		t.Fatalf("insert sleep: %v", err)
	}

	tempData := `{"value":37.2,"location":"armpit"}`
	if _, err := db.Exec(`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, createdBy, createdAt, updatedAt)
		VALUES (?, ?, 'nursing', 'temperature', ?, ?, ?, ?, ?)`,
		"rec-temp", bid, tempData, today.Add(3*time.Hour).UnixMilli(), userID, now, now); err != nil {
		t.Fatalf("insert temperature: %v", err)
	}

	stats, err := computeBabyDailySummary(bid, startMs, endMs)
	if err != nil {
		t.Fatalf("computeBabyDailySummary: %v", err)
	}
	if stats.recordCount != 5 {
		t.Fatalf("recordCount = %d, want 5", stats.recordCount)
	}
	if stats.feedingCount != 2 {
		t.Fatalf("feedingCount = %d, want 2", stats.feedingCount)
	}
	if stats.diaperCount != 1 {
		t.Fatalf("diaperCount = %d, want 1", stats.diaperCount)
	}
	if stats.sleepMinutes != 125 {
		t.Fatalf("sleepMinutes = %v, want 125", stats.sleepMinutes)
	}
	if !stats.hasTemp || stats.maxTemp != 37.2 {
		t.Fatalf("maxTemp = %v hasTemp=%v, want 37.2 true", stats.maxTemp, stats.hasTemp)
	}

	body := formatDailySummaryBody(stats)
	want := "喂养 2 次 · 换尿布 1 次 · 睡眠 2 小时 5 分钟 · 最高体温 37.2°C"
	if body != want {
		t.Fatalf("body = %q, want %q", body, want)
	}
}

func TestComputeBabyDailySummaryNoRecords(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	loc := time.Now().Location()
	startMs := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 0, 0, 0, 0, loc).UnixMilli()
	endMs := startMs + 24*60*60*1000

	stats, err := computeBabyDailySummary(bid, startMs, endMs)
	if err != nil {
		t.Fatalf("computeBabyDailySummary: %v", err)
	}
	if stats.recordCount != 0 {
		t.Fatalf("recordCount = %d, want 0", stats.recordCount)
	}
}

func TestCheckDailySummaryOncePerDay(t *testing.T) {
	lastSummaryDate = ""
	today := time.Now().Format("2006-01-02")

	// Simulate already sent today.
	lastSummaryDate = today
	before := lastSummaryDate
	checkDailySummary()
	if lastSummaryDate != before {
		t.Fatalf("lastSummaryDate changed from %q to %q", before, lastSummaryDate)
	}
}
