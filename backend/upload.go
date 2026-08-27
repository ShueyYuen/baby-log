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
	"image/heic":      true,
	"image/heif":      true,
	"video/mp4":       true,
	"video/quicktime": true,
	"video/webm":      true,
	"video/x-msvideo": true,
	"video/3gpp":      true,
}

func rejectUnsupportedMIME(w http.ResponseWriter, filename, contentType string) {
	log.Printf("[Upload] rejected unsupported type file=%s type=%s", filename, contentType)
	writeErr(w, http.StatusBadRequest, "不支持的文件类型")
}

// normalizeMomentMIME maps empty / octet-stream types (common on iOS) to a
// real MIME type using the filename extension so videos are not rejected.
func normalizeMomentMIME(filename, contentType string) string {
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	switch ct {
	case "image/jpg":
		ct = "image/jpeg"
	case "video/x-quicktime":
		ct = "video/quicktime"
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
	case ".3gp":
		return "video/3gpp"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".heic":
		return "image/heic"
	case ".heif":
		return "image/heif"
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
		writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
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
		writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
		return
	}

	trackUploadedFile(result.Key, result.RawKey, result.Size)
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
			writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
			return
		}
		contentType := normalizeMomentMIME(header.Filename, header.Header.Get("Content-Type"))
		if !momentAllowedMimeTypes[contentType] {
			f.Close()
			rejectUnsupportedMIME(w, header.Filename, contentType)
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
				writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
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
			trackUploadedFile(result.Key, result.RawKey, result.Size)
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
				writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
			}
			return
		}
		trackUploadedFile(result.Key, result.RawKey, result.Size)
		localPath := filepath.Join(getStorageConfig().uploadDir, filepath.FromSlash(result.Key))
		enqueueVideoPrepareAndSync(localPath, result.Key)
		results = append(results, result)
	}
	writeOK(w, results)
}

// handleUploadMediaStreamingS3 reads each multipart part and writes it locally.
// Videos are transcoded (1-at-a-time) and synced to S3 in the background.
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
			writeInternal(w, r, http.StatusInternalServerError, "Failed to read upload", err)
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
			rejectUnsupportedMIME(w, filename, contentType)
			return
		}

		uid := uuid.NewString()
		origExt := strings.ToLower(filepath.Ext(filename))
		if origExt == "" {
			origExt = mimeToExt(contentType)
		}

		isImage := isImageMIME(contentType)
		result := &uploadResult{}

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
			compData, compMIME := compressImage(data, contentType)
			compExt := origExt
			if compMIME == "image/jpeg" {
				compExt = ".jpg"
			}
			compKey := prefix + "/" + uid + compExt
			rawKey := prefix + "/raw/" + uid + origExt
			result.Key = compKey
			result.MediaType = "image"
			result.Size = int64(len(compData))
			if err := writeLocalBytes(compKey, compData); err != nil {
				log.Printf("[Upload] write local %s: %v", compKey, err)
				writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
				return
			}
			localComp := filepath.Join(cfg.uploadDir, filepath.FromSlash(compKey))
			go syncFileToS3(localComp, compKey, "image")
			if err := writeLocalBytes(rawKey, data); err != nil {
				log.Printf("[Storage] local raw write failed (non-fatal): %v", err)
			} else {
				result.RawKey = rawKey
				result.RawURL = "/api/v1/uploads/" + rawKey
				localRaw := filepath.Join(cfg.uploadDir, filepath.FromSlash(rawKey))
				go syncFileToS3(localRaw, rawKey, "image")
			}
			if prefix == "medical" && isOCRAvailable() {
				ocrEnqueueBackground(rawKey, data)
			}
		} else {
			compKey := prefix + "/" + uid + origExt
			saved, err := saveLocalPrefixedVideoToKey(compKey, part, maxMomentUploadSize)
			part.Close()
			if err != nil {
				if errors.Is(err, errMediaTooLarge) {
					writeErr(w, http.StatusBadRequest, "文件过大")
				} else if errors.Is(err, errMediaInvalid) {
					writeErr(w, http.StatusBadRequest, "文件内容与声明的类型不匹配")
				} else {
					log.Printf("[Upload] %s video failed: %v", prefix, err)
					writeInternal(w, r, http.StatusInternalServerError, "Upload failed", err)
				}
				return
			}
			result.Key = saved.Key
			result.Size = saved.Size
			result.MediaType = "video"
			localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(compKey))
			attachPosterToResult(result)
			markResultProcessing(result)
			enqueueVideoPrepareAndSync(localPath, compKey)
		}

		result.URL = "/api/v1/uploads/" + result.Key

		trackUploadedFile(result.Key, result.RawKey, result.Size)
		results = append(results, result)
	}

	if len(results) == 0 {
		writeErr(w, http.StatusBadRequest, "No files uploaded")
		return
	}

	log.Printf("[Upload] %s media streaming: count=%d", prefix, len(results))
	writeOK(w, results)
}

