package main

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Known upload prefixes written by this app. S3 listing is scoped to these so a
// shared bucket does not get fully enumerated (ListObjects is billed).
var s3AppPrefixes = []string{
	"avatar/",
	"records/",
	"moments/",
	"health/",
	"milestones/",
	"plans/",
	"medical/",
	"uploads/",
}

const (
	s3OrphanSampleLimit = 50
	s3OrphanMaxList     = 100_000
	s3DeleteBatchSize   = 1000
	s3OrphanListTimeout = 5 * time.Minute
)

type s3ListedObject struct {
	Key          string
	Size         int64
	LastModified time.Time
}

type s3ListResult struct {
	Objects      []s3ListedObject
	ListRequests int
	Truncated    bool
}

type s3OrphanItem struct {
	Key          string `json:"key"`
	Size         int64  `json:"size"`
	LastModified int64  `json:"lastModified"`
}

type storageReindexResult struct {
	Listed            int            `json:"listed"`
	PostersIndexed    int            `json:"postersIndexed"`
	SizesUpdated      int            `json:"sizesUpdated"`
	Tracked           int            `json:"tracked"`
	SkippedRecent     int            `json:"skippedRecent"`
	SkippedReferenced int            `json:"skippedReferenced"`
	Found             int            `json:"found"`
	Deleted           int            `json:"deleted"`
	Bytes             int64          `json:"bytes"`
	ListRequests      int            `json:"listRequests"`
	Truncated         bool           `json:"truncated,omitempty"`
	Items             []s3OrphanItem `json:"items"`
	Errors            []string       `json:"errors,omitempty"`
}

type s3OrphanClassifyStats struct {
	tracked    int
	recent     int
	referenced int
}

var (
	listStorageObjectsFn = listStorageObjects
	deleteStorageKeysFn  = deleteStorageKeys
)

type storageReindexState struct {
	mu   sync.Mutex
	busy bool
}

var reindexState storageReindexState

func resetS3OrphanState() {
	reindexState.mu.Lock()
	defer reindexState.mu.Unlock()
	reindexState.busy = false
}

func (s *storageReindexState) begin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.busy {
		return false
	}
	s.busy = true
	return true
}

func (s *storageReindexState) end() {
	s.mu.Lock()
	s.busy = false
	s.mu.Unlock()
}

// POST /admin/storage/reindex — rebuild UploadedFile from storage, then purge
// objects that still have no index row. Admin-only; never run from the scheduler.
func handleStorageReindex(w http.ResponseWriter, r *http.Request) {
	if !isAdminCtx(r) {
		writeErr(w, http.StatusForbidden, "仅管理员可操作")
		return
	}
	if !reindexState.begin() {
		writeErr(w, http.StatusConflict, "索引重建正在进行")
		return
	}
	defer reindexState.end()

	ctx, cancel := context.WithTimeout(r.Context(), s3OrphanListTimeout)
	defer cancel()

	result, err := reindexStorage(ctx)
	if err != nil {
		writeServerErr(w, r, err)
		return
	}
	log.Printf("[Cleanup] Storage reindex: listed=%d posters=%d sizes=%d deleted=%d errors=%d",
		result.Listed, result.PostersIndexed, result.SizesUpdated, result.Deleted, len(result.Errors))
	writeOK(w, result)
}

