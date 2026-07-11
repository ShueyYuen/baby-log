package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

func scanPlanRow(row interface {
	Scan(dest ...interface{}) error
}, userID string, isAdmin bool,
) (*planOut, error) {
	var p planOut
	var scheduled, created, updated int64
	var desc, reminder, imagesJSON sql.NullString
	if err := row.Scan(&p.ID, &p.BabyID, &p.Title, &p.Type, &scheduled, &desc, &reminder, &p.Repeat, &p.Status, &p.CreatedBy, &created, &updated, &imagesJSON); err != nil {
		return nil, err
	}
	p.ScheduledAt = Millis(scheduled)
	p.CreatedAt = Millis(created)
	p.UpdatedAt = Millis(updated)
	p.Description = strPtr(desc)
	p.Reminder = strPtr(reminder)
	stored := parseRecordImages(imagesJSON)
	p.Images = recordImagesToDisplay(stored, userID, isAdmin, p.CreatedBy)
	return &p, nil
}

const planCols = `id, babyId, title, type, scheduledAt, description, reminder, repeat, status, createdBy, createdAt, updatedAt, images`

// GET /plans
func handleListPlans(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	isAdmin := isAdminCtx(r)
	babyID := r.URL.Query().Get("babyId")
	status := r.URL.Query().Get("status")

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

	q := r.URL.Query()
	page := parseIntDefault(q.Get("page"), 1)
	pageSize := parseIntDefault(q.Get("pageSize"), 50)
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}

	where := `WHERE babyId = ?`
	args := []interface{}{babyID}
	if status != "" {
		where += ` AND status = ?`
		args = append(args, status)
	}
	if from := q.Get("from"); from != "" {
		where += ` AND scheduledAt >= ?`
		args = append(args, from)
	}
	if to := q.Get("to"); to != "" {
		where += ` AND scheduledAt < ?`
		args = append(args, to)
	}

	var total int
	db.QueryRow(`SELECT COUNT(*) FROM "Plan" `+where, args...).Scan(&total)

	query := `SELECT ` + planCols + ` FROM "Plan" ` + where + ` ORDER BY scheduledAt ASC LIMIT ? OFFSET ?`
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := db.Query(query, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	plans := []planOut{}
	for rows.Next() {
		p, err := scanPlanRow(rows, userID, isAdmin)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		plans = append(plans, *p)
	}

	writeOK(w, map[string]interface{}{
		"items":    plans,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"hasMore":  page*pageSize < total,
	})
}

// POST /plans
func handleCreatePlan(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID      string             `json:"babyId"`
		Title       string             `json:"title"`
		Type        string             `json:"type"`
		ScheduledAt string             `json:"scheduledAt"`
		Description *string            `json:"description"`
		Reminder    *string            `json:"reminder"`
		Repeat      *string            `json:"repeat"`
		Images      []RecordImageStore `json:"images"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" || body.Title == "" || !isValidPlanType(body.Type) || body.ScheduledAt == "" {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	repeat := "none"
	if body.Repeat != nil && *body.Repeat != "" {
		if !isValidRepeat(*body.Repeat) {
			writeErr(w, http.StatusBadRequest, "Invalid input")
			return
		}
		repeat = *body.Repeat
	}

	scheduled, err := millisFromInput(body.ScheduledAt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid scheduledAt")
		return
	}

	ok, err := findMembership(body.BabyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	id := uuid.NewString()
	now := nowMillis()

	var imagesJSON sql.NullString
	if len(body.Images) > 0 {
		b, _ := json.Marshal(body.Images)
		imagesJSON = sql.NullString{String: string(b), Valid: true}
		keys := make([]string, 0, len(body.Images)*2)
		for _, img := range body.Images {
			keys = append(keys, img.Key)
			if img.RawKey != "" {
				keys = append(keys, img.RawKey)
			}
		}
		markUploadedFilesUsed(keys)
	}

	if _, err := db.Exec(`INSERT INTO "Plan" (id, babyId, title, type, scheduledAt, description, reminder, repeat, status, createdBy, createdAt, updatedAt, images)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
		id, body.BabyID, body.Title, body.Type, int64(scheduled),
		nullStringFromPtr(body.Description), nullStringFromPtr(body.Reminder), repeat, userID, int64(now), int64(now), imagesJSON); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	// 为该计划创建提醒
	nowMs := int64(nowMillis())
	if int64(scheduled) > nowMs {
		reminderMinutes := 30
		if body.Reminder != nil && *body.Reminder != "" {
			if n, err := strconv.Atoi(*body.Reminder); err == nil && n != 0 {
				reminderMinutes = n
			}
		}
		remindAt := int64(scheduled) - int64(reminderMinutes)*60000
		if remindAt > nowMs {
			_, _ = db.Exec(`INSERT INTO "Reminder" (id, babyId, remindAt, source, title, body, refId, sent, createdAt)
				VALUES (?, ?, ?, 'plan', ?, ?, ?, 0, ?)`,
				uuid.NewString(), body.BabyID, remindAt,
				"📋 "+body.Title, "计划将在"+strconv.Itoa(reminderMinutes)+"分钟后开始", id, nowMs)
		}
	}

	row := db.QueryRow(`SELECT `+planCols+` FROM "Plan" WHERE id = ?`, id)
	p, err := scanPlanRow(row, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, p)
	publishEvent(DataEvent{Type: EventPlanCreated, BabyID: body.BabyID, ID: id, UserID: userID})
}

