package main

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	errAdminUploadKey    = errors.New("missing key")
	errAdminNotVideo     = errors.New("not a video")
	errAdminTranscodeOff = errors.New("transcode disabled")
	errAdminFileMissing  = errors.New("file missing on disk")
	errAdminNotFound     = errors.New("upload not found")
	errAdminReferenced   = errors.New("file is still referenced")
)

var videoKeySuffixes = []string{".mp4", ".mov", ".webm", ".avi", ".m4v", ".mkv", ".3gp", ".3gpp"}

type adminUploadItem struct {
	Key        string `json:"key"`
	RawKey     string `json:"rawKey,omitempty"`
	CreatedAt  Millis `json:"createdAt"`
	Used       bool   `json:"used"`
	Ready      bool   `json:"ready"`
	MediaType  string `json:"mediaType"`
	Poster     bool   `json:"poster,omitempty"`
	Referenced bool   `json:"referenced"`
	Local      bool   `json:"local"`
	Size       int64  `json:"size"`
	URL        string `json:"url,omitempty"`
	PosterURL  string `json:"posterUrl,omitempty"`
	Phase      string `json:"phase,omitempty"`
}

type adminUploadWorker struct {
	Key       string `json:"key"`
	Phase     string `json:"phase"`
	ElapsedMs int64  `json:"elapsedMs"`
	WaitedMs  int64  `json:"waitedMs"`
}

type adminUploadCounts struct {
	Total   int `json:"total"`
	Unready int `json:"unready"`
	Unused  int `json:"unused"`
	Videos  int `json:"videos"`
}

// GET /admin/uploads
func handleListAdminUploads(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}

	q := r.URL.Query()
	page := parseIntDefault(q.Get("page"), 1)
	if page < 1 {
		page = 1
	}
	pageSize := parseIntDefault(q.Get("pageSize"), 20)
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	status := strings.ToLower(strings.TrimSpace(q.Get("status")))
	search := strings.TrimSpace(q.Get("q"))

	where, args := adminUploadFilters(status, search)

	var filtered int
	countSQL := `SELECT COUNT(*) FROM "UploadedFile"` + where
	if err := db.QueryRow(countSQL, args...).Scan(&filtered); err != nil {
		writeServerErr(w, r, err)
		return
	}

	counts, err := adminUploadCountsAll()
	if err != nil {
		writeServerErr(w, r, err)
		return
	}

	listSQL := `SELECT "key", "rawKey", "createdAt", "used", "ready", "size" FROM "UploadedFile"` + where +
		` ORDER BY "createdAt" DESC LIMIT ? OFFSET ?`
	listArgs := append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)
	rows, err := db.Query(listSQL, listArgs...)
	if err != nil {
		writeServerErr(w, r, err)
		return
	}

	type uploadRow struct {
		key, rawKey string
		created     int64
		used, ready bool
		size        int64
	}
	var rawItems []uploadRow
	for rows.Next() {
		var row uploadRow
		var rawKey sql.NullString
		var used, ready int
		if err := rows.Scan(&row.key, &rawKey, &row.created, &used, &ready, &row.size); err != nil {
			continue
		}
		row.rawKey = rawKey.String
		row.used = used != 0
		row.ready = ready != 0
		rawItems = append(rawItems, row)
	}
	scanErr := rows.Err()
	rows.Close()
	if scanErr != nil {
		writeServerErr(w, r, scanErr)
		return
	}

	cfg := getStorageConfig()
	active := snapshotVideoJob()
	items := make([]adminUploadItem, 0, len(rawItems))
	for _, row := range rawItems {
		items = append(items, buildAdminUploadItem(cfg, row.key, row.rawKey, row.created, row.used, row.ready, row.size, active))
	}

	writeOK(w, map[string]interface{}{
		"items":            items,
		"total":            filtered,
		"page":             page,
		"pageSize":         pageSize,
		"hasMore":          page*pageSize < filtered,
		"counts":           counts,
		"worker":           adminWorkerSnapshot(active),
		"queued":           videoQueued.Load(),
		"transcodeEnabled": videoTranscodeEnabled(),
		"storageType":      string(cfg.typ),
	})
}

