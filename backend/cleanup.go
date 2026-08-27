package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const orphanGraceMs = 24 * 60 * 60 * 1000

type orphanFile struct {
	key    string
	rawKey string
}

// startCleanupScheduler runs once per hour; on each tick it removes uploaded
// files that were created more than 24 hours ago, are marked unused, and are
// not referenced by any live record (used = 0 is not trusted alone).
// It never lists S3: objects that exist in storage but have no UploadedFile
// row are handled only by the admin-triggered POST /admin/storage/reindex.
func startCleanupScheduler() {
	go func() {
		repairReferencedUploads()
		ticker := time.NewTicker(1 * time.Hour)
		for range ticker.C {
			runCleanupTick()
		}
	}()
	log.Println("[Cleanup] Orphan file cleanup scheduler started (every 1 hour)")
}

func repairReferencedUploads() {
	rows, err := db.Query(`SELECT "key", "rawKey" FROM "UploadedFile" WHERE "used" = 0`)
	if err != nil {
		log.Printf("[Cleanup] Repair query error: %v", err)
		return
	}
	defer rows.Close()

	var files []orphanFile
	for rows.Next() {
		var o orphanFile
		var rawKey *string
		if err := rows.Scan(&o.key, &rawKey); err != nil {
			continue
		}
		if rawKey != nil {
			o.rawKey = *rawKey
		}
		files = append(files, o)
	}

	repaired := 0
	for _, o := range files {
		if fileIsReferenced(o.key, o.rawKey) {
			markUploadedFilesUsed([]string{o.key})
			repaired++
		}
	}
	if repaired > 0 {
		log.Printf("[Cleanup] Repaired used=1 for %d still-referenced file(s)", repaired)
	}
}

func runCleanupTick() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Cleanup] Panic: %v", r)
		}
	}()

	cleanupIdempotencyKeys()
	cleanupStaleTempFiles()
	reclaimUnreferencedUsedFiles()

	found, deleted, errs := cleanupOrphanUploads()
	if found == 0 && len(errs) == 0 {
		return
	}
	log.Printf("[Cleanup] Cleaned up %d orphan file(s) (candidates=%d errors=%d)", deleted, found, len(errs))
	for _, e := range errs {
		log.Printf("[Cleanup] %s", e)
	}
}

// POST /admin/cleanup — immediately run the orphan file cleanup.
func handleManualCleanup(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	found, deleted, errors := cleanupOrphanUploads()
	reclaimUnreferencedUsedFiles()
	log.Printf("[Cleanup] Manual cleanup: found=%d deleted=%d errors=%d", found, deleted, len(errors))

	writeOK(w, map[string]interface{}{
		"found":   found,
		"deleted": deleted,
		"errors":  errors,
	})
}

func cleanupOrphanUploads() (found, deleted int, errors []string) {
	cutoff := int64(nowMillis()) - orphanGraceMs
	rows, err := db.Query(
		`SELECT "key", "rawKey" FROM "UploadedFile" WHERE "used" = 0 AND "createdAt" < ?`,
		cutoff,
	)
	if err != nil {
		log.Printf("[Cleanup] Query error: %v", err)
		return 0, 0, []string{"query: " + err.Error()}
	}
	defer rows.Close()

	var orphans []orphanFile
	for rows.Next() {
		var o orphanFile
		var rawKey *string
		if err := rows.Scan(&o.key, &rawKey); err != nil {
			continue
		}
		if rawKey != nil {
			o.rawKey = *rawKey
		}
		orphans = append(orphans, o)
	}
	found = len(orphans)
	if found == 0 {
		return found, 0, nil
	}

	for _, o := range orphans {
		if ok, err := claimAndDeleteOrphan(o); err != nil {
			errors = append(errors, o.key+": "+err.Error())
		} else if ok {
			deleted++
		}
	}
	return found, deleted, errors
}

