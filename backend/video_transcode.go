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
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	videoProgressInterval   = 30 * time.Second
	videoWatchdogInterval   = 5 * time.Minute
	videoStuckAfter         = 30 * time.Minute
	ffmpegWaitDelay         = 10 * time.Second
)

var transcodeSem = make(chan struct{}, 1)

var (
	ffmpegOnce  sync.Once
	ffmpegPath  string
	ffprobePath string
	ffmpegFound bool
)

// In-flight job + queue depth so a stuck transcode is visible in logs
// without dumping ffmpeg stderr.
var (
	videoQueued       atomic.Int64
	videoJobMu        sync.Mutex
	videoJobActive    *videoJobState
	videoWatchdogOnce sync.Once
)

type videoJobState struct {
	Key       string
	Phase     string
	StartedAt time.Time
	Waited    time.Duration
}

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
			log.Printf("[Video] ffmpeg=%s ffprobe=%s timeout=%s preset=%s crf=%d maxEdge=%d",
				ffmpegPath, ffprobePath, transcodeTimeout(), transcodePreset(), transcodeCRF(), transcodeMaxEdge())
		} else {
			log.Printf("[Video] ffmpeg/ffprobe not found; uploads will be stored as-is")
		}
	})
}

func formatByteSize(n int64) string {
	const (
		kb = 1024
		mb = 1024 * 1024
		gb = 1024 * 1024 * 1024
	)
	switch {
	case n >= gb:
		return fmt.Sprintf("%.1fGB", float64(n)/float64(gb))
	case n >= mb:
		return fmt.Sprintf("%.1fMB", float64(n)/float64(mb))
	case n >= kb:
		return fmt.Sprintf("%.1fKB", float64(n)/float64(kb))
	default:
		return fmt.Sprintf("%dB", n)
	}
}

func fileSizeOf(path string) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

func localFileLog(path string) string {
	st, err := os.Stat(path)
	if err != nil {
		return "missing"
	}
	return formatByteSize(st.Size())
}

func (p videoProbe) logLine() string {
	audio := "none"
	if p.HasAudio {
		audio = p.AudioCodec
		if audio == "" {
			audio = "yes"
		}
	}
	return fmt.Sprintf("codec=%s profile=%q pix=%s %dx%d fps=%.1f dur=%.1fs audio=%s",
		p.VideoCodec, p.VideoProfile, p.PixFmt, p.Width, p.Height, p.FPS, p.Duration, audio)
}

func recoverVideoPanic(key string) {
	if r := recover(); r != nil {
		log.Printf("[Video] panic key=%s: %v\n%s", key, r, debug.Stack())
	}
}

func setVideoJobPhase(key, phase string) {
	videoJobMu.Lock()
	defer videoJobMu.Unlock()
	if videoJobActive == nil || videoJobActive.Key != key {
		videoJobActive = &videoJobState{Key: key, Phase: phase, StartedAt: time.Now()}
		return
	}
	videoJobActive.Phase = phase
}

func setVideoJobWaited(key string, waited time.Duration) {
	videoJobMu.Lock()
	defer videoJobMu.Unlock()
	if videoJobActive != nil && videoJobActive.Key == key {
		videoJobActive.Waited = waited
	}
}

func clearVideoJob(key string) {
	videoJobMu.Lock()
	defer videoJobMu.Unlock()
	if videoJobActive != nil && videoJobActive.Key == key {
		videoJobActive = nil
	}
}

func snapshotVideoJob() *videoJobState {
	videoJobMu.Lock()
	defer videoJobMu.Unlock()
	if videoJobActive == nil {
		return nil
	}
	cp := *videoJobActive
	return &cp
}

