package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type ctxKey string

const userIDKey ctxKey = "userId"

func getUserID(r *http.Request) string {
	if v, ok := r.Context().Value(userIDKey).(string); ok {
		return v
	}
	return ""
}

// authMiddleware：Bearer <userId> 简易 token 鉴权，与原实现保持一致。
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		token := strings.TrimPrefix(authHeader, "Bearer ")

		var id string
		err := db.QueryRow(`SELECT id FROM "User" WHERE id = ?`, token).Scan(&id)
		if err != nil {
			if isNoRows(err) {
				writeErr(w, http.StatusUnauthorized, "Invalid token")
				return
			}
			writeErr(w, http.StatusInternalServerError, "Auth error")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

const (
	upperChars  = "ABCDEFGHJKLMNPQRSTUVWXYZ"
	lowerChars  = "abcdefghjkmnpqrstuvwxyz"
	digitChars  = "23456789"
	symbolChars = "!@#$%&*"
	allChars    = upperChars + lowerChars + digitChars + symbolChars
)

func generatePassword(length int) string {
	for {
		bytes := make([]byte, length)
		_, _ = rand.Read(bytes)
		var sb strings.Builder
		for i := 0; i < length; i++ {
			sb.WriteByte(allChars[int(bytes[i])%len(allChars)])
		}
		pw := sb.String()
		if validatePasswordStrength(pw) {
			return pw
		}
	}
}

func validatePasswordStrength(pw string) bool {
	if len(pw) < 8 {
		return false
	}
	return strings.ContainsAny(pw, upperChars) &&
		strings.ContainsAny(pw, lowerChars) &&
		strings.ContainsAny(pw, digitChars) &&
		strings.ContainsAny(pw, symbolChars)
}

func hashPassword(plain string) string {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("[Auth] bcrypt hash failed: %v", err)
	}
	return string(h)
}

func checkPassword(hashed, plain string) bool {
	if !strings.HasPrefix(hashed, "$2") {
		// Legacy plain-text password — compare directly and upgrade in-place
		return hashed == plain
	}
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain)) == nil
}

func isAdmin(userID string) bool {
	var role string
	err := db.QueryRow(`SELECT role FROM "User" WHERE id = ?`, userID).Scan(&role)
	if err != nil {
		return false
	}
	return role == "admin"
}

// POST /auth/login
func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username *string `json:"username"`
		Password *string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Username == nil || body.Password == nil {
		writeErr(w, http.StatusBadRequest, "Required")
		return
	}

	var id, username, storedHash, displayName, role string
	err := db.QueryRow(`SELECT id, username, password, displayName, role FROM "User" WHERE username = ?`, *body.Username).
		Scan(&id, &username, &storedHash, &displayName, &role)
	if err != nil || !checkPassword(storedHash, *body.Password) {
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	if !strings.HasPrefix(storedHash, "$2") {
		conn := db
		pwd := *body.Password
		uid := id
		go func() {
			if conn != nil {
				conn.Exec(`UPDATE "User" SET password = ? WHERE id = ?`, hashPassword(pwd), uid)
			}
		}()
	}

	writeOK(w, map[string]interface{}{
		"token": id,
		"user":  userPublic{ID: id, Username: username, DisplayName: displayName, Role: role},
	})
}

// GET /auth/me
func handleMe(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		writeErr(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")

	var id, username, displayName, role string
	err := db.QueryRow(`SELECT id, username, displayName, role FROM "User" WHERE id = ?`, token).
		Scan(&id, &username, &displayName, &role)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "Invalid token")
		return
	}

	writeOK(w, userPublic{ID: id, Username: username, DisplayName: displayName, Role: role})
}

