package main

import (
	"bytes"
	"context"
	"log"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscfg "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

type storageType string

const (
	storageLocal storageType = "local"
	storageS3    storageType = "s3"
)

// s3CacheControl sets the Cache-Control header for all uploaded objects.
// Files use UUID-based names and are immutable, so a long cache is safe.
const s3CacheControl = "public, max-age=31536000, immutable"

type s3Config struct {
	bucket          string
	region          string
	endpoint        string
	accessKeyID     string
	secretAccessKey string
	publicURL       string
	forcePathStyle  bool
}

type storageConfig struct {
	typ        storageType
	s3         *s3Config
	uploadDir  string
	publicPath string
}

var httpSchemeRe = regexp.MustCompile(`(?i)^https?://`)

func normalizeEndpoint(endpoint string) string {
	trimmed := strings.TrimSpace(endpoint)
	if trimmed == "" {
		return ""
	}
	if httpSchemeRe.MatchString(trimmed) {
		return trimmed
	}
	return "https://" + trimmed
}

func getStorageConfig() storageConfig {
	typ := storageType(os.Getenv("STORAGE_TYPE"))
	if typ == "" {
		typ = storageLocal
	}

	if typ == storageS3 {
		region := os.Getenv("S3_REGION")
		if region == "" {
			region = "us-east-1"
		}
		return storageConfig{
			typ: storageS3,
			s3: &s3Config{
				bucket:          os.Getenv("S3_BUCKET"),
				region:          region,
				endpoint:        normalizeEndpoint(os.Getenv("S3_ENDPOINT")),
				accessKeyID:     os.Getenv("S3_ACCESS_KEY_ID"),
				secretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY"),
				publicURL:       normalizeEndpoint(os.Getenv("S3_PUBLIC_URL")),
				forcePathStyle:  os.Getenv("S3_FORCE_PATH_STYLE") == "true",
			},
		}
	}

	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "uploads"
	}
	return storageConfig{
		typ:        storageLocal,
		uploadDir:  uploadDir,
		publicPath: "/api/v1/uploads",
	}
}

func getStorageType() storageType {
	return getStorageConfig().typ
}

var (
	s3ClientOnce sync.Once
	s3ClientInst *s3.Client
)

func getS3Client() *s3.Client {
	s3ClientOnce.Do(func() {
		cfg := getStorageConfig()
		if cfg.s3 == nil {
			return
		}
		if cfg.s3.bucket == "" {
			log.Println("[Storage] S3_BUCKET is empty!")
		}
		if cfg.s3.accessKeyID == "" {
			log.Println("[Storage] S3_ACCESS_KEY_ID is empty!")
		}
		if cfg.s3.secretAccessKey == "" {
			log.Println("[Storage] S3_SECRET_ACCESS_KEY is empty!")
		}

		awsConf, err := awscfg.LoadDefaultConfig(context.Background(),
			awscfg.WithRegion(cfg.s3.region),
			awscfg.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
				cfg.s3.accessKeyID, cfg.s3.secretAccessKey, "")),
		)
		if err != nil {
			log.Printf("[Storage] Failed to load AWS config: %v", err)
			return
		}

		s3ClientInst = s3.NewFromConfig(awsConf, func(o *s3.Options) {
			if cfg.s3.endpoint != "" {
				o.BaseEndpoint = aws.String(cfg.s3.endpoint)
			}
			o.UsePathStyle = cfg.s3.forcePathStyle
		})
	})
	return s3ClientInst
}

