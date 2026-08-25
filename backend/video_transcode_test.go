package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseFPS(t *testing.T) {
	if parseFPS("30000/1001") < 29 || parseFPS("30000/1001") > 30 {
		t.Fatalf("ntsc fps=%v", parseFPS("30000/1001"))
	}
	if parseFPS("30/1") != 30 {
		t.Fatalf("30/1=%v", parseFPS("30/1"))
	}
	if parseFPS("0/0") != 0 || parseFPS("") != 0 {
		t.Fatal("zero fps")
	}
}

func TestPixFmtNeedsTranscode(t *testing.T) {
	if pixFmtNeedsTranscode("yuv420p") || pixFmtNeedsTranscode("yuvj420p") {
		t.Fatal("8-bit 420 should be ok")
	}
	if !pixFmtNeedsTranscode("yuv420p10le") || !pixFmtNeedsTranscode("yuv422p") {
		t.Fatal("10-bit / 422 should transcode")
	}
}

func TestVideoAction(t *testing.T) {
	hevc := videoProbe{HasVideo: true, VideoCodec: "hevc", PixFmt: "yuvj420p", Width: 720, Height: 1280, FPS: 60, HasAudio: true, AudioCodec: "aac"}
	if videoAction(hevc) != "transcode" {
		t.Fatalf("hevc action=%s", videoAction(hevc))
	}
	h264 := videoProbe{HasVideo: true, VideoCodec: "h264", VideoProfile: "High", PixFmt: "yuv420p", Width: 720, Height: 1280, FPS: 30, HasAudio: true, AudioCodec: "aac"}
	if videoAction(h264) != "remux" {
		t.Fatalf("h264 action=%s", videoAction(h264))
	}
	h264_10 := h264
	h264_10.PixFmt = "yuv420p10le"
	if videoAction(h264_10) != "transcode" {
		t.Fatal("10-bit h264")
	}
	vp9 := videoProbe{HasVideo: true, VideoCodec: "vp9", PixFmt: "yuv420p"}
	if videoAction(vp9) != "skip" {
		t.Fatalf("vp9 action=%s", videoAction(vp9))
	}
	if videoAction(videoProbe{}) != "skip" {
		t.Fatal("no video")
	}
}

func TestBuildTranscodeArgsAreSingleThreaded(t *testing.T) {
	p := videoProbe{HasVideo: true, HasAudio: true, FPS: 60, Width: 1920, Height: 1080}
	args := buildTranscodeArgs("in.mp4", "out.mp4", p)
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-threads 1") {
		t.Fatal("missing ffmpeg -threads 1")
	}
	if !strings.Contains(joined, "-filter_threads 1") {
		t.Fatal("missing filter_threads 1")
	}
	if !strings.Contains(joined, "threads=1") {
		t.Fatal("missing x264 threads=1")
	}
	if !strings.Contains(joined, "fps=30") {
		t.Fatal("60fps source should be capped")
	}
	if !strings.Contains(joined, "veryfast") {
		t.Fatal("expected veryfast preset")
	}
	if !strings.Contains(joined, "-map 0:a:0") {
		t.Fatal("audio map")
	}
}

func TestPosterSeekSeconds(t *testing.T) {
	if posterSeekSeconds(20) != 0.5 {
		t.Fatalf("got %v", posterSeekSeconds(20))
	}
	if posterSeekSeconds(2) != 0.1 {
		t.Fatalf("got %v", posterSeekSeconds(2))
	}
}

func TestVideoTranscodeDisabledByEnv(t *testing.T) {
	t.Setenv("VIDEO_TRANSCODE", "0")
	if videoTranscodeEnabled() {
		t.Fatal("expected disabled")
	}
}

func haveFFmpeg() bool {
	_, e1 := exec.LookPath("ffmpeg")
	_, e2 := exec.LookPath("ffprobe")
	return e1 == nil && e2 == nil
}

func haveEncoder(t *testing.T, name string) bool {
	t.Helper()
	out, err := exec.Command("ffmpeg", "-hide_banner", "-encoders").CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), name)
}

func ffmpegGen(t *testing.T, dest, vcodec string, faststart bool) {
	t.Helper()
	args := []string{
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=0.4",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=0.4",
		"-c:v", vcodec, "-pix_fmt", "yuv420p", "-c:a", "aac",
	}
	if vcodec == "libx265" {
		args = append(args, "-tag:v", "hvc1")
	}
	if faststart {
		args = append(args, "-movflags", "+faststart")
	}
	args = append(args, dest)
	if out, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg gen: %v %s", err, out)
	}
}

func TestPrepareVideoTranscodesHEVC(t *testing.T) {
	if !haveFFmpeg() {
		t.Skip("ffmpeg not installed")
	}
	if !haveEncoder(t, "libx265") {
		t.Skip("libx265 not available")
	}
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	src := filepath.Join(dir, "clip.mp4")
	ffmpegGen(t, src, "libx265", false)
	action, err := prepareVideoForWeb(src, "moments/clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if action != "transcode" {
		t.Fatalf("action=%s", action)
	}
	p, err := probeVideoFile(src)
	if err != nil {
		t.Fatal(err)
	}
	if p.VideoCodec != "h264" {
		t.Fatalf("codec=%s", p.VideoCodec)
	}
	poster := filepath.Join(dir, "moments", "clip.poster.jpg")
	st, err := os.Stat(poster)
	if err != nil || st.Size() < 50 {
		t.Fatalf("poster missing: %v", err)
	}
}

func TestPrepareVideoRemuxesH264(t *testing.T) {
	if !haveFFmpeg() {
		t.Skip("ffmpeg not installed")
	}
	dir := t.TempDir()
	t.Setenv("UPLOAD_DIR", dir)
	src := filepath.Join(dir, "ok.mp4")
	ffmpegGen(t, src, "libx264", false)
	action, err := prepareVideoForWeb(src, "moments/ok.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if action != "remux" {
		t.Fatalf("action=%s", action)
	}
	if _, err := os.Stat(filepath.Join(dir, "moments", "ok.poster.jpg")); err != nil {
		t.Fatalf("poster: %v", err)
	}
}
