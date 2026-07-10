package main

import (
	"net/http"
	"testing"
)

func TestIsImageVisibleTo(t *testing.T) {
	tests := []struct {
		name      string
		visibleTo []string
		userID    string
		isAdmin   bool
		createdBy string
		want      bool
	}{
		{"empty list visible to all", nil, "user1", false, "", true},
		{"empty slice visible to all", []string{}, "user2", false, "", true},
		{"admin sees all", []string{"user1"}, "admin1", true, "", true},
		{"user in list can see", []string{"user1", "user2"}, "user2", false, "", true},
		{"user not in list cannot see", []string{"user1", "user2"}, "user3", false, "", false},
		{"single user list match", []string{"user1"}, "user1", false, "", true},
		{"single user list no match", []string{"user1"}, "user2", false, "", false},
		{"creator can always see", []string{"user1"}, "creator1", false, "creator1", true},
		{"non-creator still blocked", []string{"user1"}, "user2", false, "creator1", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isImageVisibleTo(tt.visibleTo, tt.userID, tt.isAdmin, tt.createdBy)
			if got != tt.want {
				t.Errorf("isImageVisibleTo(%v, %q, %v, %q) = %v, want %v",
					tt.visibleTo, tt.userID, tt.isAdmin, tt.createdBy, got, tt.want)
			}
		})
	}
}

func TestRecordImagesToDisplayFilters(t *testing.T) {
	items := []RecordImageStore{
		{Key: "public.jpg"},
		{Key: "restricted.jpg", VisibleTo: []string{"user1", "user2"}},
		{Key: "private.jpg", VisibleTo: []string{"user3"}},
	}

	t.Run("admin sees all", func(t *testing.T) {
		result := recordImagesToDisplay(items, "admin1", true, "")
		if len(result) != 3 {
			t.Errorf("admin should see 3 images, got %d", len(result))
		}
	})

	t.Run("user1 sees public and restricted", func(t *testing.T) {
		result := recordImagesToDisplay(items, "user1", false, "")
		if len(result) != 2 {
			t.Errorf("user1 should see 2 images, got %d", len(result))
		}
		if result[0].Key != "public.jpg" || result[1].Key != "restricted.jpg" {
			t.Errorf("unexpected keys: %v, %v", result[0].Key, result[1].Key)
		}
	})

	t.Run("user3 sees public and private", func(t *testing.T) {
		result := recordImagesToDisplay(items, "user3", false, "")
		if len(result) != 2 {
			t.Errorf("user3 should see 2 images, got %d", len(result))
		}
	})

	t.Run("unknown user sees only public", func(t *testing.T) {
		result := recordImagesToDisplay(items, "user99", false, "")
		if len(result) != 1 {
			t.Errorf("unknown user should see 1 image, got %d", len(result))
		}
		if result[0].Key != "public.jpg" {
			t.Errorf("should only see public.jpg, got %s", result[0].Key)
		}
	})

	t.Run("visibleTo preserved in output", func(t *testing.T) {
		result := recordImagesToDisplay(items, "user1", false, "")
		if result[1].VisibleTo == nil || len(result[1].VisibleTo) != 2 {
			t.Errorf("VisibleTo should be preserved, got %v", result[1].VisibleTo)
		}
	})

	t.Run("creator sees all own images", func(t *testing.T) {
		result := recordImagesToDisplay(items, "creator1", false, "creator1")
		if len(result) != 3 {
			t.Errorf("creator should see 3 images, got %d", len(result))
		}
	})
}

func TestMediaItemsToDisplayFilters(t *testing.T) {
	items := []MediaItem{
		{Key: "public.mp4", MediaType: "video"},
		{Key: "restricted.jpg", MediaType: "image", VisibleTo: []string{"userA"}},
	}

	t.Run("userA sees both", func(t *testing.T) {
		result := mediaItemsToDisplay(items, "userA", false, "")
		if len(result) != 2 {
			t.Errorf("userA should see 2, got %d", len(result))
		}
	})

	t.Run("userB sees only public", func(t *testing.T) {
		result := mediaItemsToDisplay(items, "userB", false, "")
		if len(result) != 1 {
			t.Errorf("userB should see 1, got %d", len(result))
		}
	})

	t.Run("creator sees all", func(t *testing.T) {
		result := mediaItemsToDisplay(items, "userB", false, "userB")
		if len(result) != 2 {
			t.Errorf("creator should see 2, got %d", len(result))
		}
	})
}

func TestRecordVisibilityIntegration(t *testing.T) {
	s := newTestServer(t)
	admin := insertUser(t, "admin", "Admin", "admin")
	viewer := insertUser(t, "viewer", "Viewer", "viewer")
	bid := createBabyFor(t, admin, "宝宝")

	viewerUID := tokenToUserID(viewer)
	_, err := db.Exec(`INSERT INTO "BabyMember" (id, userId, babyId, role) VALUES (?, ?, ?, 'viewer')`,
		"mem-"+viewerUID, viewerUID, bid)
	if err != nil {
		t.Fatalf("add viewer member: %v", err)
	}

	adminUID := tokenToUserID(admin)

	// Pre-insert UploadedFile records so validation passes
	for _, key := range []string{"img1.jpg", "img2.jpg"} {
		_, err := db.Exec(`INSERT INTO "UploadedFile" (key, createdAt) VALUES (?, ?)`,
			key, nowMillis())
		if err != nil {
			t.Fatalf("insert uploaded file: %v", err)
		}
	}

	images := []map[string]interface{}{
		{"key": "img1.jpg", "mediaType": "image"},
		{"key": "img2.jpg", "mediaType": "image", "visibleTo": []string{adminUID}},
	}

	body := map[string]interface{}{
		"babyId":     bid,
		"category":   "feeding",
		"type":       "bottle",
		"data":       map[string]interface{}{"amount": 100},
		"occurredAt": "2024-01-01T08:00:00Z",
		"images":     images,
	}

	r := s.do(http.MethodPost, "/records/", admin, body)
	e := mustOK(t, r)
	var rec recordOut
	jsonUnmarshal(e.Data, &rec)
	if len(rec.Images) != 2 {
		t.Fatalf("admin create should return 2 images, got %d", len(rec.Images))
	}

	// Viewer queries records - should only see 1 image (the public one)
	r2 := s.do(http.MethodGet, "/records/?babyId="+bid, viewer, nil)
	e2 := mustOK(t, r2)
	var listResp struct {
		Items []recordOut `json:"items"`
	}
	jsonUnmarshal(e2.Data, &listResp)
	if len(listResp.Items) != 1 {
		t.Fatalf("expected 1 record, got %d", len(listResp.Items))
	}
	if len(listResp.Items[0].Images) != 1 {
		t.Fatalf("viewer should see 1 image, got %d", len(listResp.Items[0].Images))
	}
	if listResp.Items[0].Images[0].Key != "img1.jpg" {
		t.Errorf("viewer should see img1.jpg, got %s", listResp.Items[0].Images[0].Key)
	}

	// Admin queries records - should see both
	r3 := s.do(http.MethodGet, "/records/?babyId="+bid, admin, nil)
	e3 := mustOK(t, r3)
	var listResp2 struct {
		Items []recordOut `json:"items"`
	}
	jsonUnmarshal(e3.Data, &listResp2)
	if len(listResp2.Items[0].Images) != 2 {
		t.Fatalf("admin should see 2 images, got %d", len(listResp2.Items[0].Images))
	}
}
