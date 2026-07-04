package main

import (
	"database/sql"
	"net/http"

	"github.com/google/uuid"
)

func loadBabyMembers(babyID string) ([]babyMemberOut, error) {
	rows, err := db.Query(`
		SELECT m.id, m.userId, m.babyId, m.role, u.id, u.displayName
		FROM "BabyMember" m
		JOIN "User" u ON u.id = m.userId
		WHERE m.babyId = ?`, babyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := []babyMemberOut{}
	for rows.Next() {
		var m babyMemberOut
		if err := rows.Scan(&m.ID, &m.UserID, &m.BabyID, &m.Role, &m.User.ID, &m.User.DisplayName); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, nil
}

func scanBaby(row interface {
	Scan(dest ...interface{}) error
}, withMembers bool) (*babyOut, error) {
	var b babyOut
	var birth, created, updated int64
	var avatar sql.NullString
	if err := row.Scan(&b.ID, &b.Name, &b.Gender, &birth, &avatar, &created, &updated); err != nil {
		return nil, err
	}
	b.BirthDate = Millis(birth)
	b.CreatedAt = Millis(created)
	b.UpdatedAt = Millis(updated)
	if avatar.Valid {
		display, _ := toDisplayURL(avatar.String, 86400)
		b.Avatar = &display
	}
	return &b, nil
}

// GET /babies
func handleListBabies(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	rows, err := db.Query(`
		SELECT b.id, b.name, b.gender, b.birthDate, b.avatar, b.createdAt, b.updatedAt
		FROM "Baby" b
		WHERE EXISTS (SELECT 1 FROM "BabyMember" m WHERE m.babyId = b.id AND m.userId = ?)
		ORDER BY b.createdAt DESC`, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	// 先读取全部宝宝再加载成员，避免在遍历 rows 时发起嵌套查询（单连接下会死锁）。
	data := []babyOut{}
	for rows.Next() {
		b, err := scanBaby(rows, true)
		if err != nil {
			rows.Close()
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		data = append(data, *b)
	}
	rows.Close()

	for i := range data {
		members, err := loadBabyMembers(data[i].ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		data[i].Members = members
	}

	writeOK(w, data)
}

// POST /babies
func handleCreateBaby(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		Name      string  `json:"name"`
		Gender    string  `json:"gender"`
		BirthDate string  `json:"birthDate"`
		Avatar    *string `json:"avatar"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if len(body.Name) < 1 || len(body.Name) > 50 || (body.Gender != "male" && body.Gender != "female") || body.BirthDate == "" {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	birth, err := millisFromInput(body.BirthDate)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid birthDate")
		return
	}

	var avatarKey sql.NullString
	if body.Avatar != nil {
		if *body.Avatar != "" {
			avatarKey = sql.NullString{String: toStorageKey(*body.Avatar), Valid: true}
		} else {
			avatarKey = sql.NullString{String: "", Valid: true}
		}
	}

	id := uuid.NewString()
	now := nowMillis()
	tx, err := db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if _, err := tx.Exec(`INSERT INTO "Baby" (id, name, gender, birthDate, avatar, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, body.Name, body.Gender, int64(birth), avatarKey, int64(now), int64(now)); err != nil {
		tx.Rollback()
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if _, err := tx.Exec(`INSERT INTO "BabyMember" (id, userId, babyId, role) VALUES (?, ?, ?, 'admin')`,
		uuid.NewString(), userID, id); err != nil {
		tx.Rollback()
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if err := addBabyToAllUsers(id, defaultRole); err != nil {
		logInfo("[Baby] addBabyToAllUsers failed: %v", err)
	}

	out := babyOut{ID: id, Name: body.Name, Gender: body.Gender, BirthDate: birth, CreatedAt: now, UpdatedAt: now}
	if avatarKey.Valid {
		display, _ := toDisplayURL(avatarKey.String, 86400)
		out.Avatar = &display
	}
	writeOK(w, out)
}

// GET /babies/{id}
func handleGetBaby(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	row := db.QueryRow(`
		SELECT b.id, b.name, b.gender, b.birthDate, b.avatar, b.createdAt, b.updatedAt
		FROM "Baby" b
		WHERE b.id = ? AND EXISTS (SELECT 1 FROM "BabyMember" m WHERE m.babyId = b.id AND m.userId = ?)`,
		id, userID)

	b, err := scanBaby(row, true)
	if err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	members, err := loadBabyMembers(b.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	b.Members = members
	writeOK(w, b)
}

// PUT /babies/{id}
func handleUpdateBaby(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	ok, err := findMembership(id, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	var body map[string]interface{}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	sets := []string{}
	args := []interface{}{}
	if v, ok := body["name"].(string); ok && v != "" {
		sets = append(sets, "name = ?")
		args = append(args, v)
	}
	if v, ok := body["gender"].(string); ok && v != "" {
		sets = append(sets, "gender = ?")
		args = append(args, v)
	}
	if v, ok := body["birthDate"].(string); ok && v != "" {
		m, err := millisFromInput(v)
		if err == nil {
			sets = append(sets, "birthDate = ?")
			args = append(args, int64(m))
		}
	}
	if av, exists := body["avatar"]; exists {
		if s, ok := av.(string); ok && s != "" {
			sets = append(sets, "avatar = ?")
			args = append(args, toStorageKey(s))
		} else {
			// avatar 显式设为 null / 空
			sets = append(sets, "avatar = ?")
			args = append(args, nil)
		}
	}

	sets = append(sets, "updatedAt = ?")
	args = append(args, int64(nowMillis()))
	args = append(args, id)

	q := `UPDATE "Baby" SET ` + joinComma(sets) + ` WHERE id = ?`
	if _, err := db.Exec(q, args...); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	row := db.QueryRow(`SELECT id, name, gender, birthDate, avatar, createdAt, updatedAt FROM "Baby" WHERE id = ?`, id)
	b, err := scanBaby(row, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, b)
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