// claimAndDeleteOrphan deletes storage objects only after confirming the file
// is not referenced and atomically claiming the unused tracking row.
// Returns (true, nil) if the tracking row was claimed and storage delete was attempted.
func claimAndDeleteOrphan(o orphanFile) (bool, error) {
	if o.key == "" {
		return false, nil
	}

	if fileIsReferenced(o.key, o.rawKey) {
		log.Printf("[Cleanup] Skip %s: still referenced; repairing used=1", o.key)
		markUploadedFilesUsed([]string{o.key})
		return false, nil
	}

	// Claim first. If a concurrent attach flipped used=1, RowsAffected is 0 and
	// we must not touch S3.
	res, err := db.Exec(`DELETE FROM "UploadedFile" WHERE "key" = ? AND "used" = 0`, o.key)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		log.Printf("[Cleanup] Skip %s: tracking row already used or gone", o.key)
		return false, nil
	}

	// Re-check after claiming. A concurrent attach may have written a live
	// reference after the first check and before the DELETE.
	if fileIsReferenced(o.key, o.rawKey) {
		log.Printf("[Cleanup] Skip %s: referenced after claim; restoring used=1", o.key)
		restoreTrackingRow(o, 1)
		return false, nil
	}

	if o.rawKey != "" && o.rawKey != o.key {
		if err := deleteFile(o.rawKey); err != nil {
			log.Printf("[Cleanup] Failed to delete raw file %s: %v", o.rawKey, err)
			restoreTrackingRow(o, 0)
			return true, err
		}
	}
	if err := deleteFile(o.key); err != nil {
		log.Printf("[Cleanup] Failed to delete file %s: %v", o.key, err)
		restoreTrackingRow(o, 0)
		return true, err
	}
	return true, nil
}

func restoreTrackingRow(o orphanFile, used int) {
	now := int64(nowMillis())
	size := combinedUploadSize(o.key, o.rawKey, nil)
	_, err := db.Exec(
		`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "size") VALUES (?, ?, ?, ?, ?)`,
		o.key, o.rawKey, now, used, size,
	)
	if err != nil {
		log.Printf("[Cleanup] Failed to restore tracking row %s: %v", o.key, err)
		return
	}
	if used == 1 {
		markUploadedFilesUsed([]string{o.key})
	}
}

// Columns that may contain an upload key or a URL that includes the key.
// False positives (LIKE substring) skip deletion — that is the safe direction.
var fileRefSources = []struct{ table, col string }{
	{`"Record"`, `"images"`},
	{`"Moment"`, `"mediaItems"`},
	{`"HealthEntry"`, `"images"`},
	{`"Milestone"`, `"images"`},
	{`"Plan"`, `"images"`},
	{`"MedicalVisit"`, `"images"`},
	{`"MedicalVisit"`, `"ocrData"`},
	{`"User"`, `"avatar"`},
	{`"Baby"`, `"avatar"`},
}

func fileIsReferenced(keys ...string) bool {
	seen := map[string]bool{}
	for _, key := range keys {
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		if keyReferencedInDB(key) {
			return true
		}
	}
	return false
}

func keyReferencedInDB(key string) bool {
	for _, src := range fileRefSources {
		var exists int
		err := db.QueryRow(
			`SELECT 1 FROM `+src.table+` WHERE `+src.col+` LIKE '%' || ? || '%' LIMIT 1`,
			key,
		).Scan(&exists)
		if err == sql.ErrNoRows {
			continue
		}
		if err != nil {
			// Missing column (older DBs) is skippable; any other error is treated
			// as "in use" so we never delete when we cannot prove the file is free.
			if strings.Contains(err.Error(), "no such column") {
				continue
			}
			log.Printf("[Cleanup] Reference check failed for %s.%s key=%s: %v", src.table, src.col, key, err)
			return true
		}
		return true
	}
	return false
}

func reclaimUnreferencedUsedFiles() {
	rows, err := db.Query(`SELECT "key", "rawKey" FROM "UploadedFile" WHERE "used" = 1`)
	if err != nil {
		log.Printf("[Cleanup] Reclaim query error: %v", err)
		return
	}
	defer rows.Close()

	var files []orphanFile
	for rows.Next() {
		var o orphanFile
		var rawKey *string
		if err := rows.Scan(&o.key, &rawKey); err != nil {
			continue
		}
		if rawKey != nil {
			o.rawKey = *rawKey
		}
		files = append(files, o)
	}

	reclaimed := 0
	for _, o := range files {
		if !fileIsReferenced(o.key, o.rawKey) {
			markFileUnused(o.key, o.rawKey)
			reclaimed++
		}
	}
	if reclaimed > 0 {
		log.Printf("[Cleanup] Marked used=0 for %d unreferenced used=1 file(s)", reclaimed)
	}
}

// cleanupStaleTempFiles removes chunked upload temp files older than 24 hours.
func cleanupStaleTempFiles() {
	cfg := getStorageConfig()
	if cfg.typ != storageLocal {
		return
	}

	tmpDir := filepath.Join(cfg.uploadDir, ".tmp")
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		return
	}

	cutoff := time.Now().Add(-24 * time.Hour)
	deleted := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			path := filepath.Join(tmpDir, entry.Name())
			if err := os.Remove(path); err == nil {
				deleted++
			}
			chunkedUploads.Delete(entry.Name())
		}
	}
	if deleted > 0 {
		log.Printf("[Cleanup] Removed %d stale temp file(s) from .tmp/", deleted)
	}
}