func acquireTranscodeSlot(key string) func() {
	depth := videoQueued.Add(1)
	log.Printf("[Video] queued key=%s queue_depth=%d (1 worker)", key, depth)
	waitStart := time.Now()
	transcodeSem <- struct{}{}
	waited := time.Since(waitStart)
	videoQueued.Add(-1)
	setVideoJobPhase(key, "running")
	setVideoJobWaited(key, waited)
	if waited > 500*time.Millisecond {
		log.Printf("[Video] worker acquired key=%s waited=%s", key, waited.Round(time.Millisecond))
	} else {
		log.Printf("[Video] worker acquired key=%s", key)
	}
	return func() {
		clearVideoJob(key)
		<-transcodeSem
	}
}

func logWhile(interval time.Duration, msg func(elapsed time.Duration) string) func() {
	done := make(chan struct{})
	var once sync.Once
	start := time.Now()
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				log.Printf("%s", msg(time.Since(start)))
			}
		}
	}()
	return func() { once.Do(func() { close(done) }) }
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

func runFFmpeg(label string, args []string, timeout time.Duration) error {
	lookupFFmpeg()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := ffmpegCommand(ctx, args)
	cmd.WaitDelay = ffmpegWaitDelay
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	log.Printf("[Video] ffmpeg start %s timeout=%s", label, timeout)
	stop := logWhile(videoProgressInterval, func(elapsed time.Duration) string {
		return fmt.Sprintf("[Video] ffmpeg running %s elapsed=%s timeout=%s", label, elapsed.Truncate(time.Second), timeout)
	})
	err := cmd.Run()
	stop()
	if err != nil {
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
	if err := runFFmpeg("poster "+filepath.Base(dest), args, 45*time.Second); err != nil {
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
	srcSize := fileSizeOf(localPath)
	p, err := probeVideoFile(localPath)
	if err != nil {
		log.Printf("[Video] probe failed key=%s size=%s: %v", key, formatByteSize(srcSize), err)
		return "skip", err
	}
	action = videoAction(p)
	log.Printf("[Video] probe key=%s size=%s action=%s %s", key, formatByteSize(srcSize), action, p.logLine())
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
		setVideoJobPhase(key, action)
		t0 := time.Now()
		if err := runFFmpeg(action+" "+key, args, timeout); err != nil {
			log.Printf("[Video] ffmpeg failed key=%s action=%s elapsed=%s: %v", key, action, time.Since(t0).Truncate(time.Millisecond), err)
			return action, err
		}
		outSize := fileSizeOf(tmp)
		log.Printf("[Video] ffmpeg done key=%s action=%s elapsed=%s in=%s out=%s",
			key, action, time.Since(t0).Truncate(time.Millisecond), formatByteSize(srcSize), formatByteSize(outSize))
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
			log.Printf("[Video] poster keep client cover key=%s poster=%s", key, pk)
		} else {
			setVideoJobPhase(key, "poster")
			if err := writeVideoPoster(work, posterPath, p.Duration); err != nil {
				log.Printf("[Video] poster %s: %v", key, err)
			} else {
				log.Printf("[Video] poster wrote key=%s poster=%s size=%s", key, pk, formatByteSize(fileSizeOf(posterPath)))
				trackUploadedFile(pk, "")
			}
		}
	}
	return action, nil
}

// videoReadyForS3 is true only when the object at localPath is the version we
// want CDN to pin. Originals that still need transcode must not be uploaded.
func videoReadyForS3(transcodeEnabled bool, prepareErr error) bool {
	if !transcodeEnabled {
		return true
	}
	return prepareErr == nil
}

