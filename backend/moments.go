package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// MediaItem represents a stored media file (image or video) attached to a moment.
type MediaItem struct {
	Key       string `json:"key"`
	RawKey    string `json:"rawKey,omitempty"`
	MediaType string `json:"mediaType"` // "image" or "video"
}

// MediaItemDisplay extends MediaItem with resolved display URLs.
type MediaItemDisplay struct {
	Key       string `json:"key"`
	RawKey    string `json:"rawKey,omitempty"`
	MediaType string `json:"mediaType"`
	URL       string `json:"url"`
	RawURL    string `json:"rawUrl,omitempty"`
}

type momentCommentOut struct {
	ID          string `json:"id"`
	MomentID    string `json:"momentId"`
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Content     string `json:"content"`
	CreatedAt   Millis `json:"createdAt"`
}

type momentOut struct {
	ID           string             `json:"id"`
	UserID       string             `json:"userId"`
	DisplayName  string             `json:"displayName"`
	Content      *string            `json:"content"`
	MediaItems   []MediaItemDisplay `json:"mediaItems"`
	CommentCount int                `json:"commentCount"`
	Comments     []momentCommentOut `json:"comments"`
	CreatedAt    Millis             `json:"createdAt"`
	UpdatedAt    Millis             `json:"updatedAt"`
	IsOwner      bool               `json:"isOwner"`
}

// mediaItemsToDisplay converts stored MediaItems to display form with resolved URLs.
func mediaItemsToDisplay(items []MediaItem) []MediaItemDisplay {
	out := make([]MediaItemDisplay, 0, len(items))
	for _, item := range items {
		d := MediaItemDisplay{
			Key:       item.Key,
			RawKey:    item.RawKey,
			MediaType: item.MediaType,
		}
		if item.Key != "" {
			d.URL, _ = toDisplayURL(item.Key, 86400)
		}
		if item.RawKey != "" {
			d.RawURL, _ = toDisplayURL(item.RawKey, 86400)
		}
		out = append(out, d)
	}
	return out
}

func parseMomentPage(r *http.Request) (page, pageSize int) {
	page = 1
	pageSize = 10
	if p := r.URL.Query().Get("page"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			page = n
		}
	}
	if ps := r.URL.Query().Get("pageSize"); ps != "" {
		if n, err := strconv.Atoi(ps); err == nil && n > 0 && n <= 50 {
			pageSize = n
		}
	}
	return
}

