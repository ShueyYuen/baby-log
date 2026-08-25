package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const multipartPartExpiry = 1 * time.Hour

type multipartInitRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	FileSize    int64  `json:"fileSize"`
	ChunkSize   int64  `json:"chunkSize"`
}

type multipartPartInfo struct {
	PartNumber int    `json:"partNumber"`
	UploadURL  string `json:"uploadUrl"`
}

type multipartInitResponse struct {
	UploadID  string              `json:"uploadId"`
	Key       string              `json:"key"`
	MediaType string              `json:"mediaType"`
	Parts     []multipartPartInfo `json:"parts"`
}

// POST /upload/multipart/init/{prefix}
func handleMultipartInit(w http.ResponseWriter, r *http.Request) {
	prefix := chi.URLParam(r, "prefix")
	if prefix == "" {
		writeErr(w, http.StatusBadRequest, "missing upload prefix")
		return
	}

	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		writeErr(w, http.StatusBadRequest, "multipart upload requires S3 storage")
		return
	}

	var req multipartInitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.ContentType = normalizeMomentMIME(req.Filename, req.ContentType)
	if !momentAllowedMimeTypes[req.ContentType] {
		writeErr(w, http.StatusBadRequest, "不支持的文件类型")
		return
	}
	if req.FileSize <= 0 {
		writeErr(w, http.StatusBadRequest, "fileSize required")
		return
	}
	if req.ChunkSize <= 0 {
		req.ChunkSize = 50 * 1024 * 1024 // default 50MB
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

	client := getS3Client()

	createOut, err := client.CreateMultipartUpload(context.Background(), &s3.CreateMultipartUploadInput{
		Bucket:       aws.String(cfg.s3.bucket),
		Key:          aws.String(key),
		ContentType:  aws.String(req.ContentType),
		CacheControl: aws.String(s3CacheControl),
	})
	if err != nil {
		log.Printf("[Multipart] CreateMultipartUpload failed: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to initiate upload")
		return
	}

	uploadID := aws.ToString(createOut.UploadId)

	numParts := int((req.FileSize + req.ChunkSize - 1) / req.ChunkSize)
	if numParts < 1 {
		numParts = 1
	}

	presigner := s3.NewPresignClient(client)
	parts := make([]multipartPartInfo, numParts)
	for i := 0; i < numParts; i++ {
		partNum := int32(i + 1)
		presigned, err := presigner.PresignUploadPart(context.Background(), &s3.UploadPartInput{
			Bucket:     aws.String(cfg.s3.bucket),
			Key:        aws.String(key),
			UploadId:   aws.String(uploadID),
			PartNumber: aws.Int32(partNum),
		}, func(o *s3.PresignOptions) {
			o.Expires = multipartPartExpiry
		})
		if err != nil {
			log.Printf("[Multipart] PresignUploadPart %d failed: %v", partNum, err)
			abortMultipart(cfg.s3.bucket, key, uploadID)
			writeErr(w, http.StatusInternalServerError, "failed to generate part URLs")
			return
		}
		parts[i] = multipartPartInfo{
			PartNumber: int(partNum),
			UploadURL:  presigned.URL,
		}
	}

	trackUploadedFile(key, "")

	resp := multipartInitResponse{
		UploadID:  uploadID,
		Key:       key,
		MediaType: mediaType,
		Parts:     parts,
	}

	writeOK(w, resp)
}

type multipartCompletePart struct {
	PartNumber int    `json:"partNumber"`
	ETag       string `json:"etag"`
}

type multipartCompleteRequest struct {
	UploadID string                  `json:"uploadId"`
	Key      string                  `json:"key"`
	Parts    []multipartCompletePart `json:"parts"`
}

// POST /upload/multipart/complete/{prefix}
func handleMultipartComplete(w http.ResponseWriter, r *http.Request) {
	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		writeErr(w, http.StatusBadRequest, "multipart upload requires S3 storage")
		return
	}

	var req multipartCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.UploadID == "" || req.Key == "" || len(req.Parts) == 0 {
		writeErr(w, http.StatusBadRequest, "uploadId, key, and parts required")
		return
	}

	completedParts := make([]s3types.CompletedPart, len(req.Parts))
	for i, p := range req.Parts {
		completedParts[i] = s3types.CompletedPart{
			PartNumber: aws.Int32(int32(p.PartNumber)),
			ETag:       aws.String(p.ETag),
		}
	}

	client := getS3Client()
	_, err := client.CompleteMultipartUpload(context.Background(), &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(cfg.s3.bucket),
		Key:      aws.String(req.Key),
		UploadId: aws.String(req.UploadID),
		MultipartUpload: &s3types.CompletedMultipartUpload{
			Parts: completedParts,
		},
	})
	if err != nil {
		log.Printf("[Multipart] CompleteMultipartUpload failed: %v", err)
		writeErr(w, http.StatusInternalServerError, "failed to complete upload")
		return
	}

	result := &uploadResult{Key: req.Key}
	if cfg.s3.publicURL != "" {
		result.URL = buildPublicURL(cfg.s3, req.Key)
	} else {
		result.URL, _ = toDisplayURL(req.Key, 86400)
	}
	result.MediaType = "video"
	if isImageMIME(mimeFromExt(filepath.Ext(req.Key))) {
		result.MediaType = "image"
	}
	if result.MediaType == "video" {
		attachPosterToResult(result)
		enqueueS3VideoPrepare(req.Key)
	}

	log.Printf("[Multipart] Upload completed: key=%s parts=%d", req.Key, len(req.Parts))
	writeOK(w, []*uploadResult{result})
}

type multipartAbortRequest struct {
	UploadID string `json:"uploadId"`
	Key      string `json:"key"`
}

// POST /upload/multipart/abort/{prefix}
func handleMultipartAbort(w http.ResponseWriter, r *http.Request) {
	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		writeErr(w, http.StatusBadRequest, "multipart upload requires S3 storage")
		return
	}

	var req multipartAbortRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.UploadID == "" || req.Key == "" {
		writeErr(w, http.StatusBadRequest, "uploadId and key required")
		return
	}

	abortMultipart(cfg.s3.bucket, req.Key, req.UploadID)
	writeOK(w, map[string]string{"status": "aborted"})
}

func abortMultipart(bucket, key, uploadID string) {
	client := getS3Client()
	_, err := client.AbortMultipartUpload(context.Background(), &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
	})
	if err != nil {
		log.Printf("[Multipart] AbortMultipartUpload failed: key=%s err=%v", key, err)
	}
}

func mimeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".avi":
		return "video/x-msvideo"
	case ".heic", ".heif":
		return "image/heic"
	case ".3gp":
		return "video/3gpp"
	default:
		return "application/octet-stream"
	}
}
