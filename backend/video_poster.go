package main

import (
	"bytes"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
)

const maxPosterUploadSize = 1 * 1024 * 1024 // 1MB JPEG cover

const posterSuffix = ".poster.jpg"

// posterKeyFromVideoKey maps moments/uuid.mp4 → moments/uuid.poster.jpg.
// Non-video keys return an empty string.
func posterKeyFromVideoKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" || mediaTypeFromKey(key) != "video" {
		return ""
	}
	ext := filepath.Ext(key)
	return strings.TrimSuffix(key, ext) + posterSuffix
}

func resolvePosterURL(mediaType, videoKey, posterKey string) string {
	if mediaType != "video" {
		return ""
	}
	pk := posterKey
	if pk == "" {
		pk = posterKeyFromVideoKey(videoKey)
	}
	if pk == "" {
		return ""
	}
	url, _ := toDisplayURL(pk, 86400)
	return url
}

// attachPosterToResult fills the poster key/URL. The client may still upload a
// cover; ffmpeg also writes one in the background after transcode when available.
func attachPosterToResult(result *uploadResult) {
	if result == nil || result.MediaType != "video" || result.Key == "" {
		return
	}
	pk := posterKeyFromVideoKey(result.Key)
	if pk == "" {
		return
	}
	result.PosterKey = pk
	url, _ := toDisplayURL(pk, 86400)
	result.PosterURL = url
}

// POST /upload/poster
// form-data: videoKey, file (JPEG cover captured in the browser)
func handleUploadPoster(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxPosterUploadSize + 1<<20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid upload")
		return
	}

	videoKey, err := sanitizeStorageKey(r.FormValue("videoKey"))
	if err != nil || videoKey == "" {
		writeErr(w, http.StatusBadRequest, "videoKey required")
		return
	}
	posterKey := posterKeyFromVideoKey(videoKey)
	if posterKey == "" {
		writeErr(w, http.StatusBadRequest, "videoKey must be a video")
		return
	}
	if err := validateUploadKeys([]string{videoKey}); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid videoKey")
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxPosterUploadSize+1))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Upload failed")
		return
	}
	if len(data) == 0 || int64(len(data)) > maxPosterUploadSize {
		writeErr(w, http.StatusBadRequest, "文件过大")
		return
	}
	if !bytes.HasPrefix(data, []byte{0xff, 0xd8}) {
		writeErr(w, http.StatusBadRequest, "封面必须是 JPEG")
		return
	}

	if err := writeLocalBytes(posterKey, data); err != nil {
		log.Printf("[Upload] poster write %s: %v", posterKey, err)
		writeErr(w, http.StatusInternalServerError, "Upload failed")
		return
	}

	cfg := getStorageConfig()
	if cfg.typ == storageS3 && cfg.s3 != nil {
		localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(posterKey))
		go syncFileToS3(localPath, posterKey, "image")
	}

	trackUploadedFile(posterKey, "")

	url, _ := toDisplayURL(posterKey, 86400)
	writeOK(w, uploadResult{
		URL:       url,
		Key:       posterKey,
		MediaType: "image",
	})
}
