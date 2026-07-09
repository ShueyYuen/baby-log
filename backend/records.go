package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/google/uuid"
)

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

func parseRecordImages(ns sql.NullString) []RecordImageStore {
	if !ns.Valid || ns.String == "" {
		return nil
	}
	var items []RecordImageStore
	if err := json.Unmarshal([]byte(ns.String), &items); err != nil {
		return nil
	}
	return items
}

func recordImagesToDisplay(items []RecordImageStore, currentUserID string, isAdmin bool) []RecordImageDisplay {
	out := make([]RecordImageDisplay, 0, len(items))
	for _, item := range items {
		if !isImageVisibleTo(item.VisibleTo, currentUserID, isAdmin) {
			continue
		}
		d := RecordImageDisplay{Key: item.Key, RawKey: item.RawKey, MediaType: item.MediaType, VisibleTo: item.VisibleTo}
		if item.Key != "" {
			d.URL, _ = toDisplayURL(item.Key, 86400)
		}
		if item.RawKey != "" {
			d.RawURL, _ = toDisplayURL(item.RawKey, 86400)
		}
		out = append(out, d)
	}
	return out
}

func isImageVisibleTo(visibleTo []string, userID string, isAdmin bool) bool {
	if len(visibleTo) == 0 {
		return true
	}
	if isAdmin {
		return true
	}
	for _, id := range visibleTo {
		if id == userID {
			return true
		}
	}
	return false
}

