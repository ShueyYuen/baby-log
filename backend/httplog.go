package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const reqMetaKey ctxKey = "reqMeta"

type reqMeta struct {
	UserID string
}

type logResponseWriter struct {
	http.ResponseWriter
	status    int
	wrote     bool
	clientMsg string
	cause     error
}

func (w *logResponseWriter) WriteHeader(code int) {
	if !w.wrote {
		w.status = code
		w.wrote = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *logResponseWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.status = http.StatusOK
		w.wrote = true
	}
	return w.ResponseWriter.Write(b)
}

func (w *logResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *logResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func unwrapLogWriter(w http.ResponseWriter) *logResponseWriter {
	for i := 0; i < 8 && w != nil; i++ {
		if lw, ok := w.(*logResponseWriter); ok {
			return lw
		}
		u, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return nil
		}
		w = u.Unwrap()
	}
	return nil
}

func attachErrToWriter(w http.ResponseWriter, clientMsg string, err error) {
	lw := unwrapLogWriter(w)
	if lw == nil {
		return
	}
	if clientMsg != "" && lw.clientMsg == "" {
		lw.clientMsg = clientMsg
	}
	if err != nil && lw.cause == nil {
		lw.cause = err
	}
}

func skipHTTPLog(r *http.Request, status int) bool {
	if r.Method == http.MethodOptions {
		return true
	}
	path := r.URL.Path
	if path == apiPrefix+"/health" && status < 400 {
		return true
	}
	if r.Method == http.MethodGet && strings.HasPrefix(path, apiPrefix+"/uploads/") && status < 400 {
		return true
	}
	if !strings.HasPrefix(path, "/api/") && status < 400 {
		return true
	}
	return false
}

func requestURIForLog(r *http.Request) string {
	uri := r.URL.RequestURI()
	if len(uri) > 256 {
		return uri[:256] + "…"
	}
	return uri
}

func logUser(meta *reqMeta) string {
	if meta != nil && meta.UserID != "" {
		return meta.UserID
	}
	return "-"
}

func httpLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		meta := &reqMeta{}
		r = r.WithContext(context.WithValue(r.Context(), reqMetaKey, meta))
		lw := &logResponseWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[HTTP] %s %s panic=%v dur=%s user=%s",
					r.Method, requestURIForLog(r), rec, time.Since(start).Truncate(time.Millisecond), logUser(meta))
				panic(rec)
			}
			logHTTPRequest(r, lw, time.Since(start), meta)
		}()
		next.ServeHTTP(lw, r)
	})
}

func logHTTPRequest(r *http.Request, lw *logResponseWriter, dur time.Duration, meta *reqMeta) {
	status := lw.status
	if !lw.wrote {
		status = 0
	}
	if skipHTTPLog(r, status) {
		return
	}
	msg := fmtHTTPLog(r.Method, requestURIForLog(r), status, dur, logUser(meta), lw.clientMsg, lw.cause)
	log.Print(msg)
}

func fmtHTTPLog(method, uri string, status int, dur time.Duration, user, clientMsg string, cause error) string {
	msg := fmt.Sprintf("[HTTP] %s %s status=%d dur=%s user=%s",
		method, uri, status, dur.Truncate(time.Millisecond), user)
	if clientMsg != "" {
		msg += " msg=" + strconv.Quote(truncateLog(clientMsg, 200))
	}
	if cause != nil {
		msg += " err=" + strconv.Quote(truncateLog(cause.Error(), 200))
	}
	return msg
}

func truncateLog(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func setReqMetaUser(r *http.Request, userID string) {
	if m, ok := r.Context().Value(reqMetaKey).(*reqMeta); ok && m != nil {
		m.UserID = userID
	}
}
