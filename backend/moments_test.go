package main

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCreateMomentComment(t *testing.T) {
	ts := newTestServer(t)
	uid := insertUser(t, "alice", "Alice", "user")
	_ = createBabyFor(t, uid, "Baby")

	// create a moment first
	r := ts.do("POST", "/moments", uid, map[string]interface{}{
		"content": "hello world",
	})
	if r.status != http.StatusOK {
		t.Fatalf("create moment: expected 200, got %d; body=%s", r.status, string(r.body))
	}
	var env apiEnvelope
	r.decode(t, &env)
	var moment struct{ ID string `json:"id"` }
	json.Unmarshal(env.Data, &moment)
	if moment.ID == "" {
		t.Fatalf("moment ID empty; body=%s", string(r.body))
	}

	// add comment
	r2 := ts.do("POST", "/moments/"+moment.ID+"/comments", uid, map[string]interface{}{
		"content": "nice photo!",
	})
	if r2.status != http.StatusOK {
		t.Fatalf("create comment: expected 200, got %d; body=%s", r2.status, string(r2.body))
	}
	env2 := r2.envelope(t)
	if !env2.Success {
		t.Fatalf("comment not successful: %s", string(r2.body))
	}
}
