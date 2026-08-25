package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Tuned for a 2C/4G box: one job at a time, single x264 thread, 30fps, 1280 long-edge.
const (
	defaultTranscodePreset  = "veryfast"
	defaultTranscodeCRF     = 28
	defaultTranscodeMaxEdge = 1280
	defaultTranscodeMaxFPS  = 30
	defaultTranscodeTimeout = 8 * time.Minute
	defaultPosterWidth      = 480
	defaultAudioBitrate     = "96k"
	transcodeProbeTimeout   = 30 * time.Second
)

var transcodeSem = make(chan struct{}, 1)

var (
	ffmpegOnce  sync.Once
	ffmpegPath  string
	ffprobePath string
	ffmpegFound bool
)

type videoProbe struct {
	HasVideo     bool
	HasAudio     bool
	VideoCodec   string
	VideoProfile string
	PixFmt       string
	Width        int
	Height       int
	FPS          float64
	Duration     float64
	AudioCodec   string
}

type ffprobeJSON struct {
	Streams []ffprobeStream `json:"streams"`
	Format  ffprobeFormat   `json:"format"`
}

type ffprobeStream struct {
	CodecType    string `json:"codec_type"`
	CodecName    string `json:"codec_name"`
	Profile      string `json:"profile"`
	PixFmt       string `json:"pix_fmt"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	AvgFrameRate string `json:"avg_frame_rate"`
	RFrameRate   string `json:"r_frame_rate"`
}

type ffprobeFormat struct {
	Duration string `json:"duration"`
}

var h264UnsafeProfiles = map[string]bool{
	"high 10":               true,
	"high 10 intra":         true,
	"high 4:2:2":            true,
	"high 4:2:2 intra":      true,
	"high 4:4:4":            true,
	"high 4:4:4 predictive": true,
	"high 4:4:4 intra":      true,
	"cavlc 4:4:4 intra":     true,
}

func lookupFFmpeg() {
	ffmpegOnce.Do(func() {
		ffmpegPath, _ = exec.LookPath("ffmpeg")
		ffprobePath, _ = exec.LookPath("ffprobe")
		ffmpegFound = ffmpegPath != "" && ffprobePath != ""
		if ffmpegFound {
			log.Printf("[Video] ffmpeg=%s ffprobe=%s", ffmpegPath, ffprobePath)
		} else {
			log.Printf("[Video] ffmpeg/ffprobe not found; uploads will be stored as-is")
		}
	})
}

func videoTranscodeEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("VIDEO_TRANSCODE")))
	if v == "0" || v == "false" || v == "off" || v == "no" {
		return false
	}
	lookupFFmpeg()
	return ffmpegFound
}

func transcodePreset() string {
	if p := strings.TrimSpace(os.Getenv("VIDEO_TRANSCODE_PRESET")); p != "" {
		return p
	}
	return defaultTranscodePreset
}

func transcodeCRF() int {
	if v := strings.TrimSpace(os.Getenv("VIDEO_TRANSCODE_CRF")); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil && n >= 18 && n <= 35 {
			return n
		}
	}
	return defaultTranscodeCRF
}

func transcodeMaxEdge() int {
	if v := strings.TrimSpace(os.Getenv("VIDEO_TRANSCODE_MAX_EDGE")); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil && n >= 480 && n <= 1920 {
			return n
		}
	}
	return defaultTranscodeMaxEdge
}

func transcodeTimeout() time.Duration {
	if v := strings.TrimSpace(os.Getenv("VIDEO_TRANSCODE_TIMEOUT_SEC")); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil && n >= 30 {
			return time.Duration(n) * time.Second
		}
	}
	return defaultTranscodeTimeout
}

func parseFPS(raw string) float64 {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "0/0" || raw == "N/A" {
		return 0
	}
	if strings.Contains(raw, "/") {
		parts := strings.SplitN(raw, "/", 2)
		a, err1 := strconv.ParseFloat(parts[0], 64)
		b, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 == nil && err2 == nil && b != 0 {
			return a / b
		}
		return 0
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0
	}
	return n
}

func pixFmtNeedsTranscode(pix string) bool {
	p := strings.ToLower(pix)
	if p == "" {
		return false
	}
	if strings.Contains(p, "10") || strings.Contains(p, "12") || strings.Contains(p, "16") {
		return true
	}
	if strings.Contains(p, "444") || strings.Contains(p, "422") {
		return true
	}
	return false
}

func videoAction(p videoProbe) string {
	if !p.HasVideo {
		return "skip"
	}
	codec := strings.ToLower(p.VideoCodec)
	profile := strings.ToLower(p.VideoProfile)
	switch codec {
	case "h264":
		if h264UnsafeProfiles[profile] || pixFmtNeedsTranscode(p.PixFmt) {
			return "transcode"
		}
		if p.HasAudio && p.AudioCodec != "" && p.AudioCodec != "aac" && p.AudioCodec != "mp3" {
			return "transcode"
		}
		return "remux"
	case "vp8", "vp9", "av1", "theora":
		return "skip"
	default:
		return "transcode"
	}
}

func probeVideoFile(path string) (videoProbe, error) {
	lookupFFmpeg()
	if ffprobePath == "" {
		return videoProbe{}, fmt.Errorf("ffprobe not found")
	}
	ctx, cancel := context.WithTimeout(context.Background(), transcodeProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "error",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		path,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return videoProbe{}, fmt.Errorf("ffprobe: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	var raw ffprobeJSON
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		return videoProbe{}, err
	}
	var p videoProbe
	if raw.Format.Duration != "" {
		p.Duration, _ = strconv.ParseFloat(raw.Format.Duration, 64)
	}
	for _, s := range raw.Streams {
		switch s.CodecType {
		case "video":
			if p.HasVideo {
				continue
			}
			p.HasVideo = true
			p.VideoCodec = s.CodecName
			p.VideoProfile = s.Profile
			p.PixFmt = s.PixFmt
			p.Width = s.Width
			p.Height = s.Height
			p.FPS = parseFPS(s.AvgFrameRate)
			if p.FPS == 0 {
				p.FPS = parseFPS(s.RFrameRate)
			}
		case "audio":
			if p.HasAudio {
				continue
			}
			p.HasAudio = true
			p.AudioCodec = s.CodecName
		}
	}
	return p, nil
}

func transcodeFilter(p videoProbe) string {
	edge := transcodeMaxEdge()
	parts := []string{
		fmt.Sprintf("scale='min(%d,iw)':'min(%d,ih)':force_original_aspect_ratio=decrease", edge, edge),
		"scale=trunc(iw/2)*2:trunc(ih/2)*2",
		"format=yuv420p",
	}
	if p.FPS > float64(defaultTranscodeMaxFPS)+0.5 {
		parts = append([]string{fmt.Sprintf("fps=%d", defaultTranscodeMaxFPS)}, parts...)
	}
	return strings.Join(parts, ",")
}

func buildTranscodeArgs(src, dst string, p videoProbe) []string {
	args := []string{
		"-y", "-nostdin", "-hide_banner", "-loglevel", "error",
		"-threads", "1",
		"-filter_threads", "1",
		"-i", src,
		"-map", "0:v:0",
	}
	if p.HasAudio {
		args = append(args, "-map", "0:a:0")
	}
	args = append(args,
		"-c:v", "libx264",
		"-preset", transcodePreset(),
		"-crf", strconv.Itoa(transcodeCRF()),
		"-profile:v", "high",
		"-level", "4.0",
		"-pix_fmt", "yuv420p",
		"-x264-params", "threads=1:sliced-threads=0:sync-lookahead=0:rc-lookahead=10:lookahead-threads=1",
		"-vf", transcodeFilter(p),
		"-max_muxing_queue_size", "1024",
	)
	if p.HasAudio {
		args = append(args, "-c:a", "aac", "-b:a", defaultAudioBitrate, "-ac", "2")
	}
	args = append(args, "-movflags", "+faststart", "-brand", "mp42", "-f", "mp4", dst)
	return args
}

func buildRemuxArgs(src, dst string, hasAudio bool) []string {
	args := []string{
		"-y", "-nostdin", "-hide_banner", "-loglevel", "error",
		"-i", src,
		"-map", "0:v:0",
	}
	if hasAudio {
		args = append(args, "-map", "0:a:0")
	}
	args = append(args, "-c", "copy", "-movflags", "+faststart", "-f", "mp4", dst)
	return args
}

func ffmpegCommand(ctx context.Context, args []string) *exec.Cmd {
	if nicePath, err := exec.LookPath("nice"); err == nil {
		return exec.CommandContext(ctx, nicePath, append([]string{"-n", "19", ffmpegPath}, args...)...)
	}
	return exec.CommandContext(ctx, ffmpegPath, args...)
}

func runFFmpeg(args []string, timeout time.Duration) error {
	lookupFFmpeg()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := ffmpegCommand(ctx, args)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("ffmpeg timed out after %s", timeout)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("ffmpeg: %s", msg)
	}
	return nil
}

func posterSeekSeconds(duration float64) float64 {
	if duration > 0 {
		t := duration * 0.05
		if t > 0.5 {
			t = 0.5
		}
		return t
	}
	return 0.1
}

func writeVideoPoster(src, dest string, duration float64) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	args := []string{
		"-y", "-nostdin", "-hide_banner", "-loglevel", "error",
		"-threads", "1",
		"-i", src,
		"-ss", strconv.FormatFloat(posterSeekSeconds(duration), 'f', 3, 64),
		"-frames:v", "1",
		"-vf", fmt.Sprintf("scale='min(%d,iw)':-2", defaultPosterWidth),
		"-q:v", "4",
		"-f", "image2",
		dest,
	}
	if err := runFFmpeg(args, 45*time.Second); err != nil {
		return err
	}
	st, err := os.Stat(dest)
	if err != nil || st.Size() == 0 {
		return fmt.Errorf("empty poster")
	}
	return nil
}

// prepareVideoForWeb remuxes or transcodes in place and writes a sibling .poster.jpg.
// On failure the original file is left untouched.
func prepareVideoForWeb(localPath, key string) (action string, err error) {
	if _, err := os.Stat(localPath); err != nil {
		return "skip", err
	}
	p, err := probeVideoFile(localPath)
	if err != nil {
		return "skip", err
	}
	action = videoAction(p)
	work := localPath
	switch action {
	case "transcode", "remux":
		tmp := localPath + ".web.mp4"
		defer os.Remove(tmp)
		var args []string
		if action == "transcode" {
			args = buildTranscodeArgs(localPath, tmp, p)
		} else {
			args = buildRemuxArgs(localPath, tmp, p.HasAudio)
		}
		timeout := transcodeTimeout()
		if action == "remux" {
			timeout = 2 * time.Minute
		}
		if err := runFFmpeg(args, timeout); err != nil {
			return action, err
		}
		if err := os.Rename(tmp, localPath); err != nil {
			return action, err
		}
		work = localPath
	case "skip":
		work = localPath
	}
	if pk := posterKeyFromVideoKey(key); pk != "" {
		posterPath := filepath.Join(getStorageConfig().uploadDir, filepath.FromSlash(pk))
		if st, err := os.Stat(posterPath); err == nil && st.Size() > 0 {
			// Keep a client-uploaded cover.
		} else if err := writeVideoPoster(work, posterPath, p.Duration); err != nil {
			log.Printf("[Video] poster %s: %v", key, err)
		} else {
			trackUploadedFile(pk, "")
		}
	}
	return action, nil
}

func enqueueVideoPrepareAndSync(localPath, key string) {
	if localPath == "" || key == "" {
		return
	}
	enabled := videoTranscodeEnabled()
	needS3 := false
	if cfg := getStorageConfig(); cfg.typ == storageS3 && cfg.s3 != nil {
		needS3 = true
	}
	if !enabled && !needS3 {
		return
	}
	go func() {
		// Publish the original first so S3 playback is not blocked by the transcode queue.
		if needS3 {
			if _, err := os.Stat(localPath); err == nil {
				syncFileToS3Typed(localPath, key, mimeFromExt(filepath.Ext(key)))
			}
		}
		if !enabled {
			return
		}

		transcodeSem <- struct{}{}
		defer func() { <-transcodeSem }()

		if _, err := os.Stat(localPath); err != nil {
			return
		}

		rewroteMP4 := false
		action, err := prepareVideoForWeb(localPath, key)
		if err != nil {
			log.Printf("[Video] prepare %s (%s): %v — keeping original", key, action, err)
		} else if action == "transcode" || action == "remux" {
			rewroteMP4 = true
			log.Printf("[Video] %s %s", action, key)
		}

		if !needS3 {
			return
		}
		if pk := posterKeyFromVideoKey(key); pk != "" {
			posterPath := filepath.Join(getStorageConfig().uploadDir, filepath.FromSlash(pk))
			if st, err := os.Stat(posterPath); err == nil && st.Size() > 0 {
				syncFileToS3(posterPath, pk, "image")
			}
		}
		if !rewroteMP4 {
			return
		}
		if _, err := os.Stat(localPath); err != nil {
			return
		}
		syncFileToS3Typed(localPath, key, "video/mp4")
	}()
}

func enqueueS3VideoPrepare(key string) {
	if key == "" || mediaTypeFromKey(key) != "video" {
		return
	}
	if !videoTranscodeEnabled() {
		return
	}
	go func() {
		transcodeSem <- struct{}{}
		defer func() { <-transcodeSem }()

		cfg := getStorageConfig()
		if cfg.typ != storageS3 || cfg.s3 == nil {
			return
		}
		localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
		if _, err := os.Stat(localPath); err != nil {
			if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
				log.Printf("[Video] mkdir %s: %v", key, err)
				return
			}
			if err := downloadS3ToFile(key, localPath); err != nil {
				log.Printf("[Video] download %s: %v", key, err)
				return
			}
		}
		rewroteMP4 := false
		action, err := prepareVideoForWeb(localPath, key)
		if err != nil {
			log.Printf("[Video] prepare %s (%s): %v", key, action, err)
		} else if action == "transcode" || action == "remux" {
			rewroteMP4 = true
			log.Printf("[Video] %s %s", action, key)
		}
		if pk := posterKeyFromVideoKey(key); pk != "" {
			posterPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(pk))
			if st, err := os.Stat(posterPath); err == nil && st.Size() > 0 {
				syncFileToS3(posterPath, pk, "image")
			}
		}
		ct := mimeFromExt(filepath.Ext(key))
		if rewroteMP4 {
			ct = "video/mp4"
		}
		syncFileToS3Typed(localPath, key, ct)
	}()
}

func downloadS3ToFile(key, dest string) error {
	cfg := getStorageConfig()
	client := getS3Client()
	if client == nil || cfg.s3 == nil {
		return fmt.Errorf("s3 not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	out, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cfg.s3.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return err
	}
	defer out.Body.Close()
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, out.Body)
	return err
}

func syncFileToS3Typed(localPath, key, contentType string) {
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
	if contentType == "" {
		contentType = mimeFromExt(filepath.Ext(key))
	}
	if err := putToS3(key, contentType, f); err != nil {
		log.Printf("[S3Sync] Failed to upload %s to S3: %v", key, err)
		return
	}
	log.Printf("[S3Sync] Successfully synced %s to S3", key)
	if err := os.Remove(localPath); err != nil {
		log.Printf("[S3Sync] Failed to remove local file %s: %v", localPath, err)
	}
}
