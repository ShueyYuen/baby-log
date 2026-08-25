package main

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestMimeHelpers(t *testing.T) {
	if !isImageMIME("image/jpeg") || isImageMIME("video/mp4") {
		t.Fatal("isImageMIME")
	}
	if mimeToExt("image/jpeg") != ".jpg" || mimeToExt("image/png") != ".png" {
		t.Fatal("mimeToExt images")
	}
	if mimeToExt("video/mp4") != ".mp4" || mimeToExt("application/octet-stream") != ".bin" {
		t.Fatal("mimeToExt other")
	}
}

func TestCompressImageResizesAndReencodesJPEG(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 80, 40))
	for y := 0; y < 40; y++ {
		for x := 0; x < 80; x++ {
			src.Set(x, y, color.RGBA{R: 200, G: 10, B: 10, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	out, mime := compressImage(buf.Bytes(), "image/png")
	if mime != "image/jpeg" {
		t.Fatalf("expected jpeg mime, got %s", mime)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width != 80 || cfg.Height != 40 {
		t.Fatalf("small image should keep size, got %dx%d", cfg.Width, cfg.Height)
	}
}

func TestCompressImageDownscalesLargeDimension(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 2400, 100))
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	out, mime := compressImage(buf.Bytes(), "image/png")
	if mime != "image/jpeg" {
		t.Fatalf("expected jpeg, got %s", mime)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width > maxImageDimension {
		t.Fatalf("width %d exceeds max", cfg.Width)
	}
}

func TestCompressImageSkipsHugeAndInvalid(t *testing.T) {
	orig := []byte("not-an-image")
	out, mime := compressImage(orig, "image/png")
	if mime != "image/png" || !bytes.Equal(out, orig) {
		t.Fatal("invalid image should be returned unchanged")
	}

	huge := pngIHDR(5000, 5000)
	out, mime = compressImage(huge, "image/png")
	if mime != "image/png" || !bytes.Equal(out, huge) {
		t.Fatal("huge image should skip decode")
	}
}

func TestClampMin(t *testing.T) {
	if clampMin(1, 0) != 1 || clampMin(1, 5) != 5 {
		t.Fatal("clampMin")
	}
}

func pngIHDR(w, h int) []byte {
	buf := make([]byte, 0, 8+4+4+13+4)
	buf = append(buf, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:4], uint32(w))
	binary.BigEndian.PutUint32(ihdr[4:8], uint32(h))
	ihdr[8] = 8  // bit depth
	ihdr[9] = 2  // color type RGB
	chunk := append([]byte("IHDR"), ihdr...)
	lenb := make([]byte, 4)
	binary.BigEndian.PutUint32(lenb, 13)
	crc := make([]byte, 4)
	binary.BigEndian.PutUint32(crc, crc32.ChecksumIEEE(chunk))
	buf = append(buf, lenb...)
	buf = append(buf, chunk...)
	buf = append(buf, crc...)
	return buf
}