// uploadResult holds the display URL, storage key, and optional raw file info.
type uploadResult struct {
	URL       string `json:"url"`
	Key       string `json:"key"`
	RawURL    string `json:"rawUrl,omitempty"`
	RawKey    string `json:"rawKey,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
}

func buildPublicURL(cfg *s3Config, s3Key string) string {
	if cfg.publicURL != "" {
		return cfg.publicURL + "/" + s3Key
	}
	endpoint := cfg.endpoint
	if endpoint == "" {
		endpoint = "https://s3." + cfg.region + ".amazonaws.com"
	}
	if cfg.forcePathStyle {
		return endpoint + "/" + cfg.bucket + "/" + s3Key
	}
	if u, err := url.Parse(endpoint); err == nil && u.Host != "" {
		return u.Scheme + "://" + cfg.bucket + "." + u.Host + "/" + s3Key
	}
	return endpoint + "/" + cfg.bucket + "/" + s3Key
}

// uploadFile stores a file with compression (images) and raw backup.
// S3: compressed → uploads/{uid}.jpg, raw → uploads/raw/{uid}{origExt}
// Local: compressed → {uploadDir}/{uid}.jpg, raw → {uploadDir}/raw/{uid}{origExt}
func uploadFile(filename string, contentType string, data []byte) (*uploadResult, error) {
	cfg := getStorageConfig()
	uid := uuid.NewString()
	origExt := strings.ToLower(filepath.Ext(filename))
	if origExt == "" {
		origExt = mimeToExt(contentType)
	}

	var compressedData []byte
	var compressedMIME string
	var compressedExt string

	if isImageMIME(contentType) {
		compressedData, compressedMIME = compressImage(data, contentType)
		compressedExt = ".jpg"
	} else {
		compressedData = data
		compressedMIME = contentType
		compressedExt = origExt
	}

	if cfg.typ == storageS3 && cfg.s3 != nil {
		client := getS3Client()
		s3Key := "uploads/" + uid + compressedExt

		type s3Result struct {
			url string
			key string
			err error
		}

		compCh := make(chan s3Result, 1)
		rawCh := make(chan s3Result, 1)

		go func() {
			if _, err := client.PutObject(context.Background(), &s3.PutObjectInput{
				Bucket:       aws.String(cfg.s3.bucket),
				Key:          aws.String(s3Key),
				Body:         bytes.NewReader(compressedData),
				ContentType:  aws.String(compressedMIME),
				CacheControl: aws.String(s3CacheControl),
			}); err != nil {
				compCh <- s3Result{err: err}
				return
			}
			var u string
			if cfg.s3.publicURL != "" {
				u = buildPublicURL(cfg.s3, s3Key)
			} else {
				u, _ = getSignedDownloadURL(s3Key, 3600)
			}
			compCh <- s3Result{url: u, key: s3Key}
		}()

		if isImageMIME(contentType) {
			go func() {
				rawKey := "uploads/raw/" + uid + origExt
				if _, err := client.PutObject(context.Background(), &s3.PutObjectInput{
					Bucket:       aws.String(cfg.s3.bucket),
					Key:          aws.String(rawKey),
					Body:         bytes.NewReader(data),
					ContentType:  aws.String(contentType),
					CacheControl: aws.String(s3CacheControl),
				}); err != nil {
					log.Printf("[Storage] S3 raw upload failed (non-fatal): %v", err)
					rawCh <- s3Result{}
					return
				}
				var u string
				if cfg.s3.publicURL != "" {
					u = buildPublicURL(cfg.s3, rawKey)
				} else {
					u, _ = getSignedDownloadURL(rawKey, 86400)
				}
				rawCh <- s3Result{url: u, key: rawKey}
			}()
		} else {
			rawCh <- s3Result{}
		}

		comp := <-compCh
		if comp.err != nil {
			log.Printf("[Storage] S3 upload failed: %v", comp.err)
			return nil, comp.err
		}

		result := &uploadResult{URL: comp.url, Key: comp.key}
		raw := <-rawCh
		if raw.key != "" {
			result.RawURL = raw.url
			result.RawKey = raw.key
		}
		return result, nil
	}

	// Local storage
	localKey := uid + compressedExt
	if err := os.MkdirAll(cfg.uploadDir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(cfg.uploadDir, localKey), compressedData, 0o644); err != nil {
		return nil, err
	}

	result := &uploadResult{
		URL: cfg.publicPath + "/" + localKey,
		Key: localKey,
	}

	// Store raw copy for images
	if isImageMIME(contentType) {
		rawLocalKey := "raw/" + uid + origExt
		rawDir := filepath.Join(cfg.uploadDir, "raw")
		if err := os.MkdirAll(rawDir, 0o755); err == nil {
			if err := os.WriteFile(filepath.Join(cfg.uploadDir, rawLocalKey), data, 0o644); err == nil {
				result.RawURL = cfg.publicPath + "/" + rawLocalKey
				result.RawKey = rawLocalKey
			} else {
				log.Printf("[Storage] Local raw write failed (non-fatal): %v", err)
			}
		}
	}
	return result, nil
}

// uploadPrefixedFile stores a media file under the given prefix with compression (images).
// S3: compressed → {prefix}/{uid}.jpg, raw → {prefix}/raw/{uid}{origExt}
// Local: compressed → {uploadDir}/{prefix}/{uid}.jpg, raw → {uploadDir}/{prefix}/raw/{uid}{origExt}
func uploadPrefixedFile(prefix, filename, contentType string, data []byte) (*uploadResult, error) {
	cfg := getStorageConfig()
	uid := uuid.NewString()
	origExt := strings.ToLower(filepath.Ext(filename))
	if origExt == "" {
		origExt = mimeToExt(contentType)
	}

	var compressedData []byte
	var compressedMIME string
	var compressedExt string

	if isImageMIME(contentType) {
		compressedData, compressedMIME = compressImage(data, contentType)
		compressedExt = ".jpg"
	} else {
		compressedData = data
		compressedMIME = contentType
		compressedExt = origExt
	}

	if cfg.typ == storageS3 && cfg.s3 != nil {
		client := getS3Client()
		compKey := prefix + "/" + uid + compressedExt

		type s3Result struct {
			url string
			key string
			err error
		}

		compCh := make(chan s3Result, 1)
		rawCh := make(chan s3Result, 1)

		go func() {
			if _, err := client.PutObject(context.Background(), &s3.PutObjectInput{
				Bucket:       aws.String(cfg.s3.bucket),
				Key:          aws.String(compKey),
				Body:         bytes.NewReader(compressedData),
				ContentType:  aws.String(compressedMIME),
				CacheControl: aws.String(s3CacheControl),
			}); err != nil {
				compCh <- s3Result{err: err}
				return
			}
			var u string
			if cfg.s3.publicURL != "" {
				u = buildPublicURL(cfg.s3, compKey)
			} else {
				u, _ = getSignedDownloadURL(compKey, 3600)
			}
			compCh <- s3Result{url: u, key: compKey}
		}()

		if isImageMIME(contentType) {
			go func() {
				rawKey := prefix + "/raw/" + uid + origExt
				if _, err := client.PutObject(context.Background(), &s3.PutObjectInput{
					Bucket:       aws.String(cfg.s3.bucket),
					Key:          aws.String(rawKey),
					Body:         bytes.NewReader(data),
					ContentType:  aws.String(contentType),
					CacheControl: aws.String(s3CacheControl),
				}); err != nil {
					log.Printf("[Storage] S3 %s raw upload failed (non-fatal): %v", prefix, err)
					rawCh <- s3Result{}
					return
				}
				var u string
				if cfg.s3.publicURL != "" {
					u = buildPublicURL(cfg.s3, rawKey)
				} else {
					u, _ = getSignedDownloadURL(rawKey, 86400)
				}
				rawCh <- s3Result{url: u, key: rawKey}
			}()
		} else {
			rawCh <- s3Result{}
		}

		comp := <-compCh
		if comp.err != nil {
			log.Printf("[Storage] S3 moment upload failed: %v", comp.err)
			return nil, comp.err
		}

		result := &uploadResult{URL: comp.url, Key: comp.key}
		raw := <-rawCh
		if raw.key != "" {
			result.RawURL = raw.url
			result.RawKey = raw.key
		}
		return result, nil
	}

	// Local storage — prefixed subfolder
	compKey := prefix + "/" + uid + compressedExt
	compPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(compKey))
	if err := os.MkdirAll(filepath.Dir(compPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(compPath, compressedData, 0o644); err != nil {
		return nil, err
	}

	result := &uploadResult{
		URL: cfg.publicPath + "/" + compKey,
		Key: compKey,
	}

	// Store raw copy for images
	if isImageMIME(contentType) {
		rawKey := prefix + "/raw/" + uid + origExt
		rawPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(rawKey))
		if err := os.MkdirAll(filepath.Dir(rawPath), 0o755); err == nil {
			if err := os.WriteFile(rawPath, data, 0o644); err == nil {
				result.RawURL = cfg.publicPath + "/" + rawKey
				result.RawKey = rawKey
			} else {
				log.Printf("[Storage] Local %s raw write failed (non-fatal): %v", prefix, err)
			}
		}
	}
	return result, nil
}

func uploadMomentFile(filename, contentType string, data []byte) (*uploadResult, error) {
	return uploadPrefixedFile("moments", filename, contentType, data)
}

func uploadHealthFile(filename, contentType string, data []byte) (*uploadResult, error) {
	return uploadPrefixedFile("health", filename, contentType, data)
}

func deleteFile(key string) error {
	cfg := getStorageConfig()
	if cfg.typ == storageS3 && cfg.s3 != nil {
		client := getS3Client()
		_, err := client.DeleteObject(context.Background(), &s3.DeleteObjectInput{
			Bucket: aws.String(cfg.s3.bucket),
			Key:    aws.String(key),
		})
		return err
	}
	// Local: key can be "uuid.ext" (flat) or "subdir/uuid.ext" (with subdirectory)
	filePath := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
	if _, err := os.Stat(filePath); err == nil {
		return os.Remove(filePath)
	}
	return nil
}

func getSignedDownloadURL(key string, expiresInSec int64) (string, error) {
	cfg := getStorageConfig()
	if cfg.typ == storageS3 && cfg.s3 != nil {
		client := getS3Client()
		presign := s3.NewPresignClient(client)
		req, err := presign.PresignGetObject(context.Background(), &s3.GetObjectInput{
			Bucket: aws.String(cfg.s3.bucket),
			Key:    aws.String(key),
		}, func(o *s3.PresignOptions) {
			o.Expires = time.Duration(expiresInSec) * time.Second
		})
		if err != nil {
			return "", err
		}
		return req.URL, nil
	}
	// Local: use the key directly as URL path (supports subdirectories)
	return cfg.publicPath + "/" + key, nil
}

// toStorageKey extracts the S3 key from a stored value or historical full URL.
func toStorageKey(input string) string {
	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		return input
	}
	if input == "" {
		return input
	}
	if !httpSchemeRe.MatchString(input) {
		return strings.TrimLeft(input, "/")
	}
	u, err := url.Parse(input)
	if err != nil {
		return input
	}
	p, err := url.PathUnescape(u.Path)
	if err != nil {
		p = u.Path
	}
	p = strings.TrimLeft(p, "/")
	bucketPrefix := cfg.s3.bucket + "/"
	if cfg.s3.bucket != "" && strings.HasPrefix(p, bucketPrefix) {
		p = strings.TrimPrefix(p, bucketPrefix)
	}
	return p
}

func toStorageKeys(arr []string) []string {
	out := make([]string, 0, len(arr))
	for _, s := range arr {
		out = append(out, toStorageKey(s))
	}
	return out
}

func toDisplayURL(stored string, expiresInSec int64) (string, error) {
	cfg := getStorageConfig()
	if cfg.typ != storageS3 || cfg.s3 == nil {
		if stored == "" {
			return stored, nil
		}
		if !httpSchemeRe.MatchString(stored) && !strings.HasPrefix(stored, cfg.publicPath) {
			return cfg.publicPath + "/" + stored, nil
		}
		return stored, nil
	}
	if stored == "" {
		return stored, nil
	}
	key := toStorageKey(stored)
	if cfg.s3.publicURL != "" {
		return buildPublicURL(cfg.s3, key), nil
	}
	return getSignedDownloadURL(key, expiresInSec)
}

func toDisplayURLs(arr []string) []string {
	out := make([]string, 0, len(arr))
	for _, s := range arr {
		u, err := toDisplayURL(s, 86400)
		if err != nil {
			u = s
		}
		out = append(out, u)
	}
	return out
}

func diffRemovedKeys(oldValues, newValues []string) []string {
	oldKeys := toStorageKeys(oldValues)
	keep := map[string]bool{}
	for _, k := range toStorageKeys(newValues) {
		keep[k] = true
	}
	var removed []string
	for _, k := range oldKeys {
		if !keep[k] {
			removed = append(removed, k)
		}
	}
	return removed
}

func deleteFilesBestEffort(values []string) {
	if len(values) == 0 {
		return
	}
	for _, key := range toStorageKeys(values) {
		if err := deleteFile(key); err != nil {
			log.Printf("[Storage] Failed to delete file: %s %v", key, err)
		}
	}
}

// uploadToS3Async compresses and uploads a file to S3 using pre-determined keys.
// Used by the async upload path — key and rawKey are already assigned by the handler.
func uploadToS3Async(s3cfg *s3Config, compKey, rawKey, contentType string, data []byte) error {
	client := getS3Client()

	var compressedData []byte
	var compressedMIME string

	if isImageMIME(contentType) {
		compressedData, compressedMIME = compressImage(data, contentType)
	} else {
		compressedData = data
		compressedMIME = contentType
	}

	type result struct{ err error }
	compCh := make(chan result, 1)
	rawCh := make(chan result, 1)

	go func() {
		_, err := client.PutObject(context.Background(), &s3.PutObjectInput{
			Bucket:       aws.String(s3cfg.bucket),
			Key:          aws.String(compKey),
			Body:         bytes.NewReader(compressedData),
			ContentType:  aws.String(compressedMIME),
			CacheControl: aws.String(s3CacheControl),
		})
		compCh <- result{err}
	}()

	if rawKey != "" && isImageMIME(contentType) {
		go func() {
			_, err := client.PutObject(context.Background(), &s3.PutObjectInput{
				Bucket:       aws.String(s3cfg.bucket),
				Key:          aws.String(rawKey),
				Body:         bytes.NewReader(data),
				ContentType:  aws.String(contentType),
				CacheControl: aws.String(s3CacheControl),
			})
			if err != nil {
				log.Printf("[Storage] S3 async raw upload failed (non-fatal): %v", err)
			}
			rawCh <- result{nil}
		}()
	} else {
		rawCh <- result{}
	}

	compRes := <-compCh
	<-rawCh
	return compRes.err
}

// localUploadPath returns the filesystem path for a local storage key.
// Kept for legacy usage in tests.
func localUploadPath(cfg storageConfig, key string) string {
	return filepath.Join(cfg.uploadDir, filepath.FromSlash(path.Base(key)))
}
