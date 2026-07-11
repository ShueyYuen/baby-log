package main

import (
	"log"
	"time"
)

// startReminderScheduler 每 5 分钟检查一次到期提醒并推送。
func startReminderScheduler() {
	ticker := time.NewTicker(5 * time.Minute)
	go func() {
		for range ticker.C {
			runReminderTick()
		}
	}()
	log.Println("[Scheduler] Reminder scheduler started (every 5 minutes)")
}

var lastSummaryDate string

func runReminderTick() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Scheduler] Error: %v", r)
		}
	}()

	checkDailySummary()
	markExpiredMilkInventory()

	now := int64(nowMillis())
	rows, err := db.Query(`
		SELECT r.id, r.babyId, r.source, r.title, r.body, b.name
		FROM "Reminder" r JOIN "Baby" b ON b.id = r.babyId
		WHERE r.sent = 0 AND r.remindAt <= ?`, now)
	if err != nil {
		log.Printf("[Scheduler] Error: %v", err)
		return
	}

	type due struct {
		id, babyID, source, title, body, babyName string
	}
	var dues []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.babyID, &d.source, &d.title, &d.body, &d.babyName); err != nil {
			continue
		}
		dues = append(dues, d)
	}
	rows.Close()

	if len(dues) > 0 {
		log.Printf("[Scheduler] Found %d due reminder(s)", len(dues))
	}

	for _, d := range dues {
		title := d.title
		if title == "" {
			title = d.babyName + " 提醒"
		}
		body := d.body
		if body == "" {
			body = "您有一条提醒"
		}
		payload := pushPayload{
			Title: title,
			Body:  body,
			Data:  map[string]interface{}{"url": "/", "babyId": d.babyID},
		}
		log.Printf("[Scheduler] Sending push for reminder %s, baby=%s, source=%s", d.id, d.babyName, d.source)
		sendPushToBabyMembers(d.babyID, payload)

		if _, err := db.Exec(`UPDATE "Reminder" SET sent = 1 WHERE id = ?`, d.id); err != nil {
			log.Printf("[Scheduler] Failed to mark reminder %s sent: %v", d.id, err)
		} else {
			log.Printf("[Scheduler] Marked reminder %s as sent", d.id)
		}
	}
}

// checkDailySummary 每天 21:00（服务器本地时间）发送一次每日小结推送。
func checkDailySummary() {
	now := time.Now()
	if now.Hour() < 21 {
		return
	}
	today := now.Format("2006-01-02")
	if lastSummaryDate == today {
		return
	}
	log.Printf("[Scheduler] Triggering daily summary for %s", today)
	sendDailySummary()
	lastSummaryDate = today
}
