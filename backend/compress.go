package main

import (
	"bytes"
	"image"
	"image/jpeg"
	_ "image/gif"
	_ "image/png"
	"log"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	maxImageDimension = 1920
	jpegQuality       = 85
)

// compressSem limits concurrent image compression to prevent OOM/CPU saturation
// on small servers (phone photos decode to tens of MB of RGBA).
var compressSem = make(chan struct{}, 1)

func isImageMIME(contentType string) bool {
	return strings.HasPrefix(contentType, "image/")
}

func mimeToExt(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/heic", "image/heif":
		return ".heic"
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "video/x-msvideo":
		return ".avi"
	case "video/3gpp":
		return ".3gp"
	default:
		return ".bin"
	}
}

// compressImage decodes an image, resizes if larger than maxImageDimension,
// and re-encodes as JPEG at quality 85. Returns original data on any failure.
// Concurrency is limited by compressSem to prevent OOM on small servers.
func compressImage(data []byte, contentType string) (out []byte, outMIME string) {
	compressSem <- struct{}{}
	defer func() { <-compressSem }()

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return data, contentType
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return data, contentType
	}
	// 48MP phone photos decode to ~200MB RGBA; skip resize and keep the
	// already-compressed original to avoid OOM on 2GB hosts.
	if int64(cfg.Width)*int64(cfg.Height) > 20_000_000 {
		log.Printf("[Compress] skip huge image %dx%d", cfg.Width, cfg.Height)
		return data, contentType
	}

	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, contentType
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()

	if w > maxImageDimension || h > maxImageDimension {
		scaleW := float64(maxImageDimension) / float64(w)
		scaleH := float64(maxImageDimension) / float64(h)
		scale := scaleW
		if scaleH < scale {
			scale = scaleH
		}
		nw := clampMin(1, int(float64(w)*scale))
		nh := clampMin(1, int(float64(h)*scale))
		dst := image.NewNRGBA(image.Rect(0, 0, nw, nh))
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Over, nil)
		img = dst
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
		return data, contentType
	}
	return buf.Bytes(), "image/jpeg"
}

func clampMin(min, v int) int {
	if v < min {
		return min
	}
	return v
}
