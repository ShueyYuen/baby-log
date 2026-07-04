package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
)

var (
	vapidPublicKey  = os.Getenv("VAPID_PUBLIC_KEY")
	vapidPrivateKey = os.Getenv("VAPID_PRIVATE_KEY")
	vapidSubject    = envOr("VAPID_SUBJECT", "mailto:baby-log@example.com")
)

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type pushPayload struct {
	Title string                 `json:"title"`
	Body  string                 `json:"body"`
	Data  map[string]interface{} `json:"data,omitempty"`
}

// GET /push/vapid-key
func handleVapidKey(w http.ResponseWriter, r *http.Request) {
	writeOK(w, map[string]interface{}{"publicKey": vapidPublicKey})
}

// POST /push/subscribe
func handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Endpoint == "" || body.Keys.P256dh == "" || body.Keys.Auth == "" {
		writeErr(w, http.StatusBadRequest, "Invalid subscription data")
		return
	}

	log.Printf("[Push] Subscribe request from user %s", userID)

	_, err := db.Exec(`
		INSERT INTO "PushSubscription" (id, userId, endpoint, p256dh, auth, createdAt)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, userId = excluded.userId`,
		uuid.NewString(), userID, body.Endpoint, body.Keys.P256dh, body.Keys.Auth, int64(nowMillis()))
	if err != nil {
		log.Printf("[Push] Subscribe error: %v", err)
		writeErr(w, http.StatusBadRequest, "Invalid subscription data")
		return
	}

	writeSuccess(w)
}

// DELETE /push/subscribe
func handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Endpoint == "" {
		writeErr(w, http.StatusBadRequest, "endpoint required")
		return
	}

	if _, err := db.Exec(`DELETE FROM "PushSubscription" WHERE endpoint = ? AND userId = ?`, body.Endpoint, userID); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeSuccess(w)
}