func reindexStorage(ctx context.Context) (*storageReindexResult, error) {
	listed, err := listStorageObjectsFn(ctx)
	if err != nil {
		return nil, err
	}
	byKey := map[string]s3ListedObject{}
	for _, obj := range listed.Objects {
		byKey[obj.Key] = obj
	}

	posters := indexExistingPosters(byKey)
	sizes := fillMissingUploadSizes(byKey)

	orphans, stats := classifyUntrackedS3Objects(listed.Objects, trackedStorageKeys(), time.Now())
	var toDelete []string
	for _, item := range orphans {
		toDelete = append(toDelete, item.Key)
	}
	deleted := 0
	var errs []string
	if len(toDelete) > 0 {
		deleted, errs = deleteStorageKeysFn(ctx, toDelete)
	}

	var bytes int64
	for _, item := range orphans {
		bytes += item.Size
	}
	return &storageReindexResult{
		Listed:            len(listed.Objects),
		PostersIndexed:    posters,
		SizesUpdated:      sizes,
		Tracked:           stats.tracked,
		SkippedRecent:     stats.recent,
		SkippedReferenced: stats.referenced,
		Found:             len(orphans),
		Deleted:           deleted,
		Bytes:             bytes,
		ListRequests:      listed.ListRequests,
		Truncated:         listed.Truncated,
		Items:             sampleS3OrphanItems(orphans),
		Errors:            errs,
	}, nil
}

func indexExistingPosters(listed map[string]s3ListedObject) int {
	if db == nil {
		return 0
	}
	rows, err := db.Query(`SELECT "key", "used" FROM "UploadedFile"`)
	if err != nil {
		log.Printf("[Cleanup] Poster index query error: %v", err)
		return 0
	}

	type videoRow struct {
		key  string
		used int
	}
	var videos []videoRow
	existing := map[string]bool{}
	for rows.Next() {
		var key string
		var used int
		if err := rows.Scan(&key, &used); err != nil {
			continue
		}
		existing[key] = true
		if mediaTypeFromKey(key) == "video" {
			videos = append(videos, videoRow{key: key, used: used})
		}
	}
	_ = rows.Close()

	now := int64(nowMillis())
	n := 0
	for _, v := range videos {
		pk := posterKeyFromVideoKey(v.key)
		if pk == "" || existing[pk] {
			continue
		}
		obj, ok := listed[pk]
		if !ok {
			continue
		}
		used := v.used
		if fileIsReferenced(pk, v.key) {
			used = 1
		}
		if _, err := db.Exec(
			`INSERT OR IGNORE INTO "UploadedFile" ("key", "rawKey", "createdAt", "used", "ready", "size") VALUES (?, '', ?, ?, 1, ?)`,
			pk, now, used, obj.Size,
		); err != nil {
			log.Printf("[Cleanup] Failed to index poster %s: %v", pk, err)
			continue
		}
		if obj.Size > 0 {
			setUploadSize(pk, obj.Size)
		}
		existing[pk] = true
		n++
	}
	return n
}

func fillMissingUploadSizes(listed map[string]s3ListedObject) int {
	if db == nil {
		return 0
	}
	rows, err := db.Query(`SELECT "key", "rawKey", "size" FROM "UploadedFile"`)
	if err != nil {
		log.Printf("[Cleanup] Size backfill query error: %v", err)
		return 0
	}
	type sizeRow struct {
		key, raw string
		size     int64
	}
	var rowsToFill []sizeRow
	known := map[string]int64{}
	for k, obj := range listed {
		if obj.Size > 0 {
			known[k] = obj.Size
		}
	}
	for rows.Next() {
		var key string
		var rawKey *string
		var size int64
		if err := rows.Scan(&key, &rawKey, &size); err != nil || key == "" {
			continue
		}
		raw := ""
		if rawKey != nil {
			raw = *rawKey
		}
		rowsToFill = append(rowsToFill, sizeRow{key: key, raw: raw, size: size})
	}
	_ = rows.Close()

	n := 0
	for _, row := range rowsToFill {
		sz := combinedUploadSize(row.key, row.raw, known)
		if sz <= 0 || sz == row.size {
			continue
		}
		setUploadSize(row.key, sz)
		n++
	}
	return n
}

func sampleS3OrphanItems(orphans []s3OrphanItem) []s3OrphanItem {
	if len(orphans) == 0 {
		return []s3OrphanItem{}
	}
	if len(orphans) <= s3OrphanSampleLimit {
		return orphans
	}
	return orphans[:s3OrphanSampleLimit]
}

