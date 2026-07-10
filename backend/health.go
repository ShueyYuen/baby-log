package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// ─── Health Conditions ──────────────────────────────────────────────────────

// GET /health-conditions?babyId=...
func handleListHealthConditions(w http.ResponseWriter, r *http.Request) {
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

	rows, err := db.Query(`
		SELECT c.id, c.babyId, c.name, c.description, c.status, c.createdBy, c.createdAt, c.updatedAt,
		       (SELECT COUNT(*) FROM "HealthEntry" WHERE conditionId = c.id) as entryCount
		FROM "HealthCondition" c
		WHERE c.babyId = ?
		ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.updatedAt DESC`,
		babyID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	list := []healthConditionOut{}
	for rows.Next() {
		var c healthConditionOut
		var desc sql.NullString
		var created, updated int64
		if err := rows.Scan(&c.ID, &c.BabyID, &c.Name, &desc, &c.Status, &c.CreatedBy, &created, &updated, &c.EntryCount); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		c.Description = strPtr(desc)
		c.CreatedAt = Millis(created)
		c.UpdatedAt = Millis(updated)
		list = append(list, c)
	}
	writeOK(w, list)
}

// POST /health-conditions
func handleCreateHealthCondition(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID      string  `json:"babyId"`
		Name        string  `json:"name"`
		Description *string `json:"description"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "babyId and name required")
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
	if _, err := db.Exec(`INSERT INTO "HealthCondition" (id, babyId, name, description, status, createdBy, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
		id, body.BabyID, body.Name, nullStringFromPtr(body.Description), userID, int64(now), int64(now)); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeOK(w, healthConditionOut{
		ID:          id,
		BabyID:      body.BabyID,
		Name:        body.Name,
		Description: body.Description,
		Status:      "active",
		EntryCount:  0,
		CreatedBy:   userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	})
	publishEvent(DataEvent{Type: EventHealthChange, BabyID: body.BabyID, ID: id, UserID: userID})
}

// PUT /health-conditions/{id}
func handleUpdateHealthCondition(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "HealthCondition" WHERE id = ?`, id).Scan(&babyID); err != nil {
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
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	sets := []string{}
	args := []interface{}{}
	if raw, ok := body["name"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "name = ?")
			args = append(args, s)
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
	if raw, ok := body["status"]; ok {
		if s := jsonString(raw); s == "active" || s == "resolved" {
			sets = append(sets, "status = ?")
			args = append(args, s)
		}
	}

	if len(sets) == 0 {
		writeErr(w, http.StatusBadRequest, "No fields to update")
		return
	}

	sets = append(sets, "updatedAt = ?")
	args = append(args, int64(nowMillis()))
	args = append(args, id)

	if _, err := db.Exec(`UPDATE "HealthCondition" SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	var c healthConditionOut
	var desc sql.NullString
	var created, updated int64
	var entryCount int
	if err := db.QueryRow(`
		SELECT c.id, c.babyId, c.name, c.description, c.status, c.createdBy, c.createdAt, c.updatedAt,
		       (SELECT COUNT(*) FROM "HealthEntry" WHERE conditionId = c.id) as entryCount
		FROM "HealthCondition" c WHERE c.id = ?`, id).Scan(
		&c.ID, &c.BabyID, &c.Name, &desc, &c.Status, &c.CreatedBy, &created, &updated, &entryCount); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	c.Description = strPtr(desc)
	c.CreatedAt = Millis(created)
	c.UpdatedAt = Millis(updated)
	c.EntryCount = entryCount
	writeOK(w, c)
	publishEvent(DataEvent{Type: EventHealthChange, BabyID: babyID, ID: id, UserID: userID})
}

// DELETE /health-conditions/{id}
func handleDeleteHealthCondition(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "HealthCondition" WHERE id = ?`, id).Scan(&babyID); err != nil {
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

	// Clean up images from all entries
	rows, err := db.Query(`SELECT images FROM "HealthEntry" WHERE conditionId = ?`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var images sql.NullString
			if rows.Scan(&images) == nil && images.Valid {
				for _, img := range parseRecordImages(images) {
					markFileUnused(img.Key, img.RawKey)
				}
			}
		}
	}

	if _, err := db.Exec(`DELETE FROM "HealthCondition" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeSuccess(w)
	publishEvent(DataEvent{Type: EventHealthChange, BabyID: babyID, ID: id, UserID: userID})
}

// ─── Health Entries ─────────────────────────────────────────────────────────

// GET /health-conditions/{id}/entries?page=&pageSize=
func handleListHealthEntries(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	conditionID := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "HealthCondition" WHERE id = ?`, conditionID).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Condition not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
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
	pageSize := parseIntDefault(q.Get("pageSize"), 20)
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var total int
	db.QueryRow(`SELECT COUNT(*) FROM "HealthEntry" WHERE conditionId = ?`, conditionID).Scan(&total)

	rows, err := db.Query(`SELECT id, conditionId, date, note, images, annotations, createdBy, createdAt, updatedAt
		FROM "HealthEntry" WHERE conditionId = ? ORDER BY date DESC LIMIT ? OFFSET ?`,
		conditionID, pageSize, (page-1)*pageSize)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	isAdmin := isAdminCtx(r)
	list := []healthEntryOut{}
	for rows.Next() {
		var e healthEntryOut
		var dateMs, created, updated int64
		var note, images, annotations sql.NullString
		if err := rows.Scan(&e.ID, &e.ConditionID, &dateMs, &note, &images, &annotations, &e.CreatedBy, &created, &updated); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		e.Date = Millis(dateMs)
		e.Note = strPtr(note)
		e.Images = recordImagesToDisplay(parseRecordImages(images), userID, isAdmin, e.CreatedBy)
		if annotations.Valid && annotations.String != "" {
			e.Annotations = json.RawMessage(annotations.String)
		}
		e.CreatedAt = Millis(created)
		e.UpdatedAt = Millis(updated)
		list = append(list, e)
	}

	writeOK(w, map[string]interface{}{
		"items":    list,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"hasMore":  page*pageSize < total,
	})
}

// POST /health-conditions/{id}/entries
func handleCreateHealthEntry(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	conditionID := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "HealthCondition" WHERE id = ?`, conditionID).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Condition not found")
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

	var body struct {
		Date        string             `json:"date"`
		Note        *string            `json:"note"`
		Images      []RecordImageStore `json:"images"`
		Annotations json.RawMessage    `json:"annotations"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.Date == "" {
		writeErr(w, http.StatusBadRequest, "date required")
		return
	}

	dateMs, err := millisFromInput(body.Date)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid date")
		return
	}

	if len(body.Images) > 0 {
		keys := make([]string, 0, len(body.Images))
		for _, img := range body.Images {
			keys = append(keys, img.Key)
		}
		if err := validateUploadKeys(keys); err != nil {
			writeErr(w, http.StatusBadRequest, "Invalid image key")
			return
		}
	}

	var imagesStore sql.NullString
	if len(body.Images) > 0 {
		b, _ := json.Marshal(body.Images)
		imagesStore = sql.NullString{String: string(b), Valid: true}
	}

	var annotationsStore sql.NullString
	if len(body.Annotations) > 0 && string(body.Annotations) != "null" {
		annotationsStore = sql.NullString{String: string(body.Annotations), Valid: true}
	}

	id := uuid.NewString()
	now := nowMillis()
	if _, err := db.Exec(`INSERT INTO "HealthEntry" (id, conditionId, date, note, images, annotations, createdBy, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, conditionID, int64(dateMs), nullStringFromPtr(body.Note), imagesStore, annotationsStore, userID, int64(now), int64(now)); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	// Update condition's updatedAt
	db.Exec(`UPDATE "HealthCondition" SET updatedAt = ? WHERE id = ?`, int64(now), conditionID)

	usedKeys := make([]string, 0, len(body.Images))
	for _, img := range body.Images {
		usedKeys = append(usedKeys, img.Key)
	}
	markUploadedFilesUsed(usedKeys)

	isAdmin := isAdminCtx(r)
	out := healthEntryOut{
		ID:          id,
		ConditionID: conditionID,
		Date:        dateMs,
		Note:        body.Note,
		Images:      recordImagesToDisplay(body.Images, userID, isAdmin, userID),
		CreatedBy:   userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if len(body.Annotations) > 0 && string(body.Annotations) != "null" {
		out.Annotations = body.Annotations
	}
	writeOK(w, out)
	publishEvent(DataEvent{Type: EventHealthChange, BabyID: babyID, ID: conditionID, UserID: userID})
}

// PUT /health-conditions/{id}/entries/{entryId}
func handleUpdateHealthEntry(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	conditionID := chiURLParam(r, "id")
	entryID := chiURLParam(r, "entryId")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "HealthCondition" WHERE id = ?`, conditionID).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Condition not found")
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

	var existingImages sql.NullString
	var existingCreatedBy string
	if err := db.QueryRow(`SELECT images, createdBy FROM "HealthEntry" WHERE id = ? AND conditionId = ?`, entryID, conditionID).Scan(&existingImages, &existingCreatedBy); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Entry not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	var body map[string]json.RawMessage
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	sets := []string{}
	args := []interface{}{}
	if raw, ok := body["date"]; ok {
		if s := jsonString(raw); s != "" {
			if m, err := millisFromInput(s); err == nil {
				sets = append(sets, "date = ?")
				args = append(args, int64(m))
			}
		}
	}
	if raw, ok := body["note"]; ok {
		if string(raw) == "null" {
			sets = append(sets, "note = ?")
			args = append(args, nil)
		} else {
			sets = append(sets, "note = ?")
			args = append(args, jsonString(raw))
		}
	}
	if raw, ok := body["annotations"]; ok {
		if string(raw) == "null" {
			sets = append(sets, "annotations = ?")
			args = append(args, nil)
		} else {
			sets = append(sets, "annotations = ?")
			args = append(args, string(raw))
		}
	}

	var newImages []RecordImageStore
	imagesProvided := false
	if raw, ok := body["images"]; ok {
		imagesProvided = true
		if string(raw) == "null" {
			sets = append(sets, "images = ?")
			args = append(args, nil)
		} else {
			json.Unmarshal(raw, &newImages)
			// Preserve images not visible to current user
			if existingImages.Valid {
				oldImgs := parseRecordImages(existingImages)
				for _, old := range oldImgs {
					if !isImageVisibleTo(old.VisibleTo, userID, isAdminCtx(r), existingCreatedBy) {
						newImages = append(newImages, old)
					}
				}
			}
			b, _ := json.Marshal(newImages)
			sets = append(sets, "images = ?")
			args = append(args, string(b))
		}
	}

	if len(sets) == 0 {
		writeErr(w, http.StatusBadRequest, "No fields to update")
		return
	}

	sets = append(sets, "updatedAt = ?")
	now := nowMillis()
	args = append(args, int64(now))
	args = append(args, entryID)
	args = append(args, conditionID)

	if _, err := db.Exec(`UPDATE "HealthEntry" SET `+strings.Join(sets, ", ")+` WHERE id = ? AND conditionId = ?`, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if imagesProvided {
		usedKeys := make([]string, 0, len(newImages))
		for _, img := range newImages {
			usedKeys = append(usedKeys, img.Key)
		}
		markUploadedFilesUsed(usedKeys)
	}

	if imagesProvided && existingImages.Valid {
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

	// Update condition's updatedAt
	db.Exec(`UPDATE "HealthCondition" SET updatedAt = ? WHERE id = ?`, int64(now), conditionID)

	isAdmin := isAdminCtx(r)
	var e healthEntryOut
	var dateMs, created, updated int64
	var note, images, annotations sql.NullString
	if err := db.QueryRow(`SELECT id, conditionId, date, note, images, annotations, createdBy, createdAt, updatedAt
		FROM "HealthEntry" WHERE id = ?`, entryID).Scan(
		&e.ID, &e.ConditionID, &dateMs, &note, &images, &annotations, &e.CreatedBy, &created, &updated); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	e.Date = Millis(dateMs)
	e.Note = strPtr(note)
	e.Images = recordImagesToDisplay(parseRecordImages(images), userID, isAdmin, e.CreatedBy)
	if annotations.Valid && annotations.String != "" {
		e.Annotations = json.RawMessage(annotations.String)
	}
	e.CreatedAt = Millis(created)
	e.UpdatedAt = Millis(updated)
	writeOK(w, e)
	publishEvent(DataEvent{Type: EventHealthChange, BabyID: babyID, ID: conditionID, UserID: userID})
}

// DELETE /health-conditions/{id}/entries/{entryId}
func handleDeleteHealthEntry(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	conditionID := chiURLParam(r, "id")
	entryID := chiURLParam(r, "entryId")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "HealthCondition" WHERE id = ?`, conditionID).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Condition not found")
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

	var images sql.NullString
	if err := db.QueryRow(`SELECT images FROM "HealthEntry" WHERE id = ? AND conditionId = ?`, entryID, conditionID).Scan(&images); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Entry not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if _, err := db.Exec(`DELETE FROM "HealthEntry" WHERE id = ? AND conditionId = ?`, entryID, conditionID); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if images.Valid {
		for _, img := range parseRecordImages(images) {
			markFileUnused(img.Key, img.RawKey)
		}
	}

	writeSuccess(w)
	publishEvent(DataEvent{Type: EventHealthChange, BabyID: babyID, ID: conditionID, UserID: userID})
}
