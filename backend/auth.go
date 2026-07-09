package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type ctxKey string

const (
	userIDKey   ctxKey = "userId"
	userRoleKey ctxKey = "userRole"
)

func getUserID(r *http.Request) string {
	if v, ok := r.Context().Value(userIDKey).(string); ok {
		return v
	}
	return ""
}

func getUserRole(r *http.Request) string {
	if v, ok := r.Context().Value(userRoleKey).(string); ok {
		return v
	}
	return ""
}

// authMiddleware：从 HttpOnly cookie 或 Authorization header 读取 token。
// token 格式为 userId:tokenVersion。
// 一次查询获取 id、role、tokenVersion 并全部缓存到 context 中。
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var token string
		if c, err := r.Cookie("token"); err == nil && c.Value != "" {
			token = c.Value
		} else if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
		if token == "" {
			writeErr(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		idx := strings.LastIndex(token, ":")
		if idx <= 0 {
			writeErr(w, http.StatusUnauthorized, "Invalid token format")
			return
		}
		userID := token[:idx]
		tokenVer, err := strconv.Atoi(token[idx+1:])
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "Invalid token format")
			return
		}

		var id, role string
		var dbTokenVer int
		err = db.QueryRow(`SELECT id, role, "tokenVersion" FROM "User" WHERE id = ?`, userID).Scan(&id, &role, &dbTokenVer)
		if err != nil {
			if isNoRows(err) {
				writeErr(w, http.StatusUnauthorized, "Invalid token")
				return
			}
			writeErr(w, http.StatusInternalServerError, "Auth error")
			return
		}

		if tokenVer != dbTokenVer {
			writeErr(w, http.StatusUnauthorized, "Token 已失效，请重新登录")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, id)
		ctx = context.WithValue(ctx, userRoleKey, role)
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
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain)) == nil
}

// ── Login rate limiting ──────────────────────────────────────────────────────

type loginAttempt struct {
	failures int
	lastFail time.Time
}

var (
	loginMu       sync.Mutex
	loginAttempts = map[string]*loginAttempt{}
)

const (
	maxLoginFailures  = 5
	loginLockDuration = 15 * time.Minute
)

func checkLoginRate(username string) bool {
	loginMu.Lock()
	defer loginMu.Unlock()
	a, ok := loginAttempts[username]
	if !ok {
		return true
	}
	if time.Since(a.lastFail) > loginLockDuration {
		delete(loginAttempts, username)
		return true
	}
	return a.failures < maxLoginFailures
}

func recordLoginFailure(username string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	a, ok := loginAttempts[username]
	if !ok {
		a = &loginAttempt{}
		loginAttempts[username] = a
	}
	a.failures++
	a.lastFail = time.Now()
}

func clearLoginFailures(username string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	delete(loginAttempts, username)
}

func isAdminCtx(r *http.Request) bool {
	return getUserRole(r) == "admin"
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

	if !checkLoginRate(*body.Username) {
		writeErr(w, http.StatusTooManyRequests, "登录尝试次数过多，请 15 分钟后再试")
		return
	}

	var id, username, storedHash, displayName, role string
	var tokenVersion int
	var avatar *string
	err := db.QueryRow(`SELECT id, username, password, displayName, role, "tokenVersion", avatar FROM "User" WHERE username = ?`, *body.Username).
		Scan(&id, &username, &storedHash, &displayName, &role, &tokenVersion, &avatar)
	if err != nil || !checkPassword(storedHash, *body.Password) {
		if body.Username != nil {
			recordLoginFailure(*body.Username)
		}
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}

	clearLoginFailures(*body.Username)

	token := fmt.Sprintf("%s:%d", id, tokenVersion)

	http.SetCookie(w, &http.Cookie{
		Name:     "token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		MaxAge:   30 * 24 * 60 * 60, // 30 days
	})

	writeOK(w, map[string]interface{}{
		"token": token,
		"user":  userPublic{ID: id, Username: username, DisplayName: displayName, Role: role, Avatar: avatar},
	})
}

