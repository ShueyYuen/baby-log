package main

import (
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
	// 默认本地存储：原样返回。
	if got := toStorageKey("/api/v1/uploads/abc.jpg"); got != "/api/v1/uploads/abc.jpg" {
		t.Errorf("local should return input, got %q", got)
	}
}

func TestToStorageKeyS3(t *testing.T) {
	t.Setenv("STORAGE_TYPE", "s3")
	t.Setenv("S3_BUCKET", "mybucket")
	t.Setenv("S3_REGION", "us-east-1")

	cases := map[string]string{
		"uploads/x.jpg":  "uploads/x.jpg",
		"/uploads/x.jpg": "uploads/x.jpg",
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
	if got != "abc.jpg" {
		t.Errorf("local display should be unchanged, got %q", got)
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
	if len(urls) != 2 || urls[1] != "b.jpg" {
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

func TestGetStorageTypeDefaultsLocal(t *testing.T) {
	if getStorageType() != storageLocal {
		t.Errorf("default storage should be local")
	}
}
