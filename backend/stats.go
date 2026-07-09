package main

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
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

	writeOK(w, buildPrediction(babyID))
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

// dailyAgg 表示单日聚合结果，字段与 /stats/daily 返回一致。
type dailyAgg struct {
	feedingCount   int
	diaperCount    int
	peeCount       int
	poopCount      int
	sleepMinutes   float64
	feedingDetails map[string]int
}

// GET /stats/range?babyId=&startDate=&endDate=&tz=
// 一次性返回 [startDate, endDate] 区间内每天的统计，替代前端按天多次调用 /stats/daily。
func handleStatsRange(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	q := r.URL.Query()
	babyID := q.Get("babyId")
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

	startDate := q.Get("startDate")
	endDate := q.Get("endDate")
	if startDate == "" || endDate == "" {
		writeErr(w, http.StatusBadRequest, "startDate and endDate required")
		return
	}
	startT, err := time.Parse("2006-01-02", startDate)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid startDate")
		return
	}
	endT, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid endDate")
		return
	}
	if endT.Before(startT) {
		writeErr(w, http.StatusBadRequest, "endDate must be >= startDate")
		return
	}
	numDays := int(endT.Sub(startT).Hours()/24) + 1
	if numDays > 92 {
		writeErr(w, http.StatusBadRequest, "range too large")
		return
	}

	tzOffset := parseIntDefault(q.Get("tz"), 0)
	const dayMs = 24 * 60 * 60 * 1000
	firstStart := startT.UnixMilli() + int64(tzOffset)*60000
	rangeEnd := endT.UnixMilli() + int64(tzOffset)*60000 + dayMs - 1

	dates := make([]string, numDays)
	aggs := make([]*dailyAgg, numDays)
	for i := 0; i < numDays; i++ {
		dates[i] = startT.AddDate(0, 0, i).Format("2006-01-02")
		aggs[i] = &dailyAgg{feedingDetails: map[string]int{"breastfeed": 0, "bottle": 0, "solid": 0}}
	}

	rows, err := db.Query(`SELECT category, type, data, occurredAt FROM "Record" WHERE babyId = ? AND occurredAt >= ? AND occurredAt <= ?`,
		babyID, firstStart, rangeEnd)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var category, typ, dataStr string
		var occurred int64
		if err := rows.Scan(&category, &typ, &dataStr, &occurred); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		idx := int((occurred - firstStart) / dayMs)
		if idx < 0 || idx >= numDays {
			continue
		}
		agg := aggs[idx]
		switch {
		case category == "feeding":
			agg.feedingCount++
			if _, ok := agg.feedingDetails[typ]; ok {
				agg.feedingDetails[typ]++
			}
		case typ == "diaper":
			agg.diaperCount++
			m := map[string]interface{}{}
			_ = json.Unmarshal([]byte(dataStr), &m)
			dt, _ := m["type"].(string)
			if dt == "wet" || dt == "both" {
				agg.peeCount++
			}
			if dt == "dirty" || dt == "both" {
				agg.poopCount++
			}
		case typ == "sleep":
			m := map[string]interface{}{}
			_ = json.Unmarshal([]byte(dataStr), &m)
			agg.sleepMinutes += numField(m, "durationMinutes")
		}
	}

	out := make([]map[string]interface{}, numDays)
	for i, agg := range aggs {
		out[i] = map[string]interface{}{
			"date":           dates[i],
			"feedingCount":   agg.feedingCount,
			"diaperCount":    agg.diaperCount,
			"peeCount":       agg.peeCount,
			"poopCount":      agg.poopCount,
			"sleepMinutes":   sleepMinutesValue(agg.sleepMinutes),
			"feedingDetails": agg.feedingDetails,
		}
	}
	writeOK(w, out)
}

// sleepMinutes 在原实现中是数值相加，可能是整数或小数，这里保持数值类型。
func sleepMinutesValue(v float64) interface{} {
	if v == math.Trunc(v) {
		return int64(v)
	}
	return v
}

