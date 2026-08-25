package main

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeEndpoint(t *testing.T) {
	cases := map[string]string{
		"":                   "",
		"  ":                 "",
		"http://a.com":       "http://a.com",
		"https://a.com":      "https://a.com",
		"HTTPS://a.com":      "HTTPS://a.com",
		"a.com":              "https://a.com",
		"  s3.example.com  ": "https://s3.example.com",
	}
	for in, want := range cases {
		if got := normalizeEndpoint(in); got != want {
			t.Errorf("normalizeEndpoint(%q)=%q want %q", in, got, want)
		}
	}
}

func TestBuildPublicURL(t *testing.T) {
	t.Run("with publicURL", func(t *testing.T) {
		cfg := &s3Config{publicURL: "https://cdn.example.com", bucket: "b", region: "r"}
		if got := buildPublicURL(cfg, "uploads/x.jpg"); got != "https://cdn.example.com/uploads/x.jpg" {
			t.Errorf("got %q", got)
		}
	})
	t.Run("path style", func(t *testing.T) {
		cfg := &s3Config{endpoint: "https://minio.local", bucket: "b", region: "r", forcePathStyle: true}
		if got := buildPublicURL(cfg, "uploads/x.jpg"); got != "https://minio.local/b/uploads/x.jpg" {
			t.Errorf("got %q", got)
		}
	})
	t.Run("virtual host style", func(t *testing.T) {
		cfg := &s3Config{endpoint: "https://s3.example.com", bucket: "b", region: "r"}
		if got := buildPublicURL(cfg, "uploads/x.jpg"); got != "https://b.s3.example.com/uploads/x.jpg" {
			t.Errorf("got %q", got)
		}
	})
	t.Run("default aws endpoint", func(t *testing.T) {
		cfg := &s3Config{bucket: "b", region: "us-west-2"}
		if got := buildPublicURL(cfg, "uploads/x.jpg"); got != "https://b.s3.us-west-2.amazonaws.com/uploads/x.jpg" {
			t.Errorf("got %q", got)
		}
	})
}

func TestToStorageKeyLocal(t *testing.T) {
	cases := map[string]string{
		"abc.jpg":                      "abc.jpg",
		"/api/v1/uploads/abc.jpg":      "abc.jpg",
		"avatar/x.jpg":                 "avatar/x.jpg",
		"/api/v1/uploads/avatar/x.jpg": "avatar/x.jpg",
	}
	for in, want := range cases {
		if got := toStorageKey(in); got != want {
			t.Errorf("toStorageKey(%q)=%q want %q", in, got, want)
		}
	}
}

func TestToStorageKeyS3(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "s3")
	t.Setenv("S3_BUCKET", "mybucket")
	t.Setenv("S3_REGION", "us-east-1")

	cases := map[string]string{
		"uploads/x.jpg":                "uploads/x.jpg",
		"/uploads/x.jpg":               "uploads/x.jpg",
		"/api/v1/uploads/avatar/x.jpg": "avatar/x.jpg",
		"https://mybucket.s3.amazonaws.com/uploads/x.jpg": "uploads/x.jpg",
		"https://s3.amazonaws.com/mybucket/uploads/x.jpg": "uploads/x.jpg",
	}
	for in, want := range cases {
		if got := toStorageKey(in); got != want {
			t.Errorf("toStorageKey(%q)=%q want %q", in, got, want)
		}
	}
}

func TestToDisplayURLLocal(t *testing.T) {
	got, err := toDisplayURL("abc.jpg", 3600)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != "/api/v1/uploads/abc.jpg" {
		t.Errorf("local display should prefix public path, got %q", got)
	}
	got, err = toDisplayURL("/api/v1/uploads/avatar/x.jpg", 3600)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != "/api/v1/uploads/avatar/x.jpg" {
		t.Errorf("already-prefixed path, got %q", got)
	}
}

func TestToDisplayURLS3Public(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "s3")
	t.Setenv("S3_BUCKET", "mybucket")
	t.Setenv("S3_PUBLIC_URL", "https://cdn.example.com")
	got, err := toDisplayURL("uploads/x.jpg", 3600)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != "https://cdn.example.com/uploads/x.jpg" {
		t.Errorf("got %q", got)
	}
}

func TestToStorageKeysAndDisplayURLs(t *testing.T) {
	keys := toStorageKeys([]string{"a.jpg", "b.jpg"})
	if len(keys) != 2 || keys[0] != "a.jpg" {
		t.Errorf("toStorageKeys unexpected: %v", keys)
	}
	urls := toDisplayURLs([]string{"a.jpg", "b.jpg"})
	if len(urls) != 2 || urls[1] != "/api/v1/uploads/b.jpg" {
		t.Errorf("toDisplayURLs unexpected: %v", urls)
	}
	// 空数组应返回非 nil 空切片，保持接口返回 [] 而非 null。
	if got := toDisplayURLs(nil); got == nil || len(got) != 0 {
		t.Errorf("toDisplayURLs(nil) should be empty non-nil slice, got %v", got)
	}
}