func writeLocalBytes(key string, data []byte) error {
	cfg := getStorageConfig()
	dest := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0o644)
}

func saveLocalPrefixedVideo(prefix, filename, contentType string, src io.Reader, maxSize int64) (*uploadResult, error) {
	uid := uuid.NewString()
	origExt := strings.ToLower(filepath.Ext(filename))
	if origExt == "" {
		origExt = mimeToExt(contentType)
	}
	key := prefix + "/" + uid + origExt
	return saveLocalPrefixedVideoToKey(key, src, maxSize)
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

	result := &uploadResult{
		URL:       cfg.publicPath + "/" + key,
		Key:       key,
		MediaType: "video",
		Size:      written,
	}
	attachPosterToResult(result)
	markResultProcessing(result)
	return result, nil
}

func trackUploadedFile(key, rawKey string, size int64) {
	if db == nil || key == "" {
		return
	}
	if size <= 0 {
		size = localFileSize(key)
	}
	now := int64(nowMillis())
	ready := 1
	if mediaTypeFromKey(key) == "video" && videoTranscodeEnabled() {
		ready = 0
	}
	_, err := db.Exec(`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "ready", "size") VALUES (?, ?, ?, 0, ?, ?)`,
		key, rawKey, now, ready, size)
	if err != nil {
		log.Printf("[Upload] Failed to track uploaded file %s: %v", key, err)
		return
	}
	if size > 0 {
		if _, err := db.Exec(`UPDATE "UploadedFile" SET "size" = ? WHERE "key" = ?`, size, key); err != nil {
			log.Printf("[Upload] Failed to update size %s: %v", key, err)
		}
	}
	if ready == 0 {
		_, _ = db.Exec(`UPDATE "UploadedFile" SET "ready" = 0 WHERE "key" = ? AND "ready" = 1`, key)
	}
	if mediaTypeFromKey(key) == "video" {
		if pk := posterKeyFromVideoKey(key); pk != "" {
			posterSize := localFileSize(pk)
			if _, err := db.Exec(`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "ready", "size") VALUES (?, ?, ?, 0, 1, ?)`,
				pk, "", now, posterSize); err != nil {
				log.Printf("[Upload] Failed to track poster %s: %v", pk, err)
			}
		}
	}
}

func setUploadSize(key string, size int64) {
	if db == nil || key == "" || size <= 0 {
		return
	}
	if _, err := db.Exec(`UPDATE "UploadedFile" SET "size" = ? WHERE "key" = ?`, size, key); err != nil {
		log.Printf("[Upload] Failed to update size %s: %v", key, err)
	}
}

func localFileSize(key string) int64 {
	if key == "" {
		return 0
	}
	path := filepath.Join(getStorageConfig().uploadDir, filepath.FromSlash(key))
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return 0
	}
	return st.Size()
}

func markUploadReady(key string) {
	if db == nil || key == "" {
		return
	}
	if _, err := db.Exec(`UPDATE "UploadedFile" SET "ready" = 1 WHERE "key" = ?`, key); err != nil {
		log.Printf("[Upload] Failed to mark ready %s: %v", key, err)
	}
}

