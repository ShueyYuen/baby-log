package main

import "encoding/json"

type userPublic struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}

type memberUser struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
}

type babyMemberOut struct {
	ID     string     `json:"id"`
	UserID string     `json:"userId"`
	BabyID string     `json:"babyId"`
	Role   string     `json:"role"`
	User   memberUser `json:"user"`
}

type babyOut struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Gender    string          `json:"gender"`
	BirthDate Millis          `json:"birthDate"`
	Avatar    *string         `json:"avatar"`
	CreatedAt Millis          `json:"createdAt"`
	UpdatedAt Millis          `json:"updatedAt"`
	Members   []babyMemberOut `json:"members,omitempty"`
}

// RecordImageStore is the JSON shape persisted in Record.images / Milestone.images.
type RecordImageStore struct {
	Key       string `json:"key"`
	RawKey    string `json:"rawKey,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
}

// RecordImageDisplay is the API response shape with resolved URLs.
type RecordImageDisplay struct {
	Key       string `json:"key"`
	RawKey    string `json:"rawKey,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
	URL       string `json:"url"`
	RawURL    string `json:"rawUrl,omitempty"`
}

type recordOut struct {
	ID         string              `json:"id"`
	BabyID     string              `json:"babyId"`
	Category   string              `json:"category"`
	Type       string              `json:"type"`
	Data       json.RawMessage     `json:"data"`
	OccurredAt Millis              `json:"occurredAt"`
	Note       *string             `json:"note"`
	Images     []RecordImageDisplay `json:"images"`
	CreatedBy  string              `json:"createdBy"`
	CreatedAt  Millis              `json:"createdAt"`
	UpdatedAt  Millis              `json:"updatedAt"`
	User       *memberUser         `json:"user,omitempty"`
}

type planOut struct {
	ID          string  `json:"id"`
	BabyID      string  `json:"babyId"`
	Title       string  `json:"title"`
	Type        string  `json:"type"`
	ScheduledAt Millis  `json:"scheduledAt"`
	Description *string `json:"description"`
	Reminder    *string `json:"reminder"`
	Repeat      string  `json:"repeat"`
	Status      string  `json:"status"`
	CreatedBy   string  `json:"createdBy"`
	CreatedAt   Millis  `json:"createdAt"`
	UpdatedAt   Millis  `json:"updatedAt"`
}

type growthOut struct {
	ID                string   `json:"id"`
	BabyID            string   `json:"babyId"`
	Date              Millis   `json:"date"`
	Height            *float64 `json:"height"`
	Weight            *float64 `json:"weight"`
	HeadCircumference *float64 `json:"headCircumference"`
	Note              *string  `json:"note"`
	CreatedAt         Millis   `json:"createdAt"`
	UpdatedAt         Millis   `json:"updatedAt"`
}

type milestoneOut struct {
	ID          string              `json:"id"`
	BabyID      string              `json:"babyId"`
	Type        string              `json:"type"`
	Title       string              `json:"title"`
	OccurredAt  Millis              `json:"occurredAt"`
	Description *string             `json:"description"`
	Images      []RecordImageDisplay `json:"images"`
	CreatedAt   Millis              `json:"createdAt"`
	UpdatedAt   Millis              `json:"updatedAt"`
}

type reminderOut struct {
	ID        string  `json:"id"`
	BabyID    string  `json:"babyId"`
	RemindAt  Millis  `json:"remindAt"`
	Source    string  `json:"source"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	RefID     *string `json:"refId"`
	Sent      bool    `json:"sent"`
	CreatedAt Millis  `json:"createdAt"`
}
