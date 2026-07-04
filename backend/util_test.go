package main

import (
	"database/sql"
	"testing"
)

func TestPlaceholders(t *testing.T) {
	cases := map[int]string{
		0:  "",
		1:  "?",
		3:  "?,?,?",
		-1: "",
	}
	for n, want := range cases {
		if got := placeholders(n); got != want {
			t.Errorf("placeholders(%d)=%q want %q", n, got, want)
		}
	}
}

func TestJoinComma(t *testing.T) {
	if got := joinComma(nil); got != "" {
		t.Errorf("empty: got %q", got)
	}
	if got := joinComma([]string{"a = ?"}); got != "a = ?" {
		t.Errorf("single: got %q", got)
	}
	if got := joinComma([]string{"a = ?", "b = ?"}); got != "a = ?, b = ?" {
		t.Errorf("multi: got %q", got)
	}
}

func TestStrPtr(t *testing.T) {
	if strPtr(sql.NullString{Valid: false}) != nil {
		t.Errorf("invalid should be nil")
	}
	p := strPtr(sql.NullString{String: "x", Valid: true})
	if p == nil || *p != "x" {
		t.Errorf("valid should return &\"x\"")
	}
}

func TestFloatPtr(t *testing.T) {
	if floatPtr(sql.NullFloat64{Valid: false}) != nil {
		t.Errorf("invalid should be nil")
	}
	p := floatPtr(sql.NullFloat64{Float64: 3.5, Valid: true})
	if p == nil || *p != 3.5 {
		t.Errorf("valid should return &3.5")
	}
}

func TestNullStringFromPtr(t *testing.T) {
	if nullStringFromPtr(nil) != nil {
		t.Errorf("nil ptr should be nil")
	}
	s := "hi"
	if got := nullStringFromPtr(&s); got != "hi" {
		t.Errorf("got %v", got)
	}
}

func TestJSONString(t *testing.T) {
	if got := jsonString([]byte(`"hello"`)); got != "hello" {
		t.Errorf("got %q", got)
	}
	if got := jsonString([]byte(`123`)); got != "" {
		t.Errorf("non-string should be empty, got %q", got)
	}
}

func TestParseIntDefault(t *testing.T) {
	if parseIntDefault("", 5) != 5 {
		t.Errorf("empty should default")
	}
	if parseIntDefault("10", 5) != 10 {
		t.Errorf("valid should parse")
	}
	if parseIntDefault("abc", 5) != 5 {
		t.Errorf("invalid should default")
	}
}

func TestPositiveOrNil(t *testing.T) {
	if !positiveOrNil(nil) {
		t.Errorf("nil is allowed")
	}
	v := 1.0
	if !positiveOrNil(&v) {
		t.Errorf("positive allowed")
	}
	z := 0.0
	if positiveOrNil(&z) {
		t.Errorf("zero not allowed")
	}
	n := -1.0
	if positiveOrNil(&n) {
		t.Errorf("negative not allowed")
	}
}

func TestFloatArg(t *testing.T) {
	if floatArg(nil) != nil {
		t.Errorf("nil should be nil")
	}
	v := 2.5
	if got := floatArg(&v); got != 2.5 {
		t.Errorf("got %v", got)
	}
}

func TestValidPlanTypeAndRepeat(t *testing.T) {
	for _, ty := range []string{"vaccine", "doctor", "checkup", "medicine", "custom"} {
		if !isValidPlanType(ty) {
			t.Errorf("%s should be valid", ty)
		}
	}
	if isValidPlanType("bogus") {
		t.Errorf("bogus should be invalid")
	}
	for _, rp := range []string{"none", "daily", "weekly", "monthly"} {
		if !isValidRepeat(rp) {
			t.Errorf("%s should be valid", rp)
		}
	}
	if isValidRepeat("yearly") {
		t.Errorf("yearly should be invalid")
	}
}

func TestIsNoRows(t *testing.T) {
	if !isNoRows(sql.ErrNoRows) {
		t.Errorf("ErrNoRows should be detected")
	}
	if isNoRows(nil) {
		t.Errorf("nil is not no-rows")
	}
}
