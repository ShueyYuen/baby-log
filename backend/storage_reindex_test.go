package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRelatedStorageKeysIncludesCompanions(t *testing.T) {
	key := "moments/clip.mp4"
	got := map[string]bool{}
	for _, k := range relatedStorageKeys(key) {
		got[k] = true
	}
	for _, want := range []string{key, "moments/clip.poster.jpg", "moments/raw/clip.mp4"} {
		if !got[want] {
			t.Fatalf("missing %s in %v", want, relatedStorageKeys(key))
		}
	}

	poster := "moments/clip.poster.jpg"
	got = map[string]bool{}
	for _, k := range relatedStorageKeys(poster) {
		got[k] = true
	}
	if !got["moments/clip.mp4"] {
		t.Fatalf("poster should relate to video, got %v", relatedStorageKeys(poster))
	}

	raw := "moments/raw/photo.jpg"
	got = map[string]bool{}
	for _, k := range relatedStorageKeys(raw) {
		got[k] = true
	}
	if !got["moments/photo.jpg"] {
		t.Fatalf("raw should relate to compressed, got %v", relatedStorageKeys(raw))
	}
}

func TestClassifyUntrackedS3Objects(t *testing.T) {
	setupTestDB(t)
	old := time.Now().Add(-48 * time.Hour)
	recent := time.Now().Add(-time.Hour)

	tracked := "moments/" + uuid.NewString() + ".jpg"
	raw := "moments/raw/" + uuid.NewString() + ".jpg"
	insertTrackedUpload(t, tracked, raw, 1, 1)

	video := "moments/" + uuid.NewString() + ".mp4"
	insertTrackedUpload(t, video, "", 1, 1)

	token := insertUser(t, "u1", "U1", "user")
	uid := tokenToUserID(token)
	babyID := createBabyFor(t, token, "B")
	referenced := "records/" + uuid.NewString() + ".jpg"
	images := `[{"key":"` + referenced + `"}]`
	if _, err := db.Exec(
		`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, images, createdBy, createdAt, updatedAt)
		 VALUES (?, ?, 'feeding', 'bottle', '{}', ?, ?, ?, ?, ?)`,
		uuid.NewString(), babyID, int64(nowMillis()), images, uid, int64(nowMillis()), int64(nowMillis()),
	); err != nil {
		t.Fatal(err)
	}

	orphan := "moments/" + uuid.NewString() + ".jpg"
	fresh := "moments/" + uuid.NewString() + ".jpg"
	otherBucket := "tmp/" + uuid.NewString() + ".jpg"

	objects := []s3ListedObject{
		{Key: tracked, Size: 10, LastModified: old},
		{Key: raw, Size: 20, LastModified: old},
		{Key: posterKeyFromVideoKey(video), Size: 5, LastModified: old},
		{Key: referenced, Size: 30, LastModified: old},
		{Key: orphan, Size: 100, LastModified: old},
		{Key: fresh, Size: 50, LastModified: recent},
		{Key: otherBucket, Size: 999, LastModified: old},
		{Key: "moments/", Size: 0, LastModified: old},
	}
	orphans, stats := classifyUntrackedS3Objects(objects, trackedStorageKeys(), time.Now())
	if stats.tracked != 3 {
		t.Fatalf("tracked=%d want 3", stats.tracked)
	}
	if stats.recent != 1 {
		t.Fatalf("recent=%d want 1", stats.recent)
	}
	if stats.referenced != 1 {
		t.Fatalf("referenced=%d want 1", stats.referenced)
	}
	if len(orphans) != 1 || orphans[0].Key != orphan || orphans[0].Size != 100 {
		t.Fatalf("orphans=%+v", orphans)
	}
}

func uploadSize(t *testing.T, key string) int64 {
	t.Helper()
	var size int64
	if err := db.QueryRow(`SELECT "size" FROM "UploadedFile" WHERE "key" = ?`, key).Scan(&size); err != nil {
		t.Fatalf("size for %s: %v", key, err)
	}
	return size
}