func classifyUntrackedS3Objects(objects []s3ListedObject, known map[string]bool, now time.Time) ([]s3OrphanItem, s3OrphanClassifyStats) {
	var stats s3OrphanClassifyStats
	var orphans []s3OrphanItem
	grace := time.Duration(orphanGraceMs) * time.Millisecond
	for _, obj := range objects {
		key := strings.TrimSpace(obj.Key)
		if key == "" || strings.HasSuffix(key, "/") || !s3KeyHasAppPrefix(key) {
			continue
		}
		isTracked, isRef := s3ObjectProtected(key, known)
		if isTracked {
			stats.tracked++
			continue
		}
		if obj.LastModified.IsZero() || now.Sub(obj.LastModified) < grace {
			stats.recent++
			continue
		}
		if isRef {
			stats.referenced++
			continue
		}
		orphans = append(orphans, s3OrphanItem{
			Key:          key,
			Size:         obj.Size,
			LastModified: obj.LastModified.UnixMilli(),
		})
	}
	sort.Slice(orphans, func(i, j int) bool {
		if orphans[i].Size == orphans[j].Size {
			return orphans[i].Key < orphans[j].Key
		}
		return orphans[i].Size > orphans[j].Size
	})
	return orphans, stats
}

func s3KeyHasAppPrefix(key string) bool {
	for _, p := range s3AppPrefixes {
		if strings.HasPrefix(key, p) {
			return true
		}
	}
	return false
}

func trackedStorageKeys() map[string]bool {
	known := map[string]bool{}
	if db == nil {
		return known
	}
	rows, err := db.Query(`SELECT "key", "rawKey" FROM "UploadedFile"`)
	if err != nil {
		log.Printf("[Cleanup] Tracked keys query error: %v", err)
		return known
	}
	defer rows.Close()
	add := func(k string) {
		k = strings.TrimSpace(k)
		if k == "" {
			return
		}
		known[k] = true
		if pk := posterKeyFromVideoKey(k); pk != "" {
			known[pk] = true
		}
	}
	for rows.Next() {
		var key string
		var rawKey *string
		if err := rows.Scan(&key, &rawKey); err != nil {
			continue
		}
		add(key)
		if rawKey != nil {
			add(*rawKey)
		}
	}
	return known
}

func s3ObjectProtected(key string, known map[string]bool) (tracked, referenced bool) {
	rels := relatedStorageKeys(key)
	for _, rel := range rels {
		if known[rel] {
			return true, false
		}
	}
	for _, rel := range rels {
		if fileIsReferenced(rel) {
			return false, true
		}
	}
	return false, false
}

func relatedStorageKeys(key string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(k string) {
		if k == "" || seen[k] {
			return
		}
		seen[k] = true
		out = append(out, k)
	}
	add(key)
	add(posterKeyFromVideoKey(key))
	if strings.HasSuffix(key, posterSuffix) {
		stem := strings.TrimSuffix(key, posterSuffix)
		for _, ext := range videoKeySuffixes {
			add(stem + ext)
		}
	}
	const rawSeg = "/raw/"
	if i := strings.Index(key, rawSeg); i >= 0 {
		prefix := key[:i]
		base := key[i+len(rawSeg):]
		add(prefix + "/" + base)
		ext := filepath.Ext(base)
		add(prefix + "/" + strings.TrimSuffix(base, ext) + ".jpg")
	} else if slash := strings.LastIndex(key, "/"); slash >= 0 {
		prefix := key[:slash]
		base := key[slash+1:]
		add(prefix + "/raw/" + base)
	}
	return out
}

func listStorageObjects(ctx context.Context) (s3ListResult, error) {
	cfg := getStorageConfig()
	if cfg.typ == storageS3 && cfg.s3 != nil {
		return listS3ObjectsUnderPrefixes(ctx)
	}
	return listLocalUploadObjects(cfg.uploadDir)
}

