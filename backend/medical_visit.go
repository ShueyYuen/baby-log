package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type medicalVisitOut struct {
	ID           string        `json:"id"`
	BabyID       string        `json:"babyId"`
	VisitDate    Millis        `json:"visitDate"`
	Hospital     string        `json:"hospital"`
	Department   string        `json:"department"`
	Doctor       string        `json:"doctor"`
	Diagnosis    string        `json:"diagnosis"`
	Prescription string        `json:"prescription"`
	Notes        string        `json:"notes"`
	Images       []mvImage     `json:"images"`
	OcrText      string        `json:"ocrText"`
	OcrData      []ocrDataItem `json:"ocrData"`
	CreatedBy    string        `json:"createdBy"`
	CreatedAt    Millis        `json:"createdAt"`
	UpdatedAt    Millis        `json:"updatedAt"`
}

type ocrDataItem struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

type mvImage struct {
	Key      string `json:"key"`
	RawKey   string `json:"rawKey,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
	URL      string `json:"url,omitempty"`
	RawURL   string `json:"rawUrl,omitempty"`
}

const medicalVisitCols = `id, babyId, visitDate, hospital, department, doctor, diagnosis, prescription, notes, images, ocrText, ocrData, createdBy, createdAt, updatedAt`

func scanMedicalVisitRow(row interface{ Scan(dest ...interface{}) error }) (*medicalVisitOut, error) {
	var m medicalVisitOut
	var visitDate, created, updated int64
	var imagesJSON, ocrDataJSON string
	if err := row.Scan(&m.ID, &m.BabyID, &visitDate, &m.Hospital, &m.Department, &m.Doctor, &m.Diagnosis, &m.Prescription, &m.Notes, &imagesJSON, &m.OcrText, &ocrDataJSON, &m.CreatedBy, &created, &updated); err != nil {
		return nil, err
	}
	m.VisitDate = Millis(visitDate)
	m.CreatedAt = Millis(created)
	m.UpdatedAt = Millis(updated)

	var imgs []mvImage
	if err := json.Unmarshal([]byte(imagesJSON), &imgs); err != nil {
		imgs = []mvImage{}
	}
	for i := range imgs {
		u, _ := toDisplayURL(imgs[i].Key, 86400)
		imgs[i].URL = u
		if imgs[i].RawKey != "" {
			ru, _ := toDisplayURL(imgs[i].RawKey, 86400)
			imgs[i].RawURL = ru
		}
	}
	m.Images = imgs

	var ocrItems []ocrDataItem
	if err := json.Unmarshal([]byte(ocrDataJSON), &ocrItems); err != nil {
		ocrItems = []ocrDataItem{}
	}
	m.OcrData = ocrItems

	return &m, nil
}

// GET /medical-visits?babyId=&q=&page=&pageSize=
func handleListMedicalVisits(w http.ResponseWriter, r *http.Request) {
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

	q := strings.TrimSpace(r.URL.Query().Get("q"))
	where := `WHERE "babyId" = ?`
	args := []interface{}{babyID}

	if q != "" {
		like := "%" + q + "%"
		where += ` AND ("hospital" LIKE ? OR "department" LIKE ? OR "doctor" LIKE ? OR "diagnosis" LIKE ? OR "prescription" LIKE ? OR "notes" LIKE ? OR "ocrText" LIKE ?)`
		args = append(args, like, like, like, like, like, like, like)
	}

	var total int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "MedicalVisit" `+where, args...).Scan(&total); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	page := intQueryParam(r, "page", 1)
	pageSize := intQueryParam(r, "pageSize", 20)
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	queryArgs := append(args, pageSize, offset)

	rows, err := db.Query(
		`SELECT `+medicalVisitCols+` FROM "MedicalVisit" `+where+` ORDER BY "visitDate" DESC LIMIT ? OFFSET ?`,
		queryArgs...,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	defer rows.Close()

	items := []medicalVisitOut{}
	for rows.Next() {
		m, err := scanMedicalVisitRow(rows)
		if err != nil {
			log.Printf("[MedicalVisit] scan error: %v", err)
			writeErr(w, http.StatusInternalServerError, "Server error")
			return
		}
		items = append(items, *m)
	}

	writeOK(w, map[string]interface{}{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"hasMore":  offset+len(items) < total,
	})
}

