package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPosterKeyFromVideoKey(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"moments/abc.mp4", "moments/abc.poster.jpg"},
		{"clip.MOV", "clip.poster.jpg"},
		{"health/x.webm", "health/x.poster.jpg"},
		{"pic.jpg", ""},
		{"moments/abc.poster.jpg", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := posterKeyFromVideoKey(tc.in); got != tc.want {
			t.Errorf("posterKeyFromVideoKey(%q)=%q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestUploadPoster(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	videoKey := "moments/clip.mp4"
	registerUploadKey(t, videoKey)
	if err := os.MkdirAll(filepath.Join(dir, "moments"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(videoKey)), fakeMP4(64), 0o644); err != nil {
		t.Fatal(err)
	}

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	_ = w.WriteField("videoKey", videoKey)
	part, err := w.CreateFormFile("file", "poster.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(fakeJPEG); err != nil {
		t.Fatal(err)
	}
	w.Close()

	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/poster", buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+uid)
	r := s.rawRequest(req)
	e := mustOK(t, r)
	var result uploadResult
	jsonUnmarshal(e.Data, &result)
	if result.Key != "moments/clip.poster.jpg" {
		t.Fatalf("poster key=%q", result.Key)
	}
	if _, err := os.Stat(filepath.Join(dir, "moments", "clip.poster.jpg")); err != nil {
		t.Fatalf("poster file missing: %v", err)
	}
}

func TestUploadPosterRejectsNonVideo(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	registerUploadKey(t, "pic.jpg")

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	_ = w.WriteField("videoKey", "pic.jpg")
	part, _ := w.CreateFormFile("file", "poster.jpg")
	part.Write(fakeJPEG)
	w.Close()

	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/poster", buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+uid)
	r := s.rawRequest(req)
	if r.status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d %s", r.status, string(r.body))
	}
}

func TestMediaItemsToDisplayIncludesPosterURL(t *testing.T) {
	items := []MediaItem{
		{Key: "moments/a.mp4", MediaType: "video", PosterKey: "moments/a.poster.jpg"},
		{Key: "moments/old.mp4", MediaType: "video"},
		{Key: "moments/b.jpg", MediaType: "image"},
	}
	out := mediaItemsToDisplay(items, "u1", true, "u1")
	if len(out) != 3 {
		t.Fatalf("len=%d", len(out))
	}
	if out[0].PosterURL == "" || out[0].PosterKey != "moments/a.poster.jpg" {
		t.Fatalf("video poster missing: %+v", out[0])
	}
	if out[1].PosterURL == "" {
		t.Fatalf("video without posterKey should still get a derived poster URL: %+v", out[1])
	}
	if out[2].PosterURL != "" {
		t.Fatalf("image should not have poster: %+v", out[2])
	}
}

func TestAttachPosterToResultDoesNotWriteFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	result := &uploadResult{Key: "moments/clip.mp4", MediaType: "video"}
	attachPosterToResult(result)
	if result.PosterKey != "moments/clip.poster.jpg" {
		t.Fatalf("posterKey=%q", result.PosterKey)
	}
	if result.PosterURL == "" {
		t.Fatal("expected derived poster URL")
	}
	if _, err := os.Stat(filepath.Join(dir, "moments", "clip.poster.jpg")); !os.IsNotExist(err) {
		t.Fatalf("server must not generate poster files: %v", err)
	}
}