// POST /push/reminder
func handleCreateReminder(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID   string  `json:"babyId"`
		RemindAt string  `json:"remindAt"`
		Source   *string `json:"source"`
		Title    *string `json:"title"`
		Body     *string `json:"body"`
		RefID    *string `json:"refId"`
	}
	if err := decodeJSON(r, &body); err != nil || body.BabyID == "" || body.RemindAt == "" {
		writeErr(w, http.StatusBadRequest, "Invalid data")
		return
	}
	source := "feeding_manual"
	if body.Source != nil && *body.Source != "" {
		switch *body.Source {
		case "feeding_auto", "feeding_manual", "plan":
			source = *body.Source
		default:
			writeErr(w, http.StatusBadRequest, "Invalid data")
			return
		}
	}

	ok, err := findMembership(body.BabyID, userID)
	if err != nil || !ok {
		if err != nil {
			// 原实现 catch 后返回 400 Invalid data
			writeErr(w, http.StatusBadRequest, "Invalid data")
			return
		}
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	remindAt, err := millisFromInput(body.RemindAt)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid data")
		return
	}

	title := ""
	if body.Title != nil {
		title = *body.Title
	}
	bodyText := ""
	if body.Body != nil {
		bodyText = *body.Body
	}

	id := uuid.NewString()
	now := nowMillis()
	if _, err := db.Exec(`INSERT INTO "Reminder" (id, babyId, remindAt, source, title, body, refId, sent, createdAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
		id, body.BabyID, int64(remindAt), source, title, bodyText, nullStringFromPtr(body.RefID), int64(now)); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid data")
		return
	}

	row := db.QueryRow(`SELECT id, babyId, remindAt, source, title, body, refId, sent, createdAt FROM "Reminder" WHERE id = ?`, id)
	rem, err := scanReminderRow(row)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid data")
		return
	}
	writeOK(w, rem)
}

// GET /push/reminder
func handleListReminders(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	babyID := r.URL.Query().Get("babyId")
	if babyID == "" {
		writeErr(w, http.StatusBadRequest, "babyId required")
		return
	}

	ok, err := findMembership(babyID, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	rows, err := db.Query(`SELECT id, babyId, remindAt, source, title, body, refId, sent, createdAt
		FROM "Reminder" WHERE babyId = ? AND sent = 0 AND remindAt >= ? ORDER BY remindAt ASC LIMIT 10`,
		babyID, int64(nowMillis()))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	list := []reminderOut{}
	for rows.Next() {
		rem, err := scanReminderRow(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		list = append(list, *rem)
	}
	writeOK(w, list)
}

// POST /push/due-reminders — 轮询到期提醒并标记已发送。
// 使用 POST 因为此端点有副作用（标记 sent）。
// 只标记当前用户已轮询的提醒，不影响其他家庭成员。
func handleDueReminders(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	now := int64(nowMillis())

	memRows, err := db.Query(`SELECT babyId FROM "BabyMember" WHERE userId = ?`, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	var babyIDs []string
	for memRows.Next() {
		var bid string
		if err := memRows.Scan(&bid); err != nil {
			memRows.Close()
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		babyIDs = append(babyIDs, bid)
	}
	memRows.Close()

	if len(babyIDs) == 0 {
		writeOK(w, []interface{}{})
		return
	}

	args := []interface{}{}
	for _, b := range babyIDs {
		args = append(args, b)
	}
	args = append(args, now, userID)
	rows, err := db.Query(`
		SELECT r.id, r.title, r.body, b.name
		FROM "Reminder" r JOIN "Baby" b ON b.id = r.babyId
		WHERE r.babyId IN (`+placeholders(len(babyIDs))+`)
		  AND r.remindAt <= ?
		  AND r.id NOT IN (SELECT reminderId FROM "ReminderDelivered" WHERE userId = ?)`, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	type notif struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	notifications := []notif{}
	var ids []string
	for rows.Next() {
		var id, title, body, babyName string
		if err := rows.Scan(&id, &title, &body, &babyName); err != nil {
			rows.Close()
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		if title == "" {
			title = babyName + " 提醒"
		}
		if body == "" {
			body = "您有一条提醒"
		}
		notifications = append(notifications, notif{ID: id, Title: title, Body: body})
		ids = append(ids, id)
	}
	rows.Close()

	if len(notifications) == 0 {
		writeOK(w, []interface{}{})
		return
	}

	// 标记这些提醒对当前用户已投递
	for _, id := range ids {
		db.Exec(`INSERT OR IGNORE INTO "ReminderDelivered" (reminderId, userId, deliveredAt) VALUES (?, ?, ?)`,
			id, userID, now)
	}

	log.Printf("[Push] Served %d due reminder(s) via polling to user %s", len(notifications), userID)
	writeOK(w, notifications)
}

func scanReminderRow(row interface {
	Scan(dest ...interface{}) error
}) (*reminderOut, error) {
	var rem reminderOut
	var remindAt, created int64
	var sentInt int64
	var refID sql.NullString
	if err := row.Scan(&rem.ID, &rem.BabyID, &remindAt, &rem.Source, &rem.Title, &rem.Body, &refID, &sentInt, &created); err != nil {
		return nil, err
	}
	rem.RemindAt = Millis(remindAt)
	rem.CreatedAt = Millis(created)
	rem.RefID = strPtr(refID)
	rem.Sent = sentInt != 0
	return &rem, nil
}

// ---- Web Push 发送 ----

func vapidConfigured() bool {
	return vapidPublicKey != "" && vapidPrivateKey != ""
}

func sendPushToUser(userID string, payload pushPayload) {
	if !vapidConfigured() {
		return
	}
	rows, err := db.Query(`SELECT id, endpoint, p256dh, auth FROM "PushSubscription" WHERE userId = ?`, userID)
	if err != nil {
		return
	}
	type sub struct{ id, endpoint, p256dh, auth string }
	var subs []sub
	for rows.Next() {
		var s sub
		if err := rows.Scan(&s.id, &s.endpoint, &s.p256dh, &s.auth); err != nil {
			continue
		}
		subs = append(subs, s)
	}
	rows.Close()

	log.Printf("[Push] Sending to user %s, found %d subscription(s)", userID, len(subs))
	if len(subs) == 0 {
		return
	}

	msg, _ := json.Marshal(payload)
	for _, s := range subs {
		resp, err := webpush.SendNotification(msg, &webpush.Subscription{
			Endpoint: s.endpoint,
			Keys:     webpush.Keys{P256dh: s.p256dh, Auth: s.auth},
		}, &webpush.Options{
			Subscriber:      vapidSubject,
			VAPIDPublicKey:  vapidPublicKey,
			VAPIDPrivateKey: vapidPrivateKey,
			TTL:             30,
		})
		if err != nil {
			log.Printf("[Push] Failed to send: %v", err)
			continue
		}
		status := resp.StatusCode
		resp.Body.Close()
		if status == 410 || status == 404 {
			_, _ = db.Exec(`DELETE FROM "PushSubscription" WHERE id = ?`, s.id)
			log.Printf("[Push] Removed expired subscription %s", s.id)
		}
	}
}

func sendPushToBabyMembers(babyID string, payload pushPayload) {
	rows, err := db.Query(`SELECT userId FROM "BabyMember" WHERE babyId = ?`, babyID)
	if err != nil {
		return
	}
	var userIDs []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			continue
		}
		userIDs = append(userIDs, uid)
	}
	rows.Close()

	log.Printf("[Push] Sending to all members of baby %s, found %d member(s)", babyID, len(userIDs))
	for _, uid := range userIDs {
		sendPushToUser(uid, payload)
	}
}

var _ = time.Now
