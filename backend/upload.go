package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
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

// POST /upload/{prefix} — unified media upload handler.
// {prefix} determines the storage folder (moments, health, milestones, etc.).
// Returns an array of uploadResult objects with mediaType field set.
func handleUploadMedia(w http.ResponseWriter, r *http.Request) {
	prefix := chi.URLParam(r, "prefix")
	if prefix == "" {
		writeErr(w, http.StatusBadRequest, "missing upload prefix")
		return
	}

	cfg := getStorageConfig()

	// S3: use streaming multipart reader to overlap browser→backend and backend→S3
	if cfg.typ == storageS3 && cfg.s3 != nil {
		handleUploadMediaStreamingS3(w, r, prefix, cfg)
		return
	}

	// Local storage: use ParseMultipartForm
	if err := r.ParseMultipartForm(32 * 1024 * 1024); err != nil {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}
	if r.MultipartForm == nil || len(r.MultipartForm.File["files"]) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	headers := r.MultipartForm.File["files"]
	log.Printf("[Upload] %s media: count=%d storage=local", prefix, len(headers))

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

		result, err := uploadPrefixedFile(prefix, header.Filename, contentType, data)
		if err != nil {
			log.Printf("[Upload] %s failed: %v", prefix, err)
			writeErr(w, http.StatusInternalServerError, "Upload failed")
			return
		}
		if isImageMIME(contentType) {
			result.MediaType = "image"
			if prefix == "medical" && isOCRAvailable() {
				ocrKey := result.RawKey
				if ocrKey == "" {
					ocrKey = result.Key
				}
				ocrEnqueueBackground(ocrKey, data)
			}
		} else {
			result.MediaType = "video"
		}
		trackUploadedFile(result.Key, result.RawKey)
		results = append(results, result)
	}
	writeOK(w, results)
}

// handleUploadMediaStreamingS3 uses MultipartReader for streaming:
// as each byte arrives from the browser, it is simultaneously forwarded to S3.
//
// For images: raw original streams to S3 in real-time; after fully received,
// the image is compressed and the compressed version is uploaded.
// For videos: the data streams directly to S3 for the single key.
func handleUploadMediaStreamingS3(w http.ResponseWriter, r *http.Request, prefix string, cfg storageConfig) {
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	var results []*uploadResult

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Failed to read upload")
			return
		}
		if part.FormName() != "files" {
			part.Close()
			continue
		}

		contentType := part.Header.Get("Content-Type")
		if !momentAllowedMimeTypes[contentType] {
			part.Close()
			writeErr(w, http.StatusBadRequest, "不支持的文件类型")
			return
		}

		filename := part.FileName()
		uid := uuid.NewString()
		origExt := strings.ToLower(filepath.Ext(filename))
		if origExt == "" {
			origExt = mimeToExt(contentType)
		}

		isImage := isImageMIME(contentType)
		compExt := origExt
		if isImage {
			compExt = ".jpg"
		}
		compKey := prefix + "/" + uid + compExt
		var rawKey string
		if isImage {
			rawKey = prefix + "/raw/" + uid + origExt
		}

		// Determine which key to stream to during browser upload:
		// images → raw key (original); videos → comp key (only key)
		streamKey := compKey
		if rawKey != "" {
			streamKey = rawKey
		}

		// Start S3 upload goroutine reading from pipe
		pr, pw := io.Pipe()
		s3Done := make(chan error, 1)
		go func() {
			err := putToS3(streamKey, contentType, pr)
			if err != nil {
				// Drain remaining data to prevent pipe deadlock
				io.Copy(io.Discard, pr)
			}
			s3Done <- err
		}()

		// TeeReader: read from browser part → data goes to both local buffer and S3 pipe
		tee := io.TeeReader(io.LimitReader(part, maxMomentUploadSize+1), pw)
		data, readErr := io.ReadAll(tee)
		pw.Close()
		part.Close()

		// Wait for streaming S3 upload to finish
		s3Err := <-s3Done

		if readErr != nil || len(data) > maxMomentUploadSize {
			writeErr(w, http.StatusBadRequest, "文件过大")
			return
		}
		if !validateMediaType(data) {
			writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
			return
		}

		result := &uploadResult{Key: compKey}
		if isImage {
			result.MediaType = "image"
		} else {
			result.MediaType = "video"
		}

		if isImage {
			// Raw already uploaded via streaming; now compress and upload compressed
			if s3Err != nil {
				log.Printf("[Storage] S3 %s raw streaming upload failed (non-fatal): %v", prefix, s3Err)
			}
			compData, compMIME := compressImage(data, contentType)
			if err := putToS3(compKey, compMIME, bytes.NewReader(compData)); err != nil {
				log.Printf("[Storage] S3 %s compressed upload failed: %v", prefix, err)
				writeErr(w, http.StatusInternalServerError, "Upload failed")
				return
			}
			result.RawKey = rawKey
			if cfg.s3.publicURL != "" {
				result.RawURL = buildPublicURL(cfg.s3, rawKey)
			} else {
				result.RawURL, _ = getSignedDownloadURL(rawKey, 86400)
			}
		} else {
			// Video was streamed directly to compKey
			if s3Err != nil {
				log.Printf("[Storage] S3 %s video streaming upload failed: %v", prefix, s3Err)
				writeErr(w, http.StatusInternalServerError, "Upload failed")
				return
			}
		}

		if cfg.s3.publicURL != "" {
			result.URL = buildPublicURL(cfg.s3, compKey)
		} else {
			result.URL, _ = getSignedDownloadURL(compKey, 3600)
		}

		if isImage && prefix == "medical" && isOCRAvailable() {
			ocrKey := rawKey
			if ocrKey == "" {
				ocrKey = compKey
			}
			ocrEnqueueBackground(ocrKey, data)
		}

		trackUploadedFile(compKey, rawKey)
		results = append(results, result)
	}

	if len(results) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	log.Printf("[Upload] %s media streaming: count=%d", prefix, len(results))
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