func syncPreparedVideoToS3(localPath, key string, rewroteMP4 bool) error {
	if pk := posterKeyFromVideoKey(key); pk != "" {
		posterPath := filepath.Join(getStorageConfig().uploadDir, filepath.FromSlash(pk))
		if st, err := os.Stat(posterPath); err == nil && st.Size() > 0 {
			syncFileToS3(posterPath, pk, "image")
		}
	}
	if _, err := os.Stat(localPath); err != nil {
		return err
	}
	ct := mimeFromExt(filepath.Ext(key))
	if rewroteMP4 {
		ct = "video/mp4"
	}
	setVideoJobPhase(key, "s3")
	return syncFileToS3Typed(localPath, key, ct)
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
	log.Printf("[Video] enqueue key=%s src=local size=%s transcode=%v s3=%v",
		key, localFileLog(localPath), enabled, needS3)
	go func() {
		defer recoverVideoPanic(key)
		t0 := time.Now()
		if enabled {
			release := acquireTranscodeSlot(key)
			defer release()
		} else {
			setVideoJobPhase(key, "s3")
			defer clearVideoJob(key)
		}
		if _, err := os.Stat(localPath); err != nil {
			log.Printf("[Video] abort key=%s: local file missing: %v", key, err)
			return
		}

		rewroteMP4 := false
		var prepareErr error
		if enabled {
			var action string
			action, prepareErr = prepareVideoForWeb(localPath, key)
			if prepareErr != nil {
				log.Printf("[Video] prepare %s (%s): %v — keeping original locally, not uploading to S3", key, action, prepareErr)
			} else if action == "transcode" || action == "remux" {
				rewroteMP4 = true
			} else {
				log.Printf("[Video] skip transcode key=%s (already web-safe)", key)
			}
		}
		if !needS3 {
			if prepareErr == nil {
				markUploadReady(key)
				log.Printf("[Video] done key=%s ready=1 total=%s", key, time.Since(t0).Truncate(time.Millisecond))
			} else {
				log.Printf("[Video] done key=%s ready=0 total=%s (prepare failed, will retry after restart)", key, time.Since(t0).Truncate(time.Millisecond))
			}
			return
		}
		if !videoReadyForS3(enabled, prepareErr) {
			log.Printf("[Video] skip S3 key=%s: not web-ready (prepare failed)", key)
			return
		}
		if err := syncPreparedVideoToS3(localPath, key, rewroteMP4); err != nil {
			log.Printf("[Video] S3 sync %s: %v — will retry after restart", key, err)
			return
		}
		markUploadReady(key)
		log.Printf("[Video] done key=%s ready=1 total=%s", key, time.Since(t0).Truncate(time.Millisecond))
	}()
}

func enqueueS3VideoPrepare(key string) {
	if key == "" || mediaTypeFromKey(key) != "video" {
		return
	}
	if !videoTranscodeEnabled() {
		log.Printf("[Video] enqueue skipped key=%s: transcode disabled", key)
		return
	}
	log.Printf("[Video] enqueue key=%s src=s3 transcode=true", key)
	go func() {
		defer recoverVideoPanic(key)
		t0 := time.Now()
		release := acquireTranscodeSlot(key)
		defer release()

		cfg := getStorageConfig()
		if cfg.typ != storageS3 || cfg.s3 == nil {
			log.Printf("[Video] abort key=%s: s3 not configured", key)
			return
		}
		localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
		if _, err := os.Stat(localPath); err != nil {
			if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
				log.Printf("[Video] mkdir %s: %v", key, err)
				return
			}
			setVideoJobPhase(key, "download")
			if err := downloadS3ToFile(key, localPath); err != nil {
				log.Printf("[Video] download %s: %v", key, err)
				return
			}
		} else {
			log.Printf("[Video] local copy present key=%s size=%s", key, localFileLog(localPath))
		}
		// Drop the client-uploaded original so CDN cannot pin HEVC/non-faststart.
		// Use deleteStoredObject so a sibling poster is not removed.
		if err := deleteStoredObject(key); err != nil {
			log.Printf("[Video] delete pending S3 original %s: %v", key, err)
		} else {
			log.Printf("[Video] deleted pending S3 original key=%s", key)
		}
		action, prepareErr := prepareVideoForWeb(localPath, key)
		if prepareErr != nil {
			log.Printf("[Video] prepare %s (%s): %v — keeping original locally, not uploading to S3", key, action, prepareErr)
			return
		}
		rewroteMP4 := action == "transcode" || action == "remux"
		if !rewroteMP4 {
			log.Printf("[Video] skip transcode key=%s (already web-safe)", key)
		}
		if err := syncPreparedVideoToS3(localPath, key, rewroteMP4); err != nil {
			log.Printf("[Video] S3 sync %s: %v — will retry after restart", key, err)
			return
		}
		markUploadReady(key)
		log.Printf("[Video] done key=%s ready=1 total=%s", key, time.Since(t0).Truncate(time.Millisecond))
	}()
}

