package main

import (
	"io"
	"log"
	"net/http"
)

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
		writeErr(w, http.StatusInternalServerError, "不支持的文件类型，仅允许 JPG/PNG/GIF/WebP")
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, maxUploadSize+1))
	if err != nil || len(data) > maxUploadSize {
		writeErr(w, http.StatusInternalServerError, "Upload failed")
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
			writeErr(w, http.StatusInternalServerError, "不支持的文件类型，仅允许 JPG/PNG/GIF/WebP")
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, maxUploadSize+1))
		f.Close()
		if err != nil || len(data) > maxUploadSize {
			writeErr(w, http.StatusInternalServerError, "Upload failed")
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
func handleUploadMomentMedia(w http.ResponseWriter, r *http.Request) {
	// 32MB in memory, rest spills to temp files
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	if r.MultipartForm == nil || len(r.MultipartForm.File["files"]) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	headers := r.MultipartForm.File["files"]

	log.Printf("[Upload] Moment media: count=%d storage=%s", len(headers), getStorageType())

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
