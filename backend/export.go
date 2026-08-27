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
		writeServerErr(w, r, err)
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
		writeServerErr(w, r, err)
		return
	}
	plans, err := exportPlans(babyID, userID, isAdminCtx(r))
	if err != nil {
		writeServerErr(w, r, err)
		return
	}
	growth, err := exportGrowth(babyID)
	if err != nil {
		writeServerErr(w, r, err)
		return
	}
	milestones, err := exportMilestones(babyID, userID, isAdminCtx(r))
	if err != nil {
		writeServerErr(w, r, err)
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
	type scanned struct {
		rec    recordOut
		images sql.NullString
	}
	raw := []scanned{}
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
		rec.User = &memberUser{ID: uID, DisplayName: uName}
		raw = append(raw, scanned{rec: rec, images: images})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	items := make([]recordOut, 0, len(raw))
	for _, s := range raw {
		s.rec.Images = recordImagesToDisplay(parseRecordImages(s.images), userID, admin, s.rec.CreatedBy)
		items = append(items, s.rec)
	}
	return items, nil
}

func exportPlans(babyID, userID string, admin bool) ([]planOut, error) {
	rows, err := db.Query(`SELECT `+planCols+` FROM "Plan" WHERE babyId = ? ORDER BY scheduledAt DESC`, babyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type scanned struct {
		p      planOut
		images sql.NullString
	}
	raw := []scanned{}
	for rows.Next() {
		p, images, err := scanPlanFields(rows)
		if err != nil {
			return nil, err
		}
		raw = append(raw, scanned{p: *p, images: images})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	items := make([]planOut, 0, len(raw))
	for _, s := range raw {
		s.p.Images = recordImagesToDisplay(parseRecordImages(s.images), userID, admin, s.p.CreatedBy)
		items = append(items, s.p)
	}
	return items, nil
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
	type scanned struct {
		m      milestoneOut
		images sql.NullString
	}
	raw := []scanned{}
	for rows.Next() {
		m, images, err := scanMilestoneFields(rows)
		if err != nil {
			return nil, err
		}
		raw = append(raw, scanned{m: *m, images: images})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	items := make([]milestoneOut, 0, len(raw))
	for _, s := range raw {
		s.m.Images = recordImagesToDisplay(parseRecordImages(s.images), userID, admin, "")
		items = append(items, s.m)
	}
	return items, nil
}