// GET /moments?page=1&pageSize=10
func handleListMoments(w http.ResponseWriter, r *http.Request) {
	currentUserID := getUserID(r)
	page, pageSize := parseMomentPage(r)
	offset := (page - 1) * pageSize

	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "Moment"`).Scan(&total); err != nil {
		writeErr(w, http.StatusInternalServerError, "Failed to count moments")
		return
	}

	rows, err := db.Query(`
		SELECT m.id, m.userId, u.displayName, m.content, m.mediaItems, m.createdAt, m.updatedAt
		FROM "Moment" m
		JOIN "User" u ON m.userId = u.id
		ORDER BY m.createdAt DESC
		LIMIT ? OFFSET ?
	`, pageSize, offset)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Failed to list moments")
		return
	}
	defer rows.Close()

	type rawRow struct {
		id          string
		userID      string
		displayName string
		content     sql.NullString
		mediaItems  sql.NullString
		createdAt   int64
		updatedAt   int64
	}

	var rawRows []rawRow
	var momentIDs []string

	for rows.Next() {
		var row rawRow
		if err := rows.Scan(&row.id, &row.userID, &row.displayName, &row.content, &row.mediaItems, &row.createdAt, &row.updatedAt); err != nil {
			continue
		}
		rawRows = append(rawRows, row)
		momentIDs = append(momentIDs, row.id)
	}

	// Batch-fetch comments for all moments
	commentsByMoment := map[string][]momentCommentOut{}
	if len(momentIDs) > 0 {
		ph := placeholders(len(momentIDs))
		args := make([]interface{}, len(momentIDs))
		for i, id := range momentIDs {
			args[i] = id
		}
		crows, err := db.Query(`
			SELECT c.id, c.momentId, c.userId, u.displayName, c.content, c.createdAt
			FROM "MomentComment" c
			JOIN "User" u ON c.userId = u.id
			WHERE c.momentId IN (`+ph+`)
			ORDER BY c.createdAt ASC
		`, args...)
		if err == nil {
			defer crows.Close()
			for crows.Next() {
				var c momentCommentOut
				var ca int64
				if err := crows.Scan(&c.ID, &c.MomentID, &c.UserID, &c.DisplayName, &c.Content, &ca); err != nil {
					continue
				}
				c.CreatedAt = Millis(ca)
				commentsByMoment[c.MomentID] = append(commentsByMoment[c.MomentID], c)
			}
		}
	}

	items := make([]momentOut, 0, len(rawRows))
	for _, row := range rawRows {
		out := momentOut{
			ID:          row.id,
			UserID:      row.userID,
			DisplayName: row.displayName,
			CreatedAt:   Millis(row.createdAt),
			UpdatedAt:   Millis(row.updatedAt),
			IsOwner:     row.userID == currentUserID,
		}
		if row.content.Valid {
			out.Content = &row.content.String
		}
		if row.mediaItems.Valid && row.mediaItems.String != "" {
			var items []MediaItem
			if err := json.Unmarshal([]byte(row.mediaItems.String), &items); err == nil {
				out.MediaItems = mediaItemsToDisplay(items)
			}
		}
		if out.MediaItems == nil {
			out.MediaItems = []MediaItemDisplay{}
		}
		comments := commentsByMoment[row.id]
		if comments == nil {
			comments = []momentCommentOut{}
		}
		out.Comments = comments
		out.CommentCount = len(comments)
		items = append(items, out)
	}

	writeOK(w, map[string]interface{}{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

// POST /moments
func handleCreateMoment(w http.ResponseWriter, r *http.Request) {
	currentUserID := getUserID(r)

	var body struct {
		Content    *string     `json:"content"`
		MediaItems []MediaItem `json:"mediaItems"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if (body.Content == nil || *body.Content == "") && len(body.MediaItems) == 0 {
		writeErr(w, http.StatusBadRequest, "请输入内容或上传图片/视频")
		return
	}

	// Validate referenced upload keys
	if len(body.MediaItems) > 0 {
		keys := make([]string, 0, len(body.MediaItems))
		for _, item := range body.MediaItems {
			keys = append(keys, item.Key)
		}
		if err := validateUploadKeys(keys); err != nil {
			writeErr(w, http.StatusBadRequest, "Invalid media key")
			return
		}
	}

	// Wait for any async uploads to finish before persisting
	for _, item := range body.MediaItems {
		if err := waitForUpload(item.Key); err != nil {
			log.Printf("[Moments] Async upload failed for key=%s: %v", item.Key, err)
			writeErr(w, http.StatusInternalServerError, "文件上传处理失败")
			return
		}
	}

	mediaJSON := "[]"
	if len(body.MediaItems) > 0 {
		b, err := json.Marshal(body.MediaItems)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Failed to marshal media")
			return
		}
		mediaJSON = string(b)
	}

	id := uuid.NewString()
	now := int64(nowMillis())

	var contentVal interface{}
	if body.Content != nil && *body.Content != "" {
		contentVal = *body.Content
	}

	if _, err := db.Exec(`
		INSERT INTO "Moment" (id, userId, content, mediaItems, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, currentUserID, contentVal, mediaJSON, now, now); err != nil {
		writeErr(w, http.StatusInternalServerError, "Failed to create moment")
		return
	}

	usedKeys := make([]string, 0, len(body.MediaItems))
	for _, item := range body.MediaItems {
		usedKeys = append(usedKeys, item.Key)
	}
	markUploadedFilesUsed(usedKeys)

	// Fetch display name
	var displayName string
	db.QueryRow(`SELECT displayName FROM "User" WHERE id = ?`, currentUserID).Scan(&displayName)

	out := momentOut{
		ID:           id,
		UserID:       currentUserID,
		DisplayName:  displayName,
		Content:      body.Content,
		MediaItems:   mediaItemsToDisplay(body.MediaItems),
		Comments:     []momentCommentOut{},
		CommentCount: 0,
		CreatedAt:    Millis(now),
		UpdatedAt:    Millis(now),
		IsOwner:      true,
	}
	if out.MediaItems == nil {
		out.MediaItems = []MediaItemDisplay{}
	}
	writeOK(w, out)
}

// PUT /moments/{id}
func handleUpdateMoment(w http.ResponseWriter, r *http.Request) {
	currentUserID := getUserID(r)
	id := chi.URLParam(r, "id")

	var ownerID string
	var oldMediaJSON sql.NullString
	if err := db.QueryRow(`SELECT userId, mediaItems FROM "Moment" WHERE id = ?`, id).Scan(&ownerID, &oldMediaJSON); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Moment not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "Failed to fetch moment")
		}
		return
	}
	if ownerID != currentUserID {
		writeErr(w, http.StatusForbidden, "只能编辑自己发布的内容")
		return
	}

	var body struct {
		Content    *string     `json:"content"`
		MediaItems []MediaItem `json:"mediaItems"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	mediaJSON := "[]"
	if len(body.MediaItems) > 0 {
		b, _ := json.Marshal(body.MediaItems)
		mediaJSON = string(b)
	}

	// Mark removed media files for deferred cleanup
	if oldMediaJSON.Valid && oldMediaJSON.String != "" {
		var oldItems []MediaItem
		if err := json.Unmarshal([]byte(oldMediaJSON.String), &oldItems); err == nil {
			newKeySet := map[string]bool{}
			for _, item := range body.MediaItems {
				if item.Key != "" {
					newKeySet[item.Key] = true
				}
			}
			for _, item := range oldItems {
				if item.Key != "" && !newKeySet[item.Key] {
					markFileUnused(item.Key, item.RawKey)
				}
			}
		}
	}

	now := int64(nowMillis())
	var contentVal interface{}
	if body.Content != nil {
		contentVal = *body.Content
	}

	if _, err := db.Exec(`
		UPDATE "Moment" SET content = ?, mediaItems = ?, updatedAt = ? WHERE id = ?
	`, contentVal, mediaJSON, now, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Failed to update moment")
		return
	}

	usedKeys := make([]string, 0, len(body.MediaItems))
	for _, item := range body.MediaItems {
		usedKeys = append(usedKeys, item.Key)
	}
	markUploadedFilesUsed(usedKeys)

	writeOK(w, map[string]string{"id": id})
}