func adminUploadFilters(status, search string) (where string, args []interface{}) {
	where = " WHERE 1=1"
	if search != "" {
		where += ` AND "key" LIKE ?`
		args = append(args, "%"+search+"%")
	}
	switch status {
	case "unready":
		where += ` AND "ready" = 0`
	case "unused":
		where += ` AND "used" = 0`
	case "used":
		where += ` AND "used" = 1`
	case "video":
		where += " AND (" + videoKeySQL(`"key"`) + ")"
	case "image":
		where += " AND NOT (" + videoKeySQL(`"key"`) + ")"
	}
	return where, args
}

func videoKeySQL(col string) string {
	parts := make([]string, 0, len(videoKeySuffixes))
	for _, ext := range videoKeySuffixes {
		parts = append(parts, `LOWER(`+col+`) LIKE '%`+ext+`'`)
	}
	return strings.Join(parts, " OR ")
}

func adminUploadCountsAll() (adminUploadCounts, error) {
	var c adminUploadCounts
	err := db.QueryRow(`
		SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN "ready" = 0 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN "used" = 0 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN `+videoKeySQL(`"key"`)+` THEN 1 ELSE 0 END), 0)
		FROM "UploadedFile"`).Scan(&c.Total, &c.Unready, &c.Unused, &c.Videos)
	return c, err
}

func buildAdminUploadItem(cfg storageConfig, key, rawKey string, created int64, used, ready bool, size int64, active *videoJobState) adminUploadItem {
	item := adminUploadItem{
		Key:        key,
		RawKey:     rawKey,
		CreatedAt:  Millis(created),
		Used:       used,
		Ready:      ready,
		MediaType:  mediaTypeFromKey(key),
		Poster:     strings.HasSuffix(key, posterSuffix),
		Referenced: fileIsReferenced(key, rawKey),
		Size:       size,
	}
	localPath := filepath.Join(cfg.uploadDir, filepath.FromSlash(key))
	if st, err := os.Stat(localPath); err == nil && !st.IsDir() {
		item.Local = true
		if item.Size <= 0 {
			item.Size = combinedUploadSize(key, rawKey, nil)
			if item.Size > 0 {
				setUploadSize(key, item.Size)
			}
		}
	}
	if item.MediaType == "video" {
		if u := resolvePosterURL("video", key, ""); u != "" {
			item.PosterURL = u
		}
		if ready {
			if u, err := toDisplayURL(key, 86400); err == nil {
				item.URL = u
			}
		}
	} else {
		if u, err := toDisplayURL(key, 86400); err == nil {
			item.URL = u
		}
	}
	if active != nil && active.Key == key {
		item.Phase = active.Phase
	}
	return item
}

func adminWorkerSnapshot(active *videoJobState) *adminUploadWorker {
	if active == nil {
		return nil
	}
	return &adminUploadWorker{
		Key:       active.Key,
		Phase:     active.Phase,
		ElapsedMs: time.Since(active.StartedAt).Milliseconds(),
		WaitedMs:  active.Waited.Milliseconds(),
	}
}

type adminTranscodeRequest struct {
	Key        string `json:"key"`
	AllUnready bool   `json:"allUnready"`
}

