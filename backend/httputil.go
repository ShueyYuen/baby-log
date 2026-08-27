package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type apiResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeOK(w http.ResponseWriter, data interface{}) {
	writeJSON(w, http.StatusOK, apiResponse{Success: true, Data: data})
}

// writeSuccess 用于仅返回 { success: true }（无 data 字段）。
func writeSuccess(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, apiResponse{Success: true})
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	attachErrToWriter(w, msg, nil)
	writeJSON(w, status, apiResponse{Success: false, Error: msg})
}

// writeInternal logs the real error (for later diagnosis) while returning a client-facing message.
func writeInternal(w http.ResponseWriter, r *http.Request, status int, clientMsg string, err error) {
	attachErrToWriter(w, clientMsg, err)
	if unwrapLogWriter(w) == nil {
		user := getUserID(r)
		if user == "" {
			user = "-"
		}
		if err != nil {
			log.Printf("[HTTP] %s %s status=%d msg=%q err=%v user=%s", r.Method, requestURIForLog(r), status, clientMsg, err, user)
		} else {
			log.Printf("[HTTP] %s %s status=%d msg=%q user=%s", r.Method, requestURIForLog(r), status, clientMsg, user)
		}
	}
	writeJSON(w, status, apiResponse{Success: false, Error: clientMsg})
}

func writeServerErr(w http.ResponseWriter, r *http.Request, err error) {
	writeInternal(w, r, http.StatusInternalServerError, "Server error", err)
}

const maxJSONBodySize = 2 << 20 // 2 MB

func decodeJSON(r *http.Request, v interface{}) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxJSONBodySize)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}