func TestReindexIndexesPosterFillsSizeAndPurges(t *testing.T) {
	setupTestDB(t)
	resetS3OrphanState()
	t.Cleanup(resetS3OrphanState)

	video := "moments/" + uuid.NewString() + ".mp4"
	poster := posterKeyFromVideoKey(video)
	orphan := "moments/" + uuid.NewString() + ".jpg"
	insertTrackedUpload(t, video, "", 1, 1)
	if uploadSize(t, video) != 0 {
		t.Fatal("fixture video size should start at 0")
	}

	old := time.Now().Add(-48 * time.Hour)
	prevList := listStorageObjectsFn
	prevDel := deleteStorageKeysFn
	t.Cleanup(func() {
		listStorageObjectsFn = prevList
		deleteStorageKeysFn = prevDel
	})
	listStorageObjectsFn = func(context.Context) (s3ListResult, error) {
		return s3ListResult{
			Objects: []s3ListedObject{
				{Key: video, Size: 111, LastModified: old},
				{Key: poster, Size: 22, LastModified: old},
				{Key: orphan, Size: 50, LastModified: old},
			},
			ListRequests: 1,
		}, nil
	}
	var deleted []string
	deleteStorageKeysFn = func(_ context.Context, keys []string) (int, []string) {
		deleted = append([]string{}, keys...)
		return len(keys), nil
	}

	result, err := reindexStorage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.PostersIndexed != 1 {
		t.Fatalf("postersIndexed=%d", result.PostersIndexed)
	}
	if result.SizesUpdated < 1 {
		t.Fatalf("sizesUpdated=%d", result.SizesUpdated)
	}
	if result.Deleted != 1 || result.Found != 1 {
		t.Fatalf("purge: %+v deleted=%v", result, deleted)
	}
	if len(deleted) != 1 || deleted[0] != orphan {
		t.Fatalf("deleted=%v want only %s", deleted, orphan)
	}
	if !trackingExists(t, poster) {
		t.Fatal("existing poster must be indexed")
	}
	if uploadSize(t, poster) != 22 {
		t.Fatalf("poster size=%d", uploadSize(t, poster))
	}
	if uploadSize(t, video) != 111 {
		t.Fatalf("video size=%d", uploadSize(t, video))
	}
}

func TestReindexIncludesRawSize(t *testing.T) {
	setupTestDB(t)
	resetS3OrphanState()
	t.Cleanup(resetS3OrphanState)

	key := "moments/" + uuid.NewString() + ".jpg"
	raw := "moments/raw/" + uuid.NewString() + ".jpg"
	now := int64(nowMillis())
	if _, err := db.Exec(
		`INSERT INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "ready", "size") VALUES (?, ?, ?, 1, 1, ?)`,
		key, raw, now, int64(10),
	); err != nil {
		t.Fatal(err)
	}

	old := time.Now().Add(-48 * time.Hour)
	prevList := listStorageObjectsFn
	prevDel := deleteStorageKeysFn
	t.Cleanup(func() {
		listStorageObjectsFn = prevList
		deleteStorageKeysFn = prevDel
	})
	listStorageObjectsFn = func(context.Context) (s3ListResult, error) {
		return s3ListResult{Objects: []s3ListedObject{
			{Key: key, Size: 10, LastModified: old},
			{Key: raw, Size: 90, LastModified: old},
		}}, nil
	}
	deleteStorageKeysFn = func(context.Context, []string) (int, []string) { return 0, nil }

	result, err := reindexStorage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.SizesUpdated != 1 {
		t.Fatalf("sizesUpdated=%d", result.SizesUpdated)
	}
	if uploadSize(t, key) != 100 {
		t.Fatalf("size=%d want 100 (display+raw)", uploadSize(t, key))
	}
}

func TestReindexSkipsNewlyReferenced(t *testing.T) {
	setupTestDB(t)
	resetS3OrphanState()
	t.Cleanup(resetS3OrphanState)

	key := "moments/" + uuid.NewString() + ".jpg"
	old := time.Now().Add(-48 * time.Hour)
	prevList := listStorageObjectsFn
	prevDel := deleteStorageKeysFn
	t.Cleanup(func() {
		listStorageObjectsFn = prevList
		deleteStorageKeysFn = prevDel
	})
	listStorageObjectsFn = func(context.Context) (s3ListResult, error) {
		return s3ListResult{Objects: []s3ListedObject{{Key: key, Size: 9, LastModified: old}}}, nil
	}
	deleteStorageKeysFn = func(context.Context, []string) (int, []string) {
		t.Fatal("must not delete referenced object")
		return 0, nil
	}

	token := insertUser(t, "u1", "U1", "user")
	uid := tokenToUserID(token)
	babyID := createBabyFor(t, token, "B")
	images := `[{"key":"` + key + `"}]`
	if _, err := db.Exec(
		`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, images, createdBy, createdAt, updatedAt)
		 VALUES (?, ?, 'feeding', 'bottle', '{}', ?, ?, ?, ?, ?)`,
		uuid.NewString(), babyID, int64(nowMillis()), images, uid, int64(nowMillis()), int64(nowMillis()),
	); err != nil {
		t.Fatal(err)
	}

	result, err := reindexStorage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 0 || result.SkippedReferenced != 1 {
		t.Fatalf("reindex: %+v", result)
	}
}

