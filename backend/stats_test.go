package main

import (
	"net/http"
	"testing"
	"time"
)

func TestAvg(t *testing.T) {
	if avg(nil) != 0 {
		t.Errorf("empty avg should be 0")
	}
	if avg([]float64{2, 4, 6}) != 4 {
		t.Errorf("avg wrong")
	}
}

func TestNumField(t *testing.T) {
	m := map[string]interface{}{"a": float64(5), "b": "str"}
	if numField(m, "a") != 5 {
		t.Errorf("numeric field wrong")
	}
	if numField(m, "b") != 0 {
		t.Errorf("non-numeric should be 0")
	}
	if numField(m, "missing") != 0 {
		t.Errorf("missing should be 0")
	}
}

func TestSleepMinutesValue(t *testing.T) {
	if got := sleepMinutesValue(30.0); got != int64(30) {
		t.Errorf("whole number should be int64, got %v (%T)", got, got)
	}
	if got := sleepMinutesValue(30.5); got != 30.5 {
		t.Errorf("fractional should stay float, got %v", got)
	}
}

func TestStatsSummary(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	recent := time.Now().Add(-30 * time.Minute).UTC().Format(isoLayout)
	createRecord(t, s, uid, bid, "feeding", "bottle", map[string]interface{}{"amountMl": 100}, recent)
	createRecord(t, s, uid, bid, "nursing", "diaper", map[string]interface{}{"type": "wet"}, recent)

	e := mustOK(t, s.do(http.MethodGet, "/stats/summary?babyId="+bid, uid, nil))
	var summary struct {
		LastFeeding *struct {
			MinutesAgo int `json:"minutesAgo"`
		} `json:"lastFeeding"`
		LastDiaper *struct {
			MinutesAgo int `json:"minutesAgo"`
		} `json:"lastDiaper"`
		LastSleep interface{} `json:"lastSleep"`
	}
	jsonUnmarshal(e.Data, &summary)
	if summary.LastFeeding == nil || summary.LastFeeding.MinutesAgo < 29 || summary.LastFeeding.MinutesAgo > 31 {
		t.Errorf("lastFeeding minutesAgo wrong: %+v", summary.LastFeeding)
	}
	if summary.LastDiaper == nil {
		t.Errorf("lastDiaper should be present")
	}
	if summary.LastSleep != nil {
		t.Errorf("lastSleep should be null when no sleep records")
	}
}

func TestStatsDaily(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	// 使用 UTC 当天
	day := "2025-06-01"
	createRecord(t, s, uid, bid, "feeding", "bottle", map[string]interface{}{"amountMl": 100}, "2025-06-01T08:00:00.000Z")
	createRecord(t, s, uid, bid, "feeding", "breastfeed", map[string]interface{}{"leftMinutes": 10}, "2025-06-01T12:00:00.000Z")
	createRecord(t, s, uid, bid, "nursing", "diaper", map[string]interface{}{"type": "both"}, "2025-06-01T09:00:00.000Z")
	createRecord(t, s, uid, bid, "activity", "sleep", map[string]interface{}{"durationMinutes": 45}, "2025-06-01T14:00:00.000Z")

	e := mustOK(t, s.do(http.MethodGet, "/stats/daily?babyId="+bid+"&date="+day+"&tz=0", uid, nil))
	var daily struct {
		FeedingCount   int            `json:"feedingCount"`
		DiaperCount    int            `json:"diaperCount"`
		PeeCount       int            `json:"peeCount"`
		PoopCount      int            `json:"poopCount"`
		SleepMinutes   float64        `json:"sleepMinutes"`
		FeedingDetails map[string]int `json:"feedingDetails"`
	}
	jsonUnmarshal(e.Data, &daily)
	if daily.FeedingCount != 2 {
		t.Errorf("feedingCount got %d", daily.FeedingCount)
	}
	if daily.DiaperCount != 1 || daily.PeeCount != 1 || daily.PoopCount != 1 {
		t.Errorf("diaper counts wrong: %+v", daily)
	}
	if daily.SleepMinutes != 45 {
		t.Errorf("sleepMinutes got %v", daily.SleepMinutes)
	}
	if daily.FeedingDetails["bottle"] != 1 || daily.FeedingDetails["breastfeed"] != 1 {
		t.Errorf("feedingDetails wrong: %+v", daily.FeedingDetails)
	}
}

func TestStatsPredictInsufficientData(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	// 少于 2 条 feeding -> nextFeeding null
	createRecord(t, s, uid, bid, "feeding", "bottle", map[string]interface{}{"amountMl": 100}, "2025-06-01T08:00:00.000Z")

	e := mustOK(t, s.do(http.MethodGet, "/stats/predict?babyId="+bid, uid, nil))
	var predict map[string]interface{}
	jsonUnmarshal(e.Data, &predict)
	if predict["nextFeeding"] != nil {
		t.Errorf("nextFeeding should be null, got %v", predict["nextFeeding"])
	}
}

func TestStatsPredictBottle(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	// 5 次奶瓶喂养，每次 120ml，间隔 180 分钟；最后一次 30 分钟前。
	now := time.Now()
	for i := 0; i < 5; i++ {
		ts := now.Add(-time.Duration(30+i*180) * time.Minute)
		insertFeeding(t, bid, uid, "bottle", 120, ts)
	}

	s := &testServer{t: t, handler: buildRouter(t.TempDir(), "")}
	e := mustOK(t, s.do(http.MethodGet, "/stats/predict?babyId="+bid, uid, nil))
	var predict struct {
		MinutesUntilNext   *int    `json:"minutesUntilNext"`
		AvgIntervalMinutes *int    `json:"avgIntervalMinutes"`
		Method             *string `json:"method"`
	}
	jsonUnmarshal(e.Data, &predict)
	if predict.Method == nil || *predict.Method != "bottle" {
		t.Fatalf("expected bottle method, got %+v", predict.Method)
	}
	// 速率 180/120=1.5，预测间隔 = 1.5*120 = 180 分钟。
	if predict.AvgIntervalMinutes == nil || *predict.AvgIntervalMinutes != 180 {
		t.Errorf("expected interval 180, got %+v", predict.AvgIntervalMinutes)
	}
}

func TestStatsPredictAverageFallback(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	// solid 类型不参与 bottle/breast 速率，走平均间隔回退分支。
	now := time.Now()
	for i := 0; i < 4; i++ {
		ts := now.Add(-time.Duration(30+i*120) * time.Minute)
		insertFeeding(t, bid, uid, "solid", 0, ts)
	}

	s := &testServer{t: t, handler: buildRouter(t.TempDir(), "")}
	e := mustOK(t, s.do(http.MethodGet, "/stats/predict?babyId="+bid, uid, nil))
	var predict struct {
		Method *string `json:"method"`
	}
	jsonUnmarshal(e.Data, &predict)
	if predict.Method == nil || *predict.Method != "average" {
		t.Fatalf("expected average method, got %+v", predict.Method)
	}
}

func TestStatsPermission(t *testing.T) {
	s := newTestServer(t)
	owner := insertUser(t, "owner", "Owner", "user")
	bid := createBabyFor(t, owner, "宝宝")
	other := insertUser(t, "other", "Other", "user")

	r := s.do(http.MethodGet, "/stats/summary?babyId="+bid, other, nil)
	if r.status != http.StatusForbidden {
		t.Fatalf("non-member expected 403, got %d", r.status)
	}
}
