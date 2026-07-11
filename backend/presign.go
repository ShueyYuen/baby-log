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
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type presignRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
}

type presignResponse struct {
	UploadURL    string `json:"uploadUrl"`
	Key          string `json:"key"`
	RawUploadURL string `json:"rawUploadUrl,omitempty"`
	RawKey       string `json:"rawKey,omitempty"`
	PublicURL    string `json:"publicUrl,omitempty"`
	RawURL       string `json:"rawUrl,omitempty"`
	MediaType    string `json:"mediaType"`
}

// POST /upload/presign/{prefix}
// Returns presigned PUT URLs for direct browser-to-S3 upload.
// Falls back to an empty uploadUrl when storage is local (frontend should use regular upload).
func handlePresignUpload(w http.ResponseWriter, r *http.Request) {
	prefix := chi.URLParam(r, "prefix")
	if prefix == "" {
		writeErr(w, http.StatusBadRequest, "missing upload prefix")
		return
	}

	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		writeOK(w, map[string]interface{}{"directUpload": false})
		return
	}

	var req presignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !momentAllowedMimeTypes[req.ContentType] {
		writeErr(w, http.StatusBadRequest, "不支持的文件类型")
		return
	}

	uid := uuid.NewString()
	origExt := strings.ToLower(filepath.Ext(req.Filename))
	if origExt == "" {
		origExt = mimeToExt(req.ContentType)
	}

	mediaType := "video"
	if isImageMIME(req.ContentType) {
		mediaType = "image"
	}

	// Direct upload uses original extension and content type (no server-side compression)
	compKey := prefix + "/" + uid + origExt
	var rawKey string
	if isImageMIME(req.ContentType) {
		rawKey = prefix + "/raw/" + uid + origExt
	}

	client := getS3Client()
	presigner := s3.NewPresignClient(client)

	compURL, err := presigner.PresignPutObject(context.Background(), &s3.PutObjectInput{
		Bucket:       aws.String(cfg.s3.bucket),
		Key:          aws.String(compKey),
		ContentType:  aws.String(req.ContentType),
		CacheControl: aws.String(s3CacheControl),
	}, func(o *s3.PresignOptions) {
		o.Expires = 15 * time.Minute
	})
	if err != nil {
		log.Printf("[Presign] Failed to presign compressed key=%s: %v", compKey, err)
		writeErr(w, http.StatusInternalServerError, "presign failed")
		return
	}

	resp := presignResponse{
		UploadURL: compURL.URL,
		Key:       compKey,
		MediaType: mediaType,
	}

	if cfg.s3.publicURL != "" {
		resp.PublicURL = buildPublicURL(cfg.s3, compKey)
	}

	if rawKey != "" {
		rawPresign, err := presigner.PresignPutObject(context.Background(), &s3.PutObjectInput{
			Bucket:       aws.String(cfg.s3.bucket),
			Key:          aws.String(rawKey),
			ContentType:  aws.String(req.ContentType),
			CacheControl: aws.String(s3CacheControl),
		}, func(o *s3.PresignOptions) {
			o.Expires = 15 * time.Minute
		})
		if err != nil {
			log.Printf("[Presign] Failed to presign raw key=%s: %v", rawKey, err)
		} else {
			resp.RawUploadURL = rawPresign.URL
			resp.RawKey = rawKey
			if cfg.s3.publicURL != "" {
				resp.RawURL = buildPublicURL(cfg.s3, rawKey)
			}
		}
	}

	trackUploadedFile(compKey, rawKey)

	writeOK(w, map[string]interface{}{
		"directUpload": true,
		"presign":      resp,
	})
}

type presignCompleteRequest struct {
	Key    string `json:"key"`
	RawKey string `json:"rawKey"`
}

// POST /upload/presign-complete/{prefix}
// Called after direct S3 upload completes to confirm the file is ready.
func handlePresignComplete(w http.ResponseWriter, r *http.Request) {
	var req presignCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Key == "" {
		writeErr(w, http.StatusBadRequest, "missing key")
		return
	}

	cfg := getStorageConfig()
	result := &uploadResult{
		Key:    req.Key,
		RawKey: req.RawKey,
	}
	if cfg.typ == storageS3 && cfg.s3 != nil && cfg.s3.publicURL != "" {
		result.URL = buildPublicURL(cfg.s3, req.Key)
		if req.RawKey != "" {
			result.RawURL = buildPublicURL(cfg.s3, req.RawKey)
		}
	}
	if isImageMIME("image/jpeg") {
		result.MediaType = "image"
	}

	writeOK(w, []*uploadResult{result})
}