func TestHandleStorageReindex(t *testing.T) {
	s := newTestServer(t)
	resetS3OrphanState()
	t.Cleanup(resetS3OrphanState)

	user := insertUser(t, "u1", "U1", "user")
	forbid := s.do(http.MethodPost, "/admin/storage/reindex", user, map[string]any{})
	if forbid.status != http.StatusForbidden {
		t.Fatalf("user status=%d", forbid.status)
	}

	admin := insertUser(t, "admin", "Admin", "admin")
	orphan := "moments/" + uuid.NewString() + ".jpg"
	old := time.Now().Add(-48 * time.Hour)
	prevList := listStorageObjectsFn
	prevDel := deleteStorageKeysFn
	t.Cleanup(func() {
		listStorageObjectsFn = prevList
		deleteStorageKeysFn = prevDel
	})
	listStorageObjectsFn = func(context.Context) (s3ListResult, error) {
		return s3ListResult{
			Objects:      []s3ListedObject{{Key: orphan, Size: 7, LastModified: old}},
			ListRequests: 2,
		}, nil
	}
	var deleted []string
	deleteStorageKeysFn = func(_ context.Context, keys []string) (int, []string) {
		deleted = append([]string{}, keys...)
		return len(keys), nil
	}

	r := s.do(http.MethodPost, "/admin/storage/reindex", admin, map[string]any{})
	e := mustOK(t, r)
	var data storageReindexResult
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Found != 1 || data.Deleted != 1 || data.ListRequests != 2 || len(deleted) != 1 || deleted[0] != orphan {
		t.Fatalf("reindex: %+v deleted=%v", data, deleted)
	}
}

func TestHandleStorageReindexWorksOnLocal(t *testing.T) {
	s := newTestServer(t)
	t.Setenv("STORAGE_TYPE", "local")
	resetS3OrphanState()
	t.Cleanup(resetS3OrphanState)
	admin := insertUser(t, "admin", "Admin", "admin")

	prevList := listStorageObjectsFn
	prevDel := deleteStorageKeysFn
	t.Cleanup(func() {
		listStorageObjectsFn = prevList
		deleteStorageKeysFn = prevDel
	})
	listStorageObjectsFn = func(context.Context) (s3ListResult, error) {
		return s3ListResult{}, nil
	}
	deleteStorageKeysFn = func(context.Context, []string) (int, []string) {
		return 0, nil
	}

	r := s.do(http.MethodPost, "/admin/storage/reindex", admin, map[string]any{})
	e := mustOK(t, r)
	var data storageReindexResult
	if err := jsonUnmarshal(e.Data, &data); err != nil {
		t.Fatal(err)
	}
	if data.Items == nil {
		t.Fatal("empty reindex must encode items as [] not null")
	}
}

func TestReindexListError(t *testing.T) {
	setupTestDB(t)
	prevList := listStorageObjectsFn
	t.Cleanup(func() { listStorageObjectsFn = prevList })
	listStorageObjectsFn = func(context.Context) (s3ListResult, error) {
		return s3ListResult{}, errors.New("list failed")
	}
	if _, err := reindexStorage(context.Background()); err == nil {
		t.Fatal("expected list error")
	}
}

func TestListLocalUploadObjectsSkipsTmp(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "moments"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".tmp"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "moments", "a.jpg"), []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".tmp", "chunk"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	listed, err := listLocalUploadObjects(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Objects) != 1 || listed.Objects[0].Key != "moments/a.jpg" {
		t.Fatalf("listed=%+v", listed.Objects)
	}
}
