package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"
)

type dailySummaryStats struct {
	feedingCount int
	diaperCount  int
	sleepMinutes float64
	maxTemp      float64
	hasTemp      bool
	recordCount  int
}

func computeBabyDailySummary(babyID string, startMs, endMs int64) (dailySummaryStats, error) {
	var stats dailySummaryStats

	rows, err := db.Query(`SELECT category, type, data FROM "Record" WHERE babyId = ? AND occurredAt >= ? AND occurredAt < ?`,
		babyID, startMs, endMs)
	if err != nil {
		return stats, err
	}
	defer rows.Close()

	for rows.Next() {
		var category, typ, dataStr string
		if err := rows.Scan(&category, &typ, &dataStr); err != nil {
			return stats, err
		}
		stats.recordCount++

		switch {
		case category == "feeding":
			stats.feedingCount++
		case typ == "diaper":
			stats.diaperCount++
		case typ == "sleep":
			m := map[string]interface{}{}
			_ = json.Unmarshal([]byte(dataStr), &m)
			stats.sleepMinutes += numField(m, "durationMinutes")
		case typ == "temperature":
			m := map[string]interface{}{}
			_ = json.Unmarshal([]byte(dataStr), &m)
			v := numField(m, "value")
			if v > 0 {
				if !stats.hasTemp || v > stats.maxTemp {
					stats.maxTemp = v
					stats.hasTemp = true
				}
			}
		}
	}
	return stats, rows.Err()
}

func formatDailySummaryBody(stats dailySummaryStats) string {
	totalMins := int(math.Round(stats.sleepMinutes))
	hours := totalMins / 60
	mins := totalMins % 60
	body := fmt.Sprintf("喂养 %d 次 · 换尿布 %d 次 · 睡眠 %d 小时 %d 分钟",
		stats.feedingCount, stats.diaperCount, hours, mins)
	if stats.hasTemp {
		body += fmt.Sprintf(" · 最高体温 %.1f°C", stats.maxTemp)
	}
	return body
}

func sendDailySummary() {
	if !vapidConfigured() {
		log.Println("[DailySummary] VAPID not configured, skipping")
		return
	}

	now := time.Now()
	loc := now.Location()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	endOfDay := startOfDay.Add(24 * time.Hour)
	startMs := startOfDay.UnixMilli()
	endMs := endOfDay.UnixMilli()

	rows, err := db.Query(`SELECT id, name FROM "Baby"`)
	if err != nil {
		log.Printf("[DailySummary] Failed to list babies: %v", err)
		return
	}
	defer rows.Close()

	type baby struct {
		id, name string
	}
	var babies []baby
	for rows.Next() {
		var b baby
		if err := rows.Scan(&b.id, &b.name); err != nil {
			continue
		}
		babies = append(babies, b)
	}

	sent := 0
	for _, b := range babies {
		stats, err := computeBabyDailySummary(b.id, startMs, endMs)
		if err != nil {
			log.Printf("[DailySummary] Failed to compute stats for baby %s: %v", b.name, err)
			continue
		}
		if stats.recordCount == 0 {
			continue
		}

		payload := pushPayload{
			Title: fmt.Sprintf("📊 %s今日小结", b.name),
			Body:  formatDailySummaryBody(stats),
			Data:  map[string]interface{}{"url": "/", "babyId": b.id},
		}
		log.Printf("[DailySummary] Sending summary for baby %s: %s", b.name, payload.Body)
		sendPushToBabyMembers(b.id, payload)
		sent++
	}

	log.Printf("[DailySummary] Sent %d summary notification(s)", sent)
}
