package main

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func chiURLParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}

func logInfo(format string, args ...interface{}) {
	log.Printf(format, args...)
}

func isNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func strPtr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	v := ns.String
	return &v
}

func floatPtr(nf sql.NullFloat64) *float64 {
	if !nf.Valid {
		return nil
	}
	v := nf.Float64
	return &v
}
