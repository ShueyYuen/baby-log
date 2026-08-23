package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var (
	errMediaTooLarge = errors.New("file too large")
	errMediaInvalid  = errors.New("invalid media")
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

// normalizeMomentMIME maps empty / octet-stream types (common on iOS) to a
// real MIME type using the filename extension so videos are not rejected.
func normalizeMomentMIME(filename, contentType string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	if momentAllowedMimeTypes[ct] {
		return ct
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".avi":
		return "video/x-msvideo"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return ct
	}
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
		contentType := normalizeMomentMIME(header.Filename, header.Header.Get("Content-Type"))
		if !momentAllowedMimeTypes[contentType] {
			f.Close()
			writeErr(w, http.StatusBadRequest, "不支持的文件类型")
			return
		}

		if isImageMIME(contentType) {
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
			result.MediaType = "image"
			if prefix == "medical" && isOCRAvailable() {
				ocrKey := result.RawKey
				if ocrKey == "" {
					ocrKey = result.Key
				}
				ocrEnqueueBackground(ocrKey, data)
			}
			trackUploadedFile(result.Key, result.RawKey)
			results = append(results, result)
			continue
		}

		result, err := saveLocalPrefixedVideo(prefix, header.Filename, contentType, f, maxMomentUploadSize)
		f.Close()
		if err != nil {
			if errors.Is(err, errMediaTooLarge) {
				writeErr(w, http.StatusBadRequest, "文件过大")
			} else if errors.Is(err, errMediaInvalid) {
				writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
			} else {
				log.Printf("[Upload] %s video failed: %v", prefix, err)
				writeErr(w, http.StatusInternalServerError, "Upload failed")
			}
			return
		}
		trackUploadedFile(result.Key, result.RawKey)
		results = append(results, result)
	}
	writeOK(w, results)
}

// handleUploadMediaStreamingS3 reads each multipart part and uploads to S3
// with a known Content-Length. Videos are written to local disk first and
// synced to S3 in the background so the HTTP request can return immediately
// (the previous io.Pipe PutObject had no Content-Length and hung on OSS).
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

		filename := part.FileName()
		contentType := normalizeMomentMIME(filename, part.Header.Get("Content-Type"))
		if !momentAllowedMimeTypes[contentType] {
			part.Close()
			writeErr(w, http.StatusBadRequest, "不支持的文件类型")
			return
		}

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

		result := &uploadResult{Key: compKey}

		if isImage {
			data, readErr := io.ReadAll(io.LimitReader(part, maxMomentUploadSize+1))
			part.Close()
			if readErr != nil || len(data) > maxMomentUploadSize {
				writeErr(w, http.StatusBadRequest, "文件过大")
				return
			}
			if !validateMediaType(data) {
				writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
				return
			}
			result.MediaType = "image"
			rawOK := true
			if err := putToS3(rawKey, contentType, bytes.NewReader(data)); err != nil {
				log.Printf("[Storage] S3 %s raw upload failed (non-fatal): %v", prefix, err)
				rawOK = false
			}
			compData, compMIME := compressImage(data, contentType)
			if err := putToS3(compKey, compMIME, bytes.NewReader(compData)); err != nil {
				log.Printf("[Storage] S3 %s compressed upload failed: %v", prefix, err)
				writeErr(w, http.StatusInternalServerError, "Upload failed")
				return
			}
			if rawOK {
				result.RawKey = rawKey
				if cfg.s3.publicURL != "" {
					result.RawURL = buildPublicURL(cfg.s3, rawKey)
				} else {
					result.RawURL, _ = getSignedDownloadURL(rawKey, 86400)
				}
				if prefix == "medical" && isOCRAvailable() {
					ocrEnqueueBackground(rawKey, data)
				}
			}
		} else {
			_, err := saveLocalPrefixedVideoToKey(compKey, part, maxMomentUploadSize)
			part.Close()
			if err != nil {
				if errors.Is(err, errMediaTooLarge) {
					writeErr(w, http.StatusBadRequest, "文件过大")
				} else if errors.Is(err, errMediaInvalid) {
					writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
				} else {
					log.Printf("[Upload] %s video failed: %v", prefix, err)
					writeErr(w, http.StatusInternalServerError, "Upload failed")
				}
				return
			}
			result.MediaType = "video"
			localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(compKey))
			go syncFileToS3(localPath, compKey, "video")
		}

		if cfg.s3.publicURL != "" {
			result.URL = buildPublicURL(cfg.s3, compKey)
		} else if result.MediaType == "video" {
			result.URL = "/api/v1/uploads/" + compKey
		} else {
			result.URL, _ = getSignedDownloadURL(compKey, 3600)
		}

		trackUploadedFile(compKey, result.RawKey)
		results = append(results, result)
	}

	if len(results) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	log.Printf("[Upload] %s media streaming: count=%d", prefix, len(results))
	writeOK(w, results)
}

