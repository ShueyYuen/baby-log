package main

import (
	"log"
	"math"

	"github.com/google/uuid"
)

// createAutoFeedingReminder 根据近期喂养规律预测下次喂奶时间并创建自动提醒。
func createAutoFeedingReminder(babyID string) {
	log.Printf("[AutoReminder] Computing prediction for baby %s", babyID)

	parsed, err := loadRecentFeedings(babyID, 30)
	if err != nil || len(parsed) < 2 {
		return
	}

	var bottleRates, breastRates []float64
	for i := 0; i < len(parsed)-1; i++ {
		current := parsed[i+1]
		next := parsed[i]
		intervalMin := float64(next.occurredAt-current.occurredAt) / 60000.0
		if intervalMin <= 0 || intervalMin > 480 {
			continue
		}
		if current.typ == "bottle" {
			ml := numField(current.data, "amountMl")
			if ml > 0 {
				bottleRates = append(bottleRates, intervalMin/ml)
			}
		} else if current.typ == "breastfeed" {
			totalMin := numField(current.data, "leftMinutes") + numField(current.data, "rightMinutes")
			if totalMin > 0 {
				breastRates = append(breastRates, intervalMin/totalMin)
			}
		}
	}

	lastFeeding := parsed[0]
	lastFeedingTime := lastFeeding.occurredAt
	var predictedInterval *int

	if lastFeeding.typ == "bottle" && len(bottleRates) >= 2 {
		v := int(math.Round(avg(bottleRates) * numField(lastFeeding.data, "amountMl")))
		predictedInterval = &v
	} else if lastFeeding.typ == "breastfeed" && len(breastRates) >= 2 {
		totalMin := numField(lastFeeding.data, "leftMinutes") + numField(lastFeeding.data, "rightMinutes")
		v := int(math.Round(avg(breastRates) * totalMin))
		predictedInterval = &v
	}

	if predictedInterval == nil {
		var intervals []float64
		for i := 0; i < len(parsed)-1; i++ {
			diff := float64(parsed[i].occurredAt-parsed[i+1].occurredAt) / 60000.0
			if diff > 0 && diff <= 480 {
				intervals = append(intervals, diff)
			}
		}
		if len(intervals) >= 2 {
			v := int(math.Round(avg(intervals)))
			predictedInterval = &v
		}
	}

	if predictedInterval == nil {
		return
	}

	remindAt := lastFeedingTime + int64(*predictedInterval)*60000
	if remindAt <= int64(nowMillis()) {
		log.Printf("[AutoReminder] Predicted time is in the past, skipping")
		return
	}

	// 删除该宝宝旧的未发送自动提醒
	if _, err := db.Exec(`DELETE FROM "Reminder" WHERE babyId = ? AND source = 'feeding_auto' AND sent = 0`, babyID); err != nil {
		log.Printf("[AutoReminder] Failed to clear old reminders: %v", err)
	}

	id := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO "Reminder" (id, babyId, remindAt, source, title, body, refId, sent, createdAt)
		VALUES (?, ?, ?, 'feeding_auto', ?, ?, NULL, 0, ?)`,
		id, babyID, remindAt, "喂奶提醒", "根据喂养规律，宝宝预计需要喂奶了", int64(nowMillis())); err != nil {
		log.Printf("[AutoReminder] Failed to create reminder: %v", err)
		return
	}

	log.Printf("[AutoReminder] Created reminder %s for baby %s (in %d min)", id, babyID, *predictedInterval)
}