// GET /records
func handleListRecords(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	q := r.URL.Query()

	babyID := q.Get("babyId")
	if babyID == "" {
		writeErr(w, http.StatusBadRequest, "Required")
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

	page := parseIntDefault(q.Get("page"), 1)
	if page < 1 {
		page = 1
	}
	pageSize := parseIntDefault(q.Get("pageSize"), 20)
	if pageSize < 1 {
		pageSize = 20
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
	if v := q.Get("type"); v != "" {
		where += ` AND r.type = ?`
		args = append(args, v)
	}
	if v := q.Get("startDate"); v != "" {
		if m, err := millisFromInput(v); err == nil {
			where += ` AND r.occurredAt >= ?`
			args = append(args, int64(m))
		}
	}
	if v := q.Get("endDate"); v != "" {
		if m, err := millisFromInput(v); err == nil {
			where += ` AND r.occurredAt <= ?`
			args = append(args, int64(m))
		}
	}
	if q.Get("hasImages") == "true" {
		where += ` AND r.images IS NOT NULL`
	}
	if v := q.Get("keyword"); v != "" {
		where += ` AND r.note LIKE ?`
		args = append(args, "%"+v+"%")
	}

	// total
	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "Record" r `+where, args...).Scan(&total); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	listArgs := append([]interface{}{}, args...)
	listArgs = append(listArgs, pageSize, (page-1)*pageSize)
	rows, err := db.Query(`
		SELECT r.id, r.babyId, r.category, r.type, r.data, r.occurredAt, r.note, r.images, r.createdBy, r.createdAt, r.updatedAt, u.id, u.displayName
		FROM "Record" r
		JOIN "User" u ON u.id = r.createdBy
		`+where+`
		ORDER BY r.occurredAt DESC
		LIMIT ? OFFSET ?`, listArgs...)
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

	writeOK(w, map[string]interface{}{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"hasMore":  page*pageSize < total,
	})
}

// POST /records
func handleCreateRecord(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID     string            `json:"babyId"`
		Category   string            `json:"category"`
		Type       string            `json:"type"`
		Data       json.RawMessage   `json:"data"`
		OccurredAt string            `json:"occurredAt"`
		Note       *string           `json:"note"`
		Images     json.RawMessage   `json:"images"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" || (body.Category != "feeding" && body.Category != "nursing" && body.Category != "activity") ||
		body.Type == "" || len(body.Data) == 0 || body.OccurredAt == "" {
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

	occurred, err := millisFromInput(body.OccurredAt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid occurredAt")
		return
	}

	var imagesStore sql.NullString
	var parsedImages []RecordImageStore
	if len(body.Images) > 0 && string(body.Images) != "null" {
		if err := json.Unmarshal(body.Images, &parsedImages); err == nil && len(parsedImages) > 0 {
			keys := make([]string, 0, len(parsedImages))
			for _, img := range parsedImages {
				keys = append(keys, img.Key)
			}
			if err := validateUploadKeys(keys); err != nil {
				writeErr(w, http.StatusBadRequest, "Invalid image key")
				return
			}
			b, _ := json.Marshal(parsedImages)
			imagesStore = sql.NullString{String: string(b), Valid: true}
		}
	}

	id := uuid.NewString()
	now := nowMillis()
	_, err = db.Exec(`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, note, images, createdBy, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, body.BabyID, body.Category, body.Type, string(body.Data), int64(occurred),
		nullStringFromPtr(body.Note), imagesStore, userID, int64(now), int64(now))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	usedKeys := make([]string, 0, len(parsedImages))
	for _, img := range parsedImages {
		usedKeys = append(usedKeys, img.Key)
	}
	markUploadedFilesUsed(usedKeys)

	out := recordOut{
		ID: id, BabyID: body.BabyID, Category: body.Category, Type: body.Type,
		Data: json.RawMessage(body.Data), OccurredAt: occurred, Note: body.Note,
		Images: recordImagesToDisplay(parseRecordImages(imagesStore), userID, isAdminCtx(r)), CreatedBy: userID,
		CreatedAt: now, UpdatedAt: now,
	}
	writeOK(w, out)

	if body.Category == "feeding" {
		go func() {
			defer recoverSilently()
			createAutoFeedingReminder(body.BabyID)
		}()
	}
}

// PUT /records/{id}
func handleUpdateRecord(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var existingBabyID string
	var existingImages sql.NullString
	err := db.QueryRow(`SELECT babyId, images FROM "Record" WHERE id = ?`, id).Scan(&existingBabyID, &existingImages)
	if err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(existingBabyID, userID, "admin", "editor")
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
	if raw, ok := body["category"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "category = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["type"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "type = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["data"]; ok && len(raw) > 0 && string(raw) != "null" {
		sets = append(sets, "data = ?")
		args = append(args, string(raw))
	}
	if raw, ok := body["occurredAt"]; ok {
		if s := jsonString(raw); s != "" {
			if m, err := millisFromInput(s); err == nil {
				sets = append(sets, "occurredAt = ?")
				args = append(args, int64(m))
			}
		}
	}
	if raw, ok := body["note"]; ok {
		// note !== undefined：允许设为 null
		if string(raw) == "null" {
			sets = append(sets, "note = ?")
			args = append(args, nil)
		} else {
			sets = append(sets, "note = ?")
			args = append(args, jsonString(raw))
		}
	}
	var newImages []RecordImageStore
	hasImages := false
	if raw, ok := body["images"]; ok && len(raw) > 0 && string(raw) != "null" {
		json.Unmarshal(raw, &newImages)
		if len(newImages) >= 0 {
			hasImages = true
			b, _ := json.Marshal(newImages)
			sets = append(sets, "images = ?")
			args = append(args, string(b))
		}
	}

	sets = append(sets, "updatedAt = ?")
	args = append(args, int64(nowMillis()))
	args = append(args, id)

	if _, err := db.Exec(`UPDATE "Record" SET `+joinComma(sets)+` WHERE id = ?`, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	// Mark newly added images as used
	if hasImages {
		usedKeys := make([]string, 0, len(newImages))
		for _, img := range newImages {
			usedKeys = append(usedKeys, img.Key)
		}
		markUploadedFilesUsed(usedKeys)
	}

	// Mark removed images for deferred cleanup
	if hasImages && existingImages.Valid {
		oldImgs := parseRecordImages(existingImages)
		newKeySet := map[string]bool{}
		for _, img := range newImages {
			newKeySet[img.Key] = true
		}
		for _, old := range oldImgs {
			if old.Key != "" && !newKeySet[old.Key] {
				markFileUnused(old.Key, old.RawKey)
			}
		}
	}

	out, err := loadRecordByID(id, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, out)
}

// DELETE /records/{id}
func handleDeleteRecord(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	var images sql.NullString
	err := db.QueryRow(`SELECT babyId, images FROM "Record" WHERE id = ?`, id).Scan(&babyID, &images)
	if err != nil {
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

	if _, err := db.Exec(`DELETE FROM "Record" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if images.Valid {
		for _, img := range parseRecordImages(images) {
			markFileUnused(img.Key, img.RawKey)
		}
	}

	writeSuccess(w)
}

// loadRecordByID 返回不含 user 的记录（用于 PUT 响应，与原实现一致）。
func loadRecordByID(id string, currentUserID string, isAdmin bool) (*recordOut, error) {
	var rec recordOut
	var dataStr string
	var occurred, created, updated int64
	var note, images sql.NullString
	err := db.QueryRow(`SELECT id, babyId, category, type, data, occurredAt, note, images, createdBy, createdAt, updatedAt FROM "Record" WHERE id = ?`, id).
		Scan(&rec.ID, &rec.BabyID, &rec.Category, &rec.Type, &dataStr, &occurred, &note, &images, &rec.CreatedBy, &created, &updated)
	if err != nil {
		return nil, err
	}
	rec.Data = json.RawMessage(dataStr)
	rec.OccurredAt = Millis(occurred)
	rec.CreatedAt = Millis(created)
	rec.UpdatedAt = Millis(updated)
	rec.Note = strPtr(note)
	rec.Images = recordImagesToDisplay(parseRecordImages(images), currentUserID, isAdmin)
	return &rec, nil
}

func nullStringFromPtr(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

// jsonString 提取字符串字面量（若不是字符串返回空串）。
func jsonString(raw json.RawMessage) string {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return ""
	}
	return s
}

func recoverSilently() {
	_ = recover()
}
