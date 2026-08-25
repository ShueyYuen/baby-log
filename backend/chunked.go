package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var chunkedUploads sync.Map

type chunkedUploadState struct {
	Key          string `json:"key"`
	TempPath     string `json:"tempPath"`
	MediaType    string `json:"mediaType"`
	Prefix       string `json:"prefix"`
	FileSize     int64  `json:"fileSize"`
	TotalParts   int    `json:"totalParts"`
	ChunkSize    int64  `json:"chunkSize"`
	PartsWritten int64  // atomic counter
}

type chunkedInitRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	FileSize    int64  `json:"fileSize"`
	ChunkSize   int64  `json:"chunkSize"`
}

type chunkedInitResponse struct {
	UploadID   string `json:"uploadId"`
	Key        string `json:"key"`
	Mode       string `json:"mode"`
	TotalParts int    `json:"totalParts"`
	ChunkSize  int64  `json:"chunkSize"`
}

// POST /upload/chunked/init/{prefix}
func handleChunkedInit(w http.ResponseWriter, r *http.Request) {
	prefix := chi.URLParam(r, "prefix")
	if prefix == "" {
		writeErr(w, http.StatusBadRequest, "missing upload prefix")
		return
	}

	cfg := getStorageConfig()

	var req chunkedInitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.ContentType = normalizeMomentMIME(req.Filename, req.ContentType)
	if !momentAllowedMimeTypes[req.ContentType] {
		rejectUnsupportedMIME(w, req.Filename, req.ContentType)
		return
	}
	if req.FileSize <= 0 {
		writeErr(w, http.StatusBadRequest, "fileSize required")
		return
	}
	if req.ChunkSize <= 0 {
		req.ChunkSize = 2 * 1024 * 1024
	}
	if req.ChunkSize > 16*1024*1024 {
		req.ChunkSize = 16 * 1024 * 1024
	}

	uid := uuid.NewString()
	origExt := strings.ToLower(filepath.Ext(req.Filename))
	if origExt == "" {
		origExt = mimeToExt(req.ContentType)
	}

	key := prefix + "/" + uid + origExt
	mediaType := "video"
	if isImageMIME(req.ContentType) {
		mediaType = "image"
	}

	tmpDir := filepath.Join(cfg.uploadDir, ".tmp")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		log.Printf("[Chunked] Failed to create tmp dir: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to init upload")
		return
	}

	uploadID := uuid.NewString()
	tempPath := filepath.Join(tmpDir, uploadID)

	// Pre-allocate the file to the expected size for parallel pwrite
	f, err := os.Create(tempPath)
	if err != nil {
		log.Printf("[Chunked] Failed to create temp file: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to init upload")
		return
	}
	if err := f.Truncate(req.FileSize); err != nil {
		f.Close()
		os.Remove(tempPath)
		log.Printf("[Chunked] Failed to pre-allocate file: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to init upload")
		return
	}
	f.Close()

	totalParts := int((req.FileSize + req.ChunkSize - 1) / req.ChunkSize)
	if totalParts < 1 {
		totalParts = 1
	}

	state := &chunkedUploadState{
		Key:        key,
		TempPath:   tempPath,
		MediaType:  mediaType,
		Prefix:     prefix,
		FileSize:   req.FileSize,
		TotalParts: totalParts,
		ChunkSize:  req.ChunkSize,
	}
	chunkedUploads.Store(uploadID, state)

	trackUploadedFile(key, "")
	log.Printf("[Chunked] Init: uploadId=%s key=%s size=%d parts=%d chunk=%d",
		uploadID, key, req.FileSize, totalParts, req.ChunkSize)

	writeOK(w, chunkedInitResponse{
		UploadID:   uploadID,
		Key:        key,
		Mode:       "chunked",
		TotalParts: totalParts,
		ChunkSize:  req.ChunkSize,
	})
}

// POST /upload/chunked/part/{uploadId}
// Query params: partNumber (1-based), offset (byte offset)
func handleChunkedPart(w http.ResponseWriter, r *http.Request) {
	uploadID := chi.URLParam(r, "uploadId")
	if uploadID == "" {
		writeErr(w, http.StatusBadRequest, "missing uploadId")
		return
	}

	val, ok := chunkedUploads.Load(uploadID)
	if !ok {
		writeErr(w, http.StatusNotFound, "upload not found or expired")
		return
	}
	state := val.(*chunkedUploadState)

	partNumberStr := r.URL.Query().Get("partNumber")
	offsetStr := r.URL.Query().Get("offset")

	var offset int64
	if offsetStr != "" {
		var err error
		offset, err = strconv.ParseInt(offsetStr, 10, 64)
		if err != nil || offset < 0 {
			writeErr(w, http.StatusBadRequest, "invalid offset")
			return
		}
	} else if partNumberStr != "" {
		partNumber, err := strconv.Atoi(partNumberStr)
		if err != nil || partNumber < 1 {
			writeErr(w, http.StatusBadRequest, "invalid partNumber")
			return
		}
		offset = int64(partNumber-1) * state.ChunkSize
	}

	f, err := os.OpenFile(state.TempPath, os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("[Chunked] Failed to open temp file: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to write chunk")
		return
	}
	defer f.Close()

	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		log.Printf("[Chunked] Failed to seek: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to write chunk")
		return
	}

	written, err := io.Copy(f, io.LimitReader(r.Body, state.ChunkSize+4096))
	if err != nil {
		log.Printf("[Chunked] Failed to write chunk: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to write chunk")
		return
	}

	partsNow := atomic.AddInt64(&state.PartsWritten, 1)
	log.Printf("[Chunked] Part written: uploadId=%s offset=%d bytes=%d progress=%d/%d",
		uploadID, offset, written, partsNow, state.TotalParts)

	writeOK(w, map[string]interface{}{
		"offset":       offset,
		"bytesWritten": written,
		"partsWritten": partsNow,
		"totalParts":   state.TotalParts,
	})
}

