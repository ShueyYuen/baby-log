package main

import (
	"log"
	"net/http"
	"time"
)

// startCleanupScheduler runs once per hour; on each tick it removes moment
// media files that were uploaded more than 24 hours ago but never attached
// to any Moment (used = 0).
func startCleanupScheduler() {
	ticker := time.NewTicker(1 * time.Hour)
	go func() {
		for range ticker.C {
			runCleanupTick()
		}
	}()
	log.Println("[Cleanup] Orphan file cleanup scheduler started (every 1 hour)")
}

func runCleanupTick() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Cleanup] Panic: %v", r)
		}
	}()

	cutoff := int64(nowMillis()) - 24*60*60*1000

	rows, err := db.Query(
		`SELECT "key", "rawKey" FROM "UploadedFile" WHERE "used" = 0 AND "createdAt" < ?`,
		cutoff,
	)
	if err != nil {
		log.Printf("[Cleanup] Query error: %v", err)
		return
	}
	defer rows.Close()

	type orphan struct{ key, rawKey string }
	var orphans []orphan
	for rows.Next() {
		var o orphan
		var rawKey *string
		if err := rows.Scan(&o.key, &rawKey); err != nil {
			continue
		}
		if rawKey != nil {
			o.rawKey = *rawKey
		}
		orphans = append(orphans, o)
	}

	if len(orphans) == 0 {
		return
	}

	log.Printf("[Cleanup] Found %d orphan file(s) older than 24h, deleting…", len(orphans))

	deleted := 0
	for _, o := range orphans {
		if o.key != "" {
			if err := deleteFile(o.key); err != nil {
				log.Printf("[Cleanup] Failed to delete file %s: %v", o.key, err)
			}
		}
		if o.rawKey != "" && o.rawKey != o.key {
			if err := deleteFile(o.rawKey); err != nil {
				log.Printf("[Cleanup] Failed to delete raw file %s: %v", o.rawKey, err)
			}
		}
		if _, err := db.Exec(`DELETE FROM "UploadedFile" WHERE "key" = ?`, o.key); err != nil {
			log.Printf("[Cleanup] Failed to delete DB record %s: %v", o.key, err)
		} else {
			deleted++
		}
	}
	log.Printf("[Cleanup] Cleaned up %d orphan file(s)", deleted)
}

// POST /admin/cleanup — immediately run the orphan file cleanup.
func handleManualCleanup(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	cutoff := int64(nowMillis()) - 24*60*60*1000

	rows, err := db.Query(
		`SELECT "key", "rawKey" FROM "UploadedFile" WHERE "used" = 0 AND "createdAt" < ?`,
		cutoff,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "查询失败")
		return
	}
	defer rows.Close()

	type orphan struct{ key, rawKey string }
	var orphans []orphan
	for rows.Next() {
		var o orphan
		var rawKey *string
		if err := rows.Scan(&o.key, &rawKey); err != nil {
			continue
		}
		if rawKey != nil {
			o.rawKey = *rawKey
		}
		orphans = append(orphans, o)
	}

	deleted := 0
	var errors []string
	for _, o := range orphans {
		if o.key != "" {
			if err := deleteFile(o.key); err != nil {
				errors = append(errors, o.key+": "+err.Error())
			}
		}
		if o.rawKey != "" && o.rawKey != o.key {
			if err := deleteFile(o.rawKey); err != nil {
				errors = append(errors, o.rawKey+": "+err.Error())
			}
		}
		if _, err := db.Exec(`DELETE FROM "UploadedFile" WHERE "key" = ?`, o.key); err == nil {
			deleted++
		}
	}

	log.Printf("[Cleanup] Manual cleanup: found=%d deleted=%d errors=%d", len(orphans), deleted, len(errors))

	writeOK(w, map[string]interface{}{
		"found":   len(orphans),
		"deleted": deleted,
		"errors":  errors,
	})
}