// requireEditorRole middleware: denies write access for "viewer"-role users.
func requireEditorRole(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var role string
		if err := db.QueryRow(`SELECT role FROM "User" WHERE id = ?`, getUserID(r)).Scan(&role); err != nil || role == "viewer" {
			writeErr(w, http.StatusForbidden, "只读账户无法执行此操作")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// POST /auth/users （管理员）
func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	var body struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Role        string `json:"role"` // optional: "user" (default) or "viewer"
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if len(body.Username) < 2 || len(body.Username) > 50 || len(body.DisplayName) < 1 || len(body.DisplayName) > 50 {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.Role != "viewer" {
		body.Role = "user"
	}

	var exists string
	if err := db.QueryRow(`SELECT id FROM "User" WHERE username = ?`, body.Username).Scan(&exists); err == nil {
		writeErr(w, http.StatusBadRequest, "用户名已存在")
		return
	}

	plainPwd := generatePassword(16)
	id := uuid.NewString()
	now := nowMillis()
	_, err := db.Exec(`INSERT INTO "User" (id, username, password, displayName, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, body.Username, hashPassword(plainPwd), body.DisplayName, body.Role, int64(now), int64(now))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	if err := addUserToAllBabies(id, defaultRole); err != nil {
		logInfo("[Auth] addUserToAllBabies failed: %v", err)
	}

	writeOK(w, map[string]interface{}{
		"id":                id,
		"username":          body.Username,
		"displayName":       body.DisplayName,
		"role":              "user",
		"generatedPassword": plainPwd,
	})
}

// GET /auth/users （管理员）
func handleListUsers(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	rows, err := db.Query(`SELECT id, username, displayName, role, createdAt FROM "User" ORDER BY createdAt ASC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	type userListItem struct {
		ID          string `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Role        string `json:"role"`
		CreatedAt   Millis `json:"createdAt"`
	}

	list := []userListItem{}
	for rows.Next() {
		var it userListItem
		var created int64
		if err := rows.Scan(&it.ID, &it.Username, &it.DisplayName, &it.Role, &created); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		it.CreatedAt = Millis(created)
		list = append(list, it)
	}

	writeOK(w, list)
}

// DELETE /auth/users/{id} （管理员）
func handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	adminID := getUserID(r)
	if !isAdmin(adminID) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	targetID := chiURLParam(r, "id")
	if targetID == adminID {
		writeErr(w, http.StatusBadRequest, "不能删除自己")
		return
	}

	var exists string
	if err := db.QueryRow(`SELECT id FROM "User" WHERE id = ?`, targetID).Scan(&exists); err != nil {
		writeErr(w, http.StatusNotFound, "用户不存在")
		return
	}

	tx, err := db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	stmts := []struct {
		q    string
		args []interface{}
	}{
		{`DELETE FROM "BabyMember" WHERE userId = ?`, []interface{}{targetID}},
		{`DELETE FROM "PushSubscription" WHERE userId = ?`, []interface{}{targetID}},
		{`UPDATE "Record" SET createdBy = ? WHERE createdBy = ?`, []interface{}{adminID, targetID}},
		{`UPDATE "Plan" SET createdBy = ? WHERE createdBy = ?`, []interface{}{adminID, targetID}},
		{`DELETE FROM "User" WHERE id = ?`, []interface{}{targetID}},
	}
	for _, s := range stmts {
		if _, err := tx.Exec(s.q, s.args...); err != nil {
			tx.Rollback()
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeSuccess(w)
}

// POST /auth/users/{id}/reset-password （管理员）
func handleResetPassword(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	targetID := chiURLParam(r, "id")
	plainPwd := generatePassword(16)
	now := nowMillis()

	res, err := db.Exec(`UPDATE "User" SET password = ?, updatedAt = ? WHERE id = ?`, hashPassword(plainPwd), int64(now), targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeOK(w, map[string]interface{}{"generatedPassword": plainPwd})
}

// PUT /auth/users/{id}/role （管理员）
func handleSetUserRole(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	targetID := chiURLParam(r, "id")
	if targetID == getUserID(r) {
		writeErr(w, http.StatusBadRequest, "不能修改自己的角色")
		return
	}

	var body struct {
		Role string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	validRoles := map[string]bool{"admin": true, "user": true, "viewer": true}
	if !validRoles[body.Role] {
		writeErr(w, http.StatusBadRequest, "无效的角色")
		return
	}

	now := int64(nowMillis())
	res, err := db.Exec(`UPDATE "User" SET role = ?, updatedAt = ? WHERE id = ?`, body.Role, now, targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "User not found")
		return
	}
	writeOK(w, map[string]string{"id": targetID, "role": body.Role})
}

var _ = sql.ErrNoRows
