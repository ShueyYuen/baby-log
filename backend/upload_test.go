package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"
)

func multipartImage(t *testing.T, field, filename, contentType string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="`+field+`"; filename="`+filename+`"`)
	h.Set("Content-Type", contentType)
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatalf("create part: %v", err)
	}
	part.Write(data)
	w.Close()
	return buf, w.FormDataContentType()
}

// minimal PNG header (8 bytes magic + IHDR chunk for http.DetectContentType)
var fakePNG = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)

// minimal JPEG header
var fakeJPEG = append([]byte("\xff\xd8\xff\xe0"), make([]byte, 64)...)

func TestUploadSingle(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	buf, ct := multipartImage(t, "file", "pic.png", "image/png", fakePNG)
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/", buf)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	e := mustOK(t, r)
	var result uploadResult
	jsonUnmarshal(e.Data, &result)
	if result.Key == "" || result.URL == "" {
		t.Fatalf("upload result missing fields: %+v", result)
	}
}

func TestUploadMultiple(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	for _, tc := range []struct {
		name string
		ct   string
		data []byte
	}{
		{"a.png", "image/png", fakePNG},
		{"b.jpg", "image/jpeg", fakeJPEG},
	} {
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", `form-data; name="files"; filename="`+tc.name+`"`)
		h.Set("Content-Type", tc.ct)
		part, err := w.CreatePart(h)
		if err != nil {
			t.Fatalf("create part: %v", err)
		}
		part.Write(tc.data)
	}
	w.Close()

	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/multiple", buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	e := mustOK(t, r)
	var results []uploadResult
	jsonUnmarshal(e.Data, &results)
	if len(results) != 2 {
		t.Fatalf("expected 2 upload results, got %d", len(results))
	}
}

func TestUploadMultipleNoFiles(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	w.WriteField("other", "x")
	w.Close()
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/multiple", buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	if r.status != http.StatusBadRequest {
		t.Fatalf("no files expected 400, got %d", r.status)
	}
}

func TestUploadRejectsBadMime(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	buf, ct := multipartImage(t, "file", "evil.txt", "text/plain", []byte("hello"))
	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/", buf)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	if r.status != http.StatusBadRequest {
		t.Fatalf("bad mime expected 400, got %d; body=%s", r.status, string(r.body))
	}
}

func TestUploadNoFile(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")

	req := httptest.NewRequest(http.MethodPost, apiPrefix+"/upload/", bytes.NewBufferString(""))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=xyz")
	req.Header.Set("Authorization", "Bearer "+uid)

	r := s.rawRequest(req)
	if r.status != http.StatusBadRequest {
		t.Fatalf("no file expected 400, got %d", r.status)
	}
}