// POST /admin/uploads/transcode
func handleAdminTranscodeUpload(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}
	var req adminTranscodeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !videoTranscodeEnabled() {
		writeErr(w, http.StatusBadRequest, "视频转码未启用")
		return
	}

	if req.AllUnready {
		queued, skipped, err := enqueueAllUnreadyVideos()
		if err != nil {
			writeServerErr(w, r, err)
			return
		}
		writeOK(w, map[string]interface{}{"queued": queued, "skipped": skipped})
		return
	}

	key, err := sanitizeStorageKey(req.Key)
	if err != nil || key == "" {
		writeErr(w, http.StatusBadRequest, "key required")
		return
	}
	if !uploadKeyExists(key) {
		writeErr(w, http.StatusNotFound, "文件不存在")
		return
	}
	if mediaTypeFromKey(key) != "video" {
		writeErr(w, http.StatusBadRequest, "只能转换视频文件")
		return
	}

	active := snapshotVideoJob()
	if active != nil && active.Key == key {
		writeOK(w, map[string]interface{}{"queued": 0, "alreadyActive": true, "key": key, "phase": active.Phase})
		return
	}

	if _, err := db.Exec(`UPDATE "UploadedFile" SET "ready" = 0 WHERE "key" = ?`, key); err != nil {
		writeServerErr(w, r, err)
		return
	}
	if err := enqueueVideoJobForKey(key); err != nil {
		writeAdminTranscodeErr(w, err)
		return
	}
	writeOK(w, map[string]interface{}{"queued": 1, "key": key})
}

func enqueueAllUnreadyVideos() (queued, skipped int, err error) {
	rows, err := db.Query(`SELECT "key" FROM "UploadedFile" WHERE "ready" = 0`)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err == nil && key != "" {
			keys = append(keys, key)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	active := snapshotVideoJob()
	for _, key := range keys {
		if mediaTypeFromKey(key) != "video" {
			markUploadReady(key)
			skipped++
			continue
		}
		if active != nil && active.Key == key {
			skipped++
			continue
		}
		if err := enqueueVideoJobForKey(key); err != nil {
			skipped++
			continue
		}
		queued++
	}
	return queued, skipped, nil
}

func writeAdminTranscodeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errAdminNotVideo):
		writeErr(w, http.StatusBadRequest, "只能转换视频文件")
	case errors.Is(err, errAdminTranscodeOff):
		writeErr(w, http.StatusBadRequest, "视频转码未启用")
	case errors.Is(err, errAdminFileMissing):
		writeErr(w, http.StatusConflict, "本地文件不存在，无法转换")
	case errors.Is(err, errAdminUploadKey):
		writeErr(w, http.StatusBadRequest, "key required")
	default:
		writeErr(w, http.StatusInternalServerError, "failed to queue transcode")
	}
}

// DELETE /admin/uploads?key=&force=
func handleAdminDeleteUpload(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}
	key, err := sanitizeStorageKey(r.URL.Query().Get("key"))
	if err != nil || key == "" {
		writeErr(w, http.StatusBadRequest, "key required")
		return
	}
	force := r.URL.Query().Get("force") == "1" || r.URL.Query().Get("force") == "true"
	if err := deleteAdminUpload(key, force); err != nil {
		switch {
		case errors.Is(err, errAdminNotFound):
			writeErr(w, http.StatusNotFound, "文件不存在")
		case errors.Is(err, errAdminReferenced):
			writeErr(w, http.StatusConflict, "文件仍被记录引用，需强制删除")
		default:
			writeServerErr(w, r, err)
		}
		return
	}
	writeOK(w, map[string]interface{}{"deleted": key})
}

func deleteAdminUpload(key string, force bool) error {
	var rawKey sql.NullString
	err := db.QueryRow(`SELECT "rawKey" FROM "UploadedFile" WHERE "key" = ?`, key).Scan(&rawKey)
	if errors.Is(err, sql.ErrNoRows) {
		return errAdminNotFound
	}
	if err != nil {
		return err
	}
	raw := rawKey.String
	if fileIsReferenced(key, raw) && !force {
		return errAdminReferenced
	}
	if raw != "" && raw != key {
		if err := deleteStoredObject(raw); err != nil {
			return err
		}
	}
	if err := deleteFile(key); err != nil {
		return err
	}
	_, err = db.Exec(`DELETE FROM "UploadedFile" WHERE "key" = ? OR "rawKey" = ?`, key, key)
	return err
}
