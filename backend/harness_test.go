package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// setupTestDB 为每个测试创建独立的临时 SQLite 数据库，并把全局 db 指向它。
// 使用完全一致的 schemaSQL，保证与生产行为相同。
func setupTestDB(t *testing.T) {
	t.Helper()

	prev := db
	path := filepath.Join(t.TempDir(), "test.db")
	conn, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	conn.SetMaxOpenConns(1)
	if _, err := conn.Exec(schemaSQL); err != nil {
		t.Fatalf("init schema: %v", err)
	}
	db = conn
	t.Cleanup(func() {
		conn.Close()
		db = prev
	})
}

// testServer 封装 router，提供便捷请求方法。
type testServer struct {
	t       *testing.T
	handler http.Handler
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	setupTestDB(t)
	return &testServer{t: t, handler: buildRouter(t.TempDir(), "")}
}

type resp struct {
	status int
	body   []byte
}

func (r resp) decode(t *testing.T, v interface{}) {
	t.Helper()
	if err := json.Unmarshal(r.body, v); err != nil {
		t.Fatalf("decode response failed: %v; body=%s", err, string(r.body))
	}
}

// apiEnvelope 匹配 { success, data, error }。
type apiEnvelope struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Error   string          `json:"error"`
}

func (r resp) envelope(t *testing.T) apiEnvelope {
	t.Helper()
	var e apiEnvelope
	r.decode(t, &e)
	return e
}

// do 发起请求。body 为 nil 时不带请求体；否则序列化为 JSON。token 非空时加 Bearer 头。
func (s *testServer) do(method, path, token string, body interface{}) resp {
	s.t.Helper()
	var reader io.Reader
	if body != nil {
		switch b := body.(type) {
		case string:
			reader = bytes.NewBufferString(b)
		case []byte:
			reader = bytes.NewReader(b)
		default:
			buf, err := json.Marshal(body)
			if err != nil {
				s.t.Fatalf("marshal body: %v", err)
			}
			reader = bytes.NewReader(buf)
		}
	}
	req := httptest.NewRequest(method, apiPrefix+path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	res := rec.Result()
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return resp{status: res.StatusCode, body: data}
}

// rawRequest 直接使用给定 *http.Request（用于 multipart 上传等）。
func (s *testServer) rawRequest(req *http.Request) resp {
	s.t.Helper()
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	res := rec.Result()
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return resp{status: res.StatusCode, body: data}
}

// ---- 测试数据构造助手 ----

func insertUser(t *testing.T, username, displayName, role string) string {
	t.Helper()
	id := uuid.NewString()
	now := int64(nowMillis())
	_, err := db.Exec(`INSERT INTO "User" (id, username, password, displayName, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		id, username, "password123", displayName, role, now, now)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

// createBabyFor 直接在库中创建宝宝并把 userID 设为 admin 成员，返回 babyId。
func createBabyFor(t *testing.T, userID, name string) string {
	t.Helper()
	id := uuid.NewString()
	now := int64(nowMillis())
	if _, err := db.Exec(`INSERT INTO "Baby" (id, name, gender, birthDate, createdAt, updatedAt) VALUES (?, ?, 'male', ?, ?, ?)`,
		id, name, now, now, now); err != nil {
		t.Fatalf("insert baby: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO "BabyMember" (id, userId, babyId, role) VALUES (?, ?, ?, 'admin')`,
		uuid.NewString(), userID, id); err != nil {
		t.Fatalf("insert member: %v", err)
	}
	return id
}

// jsonUnmarshal 是测试内解码便捷函数。
func jsonUnmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

// insertReminder 直接向库中写入一条未发送提醒，remindAt 用 ISO 字符串。
func insertReminder(t *testing.T, babyID, remindAtISO, title, body string) string {
	t.Helper()
	m, err := millisFromInput(remindAtISO)
	if err != nil {
		t.Fatalf("parse remindAt: %v", err)
	}
	id := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO "Reminder" (id, babyId, remindAt, source, title, body, refId, sent, createdAt)
		VALUES (?, ?, ?, 'feeding_manual', ?, ?, NULL, 0, ?)`,
		id, babyID, int64(m), title, body, int64(nowMillis())); err != nil {
		t.Fatalf("insert reminder: %v", err)
	}
	return id
}

// insertFeeding 直接向库写入一条奶瓶喂养记录。
func insertFeeding(t *testing.T, babyID, userID, typ string, amountMl float64, occurred time.Time) {
	t.Helper()
	data := `{"amountMl":` + strconv.FormatFloat(amountMl, 'f', -1, 64) + `}`
	now := int64(nowMillis())
	if _, err := db.Exec(`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, createdBy, createdAt, updatedAt)
		VALUES (?, ?, 'feeding', ?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), babyID, typ, data, occurred.UnixMilli(), userID, now, now); err != nil {
		t.Fatalf("insert feeding: %v", err)
	}
}

func mustOK(t *testing.T, r resp) apiEnvelope {
	t.Helper()
	if r.status != http.StatusOK {
		t.Fatalf("expected 200, got %d; body=%s", r.status, string(r.body))
	}
	e := r.envelope(t)
	if !e.Success {
		t.Fatalf("expected success=true; body=%s", string(r.body))
	}
	return e
}