func downloadS3ToFile(key, dest string) error {
	cfg := getStorageConfig()
	client := getS3Client()
	if client == nil || cfg.s3 == nil {
		return fmt.Errorf("s3 not configured")
	}
	log.Printf("[Video] download start key=%s", key)
	t0 := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	stop := logWhile(videoProgressInterval, func(elapsed time.Duration) string {
		return fmt.Sprintf("[Video] download running key=%s elapsed=%s", key, elapsed.Truncate(time.Second))
	})
	defer stop()
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
	n, err := io.Copy(f, out.Body)
	if err != nil {
		return err
	}
	log.Printf("[Video] download done key=%s size=%s elapsed=%s", key, formatByteSize(n), time.Since(t0).Truncate(time.Millisecond))
	return nil
}

func syncFileToS3Typed(localPath, key, contentType string) error {
	cfg := getStorageConfig()
	if cfg.s3 == nil {
		return fmt.Errorf("s3 not configured")
	}
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	if contentType == "" {
		contentType = mimeFromExt(filepath.Ext(key))
	}
	size := fileSizeOf(localPath)
	log.Printf("[S3Sync] start key=%s size=%s type=%s", key, formatByteSize(size), contentType)
	t0 := time.Now()
	stop := logWhile(videoProgressInterval, func(elapsed time.Duration) string {
		return fmt.Sprintf("[S3Sync] running key=%s elapsed=%s size=%s", key, elapsed.Truncate(time.Second), formatByteSize(size))
	})
	err = putToS3(key, contentType, f)
	stop()
	if err != nil {
		return err
	}
	log.Printf("[S3Sync] Successfully synced %s to S3 elapsed=%s", key, time.Since(t0).Truncate(time.Millisecond))
	if err := os.Remove(localPath); err != nil {
		log.Printf("[S3Sync] Failed to remove local file %s: %v", localPath, err)
	}
	return nil
}

// enqueueVideoJobForKey queues transcode (and S3 sync) for an existing video key.
func enqueueVideoJobForKey(key string) error {
	key = toStorageKey(key)
	if key == "" {
		return errAdminUploadKey
	}
	if mediaTypeFromKey(key) != "video" {
		return errAdminNotVideo
	}
	if !videoTranscodeEnabled() {
		return errAdminTranscodeOff
	}
	cfg := getStorageConfig()
	localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
	_ = os.Remove(localPath + ".web.mp4")
	if _, err := os.Stat(localPath); err != nil {
		if cfg.typ == storageS3 && cfg.s3 != nil {
			enqueueS3VideoPrepare(key)
			return nil
		}
		return errAdminFileMissing
	}
	enqueueVideoPrepareAndSync(localPath, key)
	return nil
}

