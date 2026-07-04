package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// validateMediaType sniffs the first 512 bytes to reject obviously dangerous uploads
// (scripts, HTML, executables) while allowing legitimate media that DetectContentType
// may not recognize (e.g. HEIC images return application/octet-stream).
func validateMediaType(data []byte) bool {
	sniffed := http.DetectContentType(data)
	switch {
	case strings.HasPrefix(sniffed, "image/"),
		strings.HasPrefix(sniffed, "video/"),
		sniffed == "application/octet-stream":
		return true
	}
	return false
}

const maxUploadSize = 10 * 1024 * 1024 // 10MB per file (regular uploads)

// maxMomentUploadSize allows larger files for moments (photos/videos).
const maxMomentUploadSize = 200 * 1024 * 1024 // 200MB per file

var allowedMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
}

var momentAllowedMimeTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/gif":       true,
	"image/webp":      true,
	"video/mp4":       true,
	"video/quicktime": true,
	"video/webm":      true,
	"video/x-msvideo": true,
}

// POST /upload
func handleUploadSingle(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		writeErr(w, http.StatusBadRequest, "No file uploaded")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		log.Println("[Upload] No file in request")
		writeErr(w, http.StatusBadRequest, "No file uploaded")
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	if !allowedMimeTypes[contentType] {
		writeErr(w, http.StatusBadRequest, "不支持的文件类型，仅允许 JPG/PNG/GIF/WebP")
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, maxUploadSize+1))
	if err != nil || len(data) > maxUploadSize {
		writeErr(w, http.StatusInternalServerError, "Upload failed")
		return
	}

	if !validateMediaType(data) {
		writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
		return
	}

	log.Printf("[Upload] Received file: name=%s type=%s size=%d storage=%s",
		header.Filename, contentType, len(data), getStorageType())

	result, err := uploadFile(header.Filename, contentType, data)
	if err != nil {
		log.Printf("[Upload] Failed: %v", err)
		writeErr(w, http.StatusInternalServerError, "Upload failed")
		return
	}

	trackUploadedFile(result.Key, result.RawKey)
	writeOK(w, result)
}

// POST /upload/multiple
func handleUploadMultiple(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxUploadSize * 10); err != nil {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	if r.MultipartForm == nil || len(r.MultipartForm.File["files"]) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	headers := r.MultipartForm.File["files"]

	log.Printf("[Upload] Received multiple files: count=%d storage=%s", len(headers), getStorageType())

	results := make([]*uploadResult, 0, len(headers))
	for _, header := range headers {
		f, err := header.Open()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Upload failed")
			return
		}
		contentType := header.Header.Get("Content-Type")
		if !allowedMimeTypes[contentType] {
			f.Close()
			writeErr(w, http.StatusBadRequest, "不支持的文件类型，仅允许 JPG/PNG/GIF/WebP")
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, maxUploadSize+1))
		f.Close()
		if err != nil || len(data) > maxUploadSize {
			writeErr(w, http.StatusInternalServerError, "Upload failed")
			return
		}
		if !validateMediaType(data) {
			writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
			return
		}
		result, err := uploadFile(header.Filename, contentType, data)
		if err != nil {
			log.Printf("[Upload] Multiple failed: %v", err)
			writeErr(w, http.StatusInternalServerError, "Upload failed")
			return
		}
		results = append(results, result)
	}

	writeOK(w, results)
}

