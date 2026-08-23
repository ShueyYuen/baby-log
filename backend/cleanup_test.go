package main

import (
	"testing"

	"github.com/google/uuid"
)

func insertStaleUnusedFile(t *testing.T, key, rawKey string) {
	t.Helper()
	old := int64(nowMillis()) - orphanGraceMs - 60_000
	if _, err := db.Exec(
		`INSERT INTO "UploadedFile" ("key", "rawKey", "createdAt", "used") VALUES (?, ?, ?, 0)`,
		key, rawKey, old,
	); err != nil {
		t.Fatalf("insert UploadedFile: %v", err)
	}
}

func usedFlag(t *testing.T, key string) int {
	t.Helper()
	var used int
	err := db.QueryRow(`SELECT "used" FROM "UploadedFile" WHERE "key" = ?`, key).Scan(&used)
	if err != nil {
		t.Fatalf("used flag for %s: %v", key, err)
	}
	return used
}

func trackingExists(t *testing.T, key string) bool {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "UploadedFile" WHERE "key" = ?`, key).Scan(&n); err != nil {
		t.Fatalf("count UploadedFile: %v", err)
	}
	return n > 0
}

func TestCleanupDeletesUnreferencedStaleFile(t *testing.T) {
	setupTestDB(t)
	key := "records/" + uuid.NewString() + ".jpg"
	insertStaleUnusedFile(t, key, "")

	found, deleted, errs := cleanupOrphanUploads()
	if len(errs) != 0 {
		t.Fatalf("errors: %v", errs)
	}
	if found != 1 || deleted != 1 {
		t.Fatalf("found=%d deleted=%d, want 1/1", found, deleted)
	}
	if trackingExists(t, key) {
		t.Fatal("tracking row should be gone")
	}
}

func TestCleanupKeepsFileReferencedByRecord(t *testing.T) {
	setupTestDB(t)
	token := insertUser(t, "u1", "U1", "user")
	uid := tokenToUserID(token)
	babyID := createBabyFor(t, token, "B")

	key := "records/" + uuid.NewString() + ".jpg"
	insertStaleUnusedFile(t, key, key+"-raw")

	images := `[{"key":"` + key + `"}]`
	if _, err := db.Exec(
		`INSERT INTO "Record" (id, babyId, category, type, data, occurredAt, images, createdBy, createdAt, updatedAt)
		 VALUES (?, ?, 'feeding', 'bottle', '{}', ?, ?, ?, ?, ?)`,
		uuid.NewString(), babyID, int64(nowMillis()), images, uid, int64(nowMillis()), int64(nowMillis()),
	); err != nil {
		t.Fatalf("insert record: %v", err)
	}

	found, deleted, errs := cleanupOrphanUploads()
	if len(errs) != 0 {
		t.Fatalf("errors: %v", errs)
	}
	if found != 1 || deleted != 0 {
		t.Fatalf("found=%d deleted=%d, want 1/0", found, deleted)
	}
	if !trackingExists(t, key) {
		t.Fatal("referenced file tracking must remain")
	}
	if usedFlag(t, key) != 1 {
		t.Fatal("used flag should be repaired to 1")
	}
}

func TestCleanupKeepsUserAvatar(t *testing.T) {
	setupTestDB(t)
	token := insertUser(t, "u1", "U1", "user")
	uid := tokenToUserID(token)

	key := "avatar/" + uuid.NewString() + ".jpg"
	insertStaleUnusedFile(t, key, "")
	url := "/api/v1/uploads/" + key
	if _, err := db.Exec(`UPDATE "User" SET avatar = ? WHERE id = ?`, url, uid); err != nil {
		t.Fatalf("set avatar: %v", err)
	}

	_, deleted, errs := cleanupOrphanUploads()
	if len(errs) != 0 {
		t.Fatalf("errors: %v", errs)
	}
	if deleted != 0 {
		t.Fatalf("deleted=%d, avatar must not be removed", deleted)
	}
	if usedFlag(t, key) != 1 {
		t.Fatal("avatar used flag should be repaired to 1")
	}
}

func TestCleanupKeepsBabyAvatar(t *testing.T) {
	setupTestDB(t)
	token := insertUser(t, "u1", "U1", "user")
	babyID := createBabyFor(t, token, "B")

	key := "avatar/" + uuid.NewString() + ".jpg"
	insertStaleUnusedFile(t, key, "")
	if _, err := db.Exec(`UPDATE "Baby" SET avatar = ? WHERE id = ?`, key, babyID); err != nil {
		t.Fatalf("set baby avatar: %v", err)
	}

	_, deleted, errs := cleanupOrphanUploads()
	if len(errs) != 0 {
		t.Fatalf("errors: %v", errs)
	}
	if deleted != 0 {
		t.Fatalf("deleted=%d, baby avatar must not be removed", deleted)
	}
	if usedFlag(t, key) != 1 {
		t.Fatal("baby avatar used flag should be repaired to 1")
	}
}

func TestCleanupSkipsUsedFlagEvenIfStale(t *testing.T) {
	setupTestDB(t)
	key := "moments/" + uuid.NewString() + ".jpg"
	old := int64(nowMillis()) - orphanGraceMs - 60_000
	if _, err := db.Exec(
		`INSERT INTO "UploadedFile" ("key", "createdAt", "used") VALUES (?, ?, 1)`,
		key, old,
	); err != nil {
		t.Fatalf("insert: %v", err)
	}

	found, deleted, _ := cleanupOrphanUploads()
	if found != 0 || deleted != 0 {
		t.Fatalf("found=%d deleted=%d, used=1 files must be ignored", found, deleted)
	}
}

func TestCleanupDoesNotDeleteRecentUnused(t *testing.T) {
	setupTestDB(t)
	key := "records/" + uuid.NewString() + ".jpg"
	registerUploadKey(t, key)

	found, deleted, _ := cleanupOrphanUploads()
	if found != 0 || deleted != 0 {
		t.Fatalf("found=%d deleted=%d, files inside 24h grace must be kept", found, deleted)
	}
	if !trackingExists(t, key) {
		t.Fatal("recent unused tracking should remain")
	}
}

func TestCleanupRaceUsedFlagFlippedBeforeClaim(t *testing.T) {
	setupTestDB(t)
	key := "records/" + uuid.NewString() + ".jpg"
	insertStaleUnusedFile(t, key, "")
	markUploadedFilesUsed([]string{key})

	ok, err := claimAndDeleteOrphan(orphanFile{key: key})
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("must not delete after used=1")
	}
	if !trackingExists(t, key) {
		t.Fatal("tracking row must remain")
	}
}

func TestMarkFileUnusedSkipsSharedKey(t *testing.T) {
	setupTestDB(t)
	token := insertUser(t, "u1", "U1", "user")
	uid := tokenToUserID(token)
	babyID := createBabyFor(t, token, "B")

	key := "plans/" + uuid.NewString() + ".jpg"
	registerUploadKey(t, key)
	markUploadedFilesUsed([]string{key})

	images := `[{"key":"` + key + `"}]`
	if _, err := db.Exec(
		`INSERT INTO "Plan" (id, babyId, title, type, scheduledAt, images, createdBy, createdAt, updatedAt)
		 VALUES (?, ?, 'p', 'vaccine', ?, ?, ?, ?, ?)`,
		uuid.NewString(), babyID, int64(nowMillis()), images, uid, int64(nowMillis()), int64(nowMillis()),
	); err != nil {
		t.Fatalf("insert plan: %v", err)
	}

	markFileUnused(key, "")
	if usedFlag(t, key) != 1 {
		t.Fatal("shared key must stay used=1")
	}
}

func TestRepairReferencedUploadsMarksUsed(t *testing.T) {
	setupTestDB(t)
	token := insertUser(t, "u1", "U1", "user")
	uid := tokenToUserID(token)

	key := "avatar/" + uuid.NewString() + ".jpg"
	if _, err := db.Exec(
		`INSERT INTO "UploadedFile" ("key", "createdAt", "used") VALUES (?, ?, 0)`,
		key, int64(nowMillis()),
	); err != nil {
		t.Fatal(err)
	}
	url := "/api/v1/uploads/" + key
	if _, err := db.Exec(`UPDATE "User" SET avatar = ? WHERE id = ?`, url, uid); err != nil {
		t.Fatalf("set avatar: %v", err)
	}

	repairReferencedUploads()
	if usedFlag(t, key) != 1 {
		t.Fatal("referenced avatar should be repaired to used=1")
	}
}
