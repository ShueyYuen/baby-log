package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

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
}

// PUT /plans/{id}
func handleUpdatePlan(w http.ResponseWriter, r *http.Request) {
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

	var body map[string]json.RawMessage
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	sets := []string{}
	args := []interface{}{}
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

	row := db.QueryRow(`SELECT `+planCols+` FROM "Plan" WHERE id = ?`, id)
	p, err := scanPlanRow(row, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, p)
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
	case "none", "daily", "weekly", "monthly":
		return true
	}
	return false
}