// GET /medical-visits/{id}
func handleGetMedicalVisit(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	row := db.QueryRow(`SELECT `+medicalVisitCols+` FROM "MedicalVisit" WHERE id = ?`, id)
	m, err := scanMedicalVisitRow(row)
	if err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(m.BabyID, userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	writeOK(w, m)
}

// POST /medical-visits
func handleCreateMedicalVisit(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)

	var body struct {
		BabyID       string        `json:"babyId"`
		VisitDate    string        `json:"visitDate"`
		Hospital     string        `json:"hospital"`
		Department   string        `json:"department"`
		Doctor       string        `json:"doctor"`
		Diagnosis    string        `json:"diagnosis"`
		Prescription string        `json:"prescription"`
		Notes        string        `json:"notes"`
		Images       []mvImage     `json:"images"`
		OcrText      string        `json:"ocrText"`
		OcrData      []ocrDataItem `json:"ocrData"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.BabyID == "" {
		writeErr(w, http.StatusBadRequest, "babyId required")
		return
	}

	ok, err := findMembership(body.BabyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	visitDate := nowMillis()
	if body.VisitDate != "" {
		if m, err := millisFromInput(body.VisitDate); err == nil {
			visitDate = m
		} else {
			writeErr(w, http.StatusBadRequest, "Invalid visitDate")
			return
		}
	}

	imgsForStore := make([]mvImage, len(body.Images))
	for i, img := range body.Images {
		imgsForStore[i] = mvImage{Key: img.Key, RawKey: img.RawKey, MediaType: img.MediaType}
	}
	imagesJSON, _ := json.Marshal(imgsForStore)

	if body.OcrData == nil {
		body.OcrData = []ocrDataItem{}
	}
	ocrDataJSON, _ := json.Marshal(body.OcrData)

	id := uuid.NewString()
	now := nowMillis()
	if _, err := db.Exec(
		`INSERT INTO "MedicalVisit" (id, babyId, visitDate, hospital, department, doctor, diagnosis, prescription, notes, images, ocrText, ocrData, createdBy, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, body.BabyID, int64(visitDate), body.Hospital, body.Department, body.Doctor,
		body.Diagnosis, body.Prescription, body.Notes, string(imagesJSON), body.OcrText,
		string(ocrDataJSON), userID, int64(now), int64(now),
	); err != nil {
		log.Printf("[MedicalVisit] create error: %v", err)
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	row := db.QueryRow(`SELECT `+medicalVisitCols+` FROM "MedicalVisit" WHERE id = ?`, id)
	out, err := scanMedicalVisitRow(row)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, out)
}

// PUT /medical-visits/{id}
func handleUpdateMedicalVisit(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT "babyId" FROM "MedicalVisit" WHERE id = ?`, id).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(babyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	var body struct {
		VisitDate    *string        `json:"visitDate"`
		Hospital     *string        `json:"hospital"`
		Department   *string        `json:"department"`
		Doctor       *string        `json:"doctor"`
		Diagnosis    *string        `json:"diagnosis"`
		Prescription *string        `json:"prescription"`
		Notes        *string        `json:"notes"`
		Images       *[]mvImage     `json:"images"`
		OcrText      *string        `json:"ocrText"`
		OcrData      *[]ocrDataItem `json:"ocrData"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "Invalid input")
		return
	}

	sets := []string{`"updatedAt" = ?`}
	args := []interface{}{int64(nowMillis())}

	if body.VisitDate != nil {
		m, err := millisFromInput(*body.VisitDate)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "Invalid visitDate")
			return
		}
		sets = append(sets, `"visitDate" = ?`)
		args = append(args, int64(m))
	}
	if body.Hospital != nil {
		sets = append(sets, `"hospital" = ?`)
		args = append(args, *body.Hospital)
	}
	if body.Department != nil {
		sets = append(sets, `"department" = ?`)
		args = append(args, *body.Department)
	}
	if body.Doctor != nil {
		sets = append(sets, `"doctor" = ?`)
		args = append(args, *body.Doctor)
	}
	if body.Diagnosis != nil {
		sets = append(sets, `"diagnosis" = ?`)
		args = append(args, *body.Diagnosis)
	}
	if body.Prescription != nil {
		sets = append(sets, `"prescription" = ?`)
		args = append(args, *body.Prescription)
	}
	if body.Notes != nil {
		sets = append(sets, `"notes" = ?`)
		args = append(args, *body.Notes)
	}
	if body.Images != nil {
		imgsForStore := make([]mvImage, len(*body.Images))
		for i, img := range *body.Images {
			imgsForStore[i] = mvImage{Key: img.Key, RawKey: img.RawKey, MediaType: img.MediaType}
		}
		imagesJSON, _ := json.Marshal(imgsForStore)
		sets = append(sets, `"images" = ?`)
		args = append(args, string(imagesJSON))
	}
	if body.OcrText != nil {
		sets = append(sets, `"ocrText" = ?`)
		args = append(args, *body.OcrText)
	}
	if body.OcrData != nil {
		ocrDataJSON, _ := json.Marshal(*body.OcrData)
		sets = append(sets, `"ocrData" = ?`)
		args = append(args, string(ocrDataJSON))
	}

	args = append(args, id)
	if _, err := db.Exec(`UPDATE "MedicalVisit" SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...); err != nil {
		log.Printf("[MedicalVisit] update error: %v", err)
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	row := db.QueryRow(`SELECT `+medicalVisitCols+` FROM "MedicalVisit" WHERE id = ?`, id)
	out, err := scanMedicalVisitRow(row)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeOK(w, out)
}

// DELETE /medical-visits/{id}
func handleDeleteMedicalVisit(w http.ResponseWriter, r *http.Request) {
	userID := getUserID(r)
	id := chiURLParam(r, "id")

	var babyID string
	if err := db.QueryRow(`SELECT "babyId" FROM "MedicalVisit" WHERE id = ?`, id).Scan(&babyID); err != nil {
		if isNoRows(err) {
			writeErr(w, http.StatusNotFound, "Not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}

	ok, err := findMembership(babyID, userID, "admin", "editor")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	if !ok {
		writeErr(w, http.StatusForbidden, "Permission denied")
		return
	}

	if _, err := db.Exec(`DELETE FROM "MedicalVisit" WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "Server error")
		return
	}
	writeSuccess(w)
}

func intQueryParam(r *http.Request, key string, defaultVal int) int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return defaultVal
	}
	var v int
	if _, err := fmt.Sscanf(s, "%d", &v); err != nil {
		return defaultVal
	}
	return v
}