// POST /auth/logout
func handleLogout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "token",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
	writeSuccess(w)
}

// GET /auth/me
func handleMe(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	if userID == "" {
		writeErr(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	role := getUserRole(r)

	var username, displayName string
	var avatar *string
	err := db.QueryRow(`SELECT username, displayName, avatar FROM "User" WHERE id = ?`, userID).
		Scan(&username, &displayName, &avatar)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "Invalid token")
		return
	}

	writeOK(w, userPublic{ID: userID, Username: username, DisplayName: displayName, Role: role, Avatar: avatar})
}

// requireEditorRole middleware: denies write access for "viewer"-role users.
// Uses the role already cached in context by authMiddleware — no extra DB query.
func requireEditorRole(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if getUserRole(r) == "viewer" {
			writeErr(w, http.StatusForbidden, "只读账户无法执行此操作")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// POST /auth/users （管理员）
func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
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
		"role":              body.Role,
		"generatedPassword": plainPwd,
	})
}

// GET /auth/users （管理员）
func handleListUsers(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	rows, err := db.Query(`SELECT id, username, displayName, role, createdAt, avatar FROM "User" ORDER BY createdAt ASC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	type userListItem struct {
		ID          string  `json:"id"`
		Username    string  `json:"username"`
		DisplayName string  `json:"displayName"`
		Role        string  `json:"role"`
		CreatedAt   Millis  `json:"createdAt"`
		Avatar      *string `json:"avatar"`
	}

	list := []userListItem{}
	for rows.Next() {
		var it userListItem
		var created int64
		if err := rows.Scan(&it.ID, &it.Username, &it.DisplayName, &it.Role, &created, &it.Avatar); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		it.CreatedAt = Millis(created)
		list = append(list, it)
	}

	writeOK(w, list)
}

// GET /auth/members — lightweight user list for all authenticated users (visibility picker)
func handleListMembers(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT id, displayName, avatar FROM "User" ORDER BY createdAt ASC`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	type memberItem struct {
		ID          string  `json:"id"`
		DisplayName string  `json:"displayName"`
		Avatar      *string `json:"avatar"`
	}

	list := []memberItem{}
	for rows.Next() {
		var it memberItem
		if err := rows.Scan(&it.ID, &it.DisplayName, &it.Avatar); err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		list = append(list, it)
	}

	writeOK(w, list)
}

// DELETE /auth/users/{id} （管理员）
func handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	adminID := getUserID(r)
	if !isAdminCtx(r) {
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
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	targetID := chiURLParam(r, "id")
	plainPwd := generatePassword(16)
	now := nowMillis()

	res, err := db.Exec(`UPDATE "User" SET password = ?, "tokenVersion" = "tokenVersion" + 1, updatedAt = ? WHERE id = ?`, hashPassword(plainPwd), int64(now), targetID)
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
	if !isAdminCtx(r) {
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

// PUT /auth/users/{id} （管理员：编辑用户基本信息）
func handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	targetID := chiURLParam(r, "id")

	var body struct {
		DisplayName *string `json:"displayName"`
		Role        *string `json:"role"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	if body.Role != nil {
		if targetID == getUserID(r) {
			writeErr(w, http.StatusBadRequest, "不能修改自己的角色")
			return
		}
		validRoles := map[string]bool{"admin": true, "user": true, "viewer": true}
		if !validRoles[*body.Role] {
			writeErr(w, http.StatusBadRequest, "无效的角色")
			return
		}
	}

	if body.DisplayName != nil && len(strings.TrimSpace(*body.DisplayName)) == 0 {
		writeErr(w, http.StatusBadRequest, "显示名称不能为空")
		return
	}

	setClauses := []string{}
	args := []interface{}{}
	if body.DisplayName != nil {
		setClauses = append(setClauses, `displayName = ?`)
		args = append(args, strings.TrimSpace(*body.DisplayName))
	}
	if body.Role != nil {
		setClauses = append(setClauses, `role = ?`)
		args = append(args, *body.Role)
	}
	if len(setClauses) == 0 {
		writeErr(w, http.StatusBadRequest, "没有要更新的字段")
		return
	}

	setClauses = append(setClauses, `updatedAt = ?`)
	args = append(args, int64(nowMillis()))
	args = append(args, targetID)

	query := fmt.Sprintf(`UPDATE "User" SET %s WHERE id = ?`, strings.Join(setClauses, ", "))
	res, err := db.Exec(query, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "User not found")
		return
	}
	writeOK(w, map[string]string{"id": targetID})
}

// PUT /auth/users/{id}/avatar （管理员）
func handleSetUserAvatar(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	targetID := chiURLParam(r, "id")

	contentType := r.Header.Get("Content-Type")

	// Multipart upload: accept file and store in avatar/ folder
	if strings.HasPrefix(contentType, "multipart/") {
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			writeErr(w, http.StatusBadRequest, "No file uploaded")
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			writeErr(w, http.StatusBadRequest, "No file uploaded")
			return
		}
		defer file.Close()

		ct := header.Header.Get("Content-Type")
		if !allowedMimeTypes[ct] {
			writeErr(w, http.StatusBadRequest, "不支持的文件类型，仅允许 JPG/PNG/GIF/WebP")
			return
		}

		data, err := io.ReadAll(io.LimitReader(file, maxUploadSize+1))
		if err != nil || len(data) > maxUploadSize {
			writeErr(w, http.StatusBadRequest, "文件过大")
			return
		}

		if !validateMediaType(data) {
			writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
			return
		}

		cfg := getStorageConfig()
		uid := uuid.NewString()

		compressedData, _ := compressImage(data, ct)
		localKey := "avatar/" + uid + ".jpg"

		if cfg.typ == storageLocal {
			avatarDir := filepath.Join(cfg.uploadDir, "avatar")
			if err := os.MkdirAll(avatarDir, 0o755); err != nil {
				writeErr(w, http.StatusInternalServerError, "Server error")
				return
			}
			if err := os.WriteFile(filepath.Join(cfg.uploadDir, localKey), compressedData, 0o644); err != nil {
				writeErr(w, http.StatusInternalServerError, "Upload failed")
				return
			}
		} else if cfg.s3 != nil {
			client := getS3Client()
			if _, err := client.PutObject(context.Background(), &s3.PutObjectInput{
				Bucket:       aws.String(cfg.s3.bucket),
				Key:          aws.String(localKey),
				Body:         bytes.NewReader(compressedData),
				ContentType:  aws.String("image/jpeg"),
				CacheControl: aws.String(s3CacheControl),
			}); err != nil {
				writeErr(w, http.StatusInternalServerError, "Upload failed")
				return
			}
		}

		var avatarURL string
		if cfg.typ == storageS3 && cfg.s3 != nil && cfg.s3.publicURL != "" {
			avatarURL = buildPublicURL(cfg.s3, localKey)
		} else {
			avatarURL = cfg.publicPath + "/" + localKey
		}
		trackUploadedFile(localKey, "")

		now := int64(nowMillis())
		res, err := db.Exec(`UPDATE "User" SET avatar = ?, updatedAt = ? WHERE id = ?`, avatarURL, now, targetID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			writeErr(w, http.StatusNotFound, "User not found")
			return
		}
		writeOK(w, map[string]interface{}{"id": targetID, "avatar": avatarURL})
		return
	}

	// JSON body: set avatar URL directly or clear it
	var body struct {
		Avatar *string `json:"avatar"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	now := int64(nowMillis())
	res, err := db.Exec(`UPDATE "User" SET avatar = ?, updatedAt = ? WHERE id = ?`, body.Avatar, now, targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "User not found")
		return
	}
	writeOK(w, map[string]interface{}{"id": targetID, "avatar": body.Avatar})
}

var _ = sql.ErrNoRows