func recoverPendingVideoJobs() {
	if db == nil {
		return
	}
	if !videoTranscodeEnabled() {
		if _, err := db.Exec(`UPDATE "UploadedFile" SET "ready" = 1 WHERE "ready" = 0`); err != nil {
			log.Printf("[Video] recover mark-ready: %v", err)
		} else {
			log.Printf("[Video] recover: transcode disabled, marked unready files as ready")
		}
		return
	}
	rows, err := db.Query(`SELECT "key", "createdAt" FROM "UploadedFile" WHERE "ready" = 0`)
	if err != nil {
		log.Printf("[Video] recover query: %v", err)
		return
	}
	type pendingJob struct {
		key       string
		createdAt int64
	}
	var jobs []pendingJob
	for rows.Next() {
		var j pendingJob
		if err := rows.Scan(&j.key, &j.createdAt); err == nil && j.key != "" {
			jobs = append(jobs, j)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[Video] recover scan: %v", err)
	}
	rows.Close()
	now := int64(nowMillis())
	n := 0
	for _, j := range jobs {
		age := time.Duration(now-j.createdAt) * time.Millisecond
		if age < 0 {
			age = 0
		}
		if mediaTypeFromKey(j.key) != "video" {
			log.Printf("[Video] recover mark-ready non-video key=%s age=%s", j.key, age.Truncate(time.Second))
			markUploadReady(j.key)
			continue
		}
		if err := enqueueVideoJobForKey(j.key); err != nil {
			log.Printf("[Video] pending %s: %v age=%s", j.key, err, age.Truncate(time.Second))
			continue
		}
		log.Printf("[Video] recover key=%s age=%s", j.key, age.Truncate(time.Second))
		n++
	}
	if n > 0 {
		log.Printf("[Video] resumed %d pending transcode(s)", n)
	} else {
		log.Printf("[Video] recover: no pending video jobs")
	}
}

func startVideoWatchdog() {
	videoWatchdogOnce.Do(func() {
		go func() {
			time.Sleep(time.Minute)
			logPendingVideoJobs()
			ticker := time.NewTicker(videoWatchdogInterval)
			defer ticker.Stop()
			for range ticker.C {
				logPendingVideoJobs()
			}
		}()
		log.Printf("[Video] watchdog started (every %s, stuck after %s)", videoWatchdogInterval, videoStuckAfter)
	})
}

func logPendingVideoJobs() {
	if db == nil {
		return
	}
	rows, err := db.Query(`SELECT "key", "createdAt" FROM "UploadedFile" WHERE "ready" = 0`)
	if err != nil {
		log.Printf("[Video] watchdog query: %v", err)
		return
	}
	type pendingJob struct {
		key       string
		createdAt int64
	}
	var jobs []pendingJob
	for rows.Next() {
		var j pendingJob
		if err := rows.Scan(&j.key, &j.createdAt); err == nil && j.key != "" {
			jobs = append(jobs, j)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[Video] watchdog scan: %v", err)
	}
	rows.Close()

	active := snapshotVideoJob()
	queued := videoQueued.Load()
	cfg := getStorageConfig()
	now := int64(nowMillis())
	var videos []pendingJob
	for _, j := range jobs {
		if mediaTypeFromKey(j.key) == "video" {
			videos = append(videos, j)
		}
	}
	if len(videos) == 0 && active == nil {
		return
	}

	activeDesc := "none"
	if active != nil {
		elapsed := time.Since(active.StartedAt).Truncate(time.Second)
		activeDesc = fmt.Sprintf("key=%s phase=%s elapsed=%s waited=%s", active.Key, active.Phase, elapsed, active.Waited.Truncate(time.Millisecond))
		if active.Phase == "transcode" || active.Phase == "remux" || active.Phase == "ffmpeg" {
			if time.Since(active.StartedAt) > transcodeTimeout()+time.Minute {
				log.Printf("[Video] STUCK worker %s (timeout is %s) — ffmpeg may be blocked or unkillable", activeDesc, transcodeTimeout())
			}
		}
		if time.Since(active.StartedAt) > videoStuckAfter {
			log.Printf("[Video] STUCK worker %s (running longer than %s)", activeDesc, videoStuckAfter)
		}
	}
	log.Printf("[Video] watchdog pending=%d queued=%d active=%s", len(videos), queued, activeDesc)

	for _, j := range videos {
		age := time.Duration(now-j.createdAt) * time.Millisecond
		if age < 0 {
			age = 0
		}
		localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(j.key))
		phase := "waiting"
		if active != nil && active.Key == j.key {
			phase = active.Phase
		}
		line := fmt.Sprintf("[Video] unready key=%s age=%s local=%s phase=%s",
			j.key, age.Truncate(time.Second), localFileLog(localPath), phase)
		if age >= videoStuckAfter {
			log.Printf("[Video] STUCK %s", strings.TrimPrefix(line, "[Video] "))
		} else {
			log.Printf("%s", line)
		}
	}
}
