package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSPAServing(t *testing.T) {
	setupTestDB(t)

	webDist := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDist, "index.html"), []byte("<html>INDEX</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(webDist, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webDist, "assets", "app.js"), []byte("console.log('app')"), 0o644); err != nil {
		t.Fatal(err)
	}

	router := buildRouter(t.TempDir(), webDist)

	req := func(path string) (int, string) {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, r)
		res := rec.Result()
		buf, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, string(buf)
	}

	t.Run("root serves index", func(t *testing.T) {
		code, body := req("/")
		if code != http.StatusOK {
			t.Fatalf("GET / expected 200, got %d", code)
		}
		if body != "<html>INDEX</html>" {
			t.Errorf("GET / body=%q", body)
		}
	})

	t.Run("static asset served", func(t *testing.T) {
		code, body := req("/assets/app.js")
		if code != http.StatusOK {
			t.Fatalf("GET /assets/app.js expected 200, got %d", code)
		}
		if body != "console.log('app')" {
			t.Errorf("asset body=%q", body)
		}
	})

	t.Run("spa route falls back to index", func(t *testing.T) {
		code, body := req("/timeline")
		if code != http.StatusOK {
			t.Fatalf("GET /timeline expected 200, got %d", code)
		}
		if body != "<html>INDEX</html>" {
			t.Errorf("spa fallback body=%q", body)
		}
	})

	t.Run("missing nested file falls back to index", func(t *testing.T) {
		code, body := req("/assets/does-not-exist.js")
		if code != http.StatusOK {
			t.Fatalf("missing asset expected 200 (index fallback), got %d", code)
		}
		if body != "<html>INDEX</html>" {
			t.Errorf("missing asset should fall back to index, body=%q", body)
		}
	})

	t.Run("directory path falls back to index (no listing)", func(t *testing.T) {
		code, body := req("/assets/")
		if code != http.StatusOK {
			t.Fatalf("dir path expected 200, got %d", code)
		}
		if body != "<html>INDEX</html>" {
			t.Errorf("dir path should fall back to index, body=%q", body)
		}
	})

	t.Run("api still routed", func(t *testing.T) {
		code, _ := req(apiPrefix + "/health")
		if code != http.StatusOK {
			t.Fatalf("GET health expected 200, got %d", code)
		}
	})
}