// DELETE /moments/{id}
func handleDeleteMoment(w http.ResponseWriter, r *http.Request) {
	currentUserID := getUserID(r)
	id := chi.URLParam(r, "id")

	var ownerID string
	var mediaJSON sql.NullString
	if err := db.QueryRow(`SELECT userId, mediaItems FROM "Moment" WHERE id = ?`, id).Scan(&ownerID, &mediaJSON); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Moment not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "Failed to fetch moment")
		}
		return
	}
	if ownerID != currentUserID {
		writeErr(w, http.StatusForbidden, "只能删除自己发布的内容")
		return
	}

	tx, err := db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM "MomentComment" WHERE momentId = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if _, err := tx.Exec(`DELETE FROM "Moment" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	// Mark media files for deferred cleanup (after commit, non-critical)
	if mediaJSON.Valid && mediaJSON.String != "" {
		var items []MediaItem
		if err := json.Unmarshal([]byte(mediaJSON.String), &items); err == nil {
			for _, item := range items {
				if item.Key != "" {
					markFileUnused(item.Key, item.RawKey)
				}
			}
		}
	}

	writeOK(w, map[string]string{"id": id})
}

// POST /moments/{id}/comments
func handleCreateMomentComment(w http.ResponseWriter, r *http.Request) {
	currentUserID := getUserID(r)
	momentID := chi.URLParam(r, "id")

	var exists bool
	if err := db.QueryRow(`SELECT COUNT(*) > 0 FROM "Moment" WHERE id = ?`, momentID).Scan(&exists); err != nil || !exists {
		writeErr(w, http.StatusNotFound, "Moment not found")
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		writeErr(w, http.StatusBadRequest, "内容不能为空")
		return
	}

	commentID := uuid.NewString()
	now := int64(nowMillis())

	if _, err := db.Exec(`
		INSERT INTO "MomentComment" (id, momentId, userId, content, createdAt)
		VALUES (?, ?, ?, ?, ?)
	`, commentID, momentID, currentUserID, body.Content, now); err != nil {
		log.Printf("[Moments] Failed to create comment: momentId=%s userId=%s err=%v", momentID, currentUserID, err)
		writeErr(w, http.StatusInternalServerError, "Failed to create comment")
		return
	}

	var displayName string
	db.QueryRow(`SELECT displayName FROM "User" WHERE id = ?`, currentUserID).Scan(&displayName)

	writeOK(w, momentCommentOut{
		ID:          commentID,
		MomentID:    momentID,
		UserID:      currentUserID,
		DisplayName: displayName,
		Content:     body.Content,
		CreatedAt:   Millis(now),
	})
}

// DELETE /moments/{id}/comments/{commentId}
func handleDeleteMomentComment(w http.ResponseWriter, r *http.Request) {
	currentUserID := getUserID(r)
	momentID := chi.URLParam(r, "id")
	commentID := chi.URLParam(r, "commentId")

	var ownerID string
	if err := db.QueryRow(`
		SELECT userId FROM "MomentComment" WHERE id = ? AND momentId = ?
	`, commentID, momentID).Scan(&ownerID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Comment not found")
		} else {
			writeErr(w, http.StatusInternalServerError, "")
		}
		return
	}
	if ownerID != currentUserID {
		writeErr(w, http.StatusForbidden, "只能删除自己的评论")
		return
	}

	db.Exec(`DELETE FROM "MomentComment" WHERE id = ?`, commentID)
	writeOK(w, map[string]string{"id": commentID})
}
