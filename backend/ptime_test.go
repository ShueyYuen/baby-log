package main

import (
	"encoding/json"
	"testing"
)

func TestMillisMarshalJSON(t *testing.T) {
	// 2025-06-01T00:00:00.000Z = 1748736000000 ms
	m := Millis(1748736000000)
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	want := `"2025-06-01T00:00:00.000Z"`
	if string(b) != want {
		t.Fatalf("got %s want %s", b, want)
	}
}

func TestMillisMarshalPreservesMillisComponent(t *testing.T) {
	m := Millis(1748736000123)
	b, _ := json.Marshal(m)
	want := `"2025-06-01T00:00:00.123Z"`
	if string(b) != want {
		t.Fatalf("got %s want %s", b, want)
	}
}

func TestMillisUnmarshalFromNumber(t *testing.T) {
	var m Millis
	if err := json.Unmarshal([]byte(`1748736000000`), &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m != Millis(1748736000000) {
		t.Fatalf("got %d", int64(m))
	}
}

func TestMillisUnmarshalFromISOString(t *testing.T) {
	var m Millis
	if err := json.Unmarshal([]byte(`"2025-06-01T00:00:00.000Z"`), &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if m != Millis(1748736000000) {
		t.Fatalf("got %d want 1748736000000", int64(m))
	}
}

func TestMillisUnmarshalNullNoop(t *testing.T) {
	m := Millis(42)
	if err := json.Unmarshal([]byte(`null`), &m); err != nil {
		t.Fatalf("unmarshal null: %v", err)
	}
	if m != Millis(42) {
		t.Fatalf("null should leave value unchanged, got %d", int64(m))
	}
}

func TestMillisRoundTrip(t *testing.T) {
	orig := Millis(1700000000000)
	b, _ := json.Marshal(orig)
	var got Millis
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("roundtrip: %v", err)
	}
	if got != orig {
		t.Fatalf("roundtrip mismatch: %d != %d", int64(got), int64(orig))
	}
}

func TestParseFlexibleTime(t *testing.T) {
	cases := []struct {
		in   string
		want int64 // unix millis, -1 表示应报错
	}{
		{"2025-06-01T00:00:00.000Z", 1748736000000},
		{"2025-06-01T00:00:00Z", 1748736000000},
		{"2025-06-01", 1748736000000},
		{"not-a-date", -1},
	}
	for _, c := range cases {
		got, err := parseFlexibleTime(c.in)
		if c.want == -1 {
			if err == nil {
				t.Errorf("%q: expected error", c.in)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: unexpected error %v", c.in, err)
			continue
		}
		if got.UnixMilli() != c.want {
			t.Errorf("%q: got %d want %d", c.in, got.UnixMilli(), c.want)
		}
	}
}

func TestMillisFromInput(t *testing.T) {
	m, err := millisFromInput("2025-06-01T00:00:00.000Z")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if m != Millis(1748736000000) {
		t.Fatalf("got %d", int64(m))
	}
	if _, err := millisFromInput("garbage"); err == nil {
		t.Fatalf("expected error for garbage input")
	}
}
