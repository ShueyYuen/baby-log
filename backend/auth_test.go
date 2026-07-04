package main

import (
	"net/http"
	"testing"
)

func TestValidatePasswordStrength(t *testing.T) {
	if validatePasswordStrength("short1!") {
		t.Errorf("too short should fail")
	}
	if validatePasswordStrength("alllowercase1!") {
		t.Errorf("missing uppercase should fail")
	}
	if validatePasswordStrength("NoDigits!!AA") {
		t.Errorf("missing digit should fail")
	}
	if validatePasswordStrength("NoSymbols12AA") {
		t.Errorf("missing symbol should fail")
	}
	if !validatePasswordStrength("Abcdef2!") {
		t.Errorf("valid password should pass")
	}
}

func TestGeneratePasswordAlwaysStrong(t *testing.T) {
	for i := 0; i < 50; i++ {
		pw := generatePassword(16)
		if len(pw) != 16 {
			t.Fatalf("length mismatch: %d", len(pw))
		}
		if !validatePasswordStrength(pw) {
			t.Fatalf("generated password not strong: %q", pw)
		}
	}
}

func TestLoginSuccess(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "alice", "Alice", "user")

	r := s.do(http.MethodPost, "/auth/login", "", map[string]string{
		"username": "alice", "password": "password123",
	})
	e := mustOK(t, r)
	var data struct {
		Token string     `json:"token"`
		User  userPublic `json:"user"`
	}
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Token != uid {
		t.Errorf("token should equal user id, got %q want %q", data.Token, uid)
	}
	if data.User.Username != "alice" || data.User.DisplayName != "Alice" {
		t.Errorf("user payload wrong: %+v", data.User)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	s := newTestServer(t)
	insertUser(t, "bob", "Bob", "user")
	r := s.do(http.MethodPost, "/auth/login", "", map[string]string{
		"username": "bob", "password": "wrong",
	})
	if r.status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", r.status)
	}
}

func TestLoginMissingFields(t *testing.T) {
	s := newTestServer(t)
	r := s.do(http.MethodPost, "/auth/login", "", map[string]string{"username": "x"})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", r.status)
	}
}

func TestMeEndpoint(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "carol", "Carol", "user")

	r := s.do(http.MethodGet, "/auth/me", uid, nil)
	e := mustOK(t, r)
	var u userPublic
	jsonUnmarshal(e.Data, &u)
	if u.ID != uid || u.Username != "carol" {
		t.Errorf("me payload wrong: %+v", u)
	}

	bad := s.do(http.MethodGet, "/auth/me", "nonexistent", nil)
	if bad.status != http.StatusUnauthorized {
		t.Fatalf("bad token expected 401, got %d", bad.status)
	}

	none := s.do(http.MethodGet, "/auth/me", "", nil)
	if none.status != http.StatusUnauthorized {
		t.Fatalf("missing token expected 401, got %d", none.status)
	}
}

func TestAuthMiddlewareRejectsMissingAndInvalid(t *testing.T) {
	s := newTestServer(t)

	// 无 token
	r := s.do(http.MethodGet, "/babies/", "", nil)
	if r.status != http.StatusUnauthorized {
		t.Fatalf("missing token expected 401, got %d", r.status)
	}
	// 无效 token
	r = s.do(http.MethodGet, "/babies/", "invalid-token", nil)
	if r.status != http.StatusUnauthorized {
		t.Fatalf("invalid token expected 401, got %d", r.status)
	}
}

func TestCreateUserRequiresAdmin(t *testing.T) {
	s := newTestServer(t)
	user := insertUser(t, "normal", "Normal", "user")

	r := s.do(http.MethodPost, "/auth/users", user, map[string]string{
		"username": "newone", "displayName": "New One",
	})
	if r.status != http.StatusForbidden {
		t.Fatalf("non-admin should be forbidden, got %d", r.status)
	}
}

func TestCreateUserAsAdmin(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")

	r := s.do(http.MethodPost, "/auth/users", admin, map[string]string{
		"username": "newuser", "displayName": "New User",
	})
	e := mustOK(t, r)
	var data struct {
		ID                string `json:"id"`
		Username          string `json:"username"`
		Role              string `json:"role"`
		GeneratedPassword string `json:"generatedPassword"`
	}
	jsonUnmarshal(e.Data, &data)
	if data.Username != "newuser" || data.Role != "user" {
		t.Errorf("payload wrong: %+v", data)
	}
	if !validatePasswordStrength(data.GeneratedPassword) {
		t.Errorf("generated password should be strong: %q", data.GeneratedPassword)
	}

	// 重复用户名
	dup := s.do(http.MethodPost, "/auth/users", admin, map[string]string{
		"username": "newuser", "displayName": "Dup",
	})
	if dup.status != http.StatusBadRequest {
		t.Fatalf("duplicate username expected 400, got %d", dup.status)
	}

	// 非法输入（用户名过短）
	bad := s.do(http.MethodPost, "/auth/users", admin, map[string]string{
		"username": "x", "displayName": "Y",
	})
	if bad.status != http.StatusBadRequest {
		t.Fatalf("invalid input expected 400, got %d", bad.status)
	}
}

func TestListUsersAsAdmin(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	insertUser(t, "u2", "User Two", "user")

	r := s.do(http.MethodGet, "/auth/users", admin, nil)
	e := mustOK(t, r)
	var list []map[string]interface{}
	jsonUnmarshal(e.Data, &list)
	if len(list) != 2 {
		t.Fatalf("expected 2 users, got %d", len(list))
	}
}

func TestDeleteUser(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	target := insertUser(t, "target", "Target", "user")

	// 不能删除自己
	self := s.do(http.MethodDelete, "/auth/users/"+admin, admin, nil)
	if self.status != http.StatusBadRequest {
		t.Fatalf("delete self expected 400, got %d", self.status)
	}

	// 删除不存在
	nf := s.do(http.MethodDelete, "/auth/users/does-not-exist", admin, nil)
	if nf.status != http.StatusNotFound {
		t.Fatalf("delete missing expected 404, got %d", nf.status)
	}

	// 删除目标用户成功
	ok := s.do(http.MethodDelete, "/auth/users/"+target, admin, nil)
	mustOK(t, ok)

	var cnt int
	db.QueryRow(`SELECT COUNT(*) FROM "User" WHERE id = ?`, target).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("target user should be deleted")
	}
}

func TestResetPassword(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	target := insertUser(t, "target", "Target", "user")

	r := s.do(http.MethodPost, "/auth/users/"+target+"/reset-password", admin, nil)
	e := mustOK(t, r)
	var data struct {
		GeneratedPassword string `json:"generatedPassword"`
	}
	jsonUnmarshal(e.Data, &data)
	if !validatePasswordStrength(data.GeneratedPassword) {
		t.Errorf("reset password should be strong")
	}

	// 目标不存在 -> 500（保持原语义）
	miss := s.do(http.MethodPost, "/auth/users/nope/reset-password", admin, nil)
	if miss.status != http.StatusInternalServerError {
		t.Fatalf("reset missing expected 500, got %d", miss.status)
	}
}
