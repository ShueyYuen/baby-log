package main

import (
	"bytes"
	"log"
	"net/http"
	"time"
)

// idempotencyMiddleware checks for the X-Idempotency-Key header on POST requests.
// If the key was already used (by the same user), it returns the cached response.
// Otherwise it captures the response, stores it, and returns normally.
func idempotencyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}

		key := r.Header.Get("X-Idempotency-Key")
		if key == "" {
			next.ServeHTTP(w, r)
			return
		}

		userID := getUserID(r)
		if userID == "" {
			next.ServeHTTP(w, r)
			return
		}

		var statusCode int
		var respBody string
		var contentType string
		err := db.QueryRow(
			`SELECT statusCode, responseBody, contentType FROM "IdempotencyKey" WHERE key = ? AND userId = ?`,
			key, userID,
		).Scan(&statusCode, &respBody, &contentType)
		if err == nil {
			if contentType != "" {
				w.Header().Set("Content-Type", contentType)
			}
			w.Header().Set("X-Idempotent-Replayed", "true")
			w.WriteHeader(statusCode)
			w.Write([]byte(respBody))
			return
		}

		rec := &responseRecorder{ResponseWriter: w, statusCode: http.StatusOK, body: &bytes.Buffer{}}
		next.ServeHTTP(rec, r)

		ct := rec.Header().Get("Content-Type")
		if _, err := db.Exec(
			`INSERT OR IGNORE INTO "IdempotencyKey" (key, userId, statusCode, responseBody, contentType, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
			key, userID, rec.statusCode, rec.body.String(), ct, time.Now().UnixMilli(),
		); err != nil {
			log.Printf("[Idempotency] Failed to store key: %v", err)
		}
	})
}

type responseRecorder struct {
	http.ResponseWriter
	statusCode int
	body       *bytes.Buffer
}

func (r *responseRecorder) WriteHeader(code int) {
	r.statusCode = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

func cleanupIdempotencyKeys() {
	cutoff := time.Now().Add(-24 * time.Hour).UnixMilli()
	result, err := db.Exec(`DELETE FROM "IdempotencyKey" WHERE createdAt < ?`, cutoff)
	if err != nil {
		log.Printf("[Idempotency] Cleanup error: %v", err)
		return
	}
	if n, _ := result.RowsAffected(); n > 0 {
		log.Printf("[Idempotency] Cleaned up %d expired keys", n)
	}
}