// GET /upload/chunked/status/{uploadId}
func handleChunkedStatus(w http.ResponseWriter, r *http.Request) {
	uploadID := chi.URLParam(r, "uploadId")
	if uploadID == "" {
		writeErr(w, http.StatusBadRequest, "missing uploadId")
		return
	}

	val, ok := chunkedUploads.Load(uploadID)
	if !ok {
		writeErr(w, http.StatusNotFound, "upload not found or expired")
		return
	}
	state := val.(*chunkedUploadState)

	partsWritten := atomic.LoadInt64(&state.PartsWritten)
	writeOK(w, map[string]interface{}{
		"uploadId":     uploadID,
		"key":          state.Key,
		"totalParts":   state.TotalParts,
		"partsWritten": partsWritten,
		"chunkSize":    state.ChunkSize,
		"fileSize":     state.FileSize,
		"complete":     int(partsWritten) >= state.TotalParts,
	})
}

// POST /upload/chunked/complete/{uploadId}
func handleChunkedComplete(w http.ResponseWriter, r *http.Request) {
	uploadID := chi.URLParam(r, "uploadId")
	if uploadID == "" {
		writeErr(w, http.StatusBadRequest, "missing uploadId")
		return
	}

	val, ok := chunkedUploads.Load(uploadID)
	if !ok {
		writeErr(w, http.StatusNotFound, "upload not found or expired")
		return
	}
	state := val.(*chunkedUploadState)
	chunkedUploads.Delete(uploadID)

	partsWritten := atomic.LoadInt64(&state.PartsWritten)
	if int(partsWritten) < state.TotalParts {
		writeErr(w, http.StatusBadRequest, fmt.Sprintf("incomplete: %d/%d parts uploaded", partsWritten, state.TotalParts))
		return
	}

	// Truncate to exact file size (last chunk may have been smaller)
	if err := os.Truncate(state.TempPath, state.FileSize); err != nil {
		log.Printf("[Chunked] Failed to truncate file: %v", err)
	}

	cfg := getStorageConfig()
	finalPath := filepath.Join(cfg.uploadDir, state.Key)
	finalDir := filepath.Dir(finalPath)
	if err := os.MkdirAll(finalDir, 0755); err != nil {
		log.Printf("[Chunked] Failed to create final dir: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to complete upload")
		return
	}

	if err := os.Rename(state.TempPath, finalPath); err != nil {
		log.Printf("[Chunked] Failed to move temp to final: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to complete upload")
		return
	}

	result := &uploadResult{
		Key:       state.Key,
		MediaType: state.MediaType,
		URL:       "/api/v1/uploads/" + state.Key,
	}
	if state.MediaType == "video" {
		attachPosterToResult(result)
		enqueueVideoPrepareAndSync(finalPath, state.Key)
	} else if cfg.typ == storageS3 && cfg.s3 != nil {
		go syncFileToS3(finalPath, state.Key, state.MediaType)
	}

	log.Printf("[Chunked] Upload completed: key=%s parts=%d", state.Key, state.TotalParts)
	writeOK(w, []*uploadResult{result})
}

// syncFileToS3 uploads a local file to S3 in the background.
func syncFileToS3(localPath, key, mediaType string) {
	cfg := getStorageConfig()
	if cfg.s3 == nil {
		return
	}

	f, err := os.Open(localPath)
	if err != nil {
		log.Printf("[S3Sync] Failed to open local file %s: %v", localPath, err)
		return
	}
	defer f.Close()

	contentType := mimeFromExt(filepath.Ext(key))
	err = putToS3(key, contentType, f)
	if err != nil {
		log.Printf("[S3Sync] Failed to upload %s to S3: %v", key, err)
		return
	}

	log.Printf("[S3Sync] Successfully synced %s to S3", key)

	if err := os.Remove(localPath); err != nil {
		log.Printf("[S3Sync] Failed to remove local file %s: %v", localPath, err)
	}
}
