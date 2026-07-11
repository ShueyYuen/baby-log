package main

import (
	"database/sql"
	"encoding/json"
	"log"
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

// feedingEndMs estimates when the feeding session ended.
func feedingEndMs(f feedingRec) int64 {
	switch f.typ {
	case "breastfeed":
		dur := numField(f.data, "leftMinutes") + numField(f.data, "rightMinutes")
		if dur > 0 {
			return f.occurredAt + int64(dur*60000)
		}
	case "bottle":
		ml := numField(f.data, "amountMl")
		if ml > 0 {
			est := math.Max(5, math.Min(ml/4, 30))
			return f.occurredAt + int64(est*60000)
		}
	}
	return f.occurredAt + 15*60000
}

// feedingSession groups consecutive feedings that are close together.
type feedingSession struct {
	startMs int64
	endMs   int64
}

// clusterFeedings merges consecutive feeding records (already sorted DESC)
// into sessions. Two feedings belong to the same session if the gap between
// the estimated end of one and the start of the next is < threshold.
func clusterFeedings(recs []feedingRec, thresholdMs int64) []feedingSession {
	if len(recs) == 0 {
		return nil
	}
	// recs are DESC; iterate in chronological order (oldest first)
	var sessions []feedingSession
	i := len(recs) - 1
	cur := feedingSession{startMs: recs[i].occurredAt, endMs: feedingEndMs(recs[i])}
	i--
	for ; i >= 0; i-- {
		r := recs[i]
		end := feedingEndMs(r)
		if r.occurredAt-cur.endMs < thresholdMs {
			if end > cur.endMs {
				cur.endMs = end
			}
		} else {
			sessions = append(sessions, cur)
			cur = feedingSession{startMs: r.occurredAt, endMs: end}
		}
	}
	sessions = append(sessions, cur)
	return sessions
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

func bottleAmountFromData(m map[string]interface{}) float64 {
	if v := numField(m, "amountMl"); v > 0 {
		return v
	}
	return numField(m, "amount")
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
	bottleAmountMl := 0.0
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
				m := map[string]interface{}{}
				_ = json.Unmarshal([]byte(dataStr), &m)
				bottleAmountMl += bottleAmountFromData(m)
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
		"bottleAmountMl": bottleAmountMl,
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
	bottleAmountMl float64
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
			if typ == "bottle" {
				m := map[string]interface{}{}
				_ = json.Unmarshal([]byte(dataStr), &m)
				agg.bottleAmountMl += bottleAmountFromData(m)
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
			"bottleAmountMl": agg.bottleAmountMl,
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
		rec.Images = recordImagesToDisplay(parseRecordImages(images), userID, isAdminCtx(r), rec.CreatedBy)
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

const clusterGapMs = 30 * 60 * 1000 // feedings within 30 min are one session

// buildPrediction extracts the prediction logic so it can be reused.
//
// It clusters consecutive feedings that are ≤30 min apart into "sessions"
// and computes intervals between session-end → session-start. This avoids
// treating split/top-up feedings as separate cycles and gives more realistic
// inter-session intervals.
//
// When the last feeding was bottle or breastfeed, a per-unit rate (min/ml or
// min/feedingMin) is used for more accurate prediction. Otherwise, the plain
// average session-to-session interval is used.
//
// Yesterday's data is preferred as it represents a full day's pattern.
func buildPrediction(babyID string) map[string]interface{} {
	nilResult := map[string]interface{}{"minutesUntilNext": nil, "avgIntervalMinutes": nil, "method": nil}

	parsed, err := loadRecentFeedings(babyID, 60)
	if err != nil {
		log.Printf("[Prediction] loadRecentFeedings error: %v", err)
		return nilResult
	}
	if len(parsed) < 2 {
		log.Printf("[Prediction] only %d feeding records (need ≥2)", len(parsed))
		return nilResult
	}
	log.Printf("[Prediction] loaded %d feedings, latest type=%s at %d", len(parsed), parsed[0].typ, parsed[0].occurredAt)

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).UnixMilli()
	yesterdayStart := todayStart - 24*60*60*1000

	var yesterdayFeedings []feedingRec
	for _, f := range parsed {
		if f.occurredAt >= yesterdayStart && f.occurredAt < todayStart {
			yesterdayFeedings = append(yesterdayFeedings, f)
		}
	}

	sessions := clusterFeedings(parsed, clusterGapMs)

	computeIntervals := func(sess []feedingSession) []float64 {
		var out []float64
		for i := 0; i < len(sess)-1; i++ {
			gap := float64(sess[i+1].startMs-sess[i].endMs) / 60000.0
			if gap > 0 && gap <= 960 {
				out = append(out, gap)
			}
		}
		return out
	}

	// Prefer yesterday's sessions; fall back to all.
	ySessions := clusterFeedings(yesterdayFeedings, clusterGapMs)
	sessionIntervals := computeIntervals(ySessions)
	if len(sessionIntervals) < 2 {
		sessionIntervals = computeIntervals(sessions)
	}

	// Per-unit rates still use raw records (not sessions) but only
	// look at pairs that are in different sessions (gap ≥ clusterGap).
	var bottleRates, breastRates []float64
	for i := 0; i < len(parsed)-1; i++ {
		current := parsed[i+1]
		next := parsed[i]
		gap := float64(next.occurredAt-feedingEndMs(current)) / 60000.0
		if gap < 0 || gap > 960 {
			continue
		}
		startToStart := float64(next.occurredAt-current.occurredAt) / 60000.0
		if startToStart < 30 {
			continue
		}
		if current.typ == "bottle" {
			ml := numField(current.data, "amountMl")
			if ml > 0 {
				bottleRates = append(bottleRates, startToStart/ml)
			}
		} else if current.typ == "breastfeed" {
			totalMin := numField(current.data, "leftMinutes") + numField(current.data, "rightMinutes")
			if totalMin > 0 {
				breastRates = append(breastRates, startToStart/totalMin)
			}
		}
	}

	lastFeeding := parsed[0]
	lastSession := sessions[len(sessions)-1]
	var predictedInterval *int
	var method *string

	log.Printf("[Prediction] sessions=%d, sessionIntervals=%d, bottleRates=%d, breastRates=%d, lastType=%s",
		len(sessions), len(sessionIntervals), len(bottleRates), len(breastRates), lastFeeding.typ)

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

	if predictedInterval == nil && len(sessionIntervals) >= 2 {
		dur := avg(sessionIntervals)
		feedDur := float64(lastSession.endMs-lastSession.startMs) / 60000.0
		v := int(math.Round(dur + feedDur))
		predictedInterval = &v
		m := "average"
		method = &m
	}

	if predictedInterval == nil {
		log.Printf("[Prediction] no valid prediction method found")
		return nilResult
	}

	// Predict from last session start, not last session end, because
	// predictedInterval already accounts for feeding duration.
	nowMs := now.UnixMilli()
	nextFeedingTime := lastSession.startMs + int64(*predictedInterval)*60000
	minutesUntilNext := int(math.Round(float64(nextFeedingTime-nowMs) / 60000.0))

	return map[string]interface{}{
		"minutesUntilNext":   minutesUntilNext,
		"avgIntervalMinutes": *predictedInterval,
		"method":             *method,
	}
}

var _ = sql.ErrNoRows
