package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

const growthCols = `id, babyId, date, height, weight, headCircumference, note, createdAt, updatedAt`

func scanGrowthRow(row interface {
	Scan(dest ...interface{}) error
}) (*growthOut, error) {
	var g growthOut
	var date, created, updated int64
	var height, weight, head sql.NullFloat64
	var note sql.NullString
	if err := row.Scan(&g.ID, &g.BabyID, &date, &height, &weight, &head, &note, &created, &updated); err != nil {
		return nil, err
	}
	g.Date = Millis(date)
	g.CreatedAt = Millis(created)
	g.UpdatedAt = Millis(updated)
	g.Height = floatPtr(height)
	g.Weight = floatPtr(weight)
	g.HeadCircumference = floatPtr(head)
	g.Note = strPtr(note)
	return &g, nil
}

// GET /growth
func handleListGrowth(w http.ResponseWriter, r *http.Request) {
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

	rows, err := db.Query(`SELECT `+growthCols+` FROM "GrowthRecord" WHERE babyId = ? ORDER BY date DESC`, babyID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	records := []growthOut{}
	for rows.Next() {
		g, err := scanGrowthRow(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		records = append(records, *g)
	}
	writeOK(w, records)
}

// POST /growth
func handleCreateGrowth(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID            string   `json:"babyId"`
		Date              string   `json:"date"`
		Height            *float64 `json:"height"`
		Weight            *float64 `json:"weight"`
		HeadCircumference *float64 `json:"headCircumference"`
		Note              *string  `json:"note"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" || body.Date == "" {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if !positiveOrNil(body.Height) || !positiveOrNil(body.Weight) || !positiveOrNil(body.HeadCircumference) {
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

	date, err := millisFromInput(body.Date)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid date")
		return
	}

	id := uuid.NewString()
	now := nowMillis()
	if _, err := db.Exec(`INSERT INTO "GrowthRecord" (id, babyId, date, height, weight, headCircumference, note, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, body.BabyID, int64(date), floatArg(body.Height), floatArg(body.Weight), floatArg(body.HeadCircumference),
		nullStringFromPtr(body.Note), int64(now), int64(now)); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	row := db.QueryRow(`SELECT `+growthCols+` FROM "GrowthRecord" WHERE id = ?`, id)
	g, err := scanGrowthRow(row)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, g)
}

// PUT /growth/{id}
func handleUpdateGrowth(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "GrowthRecord" WHERE id = ?`, id).Scan(&babyID); err != nil {
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
	if raw, ok := body["date"]; ok {
		if s := jsonString(raw); s != "" {
			if m, err := millisFromInput(s); err == nil {
				sets = append(sets, "date = ?")
				args = append(args, int64(m))
			}
		}
	}
	for _, field := range []string{"height", "weight", "headCircumference"} {
		if raw, ok := body[field]; ok {
			if string(raw) == "null" {
				sets = append(sets, field+" = ?")
				args = append(args, nil)
			} else {
				var f float64
				if err := json.Unmarshal(raw, &f); err == nil {
					sets = append(sets, field+" = ?")
					args = append(args, f)
				}
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

	sets = append(sets, "updatedAt = ?")
	args = append(args, int64(nowMillis()))
	args = append(args, id)

	if _, err := db.Exec(`UPDATE "GrowthRecord" SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	row := db.QueryRow(`SELECT `+growthCols+` FROM "GrowthRecord" WHERE id = ?`, id)
	g, err := scanGrowthRow(row)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, g)
}

// DELETE /growth/{id}
func handleDeleteGrowth(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "GrowthRecord" WHERE id = ?`, id).Scan(&babyID); err != nil {
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

	if _, err := db.Exec(`DELETE FROM "GrowthRecord" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeSuccess(w)
}

func positiveOrNil(f *float64) bool {
	return f == nil || *f > 0
}

func floatArg(f *float64) interface{} {
	if f == nil {
		return nil
	}
	return *f
}
