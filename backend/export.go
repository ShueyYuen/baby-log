package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

// GET /export?babyId= — dump the baby's care data as JSON for backup.
func handleExport(w http.ResponseWriter, r *http.Request) {
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

	var baby babyOut
	var birth, created, updated int64
	var avatar sql.NullString
	if err := db.QueryRow(`SELECT id, name, gender, birthDate, avatar, createdAt, updatedAt FROM "Baby" WHERE id = ?`, babyID).
		Scan(&baby.ID, &baby.Name, &baby.Gender, &birth, &avatar, &created, &updated); err != nil {
		writeErr(w, http.StatusNotFound, "Not found")
		return
	}
	baby.BirthDate = Millis(birth)
	baby.CreatedAt = Millis(created)
	baby.UpdatedAt = Millis(updated)
	if avatar.Valid {
		baby.Avatar = resolveAvatar(&avatar.String)
	}

	records, err := exportRecords(babyID, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	plans, err := exportPlans(babyID, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	growth, err := exportGrowth(babyID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	milestones, err := exportMilestones(babyID, userID, isAdminCtx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeOK(w, map[string]interface{}{
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"baby":       baby,
		"records":    records,
		"plans":      plans,
		"growth":     growth,
		"milestones": milestones,
	})
}

func exportRecords(babyID, userID string, admin bool) ([]recordOut, error) {
	rows, err := db.Query(`
		SELECT r.id, r.babyId, r.category, r.type, r.data, r.occurredAt, r.note, r.images, r.createdBy, r.createdAt, r.updatedAt, u.id, u.displayName
		FROM "Record" r
		JOIN "User" u ON u.id = r.createdBy
		WHERE r.babyId = ?
		ORDER BY r.occurredAt DESC`, babyID)
	if err != nil {
		return nil, err
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
			return nil, err
		}
		rec.Data = json.RawMessage(dataStr)
		rec.OccurredAt = Millis(occurred)
		rec.CreatedAt = Millis(created)
		rec.UpdatedAt = Millis(updated)
		rec.Note = strPtr(note)
		rec.Images = recordImagesToDisplay(parseRecordImages(images), userID, admin, rec.CreatedBy)
		rec.User = &memberUser{ID: uID, DisplayName: uName}
		items = append(items, rec)
	}
	return items, rows.Err()
}

func exportPlans(babyID, userID string, admin bool) ([]planOut, error) {
	rows, err := db.Query(`SELECT `+planCols+` FROM "Plan" WHERE babyId = ? ORDER BY scheduledAt DESC`, babyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []planOut{}
	for rows.Next() {
		p, err := scanPlanRow(rows, userID, admin)
		if err != nil {
			return nil, err
		}
		items = append(items, *p)
	}
	return items, rows.Err()
}

func exportGrowth(babyID string) ([]growthOut, error) {
	rows, err := db.Query(`SELECT `+growthCols+` FROM "GrowthRecord" WHERE babyId = ? ORDER BY date DESC`, babyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []growthOut{}
	for rows.Next() {
		g, err := scanGrowthRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *g)
	}
	return items, rows.Err()
}

func exportMilestones(babyID, userID string, admin bool) ([]milestoneOut, error) {
	rows, err := db.Query(`SELECT id, babyId, type, title, occurredAt, description, images, createdAt, updatedAt FROM "Milestone" WHERE babyId = ? ORDER BY occurredAt DESC`, babyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []milestoneOut{}
	for rows.Next() {
		var m milestoneOut
		var occurred, created, updated int64
		var desc, images sql.NullString
		if err := rows.Scan(&m.ID, &m.BabyID, &m.Type, &m.Title, &occurred, &desc, &images, &created, &updated); err != nil {
			return nil, err
		}
		m.OccurredAt = Millis(occurred)
		m.CreatedAt = Millis(created)
		m.UpdatedAt = Millis(updated)
		m.Description = strPtr(desc)
		m.Images = recordImagesToDisplay(parseRecordImages(images), userID, admin, "")
		items = append(items, m)
	}
	return items, rows.Err()
}
