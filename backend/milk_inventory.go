package main

import (
	"database/sql"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type milkInventoryOut struct {
	ID          string   `json:"id"`
	BabyID      string   `json:"babyId"`
	AmountMl    float64  `json:"amountMl"`
	StorageType string   `json:"storageType"`
	StoredAt    Millis   `json:"storedAt"`
	ExpiresAt   Millis   `json:"expiresAt"`
	Status      string   `json:"status"`
	Note        *string  `json:"note"`
	CreatedAt   Millis   `json:"createdAt"`
	UpdatedAt   Millis   `json:"updatedAt"`
}

const milkInventoryCols = `id, babyId, amountMl, storageType, storedAt, expiresAt, status, note, createdAt, updatedAt`

func calcMilkExpiresAt(storedAt Millis, storageType string) Millis {
	t := storedAt.Time()
	if storageType == "freezer" {
		return Millis(t.AddDate(0, 6, 0).UnixMilli())
	}
	return Millis(t.AddDate(0, 0, 4).UnixMilli())
}

func scanMilkInventoryRow(row interface {
	Scan(dest ...interface{}) error
}) (*milkInventoryOut, error) {
	var m milkInventoryOut
	var storedAt, expiresAt, created, updated int64
	var note sql.NullString
	if err := row.Scan(&m.ID, &m.BabyID, &m.AmountMl, &m.StorageType, &storedAt, &expiresAt, &m.Status, &note, &created, &updated); err != nil {
		return nil, err
	}
	m.StoredAt = Millis(storedAt)
	m.ExpiresAt = Millis(expiresAt)
	m.CreatedAt = Millis(created)
	m.UpdatedAt = Millis(updated)
	m.Note = strPtr(note)
	return &m, nil
}

// GET /milk-inventory?babyId=&status=
func handleListMilkInventory(w http.ResponseWriter, r *http.Request) {
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

	statusFilter := r.URL.Query().Get("status")
	where := `WHERE babyId = ?`
	args := []interface{}{babyID}
	switch statusFilter {
	case "all":
		where += ` AND status IN ('available', 'expired')`
	case "":
		where += ` AND status = 'available'`
	default:
		where += ` AND status = ?`
		args = append(args, statusFilter)
	}

	rows, err := db.Query(`SELECT `+milkInventoryCols+` FROM "MilkInventory" `+where+` ORDER BY expiresAt ASC`, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	items := []milkInventoryOut{}
	for rows.Next() {
		m, err := scanMilkInventoryRow(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		items = append(items, *m)
	}
	writeOK(w, items)
}

// POST /milk-inventory
func handleCreateMilkInventory(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID      string  `json:"babyId"`
		AmountMl    float64 `json:"amountMl"`
		StorageType string  `json:"storageType"`
		StoredAt    string  `json:"storedAt"`
		Note        *string `json:"note"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" || body.AmountMl <= 0 || (body.StorageType != "fridge" && body.StorageType != "freezer") {
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

	storedAt := nowMillis()
	if body.StoredAt != "" {
		if m, err := millisFromInput(body.StoredAt); err == nil {
			storedAt = m
		} else {
			writeErr(w, http.StatusBadRequest, "Invalid storedAt")
			return
		}
	}

	expiresAt := calcMilkExpiresAt(storedAt, body.StorageType)
	id := uuid.NewString()
	now := nowMillis()
	if _, err := db.Exec(`INSERT INTO "MilkInventory" (id, babyId, amountMl, storageType, storedAt, expiresAt, status, note, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
		id, body.BabyID, body.AmountMl, body.StorageType, int64(storedAt), int64(expiresAt),
		nullStringFromPtr(body.Note), int64(now), int64(now)); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeOK(w, milkInventoryOut{
		ID: id, BabyID: body.BabyID, AmountMl: body.AmountMl, StorageType: body.StorageType,
		StoredAt: storedAt, ExpiresAt: expiresAt, Status: "available", Note: body.Note,
		CreatedAt: now, UpdatedAt: now,
	})
}

// PUT /milk-inventory/{id}
func handleUpdateMilkInventory(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "MilkInventory" WHERE id = ?`, id).Scan(&babyID); err != nil {
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

	var body struct {
		Status string  `json:"status"`
		Note   *string `json:"note"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	sets := []string{"updatedAt = ?"}
	args := []interface{}{int64(nowMillis())}

	if body.Status != "" {
		switch body.Status {
		case "available", "used", "expired", "discarded":
			sets = append(sets, "status = ?")
			args = append(args, body.Status)
		default:
			writeErr(w, http.StatusBadRequest, "Invalid status")
			return
		}
	}
	if body.Note != nil {
		sets = append(sets, "note = ?")
		args = append(args, nullStringFromPtr(body.Note))
	}

	if len(sets) <= 1 {
		writeErr(w, http.StatusBadRequest, "Nothing to update")
		return
	}

	args = append(args, id)
	if _, err := db.Exec(`UPDATE "MilkInventory" SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	row := db.QueryRow(`SELECT `+milkInventoryCols+` FROM "MilkInventory" WHERE id = ?`, id)
	out, err := scanMilkInventoryRow(row)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, out)
}

// DELETE /milk-inventory/{id}
func handleDeleteMilkInventory(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT babyId FROM "MilkInventory" WHERE id = ?`, id).Scan(&babyID); err != nil {
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

	if _, err := db.Exec(`DELETE FROM "MilkInventory" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeSuccess(w)
}

// markExpiredMilkInventory 将已过期的可用库存标记为 expired。
func markExpiredMilkInventory() {
	now := int64(nowMillis())
	res, err := db.Exec(`UPDATE "MilkInventory" SET status = 'expired', updatedAt = ? WHERE status = 'available' AND expiresAt < ?`, now, now)
	if err != nil {
		log.Printf("[Scheduler] Failed to mark expired milk inventory: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Scheduler] Marked %d milk inventory item(s) as expired", n)
	}
}
