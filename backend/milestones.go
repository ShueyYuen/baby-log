package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

const milestoneCols = `id, babyId, type, title, occurredAt, description, images, createdAt, updatedAt`

func scanMilestoneRow(row interface {
	Scan(dest ...interface{}) error
}, currentUserID string, isAdmin bool) (*milestoneOut, error) {
	var m milestoneOut
	var occurred, created, updated int64
	var desc, images sql.NullString
	if err := row.Scan(&m.ID, &m.BabyID, &m.Type, &m.Title, &occurred, &desc, &images, &created, &updated); err != nil {
		return nil, err
	}
	m.OccurredAt = Millis(occurred)
	m.CreatedAt = Millis(created)
	m.UpdatedAt = Millis(updated)
	m.Description = strPtr(desc)
	m.Images = recordImagesToDisplay(parseRecordImages(images), currentUserID, isAdmin, "")
	return &m, nil
}

// GET /milestones
func handleListMilestones(w http.ResponseWriter, r *http.Request) {
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

	q := r.URL.Query()
	page := parseIntDefault(q.Get("page"), 1)
	pageSize := parseIntDefault(q.Get("pageSize"), 50)
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}

	var total int
	db.QueryRow(`SELECT COUNT(*) FROM "Milestone" WHERE babyId = ?`, babyID).Scan(&total)

	rows, err := db.Query(`SELECT `+milestoneCols+` FROM "Milestone" WHERE babyId = ? ORDER BY occurredAt DESC LIMIT ? OFFSET ?`,
		babyID, pageSize, (page-1)*pageSize)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	list := []milestoneOut{}
	for rows.Next() {
		m, err := scanMilestoneRow(rows, userID, isAdminCtx(r))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		list = append(list, *m)
	}
	writeOK(w, map[string]interface{}{
		"items":    list,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"hasMore":  page*pageSize < total,
	})
}

// POST /milestones
func handleCreateMilestone(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID      string            `json:"babyId"`
		Type        string            `json:"type"`
		Title       string            `json:"title"`
		OccurredAt  string            `json:"occurredAt"`
		Description *string           `json:"description"`
		Images      []RecordImageStore `json:"images"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" || body.Type == "" || body.Title == "" || body.OccurredAt == "" {
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

	id := uuid.NewString()
	now := nowMillis()
	if _, err := db.Exec(`INSERT INTO "Milestone" (id, babyId, type, title, occurredAt, description, images, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, body.BabyID, body.Type, body.Title, int64(occurred),
		nullStringFromPtr(body.Description), imagesStore, int64(now), int64(now)); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	usedKeys := make([]string, 0, len(body.Images))
	for _, img := range body.Images {
		usedKeys = append(usedKeys, img.Key)
	}
	markUploadedFilesUsed(usedKeys)

	row := db.QueryRow(`SELECT `+milestoneCols+` FROM "Milestone" WHERE id = ?`, id)
	m, err := scanMilestoneRow(row, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, m)
}

// PUT /milestones/{id}
func handleUpdateMilestone(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	var existingImages sql.NullString
	if err := db.QueryRow(`SELECT babyId, images FROM "Milestone" WHERE id = ?`, id).Scan(&babyID, &existingImages); err != nil {
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
	if raw, ok := body["type"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "type = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["title"]; ok {
		if s := jsonString(raw); s != "" {
			sets = append(sets, "title = ?")
			args = append(args, s)
		}
	}
	if raw, ok := body["occurredAt"]; ok {
		if s := jsonString(raw); s != "" {
			if m, err := millisFromInput(s); err == nil {
				sets = append(sets, "occurredAt = ?")
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
					if !isImageVisibleTo(old.VisibleTo, userID, isAdminCtx(r), "") {
						newImages = append(newImages, old)
					}
				}
			}
			b, _ := json.Marshal(newImages)
			sets = append(sets, "images = ?")
			args = append(args, string(b))
		}
	}

	sets = append(sets, "updatedAt = ?")
	args = append(args, int64(nowMillis()))
	args = append(args, id)

	if _, err := db.Exec(`UPDATE "Milestone" SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
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

	row := db.QueryRow(`SELECT `+milestoneCols+` FROM "Milestone" WHERE id = ?`, id)
	m, err := scanMilestoneRow(row, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, m)
}

// DELETE /milestones/{id}
func handleDeleteMilestone(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	var images sql.NullString
	if err := db.QueryRow(`SELECT babyId, images FROM "Milestone" WHERE id = ?`, id).Scan(&babyID, &images); err != nil {
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

	if _, err := db.Exec(`DELETE FROM "Milestone" WHERE id = ?`, id); err != nil {
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
