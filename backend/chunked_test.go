package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func fakeMP4(size int) []byte {
	if size < 12 {
		size = 12
	}
	buf := make([]byte, size)
	copy(buf[4:8], []byte("ftyp"))
	return buf
}

func TestNormalizeMomentMIME(t *testing.T) {
	cases := []struct {
		filename, contentType, want string
	}{
		{"clip.mp4", "video/mp4", "video/mp4"},
		{"clip.MOV", "", "video/quicktime"},
		{"clip.mp4", "application/octet-stream", "video/mp4"},
		{"photo.JPG", "application/octet-stream", "image/jpeg"},
		{"clip.mp4", "video/mp4; codecs=avc1", "video/mp4"},
		{"IMG_0001.HEIC", "image/heic", "image/heic"},
		{"IMG_0001.HEIC", "", "image/heic"},
		{"photo.jpg", "image/jpg", "image/jpeg"},
	}
	for _, tc := range cases {
		got := normalizeMomentMIME(tc.filename, tc.contentType)
		if got != tc.want {
			t.Errorf("normalizeMomentMIME(%q, %q)=%q want %q", tc.filename, tc.contentType, got, tc.want)
		}
	}
}

func TestUploadMomentsVideoLocal(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	mp4 := fakeMP4(64 * 1024)
	buf, ct := multipartImage(t, "files", "clip.mp4", "video/mp4", mp4)
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/moments", buf)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	e := mustOK(t, r)
	var results []uploadResult
	if err := jsonUnmarshal(e.Data, &results); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(results) != 1 || results[0].Key == "" || results[0].MediaType != "video" {
		t.Fatalf("unexpected result: %+v", results)
	}
	path := filepath.Join(os.Getenv("UPLOAD_DIR"), filepath.FromSlash(results[0].Key))
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("video file missing: %v", err)
	}
}

func TestUploadMomentsVideoInfersMIME(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	mp4 := fakeMP4(32 * 1024)
	buf, ct := multipartImage(t, "files", "clip.mp4", "application/octet-stream", mp4)
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/moments", buf)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	e := mustOK(t, r)
	var results []uploadResult
	if err := jsonUnmarshal(e.Data, &results); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(results) != 1 || results[0].MediaType != "video" {
		t.Fatalf("expected video result, got %+v", results)
	}
}

func TestChunkedUploadVideo(t *testing.T) {
	uploadDir := t.TempDir()
	t.Setenv("UPLOAD_DIR", uploadDir)
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	payload := fakeMP4(2000)
	initResp := s.do(http.MethodPost, "/upload/chunked/init/moments", uid, map[string]interface{}{
		"filename":    "clip.mp4",
		"contentType": "video/mp4",
		"fileSize":    len(payload),
		"chunkSize":   1024,
	})
	e := mustOK(t, initResp)
	var init chunkedInitResponse
	if err := jsonUnmarshal(e.Data, &init); err != nil {
		t.Fatalf("decode init: %v body=%s", err, string(e.Data))
	}
	if init.UploadID == "" || init.TotalParts < 1 {
		t.Fatalf("bad init: %+v", init)
	}

	offset := 0
	for offset < len(payload) {
		end := offset + 1024
		if end > len(payload) {
			end = len(payload)
		}
		partReq := httptest.NewRequest(
			http.MethodPost,
			fmt.Sprintf("%s/upload/chunked/part/%s?offset=%d", apiPrefix, init.UploadID, offset),
			bytes.NewReader(payload[offset:end]),
		)
		partReq.Header.Set("Authorization", "Bearer "+uid)
		partResp := s.rawRequest(partReq)
		mustOK(t, partResp)
		offset = end
	}

	completeResp := s.do(http.MethodPost, "/upload/chunked/complete/"+init.UploadID, uid, nil)
	ce := mustOK(t, completeResp)
	var results []uploadResult
	if err := jsonUnmarshal(ce.Data, &results); err != nil {
		t.Fatalf("decode complete: %v", err)
	}
	if len(results) != 1 || results[0].Key == "" || results[0].MediaType != "video" {
		t.Fatalf("complete result: %+v", results)
	}
	path := filepath.Join(uploadDir, filepath.FromSlash(results[0].Key))
	st, err := os.Stat(path)
	if err != nil {
		t.Fatalf("final file missing: %v", err)
	}
	if st.Size() != int64(len(payload)) {
		t.Fatalf("final size %d want %d", st.Size(), len(payload))
	}
}

func TestChunkedInitInfersMIMEFromFilename(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	r := s.do(http.MethodPost, "/upload/chunked/init/moments", uid, map[string]interface{}{
		"filename":    "IMG_1234.MOV",
		"contentType": "",
		"fileSize":    1024,
		"chunkSize":   1024,
	})
	mustOK(t, r)
}
