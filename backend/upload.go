package main

import (
	"io"
	"log"
	"net/http"
)

const maxUploadSize = 10 * 1024 * 1024 // 10MB

var allowedMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
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
	if len(headers) > 9 {
		headers = headers[:9]
	}

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