func listLocalUploadObjects(uploadDir string) (s3ListResult, error) {
	var out s3ListResult
	if uploadDir == "" {
		return out, nil
	}
	err := filepath.WalkDir(uploadDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, relErr := filepath.Rel(uploadDir, path)
		if relErr != nil {
			return nil
		}
		if d.IsDir() {
			if d.Name() == ".tmp" {
				return filepath.SkipDir
			}
			return nil
		}
		key := filepath.ToSlash(rel)
		if key == "." || strings.HasPrefix(key, ".tmp/") {
			return nil
		}
		item := s3ListedObject{Key: key}
		if info, infoErr := d.Info(); infoErr == nil {
			item.Size = info.Size()
			item.LastModified = info.ModTime().UTC()
		}
		out.Objects = append(out.Objects, item)
		if len(out.Objects) >= s3OrphanMaxList {
			out.Truncated = true
			return fs.SkipAll
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	return out, nil
}

func listS3ObjectsUnderPrefixes(ctx context.Context) (s3ListResult, error) {
	cfg := getStorageConfig()
	client := getS3Client()
	if client == nil || cfg.s3 == nil || cfg.s3.bucket == "" {
		return s3ListResult{}, errS3NotConfigured
	}
	var out s3ListResult
	for _, prefix := range s3AppPrefixes {
		paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
			Bucket: aws.String(cfg.s3.bucket),
			Prefix: aws.String(prefix),
		})
		for paginator.HasMorePages() {
			if err := ctx.Err(); err != nil {
				return out, err
			}
			page, err := paginator.NextPage(ctx)
			out.ListRequests++
			if err != nil {
				return out, err
			}
			for _, obj := range page.Contents {
				if obj.Key == nil || *obj.Key == "" {
					continue
				}
				item := s3ListedObject{Key: *obj.Key}
				if obj.Size != nil {
					item.Size = *obj.Size
				}
				if obj.LastModified != nil {
					item.LastModified = obj.LastModified.UTC()
				}
				out.Objects = append(out.Objects, item)
				if len(out.Objects) >= s3OrphanMaxList {
					out.Truncated = true
					return out, nil
				}
			}
		}
	}
	return out, nil
}

var errS3NotConfigured = errors.New("S3 not configured")

func deleteStorageKeys(ctx context.Context, keys []string) (int, []string) {
	cfg := getStorageConfig()
	if cfg.typ == storageS3 && cfg.s3 != nil {
		return deleteS3ObjectKeys(ctx, keys)
	}
	return deleteLocalKeys(cfg.uploadDir, keys)
}

func deleteLocalKeys(uploadDir string, keys []string) (deleted int, errs []string) {
	for _, key := range keys {
		path := filepath.Join(uploadDir, filepath.FromSlash(key))
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			errs = append(errs, key+": "+err.Error())
			continue
		}
		deleted++
	}
	return deleted, errs
}

func deleteS3ObjectKeys(ctx context.Context, keys []string) (deleted int, errs []string) {
	cfg := getStorageConfig()
	client := getS3Client()
	if client == nil || cfg.s3 == nil || cfg.s3.bucket == "" {
		return 0, []string{"S3 not configured"}
	}
	for i := 0; i < len(keys); i += s3DeleteBatchSize {
		end := i + s3DeleteBatchSize
		if end > len(keys) {
			end = len(keys)
		}
		ids := make([]types.ObjectIdentifier, 0, end-i)
		for _, key := range keys[i:end] {
			k := key
			ids = append(ids, types.ObjectIdentifier{Key: aws.String(k)})
		}
		out, err := client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(cfg.s3.bucket),
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		failed := map[string]bool{}
		if out != nil {
			for _, e := range out.Errors {
				msg := ""
				if e.Key != nil {
					msg = *e.Key + ": "
					failed[*e.Key] = true
				}
				if e.Message != nil {
					msg += *e.Message
				}
				errs = append(errs, msg)
			}
		}
		for _, key := range keys[i:end] {
			if !failed[key] {
				deleted++
			}
		}
	}
	return deleted, errs
}