// GET /timeline — 合并 records + summary + predict 为单次请求
func handleTimeline(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	q := r.URL.Query()
	babyID := q.Get("babyId")
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

	pageSize := parseIntDefault(q.Get("pageSize"), 50)
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}

	where := `WHERE r.babyId = ?`
	args := []interface{}{babyID}
	if v := q.Get("category"); v != "" {
		where += ` AND r.category = ?`
		args = append(args, v)
	}
	if v := q.Get("search"); v != "" {
		where += ` AND (r.note LIKE ? OR r.data LIKE ?)`
		like := "%" + v + "%"
		args = append(args, like, like)
	}
	if v := q.Get("before"); v != "" {
		beforeMs, err := strconv.ParseInt(v, 10, 64)
		if err == nil && beforeMs > 0 {
			where += ` AND r.occurredAt < ?`
			args = append(args, beforeMs)
		}
	}

	listArgs := append([]interface{}{}, args...)
	listArgs = append(listArgs, pageSize+1)
	rows, err := db.Query(`
		SELECT r.id, r.babyId, r.category, r.type, r.data, r.occurredAt, r.note, r.images, r.createdBy, r.createdAt, r.updatedAt, u.id, u.displayName
		FROM "Record" r
		JOIN "User" u ON u.id = r.createdBy
		`+where+`
		ORDER BY r.occurredAt DESC
		LIMIT ?`, listArgs...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	items := []recordOut{}
	for rows.Next() {
		var rec recordOut
		var dataStr string
		var occurred, created, updated int64
		var note, images sql.NullString
		var uID, uName string
		if err := rows.Scan(&rec.ID, &rec.BabyID, &rec.Category, &rec.Type, &dataStr, &occurred, &note, &images, &rec.CreatedBy, &created, &updated, &uID, &uName); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		rec.Data = json.RawMessage(dataStr)
		rec.OccurredAt = Millis(occurred)
		rec.CreatedAt = Millis(created)
		rec.UpdatedAt = Millis(updated)
		rec.Note = strPtr(note)
		rec.Images = recordImagesToDisplay(parseRecordImages(images), userID, isAdminCtx(r))
		rec.User = &memberUser{ID: uID, DisplayName: uName}
		items = append(items, rec)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	hasMore := len(items) > pageSize
	if hasMore {
		items = items[:pageSize]
	}

	isBefore := q.Get("before") != ""

	result := map[string]interface{}{
		"records": items,
		"hasMore": hasMore,
	}

	if !isBefore {
		// Summary & prediction only on the first page
		now := time.Now()
		lastAgo := func(query string, qargs ...interface{}) map[string]interface{} {
			var occurred int64
			if err := db.QueryRow(query, qargs...).Scan(&occurred); err != nil {
				return nil
			}
			t := time.UnixMilli(occurred)
			return map[string]interface{}{
				"time":       Millis(occurred),
				"minutesAgo": int(math.Round(float64(now.Sub(t).Milliseconds()) / 60000.0)),
			}
		}
		result["summary"] = map[string]interface{}{
			"lastFeeding": lastAgo(`SELECT occurredAt FROM "Record" WHERE babyId = ? AND category = 'feeding' ORDER BY occurredAt DESC LIMIT 1`, babyID),
			"lastDiaper":  lastAgo(`SELECT occurredAt FROM "Record" WHERE babyId = ? AND category = 'nursing' AND type = 'diaper' ORDER BY occurredAt DESC LIMIT 1`, babyID),
			"lastSleep":   lastAgo(`SELECT occurredAt FROM "Record" WHERE babyId = ? AND category = 'activity' AND type = 'sleep' ORDER BY occurredAt DESC LIMIT 1`, babyID),
		}
		result["prediction"] = buildPrediction(babyID)
	}

	writeOK(w, result)
}

// buildPrediction extracts the prediction logic so it can be reused.
func buildPrediction(babyID string) map[string]interface{} {
	parsed, err := loadRecentFeedings(babyID, 30)
	if err != nil || len(parsed) < 2 {
		return map[string]interface{}{"minutesUntilNext": nil, "avgIntervalMinutes": nil, "method": nil}
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
		return map[string]interface{}{"minutesUntilNext": nil, "avgIntervalMinutes": nil, "method": nil}
	}

	nowMs := time.Now().UnixMilli()
	nextFeedingTime := lastFeedingTime + int64(*predictedInterval)*60000
	minutesUntilNext := int(math.Round(float64(nextFeedingTime-nowMs) / 60000.0))

	return map[string]interface{}{
		"minutesUntilNext":   minutesUntilNext,
		"avgIntervalMinutes": *predictedInterval,
		"method":             *method,
	}
}

var _ = sql.ErrNoRows
