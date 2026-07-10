package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

type EventType string

const (
	EventRecordCreated   EventType = "record.created"
	EventRecordUpdated   EventType = "record.updated"
	EventRecordDeleted   EventType = "record.deleted"
	EventPlanCreated     EventType = "plan.created"
	EventPlanUpdated     EventType = "plan.updated"
	EventPlanDeleted     EventType = "plan.deleted"
	EventGrowthCreated   EventType = "growth.created"
	EventGrowthUpdated   EventType = "growth.updated"
	EventGrowthDeleted   EventType = "growth.deleted"
	EventMilestoneChange EventType = "milestone.change"
	EventHealthChange    EventType = "health.change"
	EventMomentChange    EventType = "moment.change"
)

type DataEvent struct {
	Type   EventType `json:"type"`
	BabyID string    `json:"babyId,omitempty"`
	ID     string    `json:"id,omitempty"`
	UserID string    `json:"userId,omitempty"`
}

type subscriber struct {
	ch     chan DataEvent
	userID string
}

var eventHub = struct {
	mu          sync.RWMutex
	subscribers map[*subscriber]struct{}
}{
	subscribers: make(map[*subscriber]struct{}),
}

func publishEvent(evt DataEvent) {
	eventHub.mu.RLock()
	defer eventHub.mu.RUnlock()
	for sub := range eventHub.subscribers {
		select {
		case sub.ch <- evt:
		default:
			// subscriber buffer full, skip
		}
	}
}

func subscribe(userID string) *subscriber {
	sub := &subscriber{
		ch:     make(chan DataEvent, 32),
		userID: userID,
	}
	eventHub.mu.Lock()
	eventHub.subscribers[sub] = struct{}{}
	eventHub.mu.Unlock()
	return sub
}

func unsubscribe(sub *subscriber) {
	eventHub.mu.Lock()
	delete(eventHub.subscribers, sub)
	eventHub.mu.Unlock()
	close(sub.ch)
}

func handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "Streaming not supported")
		return
	}

	userID := getUserID(r)
	if userID == "" {
		writeErr(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sub := subscribe(userID)
	defer unsubscribe(sub)

	ctx := r.Context()

	// Send initial keepalive
	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-sub.ch:
			if !ok {
				return
			}
			// Don't send events triggered by the same user
			if evt.UserID == userID {
				continue
			}
			data, err := json.Marshal(evt)
			if err != nil {
				log.Printf("[SSE] marshal error: %v", err)
				continue
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