func saveLocalPrefixedVideo(prefix, filename, contentType string, src io.Reader, maxSize int64) (*uploadResult, error) {
	cfg := getStorageConfig()
	uid := uuid.NewString()
	origExt := strings.ToLower(filepath.Ext(filename))
	if origExt == "" {
		origExt = mimeToExt(contentType)
	}
	key := prefix + "/" + uid + origExt
	if _, err := saveLocalPrefixedVideoToKey(key, src, maxSize); err != nil {
		return nil, err
	}
	return &uploadResult{
		URL:       cfg.publicPath + "/" + key,
		Key:       key,
		MediaType: "video",
	}, nil
}

func saveLocalPrefixedVideoToKey(key string, src io.Reader, maxSize int64) (*uploadResult, error) {
	cfg := getStorageConfig()
	dest := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, err
	}

	sniff := make([]byte, 512)
	n, err := io.ReadAtLeast(src, sniff, 1)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	sniff = sniff[:n]
	if n > 0 && !validateMediaType(sniff) {
		return nil, errMediaInvalid
	}

	f, err := os.Create(dest)
	if err != nil {
		return nil, err
	}
	written, err := io.Copy(f, io.LimitReader(io.MultiReader(bytes.NewReader(sniff), src), maxSize+1))
	closeErr := f.Close()
	if err != nil {
		os.Remove(dest)
		return nil, err
	}
	if closeErr != nil {
		os.Remove(dest)
		return nil, closeErr
	}
	if written > maxSize {
		os.Remove(dest)
		return nil, errMediaTooLarge
	}

	return &uploadResult{
		URL:       cfg.publicPath + "/" + key,
		Key:       key,
		MediaType: "video",
	}, nil
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
		normalized, err := sanitizeStorageKey(key)
		if err != nil {
			return fmt.Errorf("invalid file key: %s", key)
		}
		if normalized == "" {
			continue
		}
		var exists bool
		if err := db.QueryRow(`SELECT COUNT(*) > 0 FROM "UploadedFile" WHERE "key" = ? OR "rawKey" = ?`, normalized, normalized).Scan(&exists); err != nil || !exists {
			return fmt.Errorf("invalid file key: %s", key)
		}
	}
	return nil
}

func markUploadedFilesUsed(keys []string) {
	for _, key := range keys {
		key = toStorageKey(key)
		if key == "" {
			continue
		}
		db.Exec(`UPDATE "UploadedFile" SET "used" = 1 WHERE "key" = ? OR "rawKey" = ?`, key, key)
	}
}

// markFileUnused marks a file for deferred cleanup. If no tracking record
// exists (e.g. file uploaded before tracking was introduced), one is created.
// Files still referenced by any live row are left (or repaired) as used=1.
func markFileUnused(key, rawKey string) {
	if key == "" {
		return
	}
	if fileIsReferenced(key, rawKey) {
		markUploadedFilesUsed([]string{key})
		return
	}
	now := int64(nowMillis())
	result, _ := db.Exec(`UPDATE "UploadedFile" SET "used" = 0, "createdAt" = ? WHERE "key" = ?`, now, key)
	if affected, _ := result.RowsAffected(); affected == 0 {
		db.Exec(`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used") VALUES (?, ?, ?, 0)`,
			key, rawKey, now)
	}
}