// PUT /plans/{id}
func handleUpdatePlan(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID, oldStatus string
	if err := db.QueryRow(`SELECT babyId, status FROM "Plan" WHERE id = ?`, id).Scan(&babyID, &oldStatus); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(babyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	var body map[string]json.RawMessage
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	sets := []string{}
	args := []interface{}{}
	statusToCompleted := false
	if raw, ok := body["status"]; ok {
		if s := jsonString(raw); s == "completed" && oldStatus != "completed" {
			statusToCompleted = true
		}
	}
	if raw, ok := body["title"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "title = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["type"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "type = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["scheduledAt"]; ok {
		if s := jsonString(raw); s != "" {
			if m, err := millisFromInput(s); err == nil {
				sets = append(sets, "scheduledAt = ?")
				args = append(args, int64(m))
			}
		}
	}
	if raw, ok := body["description"]; ok {
		if string(raw) == "null" {
			sets = append(sets, "description = ?")
			args = append(args, nil)
		} else {
			sets = append(sets, "description = ?")
			args = append(args, jsonString(raw))
		}
	}
	if raw, ok := body["reminder"]; ok {
		if string(raw) == "null" {
			sets = append(sets, "reminder = ?")
			args = append(args, nil)
		} else {
			sets = append(sets, "reminder = ?")
			args = append(args, jsonString(raw))
		}
	}
	if raw, ok := body["repeat"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "repeat = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["status"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "status = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["images"]; ok {
		var newImages []RecordImageStore
		if err := json.Unmarshal(raw, &newImages); err == nil {
			b, _ := json.Marshal(newImages)
			sets = append(sets, "images = ?")
			args = append(args, string(b))
			keys := make([]string, 0, len(newImages)*2)
			for _, img := range newImages {
				keys = append(keys, img.Key)
				if img.RawKey != "" {
					keys = append(keys, img.RawKey)
				}
			}
			markUploadedFilesUsed(keys)
		}
	}

	sets = append(sets, "updatedAt = ?")
	args = append(args, int64(nowMillis()))
	args = append(args, id)

	if _, err := db.Exec(`UPDATE "Plan" SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if statusToCompleted {
		if newID, err := autoRepeatPlan(id); err != nil {
			log.Printf("[Plan] autoRepeatPlan failed for %s: %v", id, err)
		} else if newID != "" {
			publishEvent(DataEvent{Type: EventPlanCreated, BabyID: babyID, ID: newID, UserID: userID})
		}
	}

	row := db.QueryRow(`SELECT `+planCols+` FROM "Plan" WHERE id = ?`, id)
	p, err := scanPlanRow(row, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, p)
	publishEvent(DataEvent{Type: EventPlanUpdated, BabyID: babyID, ID: id, UserID: userID})
}

// DELETE /plans/{id}
func handleDeletePlan(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "Plan" WHERE id = ?`, id).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(babyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	tx, err := db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer tx.Rollback()

	tx.Exec(`DELETE FROM "ReminderDelivered" WHERE reminderId IN (SELECT id FROM "Reminder" WHERE refId = ? AND source = 'plan')`, id)
	tx.Exec(`DELETE FROM "Reminder" WHERE refId = ? AND source = 'plan'`, id)
	if _, err := tx.Exec(`DELETE FROM "Plan" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeSuccess(w)
	publishEvent(DataEvent{Type: EventPlanDeleted, BabyID: babyID, ID: id, UserID: userID})
}

type vaccineScheduleEntry struct {
	title  string
	years  int
	months int
}

var nationalVaccineSchedule = []vaccineScheduleEntry{
	{title: "乙肝疫苗(第1剂)", years: 0, months: 0},
	{title: "卡介苗", years: 0, months: 0},
	{title: "乙肝疫苗(第2剂)", years: 0, months: 1},
	{title: "脊灰灭活疫苗(第1剂)", years: 0, months: 2},
	{title: "脊灰减毒疫苗(第2剂)", years: 0, months: 3},
	{title: "百白破疫苗(第1剂)", years: 0, months: 3},
	{title: "脊灰减毒疫苗(第3剂)", years: 0, months: 4},
	{title: "百白破疫苗(第2剂)", years: 0, months: 4},
	{title: "百白破疫苗(第3剂)", years: 0, months: 5},
	{title: "乙肝疫苗(第3剂)", years: 0, months: 6},
	{title: "A群流脑多糖疫苗(第1剂)", years: 0, months: 6},
	{title: "麻腮风疫苗(第1剂)", years: 0, months: 8},
	{title: "乙脑减毒疫苗(第1剂)", years: 0, months: 8},
	{title: "A群流脑多糖疫苗(第2剂)", years: 0, months: 9},
	{title: "甲肝减毒疫苗", years: 0, months: 18},
	{title: "麻腮风疫苗(第2剂)", years: 0, months: 18},
	{title: "百白破疫苗(第4剂)", years: 0, months: 18},
	{title: "乙脑减毒疫苗(第2剂)", years: 2, months: 0},
	{title: "A群C群流脑多糖疫苗(第1剂)", years: 3, months: 0},
	{title: "脊灰减毒疫苗(第4剂)", years: 4, months: 0},
	{title: "白破疫苗", years: 6, months: 0},
	{title: "A群C群流脑多糖疫苗(第2剂)", years: 6, months: 0},
}

func vaccineScheduledAt(birth time.Time, entry vaccineScheduleEntry) Millis {
	t := birth.UTC()
	if entry.years > 0 {
		t = t.AddDate(entry.years, 0, 0)
	} else if entry.months > 0 {
		t = t.AddDate(0, entry.months, 0)
	}
	return Millis(t.UnixMilli())
}

// POST /plans/vaccine-template
func handleVaccineTemplate(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID string `json:"babyId"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	ok, err := findMembership(body.BabyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	var birthMillis int64
	if err := db.QueryRow(`SELECT birthDate FROM "Baby" WHERE id = ?`, body.BabyID).Scan(&birthMillis); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	birth := time.UnixMilli(birthMillis).UTC()

	existing := map[string]bool{}
	rows, err := db.Query(`SELECT title FROM "Plan" WHERE babyId = ? AND type = 'vaccine'`, body.BabyID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	for rows.Next() {
		var title string
		if err := rows.Scan(&title); err != nil {
			rows.Close()
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		existing[title] = true
	}
	rows.Close()

	desc := "国家免疫规划"
	reminder := "1440"
	now := nowMillis()
	created := 0

	for _, entry := range nationalVaccineSchedule {
		if existing[entry.title] {
			continue
		}
		scheduled := vaccineScheduledAt(birth, entry)
		id := uuid.NewString()

		if _, err := db.Exec(`INSERT INTO "Plan" (id, babyId, title, type, scheduledAt, description, reminder, repeat, status, createdBy, createdAt, updatedAt, images)
			VALUES (?, ?, ?, 'vaccine', ?, ?, ?, 'none', 'pending', ?, ?, ?, NULL)`,
			id, body.BabyID, entry.title, int64(scheduled), desc, reminder, userID, int64(now), int64(now)); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}

		createPlanReminder(body.BabyID, id, entry.title, scheduled, sql.NullString{String: reminder, Valid: true})
		publishEvent(DataEvent{Type: EventPlanCreated, BabyID: body.BabyID, ID: id, UserID: userID})
		created++
	}

	writeOK(w, map[string]interface{}{"created": created})
}

func isValidPlanType(t string) bool {
	switch t {
	case "vaccine", "doctor", "checkup", "medicine", "custom":
		return true
	}
	return false
}

func isValidRepeat(rp string) bool {
	switch rp {
	case "none", "daily", "weekly", "monthly", "yearly":
		return true
	}
	return false
}

func nextPlanScheduledAt(from Millis, repeat string) (Millis, bool) {
	t := from.Time()
	switch repeat {
	case "daily":
		return Millis(t.AddDate(0, 0, 1).UnixMilli()), true
	case "weekly":
		return Millis(t.AddDate(0, 0, 7).UnixMilli()), true
	case "monthly":
		return Millis(t.AddDate(0, 1, 0).UnixMilli()), true
	case "yearly":
		return Millis(t.AddDate(1, 0, 0).UnixMilli()), true
	default:
		return 0, false
	}
}

func createPlanReminder(babyID, planID, title string, scheduled Millis, reminder sql.NullString) {
	nowMs := time.Now().UnixMilli()
	if int64(scheduled) <= nowMs {
		return
	}
	reminderMinutes := 30
	if reminder.Valid && reminder.String != "" {
		if n, err := strconv.Atoi(reminder.String); err == nil && n != 0 {
			reminderMinutes = n
		}
	}
	remindAt := int64(scheduled) - int64(reminderMinutes)*60000
	if remindAt <= nowMs {
		return
	}
	_, _ = db.Exec(`INSERT INTO "Reminder" (id, babyId, remindAt, source, title, body, refId, sent, createdAt)
		VALUES (?, ?, ?, 'plan', ?, ?, ?, 0, ?)`,
		uuid.NewString(), babyID, remindAt,
		"📋 "+title, "计划将在"+strconv.Itoa(reminderMinutes)+"分钟后开始", planID, nowMs)
}

// autoRepeatPlan 在重复计划完成后创建下一期，返回新计划 ID（未创建则返回空字符串）。
func autoRepeatPlan(planID string) (string, error) {
	var (
		babyID, title, planType, repeat, status, createdBy string
		scheduled                                            int64
		desc, reminder, imagesJSON                           sql.NullString
	)
	err := db.QueryRow(`SELECT babyId, title, type, scheduledAt, description, reminder, repeat, status, createdBy, images FROM "Plan" WHERE id = ?`, planID).
		Scan(&babyID, &title, &planType, &scheduled, &desc, &reminder, &repeat, &status, &createdBy, &imagesJSON)
	if err != nil {
		return "", err
	}
	if repeat == "" || repeat == "none" || status != "completed" {
		return "", nil
	}

	nextScheduled, ok := nextPlanScheduledAt(Millis(scheduled), repeat)
	if !ok {
		return "", nil
	}

	newID := uuid.NewString()
	now := nowMillis()

	if _, err := db.Exec(`INSERT INTO "Plan" (id, babyId, title, type, scheduledAt, description, reminder, repeat, status, createdBy, createdAt, updatedAt, images)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
		newID, babyID, title, planType, int64(nextScheduled),
		desc, reminder, repeat, createdBy, int64(now), int64(now), imagesJSON); err != nil {
		return "", err
	}

	createPlanReminder(babyID, newID, title, nextScheduled, reminder)
	return newID, nil
}
