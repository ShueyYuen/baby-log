package main

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func insertTrackedUpload(t *testing.T, key, rawKey string, used, ready int) {
	t.Helper()
	now := int64(nowMillis())
	if _, err := db.Exec(
		`INSERT INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "ready") VALUES (?, ?, ?, ?, ?)`,
		key, rawKey, now, used, ready,
	); err != nil {
		t.Fatalf("insert upload: %v", err)
	}
}

func adminUploadsList(t *testing.T, s *testServer, token, query string) resp {
	t.Helper()
	path := "/admin/uploads"
	if query != "" {
		path += "?" + query
	}
	return s.do(http.MethodGet, path, token, nil)
}

func TestAdminUploadsForbiddenForUser(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u1", "U1", "user")
	r := adminUploadsList(t, s, uid, "")
	if r.status != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", r.status, r.body)
	}
}

func TestAdminUploadsListAndFilter(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	img := "moments/" + uuid.NewString() + ".jpg"
	vid := "moments/" + uuid.NewString() + ".mp4"
	insertTrackedUpload(t, img, "", 1, 1)
	insertTrackedUpload(t, vid, "", 0, 0)

	r := adminUploadsList(t, s, admin, "")
	e := mustOK(t, r)
	var data struct {
		Items  []adminUploadItem `json:"items"`
		Total  int               `json:"total"`
		Counts adminUploadCounts `json:"counts"`
	}
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Total < 2 || data.Counts.Unready < 1 || data.Counts.Videos < 1 {
		t.Fatalf("list: %+v", data)
	}

	r = adminUploadsList(t, s, admin, "status=unready")
	e = mustOK(t, r)
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Total != 1 || len(data.Items) != 1 || data.Items[0].Key != vid {
		t.Fatalf("unready filter: %+v", data)
	}
	if data.Items[0].Ready || data.Items[0].MediaType != "video" {
		t.Fatalf("item: %+v", data.Items[0])
	}

	r = adminUploadsList(t, s, admin, "status=video&q="+vid)
	e = mustOK(t, r)
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Total != 1 || data.Items[0].Key != vid {
		t.Fatalf("search: %+v", data)
	}
}

func TestAdminDeleteUploadRequiresForceWhenReferenced(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	uid := tokenToUserID(admin)
	babyID := createBabyFor(t, admin, "B")
	key := "records/" + uuid.NewString() + ".jpg"
	insertTrackedUpload(t, key, "", 1, 1)

	images := `[{"key":"` + key + `"}]`
	if _, err := db.Exec(
		`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, images, createdBy, createdAt, updatedAt)
		 VALUES (?, ?, 'feeding', 'bottle', '{}', ?, ?, ?, ?, ?)`,
		uuid.NewString(), babyID, int64(nowMillis()), images, uid, int64(nowMillis()), int64(nowMillis()),
	); err != nil {
		t.Fatal(err)
	}

	r := s.do(http.MethodDelete, "/admin/uploads?key="+key, admin, nil)
	if r.status != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", r.status, r.body)
	}
	if !trackingExists(t, key) {
		t.Fatal("should keep referenced file")
	}

	r = s.do(http.MethodDelete, "/admin/uploads?key="+key+"&force=1", admin, nil)
	mustOK(t, r)
	if trackingExists(t, key) {
		t.Fatal("force delete should drop tracking")
	}
}

func TestAdminDeleteUnusedUpload(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	key := "moments/" + uuid.NewString() + ".jpg"
	insertTrackedUpload(t, key, "", 0, 1)

	r := s.do(http.MethodDelete, "/admin/uploads?key="+key, admin, nil)
	mustOK(t, r)
	if trackingExists(t, key) {
		t.Fatal("unused file should be deleted")
	}
}

func TestAdminTranscodeDisabled(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	key := "moments/" + uuid.NewString() + ".mp4"
	insertTrackedUpload(t, key, "", 0, 0)

	r := s.do(http.MethodPost, "/admin/uploads/transcode", admin, map[string]string{"key": key})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d %s", r.status, r.body)
	}
}

func TestAdminTranscodeRejectsImage(t *testing.T) {
	s := newTestServer(t)
	if !haveFFmpeg() {
		t.Skip("ffmpeg not installed")
	}
	t.Setenv("VIDEO_TRANSCODE", "1")
	admin := insertUser(t, "admin", "Admin", "admin")
	key := "moments/" + uuid.NewString() + ".jpg"
	insertTrackedUpload(t, key, "", 1, 1)

	r := s.do(http.MethodPost, "/admin/uploads/transcode", admin, map[string]string{"key": key})
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d %s", r.status, r.body)
	}
}

func TestAdminTranscodeMissingFile(t *testing.T) {
	s := newTestServer(t)
	if !haveFFmpeg() {
		t.Skip("ffmpeg not installed")
	}
	t.Setenv("VIDEO_TRANSCODE", "1")
	t.Setenv("STORAGE_TYPE", "local")
	admin := insertUser(t, "admin", "Admin", "admin")
	key := "moments/" + uuid.NewString() + ".mp4"
	insertTrackedUpload(t, key, "", 0, 0)

	r := s.do(http.MethodPost, "/admin/uploads/transcode", admin, map[string]string{"key": key})
	if r.status != http.StatusConflict {
		t.Fatalf("expected 409, got %d %s", r.status, r.body)
	}
}

func TestAdminTranscodeQueuesLocalVideo(t *testing.T) {
	s := newTestServer(t)
	if !haveFFmpeg() {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	t.Setenv("VIDEO_TRANSCODE", "1")
	t.Setenv("STORAGE_TYPE", "local")
	admin := insertUser(t, "admin", "Admin", "admin")
	key := "moments/" + uuid.NewString() + ".mp4"
	src := filepath.Join(dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(src), 0o755); err != nil {
		t.Fatal(err)
	}
	ffmpegGen(t, src, "libx264", false)
	insertTrackedUpload(t, key, "", 1, 1)

	r := s.do(http.MethodPost, "/admin/uploads/transcode", admin, map[string]string{"key": key})
	e := mustOK(t, r)
	var data struct {
		Queued int    `json:"queued"`
		Key    string `json:"key"`
	}
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Queued != 1 || data.Key != key {
		t.Fatalf("queued: %+v", data)
	}
	if isUploadReady(key) {
		t.Fatal("should be marked unready while queued")
	}

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if isUploadReady(key) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("manual transcode did not complete")
}

func TestAdminTranscodeAllUnready(t *testing.T) {
	s := newTestServer(t)
	if !haveFFmpeg() {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	t.Setenv("VIDEO_TRANSCODE", "1")
	t.Setenv("STORAGE_TYPE", "local")
	admin := insertUser(t, "admin", "Admin", "admin")
	key := "moments/" + uuid.NewString() + ".mp4"
	src := filepath.Join(dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(src), 0o755); err != nil {
		t.Fatal(err)
	}
	ffmpegGen(t, src, "libx264", false)
	insertTrackedUpload(t, key, "", 0, 0)
	insertTrackedUpload(t, "moments/missing.mp4", "", 0, 0)

	r := s.do(http.MethodPost, "/admin/uploads/transcode", admin, map[string]any{"allUnready": true})
	e := mustOK(t, r)
	var data struct {
		Queued  int `json:"queued"`
		Skipped int `json:"skipped"`
	}
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Queued != 1 || data.Skipped != 1 {
		t.Fatalf("allUnready: %+v", data)
	}

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if isUploadReady(key) {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("allUnready transcode did not complete")
}
