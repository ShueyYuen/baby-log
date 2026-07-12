package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	s3sdk "github.com/aws/aws-sdk-go-v2/service/s3"

	openapi "github.com/alibabacloud-go/darabonba-openapi/v2/client"
	ocr "github.com/alibabacloud-go/ocr-api-20210707/v3/client"
	"github.com/alibabacloud-go/tea/tea"
)

var (
	ocrClient     *ocr.Client
	ocrClientOnce sync.Once
	ocrInitErr    error
)

// ocrCache stores OCR results from background processing during uploads.
// Key: storage key, Value: *ocrCacheEntry
var ocrCache sync.Map

type ocrCacheEntry struct {
	text      string
	err       error
	done      chan struct{} // closed when OCR completes
	expiresAt time.Time
}

const ocrCacheTTL = 10 * time.Minute
const ocrMaxConcurrent = 3

var ocrSem = make(chan struct{}, ocrMaxConcurrent)

// ocrEnqueueBackground starts OCR for the given data in a background goroutine.
// Results are cached so that handleOCRRecognize can retrieve them without re-downloading.
func ocrEnqueueBackground(key string, data []byte) {
	entry := &ocrCacheEntry{
		done:      make(chan struct{}),
		expiresAt: time.Now().Add(ocrCacheTTL),
	}
	ocrCache.Store(key, entry)

	go func() {
		defer close(entry.done)
		ocrSem <- struct{}{}
		defer func() { <-ocrSem }()

		text, err := ocrFromStream(bytes.NewReader(data))
		entry.text = text
		entry.err = err
		if err != nil {
			log.Printf("[OCR] background failed for %s: %v", key, err)
		} else {
			log.Printf("[OCR] background done for %s (%d chars)", key, len(text))
		}
	}()
}

// ocrGetCached waits for a cached OCR result (with timeout). Returns text, ok.
func ocrGetCached(key string, timeout time.Duration) (string, bool) {
	val, ok := ocrCache.Load(key)
	if !ok {
		return "", false
	}
	entry := val.(*ocrCacheEntry)
	if time.Now().After(entry.expiresAt) {
		ocrCache.Delete(key)
		return "", false
	}
	select {
	case <-entry.done:
		if entry.err != nil {
			return "", false
		}
		return entry.text, true
	case <-time.After(timeout):
		return "", false
	}
}

func getOCRClient() (*ocr.Client, error) {
	ocrClientOnce.Do(func() {
		akID := os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_ID")
		akSecret := os.Getenv("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
		if akID == "" || akSecret == "" {
			ocrInitErr = fmt.Errorf("ALIBABA_CLOUD_ACCESS_KEY_ID or ALIBABA_CLOUD_ACCESS_KEY_SECRET not set")
			log.Println("[OCR] Alibaba Cloud credentials not configured, OCR disabled")
			return
		}
		endpoint := os.Getenv("ALIBABA_CLOUD_OCR_ENDPOINT")
		if endpoint == "" {
			endpoint = "ocr-api.cn-hangzhou.aliyuncs.com"
		}
		config := &openapi.Config{
			AccessKeyId:     tea.String(akID),
			AccessKeySecret: tea.String(akSecret),
			Endpoint:        tea.String(endpoint),
		}
		ocrClient, ocrInitErr = ocr.NewClient(config)
		if ocrInitErr != nil {
			log.Printf("[OCR] Failed to init Alibaba Cloud OCR client: %v", ocrInitErr)
		} else {
			log.Printf("[OCR] Alibaba Cloud OCR ready (endpoint: %s)", endpoint)
		}
	})
	return ocrClient, ocrInitErr
}

func isOCRAvailable() bool {
	c, err := getOCRClient()
	return c != nil && err == nil
}

type ocrResult struct {
	Content string `json:"content"`
}

func ocrFromStream(r io.Reader) (string, error) {
	client, err := getOCRClient()
	if err != nil {
		return "", err
	}
	req := &ocr.RecognizeGeneralRequest{
		Body: r,
	}
	resp, err := client.RecognizeGeneral(req)
	if err != nil {
		return "", fmt.Errorf("aliyun ocr: %w", err)
	}
	return extractOCRText(resp.Body.Data), nil
}

func extractOCRText(data *string) string {
	if data == nil {
		return ""
	}
	raw := tea.StringValue(data)
	var result ocrResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return strings.TrimSpace(raw)
	}
	return strings.TrimSpace(result.Content)
}