// POST /moments/upload — upload media files for moments (images + videos).
// Returns an array of uploadResult objects with mediaType field set.
// If S3 storage is used, the actual upload happens asynchronously for faster response.
func handleUploadMomentMedia(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	if r.MultipartForm == nil || len(r.MultipartForm.File["files"]) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	headers := r.MultipartForm.File["files"]
	cfg := getStorageConfig()
	useAsync := cfg.typ == storageS3 && cfg.s3 != nil

	log.Printf("[Upload] Moment media: count=%d storage=%s async=%v", len(headers), cfg.typ, useAsync)

	results := make([]*uploadResult, 0, len(headers))
	for _, header := range headers {
		f, err := header.Open()
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Upload failed")
			return
		}
		contentType := header.Header.Get("Content-Type")
		if !momentAllowedMimeTypes[contentType] {
			f.Close()
			writeErr(w, http.StatusBadRequest, "不支持的文件类型")
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, maxMomentUploadSize+1))
		f.Close()
		if err != nil || len(data) > maxMomentUploadSize {
			writeErr(w, http.StatusBadRequest, "文件过大")
			return
		}
		if !validateMediaType(data) {
			writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
			return
		}

		if useAsync {
			uid := uuid.NewString()
			origExt := strings.ToLower(filepath.Ext(header.Filename))
			if origExt == "" {
				origExt = mimeToExt(contentType)
			}
			compExt := origExt
			if isImageMIME(contentType) {
				compExt = ".jpg"
			}

			compKey := "moments/" + uid + compExt
			var rawKey string
			if isImageMIME(contentType) {
				rawKey = "moments/raw/" + uid + origExt
			}

			result := &uploadResult{
				Key:    compKey,
				RawKey: rawKey,
			}
			if cfg.s3.publicURL != "" {
				result.URL = buildPublicURL(cfg.s3, compKey)
				if rawKey != "" {
					result.RawURL = buildPublicURL(cfg.s3, rawKey)
				}
			}
			if isImageMIME(contentType) {
				result.MediaType = "image"
			} else {
				result.MediaType = "video"
			}

			trackUploadedFile(compKey, rawKey)

			dataCopy := data
			ct := contentType
			startAsyncUpload(compKey, func() error {
				return uploadToS3Async(cfg.s3, compKey, rawKey, ct, dataCopy)
			})

			results = append(results, result)
		} else {
			result, err := uploadMomentFile(header.Filename, contentType, data)
			if err != nil {
				log.Printf("[Upload] Moment failed: %v", err)
				writeErr(w, http.StatusInternalServerError, "Upload failed")
				return
			}
			if isImageMIME(contentType) {
				result.MediaType = "image"
			} else {
				result.MediaType = "video"
			}
			trackUploadedFile(result.Key, result.RawKey)
			results = append(results, result)
		}
	}

	writeOK(w, results)
}

func trackUploadedFile(key, rawKey string) {
	now := int64(nowMillis())
	_, err := db.Exec(`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used") VALUES (?, ?, ?, 0)`,
		key, rawKey, now)
	if err != nil {
		log.Printf("[Upload] Failed to track uploaded file %s: %v", key, err)
	}
}

// validateUploadKeys ensures all referenced keys exist in UploadedFile table.
// Returns error with the first invalid key, or nil if all are valid.
func validateUploadKeys(keys []string) error {
	for _, key := range keys {
		if key == "" {
			continue
		}
		var exists bool
		if err := db.QueryRow(`SELECT COUNT(*) > 0 FROM "UploadedFile" WHERE "key" = ?`, key).Scan(&exists); err != nil || !exists {
			return fmt.Errorf("invalid file key: %s", key)
		}
	}
	return nil
}

func markUploadedFilesUsed(keys []string) {
	for _, key := range keys {
		if key == "" {
			continue
		}
		db.Exec(`UPDATE "UploadedFile" SET "used" = 1 WHERE "key" = ?`, key)
	}
}

// markFileUnused marks a file for deferred cleanup. If no tracking record
// exists (e.g. file uploaded before tracking was introduced), one is created.
func markFileUnused(key, rawKey string) {
	if key == "" {
		return
	}
	now := int64(nowMillis())
	result, _ := db.Exec(`UPDATE "UploadedFile" SET "used" = 0 WHERE "key" = ?`, key)
	if affected, _ := result.RowsAffected(); affected == 0 {
		db.Exec(`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used") VALUES (?, ?, ?, 0)`,
			key, rawKey, now)
	}
}
