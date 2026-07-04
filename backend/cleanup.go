package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
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

// collectReferencedKeys scans all data tables and returns a set of all file keys
// actually referenced by Moments, Records, Milestones, and Baby avatars.
func collectReferencedKeys() (map[string]bool, error) {
	keys := make(map[string]bool)
	addKey := func(k string) {
		if k != "" {
			keys[k] = true
		}
	}

	// 1. Moment.mediaItems
	rows, err := db.Query(`SELECT "mediaItems" FROM "Moment" WHERE "mediaItems" IS NOT NULL AND "mediaItems" != ''`)
	if err != nil {
		return nil, fmt.Errorf("query moments: %w", err)
	}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		var items []MediaItem
		if err := json.Unmarshal([]byte(raw), &items); err == nil {
			for _, item := range items {
				addKey(item.Key)
				addKey(item.RawKey)
			}
		}
	}
	rows.Close()

	// 2. Record.images
	rows, err = db.Query(`SELECT "images" FROM "Record" WHERE "images" IS NOT NULL AND "images" != '' AND "images" != '[]'`)
	if err != nil {
		return nil, fmt.Errorf("query records: %w", err)
	}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		var items []RecordImageStore
		if err := json.Unmarshal([]byte(raw), &items); err == nil {
			for _, item := range items {
				addKey(item.Key)
				addKey(item.RawKey)
			}
		}
	}
	rows.Close()

	// 3. Milestone.images
	rows, err = db.Query(`SELECT "images" FROM "Milestone" WHERE "images" IS NOT NULL AND "images" != '' AND "images" != '[]'`)
	if err != nil {
		return nil, fmt.Errorf("query milestones: %w", err)
	}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		var items []RecordImageStore
		if err := json.Unmarshal([]byte(raw), &items); err == nil {
			for _, item := range items {
				addKey(item.Key)
				addKey(item.RawKey)
			}
		}
	}
	rows.Close()

	// 4. Baby.avatar
	rows, err = db.Query(`SELECT "avatar" FROM "Baby" WHERE "avatar" IS NOT NULL AND "avatar" != ''`)
	if err != nil {
		return nil, fmt.Errorf("query babies: %w", err)
	}
	for rows.Next() {
		var avatar string
		if err := rows.Scan(&avatar); err != nil {
			continue
		}
		addKey(avatar)
	}
	rows.Close()

	return keys, nil
}

// POST /admin/cleanup — scan S3 vs DB references, find and delete orphaned files.
// Also rebuilds the UploadedFile tracking table.
// Query params:
//   - dry-run=true → list orphans without deleting
func handleManualCleanup(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	dryRun := r.URL.Query().Get("dry-run") == "true"

	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		writeErr(w, http.StatusBadRequest, "当前未使用 S3 存储，此功能仅适用于 S3")
		return
	}

	referencedKeys, err := collectReferencedKeys()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, fmt.Sprintf("scan DB: %v", err))
		return
	}

	client := getS3Client()
	if client == nil {
		writeErr(w, http.StatusInternalServerError, "S3 client not available")
		return
	}

	ctx := context.Background()
	bucket := cfg.s3.bucket

	var s3Keys []string
	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, fmt.Sprintf("list S3: %v", err))
			return
		}
		for _, obj := range page.Contents {
			s3Keys = append(s3Keys, aws.ToString(obj.Key))
		}
	}

	var orphanKeys []string
	for _, k := range s3Keys {
		if !referencedKeys[k] {
			orphanKeys = append(orphanKeys, k)
		}
	}

	if dryRun {
		writeOK(w, map[string]interface{}{
			"dryRun":      true,
			"s3Total":     len(s3Keys),
			"referenced":  len(referencedKeys),
			"orphanCount": len(orphanKeys),
			"orphans":     orphanKeys,
		})
		return
	}

	deleted := 0
	var errors []string
	for _, k := range orphanKeys {
		if err := deleteFile(k); err != nil {
			errors = append(errors, fmt.Sprintf("delete %s: %v", k, err))
		} else {
			deleted++
		}
	}

	// Rebuild UploadedFile table: mark all referenced keys as used
	if _, err := db.Exec(`DELETE FROM "UploadedFile"`); err != nil {
		errors = append(errors, fmt.Sprintf("clear UploadedFile table: %v", err))
	} else {
		now := int64(nowMillis())
		for key := range referencedKeys {
			db.Exec(
				`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used") VALUES (?, '', ?, 1)`,
				key, now,
			)
		}
	}

	log.Printf("[Cleanup] Deep cleanup: S3 total=%d, referenced=%d, orphans=%d, deleted=%d",
		len(s3Keys), len(referencedKeys), len(orphanKeys), deleted)

	writeOK(w, map[string]interface{}{
		"dryRun":      false,
		"s3Total":     len(s3Keys),
		"referenced":  len(referencedKeys),
		"orphanCount": len(orphanKeys),
		"deleted":     deleted,
		"errors":      errors,
	})
}

// POST /admin/s3-cache-control — set Cache-Control on all S3 objects.
// Query params:
//   - dry-run=true → count objects without updating
func handleSetS3CacheControl(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		writeErr(w, http.StatusBadRequest, "当前未使用 S3 存储")
		return
	}

	dryRun := r.URL.Query().Get("dry-run") == "true"
	client := getS3Client()
	if client == nil {
		writeErr(w, http.StatusInternalServerError, "S3 client not available")
		return
	}

	ctx := context.Background()
	bucket := cfg.s3.bucket
	var total, updated, skipped int
	var errors []string

	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
	})

	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, fmt.Sprintf("list objects: %v", err))
			return
		}

		for _, obj := range page.Contents {
			total++
			key := aws.ToString(obj.Key)

			if dryRun {
				continue
			}

			headOut, err := client.HeadObject(ctx, &s3.HeadObjectInput{
				Bucket: aws.String(bucket),
				Key:    aws.String(key),
			})
			if err != nil {
				errors = append(errors, fmt.Sprintf("head %s: %v", key, err))
				continue
			}

			existing := aws.ToString(headOut.CacheControl)
			if existing == s3CacheControl {
				skipped++
				continue
			}

			contentType := aws.ToString(headOut.ContentType)
			source := bucket + "/" + key

			_, err = client.CopyObject(ctx, &s3.CopyObjectInput{
				Bucket:            aws.String(bucket),
				CopySource:        aws.String(source),
				Key:               aws.String(key),
				CacheControl:      aws.String(s3CacheControl),
				ContentType:       aws.String(contentType),
				MetadataDirective: s3types.MetadataDirectiveReplace,
			})
			if err != nil {
				errors = append(errors, fmt.Sprintf("copy %s: %v", key, err))
				continue
			}
			updated++
		}
	}

	log.Printf("[S3] Cache-Control update: total=%d updated=%d skipped=%d errors=%d", total, updated, skipped, len(errors))

	writeOK(w, map[string]interface{}{
		"dryRun":  dryRun,
		"total":   total,
		"updated": updated,
		"skipped": skipped,
		"errors":  errors,
	})
}