func ocrImageByKey(key string) (string, error) {
	cfg := getStorageConfig()

	if cfg.typ == storageS3 && cfg.s3 != nil {
		client := getS3Client()
		out, err := client.GetObject(context.Background(), &s3sdk.GetObjectInput{
			Bucket: aws.String(cfg.s3.bucket),
			Key:    aws.String(key),
		})
		if err != nil {
			return "", fmt.Errorf("s3 get: %w", err)
		}
		defer out.Body.Close()
		return ocrFromStream(out.Body)
	}

	localPath := filepath.Join(cfg.uploadDir, key)
	f, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("open file: %w", err)
	}
	defer f.Close()
	return ocrFromStream(f)
}

// POST /medical-visits/{id}/ocr
func handleMedicalVisitOCR(w http.ResponseWriter, r *http.Request) {
	if !isOCRAvailable() {
		writeErr(w, http.StatusServiceUnavailable, "OCR service not available")
		return
	}

	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID, imagesJSON string
	if err := db.QueryRow(`SELECT "babyId", "images" FROM "MedicalVisit" WHERE id = ?`, id).Scan(&babyID, &imagesJSON); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(babyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	var imgs []mvImage
	if err := json.Unmarshal([]byte(imagesJSON), &imgs); err != nil || len(imgs) == 0 {
		writeErr(w, http.StatusBadRequest, "No images to process")
		return
	}

	var texts []string
	var ocrItems []ocrDataItem
	for _, img := range imgs {
		key := img.Key
		if img.RawKey != "" {
			key = img.RawKey
		}
		text, err := ocrImageByKey(key)
		if err != nil {
			log.Printf("[OCR] Failed for key %s: %v", key, err)
			ocrItems = append(ocrItems, ocrDataItem{Key: img.Key, Text: ""})
			continue
		}
		ocrItems = append(ocrItems, ocrDataItem{Key: img.Key, Text: text})
		if text != "" {
			texts = append(texts, text)
		}
	}

	ocrText := strings.Join(texts, "\n\n")
	ocrDataJSON, _ := json.Marshal(ocrItems)
	now := nowMillis()
	if _, err := db.Exec(`UPDATE "MedicalVisit" SET "ocrText" = ?, "ocrData" = ?, "updatedAt" = ? WHERE id = ?`,
		ocrText, string(ocrDataJSON), int64(now), id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	writeOK(w, map[string]interface{}{
		"ocrText":    ocrText,
		"ocrData":    ocrItems,
		"imageCount": len(imgs),
		"recognized": len(texts),
	})
}

// POST /ocr/recognize — stateless OCR, does not save to DB.
// Checks the background OCR cache first; processes remaining images concurrently.
func handleOCRRecognize(w http.ResponseWriter, r *http.Request) {
	if !isOCRAvailable() {
		writeErr(w, http.StatusServiceUnavailable, "OCR service not available")
		return
	}

	var body struct {
		Images []mvImage `json:"images"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.Images) == 0 {
		writeErr(w, http.StatusBadRequest, "images required")
		return
	}

	type indexedResult struct {
		idx  int
		item ocrDataItem
	}

	results := make([]ocrDataItem, len(body.Images))
	var needProcess []int

	for i, img := range body.Images {
		lookupKey := img.Key
		if img.RawKey != "" {
			lookupKey = img.RawKey
		}
		if text, ok := ocrGetCached(lookupKey, 30*time.Second); ok {
			results[i] = ocrDataItem{Key: img.Key, Text: text}
			ocrCache.Delete(lookupKey)
		} else {
			needProcess = append(needProcess, i)
		}
	}

	if len(needProcess) > 0 {
		ch := make(chan indexedResult, len(needProcess))
		var wg sync.WaitGroup
		for _, idx := range needProcess {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				ocrSem <- struct{}{}
				defer func() { <-ocrSem }()

				img := body.Images[i]
				key := img.Key
				if img.RawKey != "" {
					key = img.RawKey
				}
				text, err := ocrImageByKey(key)
				if err != nil {
					log.Printf("[OCR] Failed for key %s: %v", key, err)
					ch <- indexedResult{i, ocrDataItem{Key: img.Key, Text: ""}}
					return
				}
				ch <- indexedResult{i, ocrDataItem{Key: img.Key, Text: text}}
			}(idx)
		}
		go func() { wg.Wait(); close(ch) }()
		for res := range ch {
			results[res.idx] = res.item
		}
	}

	var texts []string
	for _, item := range results {
		if item.Text != "" {
			texts = append(texts, item.Text)
		}
	}

	writeOK(w, map[string]interface{}{
		"ocrText":    strings.Join(texts, "\n\n"),
		"ocrData":    results,
		"imageCount": len(body.Images),
		"recognized": len(texts),
	})
}

// GET /ocr/status
func handleOCRStatus(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]interface{}{
		"available": isOCRAvailable(),
	})
}
