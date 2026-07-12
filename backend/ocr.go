package main

import (
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

// POST /ocr/recognize — stateless OCR, does not save to DB
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

	var texts []string
	var ocrItems []ocrDataItem
	for _, img := range body.Images {
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

	writeOK(w, map[string]interface{}{
		"ocrText":    strings.Join(texts, "\n\n"),
		"ocrData":    ocrItems,
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
