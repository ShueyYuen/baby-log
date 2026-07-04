package main

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"time"
)

// GET /stats/summary
func handleStatsSummary(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	babyID := r.URL.Query().Get("babyId")
	if babyID == "" {
		writeErr(w, http.StatusBadRequest, "babyId required")
		return
	}

	ok, err := findMembership(babyID, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	now := time.Now()

	lastAgo := func(query string, args ...interface{}) map[string]interface{} {
		var occurred int64
		if err := db.QueryRow(query, args...).Scan(&occurred); err != nil {
			return nil
		}
		t := time.UnixMilli(occurred)
		return map[string]interface{}{
			"time":       Millis(occurred),
			"minutesAgo": int(math.Round(float64(now.Sub(t).Milliseconds()) / 60000.0)),
		}
	}

	summary := map[string]interface{}{
		"lastFeeding": lastAgo(`SELECT occurredAt FROM "Record" WHERE babyId = ? AND category = 'feeding' ORDER BY occurredAt DESC LIMIT 1`, babyID),
		"lastDiaper":  lastAgo(`SELECT occurredAt FROM "Record" WHERE babyId = ? AND category = 'nursing' AND type = 'diaper' ORDER BY occurredAt DESC LIMIT 1`, babyID),
		"lastSleep":   lastAgo(`SELECT occurredAt FROM "Record" WHERE babyId = ? AND category = 'activity' AND type = 'sleep' ORDER BY occurredAt DESC LIMIT 1`, babyID),
	}

	writeOK(w, summary)
}

type feedingRec struct {
	occurredAt int64
	typ        string
	data       map[string]interface{}
}

func loadRecentFeedings(babyID string, limit int) ([]feedingRec, error) {
	rows, err := db.Query(`SELECT type, data, occurredAt FROM "Record" WHERE babyId = ? AND category = 'feeding' ORDER BY occurredAt DESC LIMIT ?`, babyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []feedingRec
	for rows.Next() {
		var typ, dataStr string
		var occurred int64
		if err := rows.Scan(&typ, &dataStr, &occurred); err != nil {
			return nil, err
		}
		m := map[string]interface{}{}
		_ = json.Unmarshal([]byte(dataStr), &m)
		out = append(out, feedingRec{occurredAt: occurred, typ: typ, data: m})
	}
	return out, nil
}

func numField(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

func avg(nums []float64) float64 {
	if len(nums) == 0 {
		return 0
	}
	sum := 0.0
	for _, n := range nums {
		sum += n
	}
	return sum / float64(len(nums))
}

// GET /stats/predict
func handleStatsPredict(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	babyID := r.URL.Query().Get("babyId")
	if babyID == "" {
		writeErr(w, http.StatusBadRequest, "babyId required")
		return
	}

	ok, err := findMembership(babyID, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	parsed, err := loadRecentFeedings(babyID, 30)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if len(parsed) < 2 {
		writeOK(w, map[string]interface{}{"nextFeeding": nil, "avgIntervalMinutes": nil, "method": nil})
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
	var method *string

	if lastFeeding.typ == "bottle" && len(bottleRates) >= 2 {
		avgRate := avg(bottleRates)
		ml := numField(lastFeeding.data, "amountMl")
		v := int(math.Round(avgRate * ml))
		predictedInterval = &v
		m := "bottle"
		method = &m
	} else if lastFeeding.typ == "breastfeed" && len(breastRates) >= 2 {
		avgRate := avg(breastRates)
		totalMin := numField(lastFeeding.data, "leftMinutes") + numField(lastFeeding.data, "rightMinutes")
		v := int(math.Round(avgRate * totalMin))
		predictedInterval = &v
		m := "breastfeed"
		method = &m
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
			m := "average"
			method = &m
		}
	}

	if predictedInterval == nil {
		writeOK(w, map[string]interface{}{"minutesUntilNext": nil, "avgIntervalMinutes": nil, "method": nil})
		return
	}

	now := time.Now().UnixMilli()
	nextFeedingTime := lastFeedingTime + int64(*predictedInterval)*60000
	minutesUntilNext := int(math.Round(float64(nextFeedingTime-now) / 60000.0))

	writeOK(w, map[string]interface{}{
		"minutesUntilNext":   minutesUntilNext,
		"avgIntervalMinutes": *predictedInterval,
		"method":             *method,
	})
}

// GET /stats/daily
func handleStatsDaily(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	babyID := r.URL.Query().Get("babyId")
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	if babyID == "" {
		writeErr(w, http.StatusBadRequest, "babyId required")
		return
	}

	ok, err := findMembership(babyID, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	tzOffset := parseIntDefault(r.URL.Query().Get("tz"), 0)
	baseT, err := time.Parse("2006-01-02", date)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid date")
		return
	}
	base := baseT.UnixMilli()
	startOfDay := base + int64(tzOffset)*60000
	endOfDay := base + int64(tzOffset)*60000 + 24*60*60*1000 - 1

	rows, err := db.Query(`SELECT category, type, data FROM "Record" WHERE babyId = ? AND occurredAt >= ? AND occurredAt <= ?`,
		babyID, startOfDay, endOfDay)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	feedingCount, diaperCount, peeCount, poopCount := 0, 0, 0, 0
	sleepMinutes := 0.0
	feedingDetails := map[string]int{"breastfeed": 0, "bottle": 0, "solid": 0}

	for rows.Next() {
		var category, typ, dataStr string
		if err := rows.Scan(&category, &typ, &dataStr); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		if category == "feeding" {
			feedingCount++
			if typ == "breastfeed" {
				feedingDetails["breastfeed"]++
			} else if typ == "bottle" {
				feedingDetails["bottle"]++
			} else if typ == "solid" {
				feedingDetails["solid"]++
			}
		} else if typ == "diaper" {
			diaperCount++
			m := map[string]interface{}{}
			_ = json.Unmarshal([]byte(dataStr), &m)
			dt, _ := m["type"].(string)
			if dt == "wet" || dt == "both" {
				peeCount++
			}
			if dt == "dirty" || dt == "both" {
				poopCount++
			}
		} else if typ == "sleep" {
			m := map[string]interface{}{}
			_ = json.Unmarshal([]byte(dataStr), &m)
			sleepMinutes += numField(m, "durationMinutes")
		}
	}

	writeOK(w, map[string]interface{}{
		"date":           date,
		"feedingCount":   feedingCount,
		"diaperCount":    diaperCount,
		"peeCount":       peeCount,
		"poopCount":      poopCount,
		"sleepMinutes":   sleepMinutesValue(sleepMinutes),
		"feedingDetails": feedingDetails,
	})
}

// sleepMinutes 在原实现中是数值相加，可能是整数或小数，这里保持数值类型。
func sleepMinutesValue(v float64) interface{} {
	if v == math.Trunc(v) {
		return int64(v)
	}
	return v
}

var _ = sql.ErrNoRows