func isUploadReady(key string) bool {
	if key == "" || db == nil {
		return true
	}
	var ready int
	err := db.QueryRow(`SELECT "ready" FROM "UploadedFile" WHERE "key" = ?`, key).Scan(&ready)
	if err != nil {
		return true
	}
	return ready != 0
}

func unreadyVideoSet(keys []string) map[string]bool {
	out := map[string]bool{}
	if db == nil || len(keys) == 0 {
		return out
	}
	seen := map[string]bool{}
	var args []interface{}
	var ph []string
	for _, key := range keys {
		key = toStorageKey(key)
		if key == "" || seen[key] || mediaTypeFromKey(key) != "video" {
			continue
		}
		seen[key] = true
		args = append(args, key)
		ph = append(ph, "?")
	}
	if len(args) == 0 {
		return out
	}
	q := `SELECT "key" FROM "UploadedFile" WHERE "ready" = 0 AND "key" IN (` + strings.Join(ph, ",") + `)`
	rows, err := db.Query(q, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err == nil {
			out[key] = true
		}
	}
	return out
}

func gateVideoURL(mediaType, key, url string, unready map[string]bool) (gated string, processing bool) {
	if mediaType == "video" && key != "" && unready[key] {
		return "", true
	}
	return url, false
}

func markResultProcessing(result *uploadResult) {
	if result == nil || result.MediaType != "video" || !videoTranscodeEnabled() {
		return
	}
	result.Processing = true
	result.URL = ""
}

func uploadKeyExists(key string) bool {
	if db == nil || key == "" {
		return false
	}
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM "UploadedFile" WHERE "key" = ? OR "rawKey" = ?`, key, key).Scan(&n)
	return err == nil && n > 0
}

func posterBelongsToTrackedVideo(posterKey string, videoKeys []string) bool {
	if posterKey == "" {
		return false
	}
	for _, v := range videoKeys {
		if posterKeyFromVideoKey(v) == posterKey && uploadKeyExists(v) {
			return true
		}
	}
	if !strings.HasSuffix(posterKey, posterSuffix) {
		return false
	}
	stem := strings.TrimSuffix(posterKey, posterSuffix)
	if stem == "" {
		return false
	}
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM "UploadedFile" WHERE "key" LIKE ?`, stem+".%").Scan(&n)
	return err == nil && n > 0
}

// validateUploadKeys ensures all referenced keys exist in UploadedFile table.
// Derived video posters are allowed when the parent video is tracked, even if
// the .poster.jpg row has not been written yet (transcode still running).
func validateUploadKeys(keys []string) error {
	type item struct{ orig, norm string }
	var list []item
	var videos []string
	for _, key := range keys {
		normalized, err := sanitizeStorageKey(key)
		if err != nil {
			return fmt.Errorf("invalid file key: %s", key)
		}
		if normalized == "" {
			continue
		}
		list = append(list, item{key, normalized})
		if mediaTypeFromKey(normalized) == "video" {
			videos = append(videos, normalized)
		}
	}
	for _, it := range list {
		if uploadKeyExists(it.norm) {
			continue
		}
		if posterBelongsToTrackedVideo(it.norm, videos) {
			continue
		}
		return fmt.Errorf("invalid file key: %s", it.orig)
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
		if pk := posterKeyFromVideoKey(key); pk != "" {
			db.Exec(`UPDATE "UploadedFile" SET "used" = 1 WHERE "key" = ?`, pk)
		}
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
	markFileUnusedOne(key, rawKey)
	if pk := posterKeyFromVideoKey(key); pk != "" {
		markFileUnusedOne(pk, "")
	}
}

func markFileUnusedOne(key, rawKey string) {
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
		db.Exec(`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "size") VALUES (?, ?, ?, 0, ?)`,
			key, rawKey, now, localFileSize(key))
	}
}
