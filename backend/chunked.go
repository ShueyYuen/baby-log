package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// chunkedUploads tracks in-progress chunked uploads (local storage mode).
var chunkedUploads sync.Map

type chunkedUploadState struct {
	Key       string `json:"key"`
	TempPath  string `json:"tempPath"`
	MediaType string `json:"mediaType"`
	Prefix    string `json:"prefix"`
	Parts     int    `json:"parts"`
}

type chunkedInitRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	FileSize    int64  `json:"fileSize"`
}

type chunkedInitResponse struct {
	UploadID string `json:"uploadId"`
	Key      string `json:"key"`
	Mode     string `json:"mode"`
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

	if !momentAllowedMimeTypes[req.ContentType] {
		writeErr(w, http.StatusBadRequest, "不支持的文件类型")
		return
	}
	if req.FileSize <= 0 {
		writeErr(w, http.StatusBadRequest, "fileSize required")
		return
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

	f, err := os.Create(tempPath)
	if err != nil {
		log.Printf("[Chunked] Failed to create temp file: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to init upload")
		return
	}
	f.Close()

	state := &chunkedUploadState{
		Key:       key,
		TempPath:  tempPath,
		MediaType: mediaType,
		Prefix:    prefix,
	}
	chunkedUploads.Store(uploadID, state)

	trackUploadedFile(key, "")

	writeOK(w, chunkedInitResponse{
		UploadID: uploadID,
		Key:      key,
		Mode:     "chunked",
	})
}

// POST /upload/chunked/part/{uploadId}
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

	f, err := os.OpenFile(state.TempPath, os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		log.Printf("[Chunked] Failed to open temp file: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to write chunk")
		return
	}
	defer f.Close()

	written, err := io.Copy(f, r.Body)
	if err != nil {
		log.Printf("[Chunked] Failed to write chunk: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to write chunk")
		return
	}

	state.Parts++
	log.Printf("[Chunked] Part %d written: uploadId=%s bytes=%d", state.Parts, uploadID, written)

	writeOK(w, map[string]interface{}{
		"partNumber": state.Parts,
		"bytesWritten": written,
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

	markUploadedFilesUsed([]string{state.Key})

	result := &uploadResult{
		Key:       state.Key,
		MediaType: state.MediaType,
		URL:       "/api/v1/uploads/" + state.Key,
	}

	// If S3 is configured, queue background upload (frontend doesn't wait)
	if cfg.typ == storageS3 && cfg.s3 != nil {
		go syncFileToS3(finalPath, state.Key, state.MediaType)
	}

	log.Printf("[Chunked] Upload completed: key=%s parts=%d", state.Key, state.Parts)
	writeOK(w, []*uploadResult{result})
}

// syncFileToS3 uploads a local file to S3 in the background.
// After successful upload, the local file is removed.
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

	// Remove local copy now that S3 has it
	if err := os.Remove(localPath); err != nil {
		log.Printf("[S3Sync] Failed to remove local file %s: %v", localPath, err)
	}
}