func TestDiffRemovedKeys(t *testing.T) {
	old := []string{"a.jpg", "b.jpg", "c.jpg"}
	newer := []string{"b.jpg"}
	removed := diffRemovedKeys(old, newer)
	if len(removed) != 2 {
		t.Fatalf("expected 2 removed, got %v", removed)
	}
	set := map[string]bool{}
	for _, r := range removed {
		set[r] = true
	}
	if !set["a.jpg"] || !set["c.jpg"] {
		t.Errorf("removed set wrong: %v", removed)
	}
}

func TestToDisplayURLS3NoPublicUsesProxy(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "s3")
	t.Setenv("S3_BUCKET", "mybucket")
	t.Setenv("S3_PUBLIC_URL", "")
	got, err := toDisplayURL("medical/x.jpg", 3600)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != "/api/v1/uploads/medical/x.jpg" {
		t.Errorf("s3 without public URL should use proxy path, got %q", got)
	}
}

func TestGetStorageTypeDefaultsLocal(t *testing.T) {
	if getStorageType() != storageLocal {
		t.Errorf("default storage should be local")
	}
}

func TestServeUploadLocalFile(t *testing.T) {
	setupTestDB(t)
	dir := t.TempDir()
	key := "avatar/test.jpg"
	full := filepath.Join(dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("jpeg-bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	s := &testServer{t: t, handler: buildRouter(dir, "")}
	token := insertUser(t, "u1", "U1", "user")
	resp := s.do(http.MethodGet, "/uploads/"+key, token, nil)
	if resp.status != 200 {
		t.Fatalf("status %d body %s", resp.status, resp.body)
	}
	if string(resp.body) != "jpeg-bytes" {
		t.Fatalf("body %q", resp.body)
	}
}

func TestServeUploadBlocksUnreadyVideo(t *testing.T) {
	setupTestDB(t)
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	key := "moments/pending.mp4"
	full := filepath.Join(dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("fake-mp4"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO "UploadedFile" ("key", "createdAt", "used", "ready") VALUES (?, ?, 0, 0)`, key, nowMillis()); err != nil {
		t.Fatal(err)
	}
	s := &testServer{t: t, handler: buildRouter(dir, "")}
	token := insertUser(t, "u1", "U1", "user")
	resp := s.do(http.MethodGet, "/uploads/"+key, token, nil)
	if resp.status != 404 {
		t.Fatalf("unready video should 404, got %d", resp.status)
	}
}

func TestDeleteFileRemovesPoster(t *testing.T) {
	setupTestDB(t)
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	key := "moments/clip.mp4"
	pk := "moments/clip.poster.jpg"
	for _, name := range []string{key, pk} {
		full := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO "UploadedFile" ("key", "createdAt", "used") VALUES (?, ?, 0)`, pk, nowMillis()); err != nil {
		t.Fatal(err)
	}
	if err := deleteFile(key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(key))); !os.IsNotExist(err) {
		t.Fatal("video should be gone")
	}
	if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(pk))); !os.IsNotExist(err) {
		t.Fatal("poster should be gone")
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "UploadedFile" WHERE "key" = ?`, pk).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("poster tracking row should be deleted")
	}
}

func TestSanitizeStorageKeyRejectsTraversal(t *testing.T) {
	if _, err := sanitizeStorageKey("../etc/passwd"); err == nil {
		t.Fatal("expected error for .. traversal")
	}
	if _, err := sanitizeStorageKey("foo/../../secret"); err == nil {
		t.Fatal("expected error for nested ..")
	}
	got, err := sanitizeStorageKey("avatar/x.jpg")
	if err != nil || got != "avatar/x.jpg" {
		t.Fatalf("got %q err %v", got, err)
	}
	got, err = sanitizeStorageKey("/api/v1/uploads/avatar/x.jpg")
	if err != nil || got != "avatar/x.jpg" {
		t.Fatalf("display url got %q err %v", got, err)
	}
}

func TestMediaTypeFromKey(t *testing.T) {
	if mediaTypeFromKey("clip.mp4") != "video" {
		t.Fatal("mp4 should be video")
	}
	if mediaTypeFromKey("clip.MOV") != "video" {
		t.Fatal("MOV should be video")
	}
	if mediaTypeFromKey("pic.jpg") != "image" {
		t.Fatal("jpg should be image")
	}
}

func TestValidateUploadKeysAcceptsDisplayURL(t *testing.T) {
	setupTestDB(t)
	key := "avatar/x.jpg"
	registerUploadKey(t, key)
	if err := validateUploadKeys([]string{"/api/v1/uploads/" + key}); err != nil {
		t.Fatalf("display URL key should validate: %v", err)
	}
}

func TestValidateUploadKeysAllowsDerivedPosterForTrackedVideo(t *testing.T) {
	setupTestDB(t)
	video := "moments/clip.mp4"
	poster := "moments/clip.poster.jpg"
	registerUploadKey(t, video)
	if _, err := db.Exec(`UPDATE "UploadedFile" SET "ready" = 0 WHERE "key" = ?`, video); err != nil {
		t.Fatal(err)
	}
	if err := validateUploadKeys([]string{video, poster}); err != nil {
		t.Fatalf("processing video + derived poster should validate: %v", err)
	}
	if err := validateUploadKeys([]string{poster}); err != nil {
		t.Fatalf("poster of a tracked video should validate: %v", err)
	}
	if err := validateUploadKeys([]string{"moments/missing.poster.jpg"}); err == nil {
		t.Fatal("unknown poster should fail")
	}
}
