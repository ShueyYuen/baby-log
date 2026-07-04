package main

import (
	"context"
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

// POST /admin/cleanup — manually trigger cleanup of unused uploaded files.
// Query params:
//   - all=true  → delete all unused files regardless of age (default: only >24h)
//   - dry-run=true → list files without deleting
func handleManualCleanup(w http.ResponseWriter, r *http.Request) {
	if !isAdmin(getUserID(r)) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	includeAll := r.URL.Query().Get("all") == "true"
	dryRun := r.URL.Query().Get("dry-run") == "true"

	query := `SELECT "key", "rawKey", "createdAt" FROM "UploadedFile" WHERE "used" = 0`
	if !includeAll {
		cutoff := int64(nowMillis()) - 24*60*60*1000
		query += fmt.Sprintf(` AND "createdAt" < %d`, cutoff)
	}
	query += ` ORDER BY "createdAt" ASC`

	rows, err := db.Query(query)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Query error")
		return
	}
	defer rows.Close()

	type orphan struct {
		Key       string `json:"key"`
		RawKey    string `json:"rawKey,omitempty"`
		CreatedAt int64  `json:"createdAt"`
	}
	var orphans []orphan
	for rows.Next() {
		var o orphan
		var rawKey *string
		if err := rows.Scan(&o.Key, &rawKey, &o.CreatedAt); err != nil {
			continue
		}
		if rawKey != nil {
			o.RawKey = *rawKey
		}
		orphans = append(orphans, o)
	}

	if dryRun {
		writeOK(w, map[string]interface{}{
			"dryRun": true,
			"count":  len(orphans),
			"files":  orphans,
		})
		return
	}

	deleted := 0
	var errors []string
	for _, o := range orphans {
		if o.Key != "" {
			if err := deleteFile(o.Key); err != nil {
				errors = append(errors, fmt.Sprintf("delete %s: %v", o.Key, err))
			}
		}
		if o.RawKey != "" && o.RawKey != o.Key {
			if err := deleteFile(o.RawKey); err != nil {
				errors = append(errors, fmt.Sprintf("delete raw %s: %v", o.RawKey, err))
			}
		}
		if _, err := db.Exec(`DELETE FROM "UploadedFile" WHERE "key" = ?`, o.Key); err != nil {
			errors = append(errors, fmt.Sprintf("db delete %s: %v", o.Key, err))
		} else {
			deleted++
		}
	}

	log.Printf("[Cleanup] Manual cleanup: deleted %d/%d file(s)", deleted, len(orphans))

	writeOK(w, map[string]interface{}{
		"dryRun":  false,
		"found":   len(orphans),
		"deleted": deleted,
		"errors":  errors,
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
