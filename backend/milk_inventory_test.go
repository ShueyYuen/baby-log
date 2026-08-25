package main

import (
	"net/http"
	"testing"
	"time"
)

func TestCalcMilkExpiresAt(t *testing.T) {
	stored := Millis(time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC).UnixMilli())
	fridge := calcMilkExpiresAt(stored, "fridge")
	if fridge.Time().Sub(stored.Time()) != 4*24*time.Hour {
		t.Fatalf("fridge should expire in 4 days, got %s -> %s", stored.Time(), fridge.Time())
	}
	freezer := calcMilkExpiresAt(stored, "freezer")
	want := stored.Time().AddDate(0, 6, 0)
	if freezer.Time().UTC().Year() != want.Year() || freezer.Time().UTC().Month() != want.Month() {
		t.Fatalf("freezer should expire in 6 months, got %s", freezer.Time())
	}
}

func TestMilkInventoryCRUD(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	r := s.do(http.MethodPost, "/milk-inventory/", uid, map[string]interface{}{
		"babyId": bid, "amountMl": 80, "storageType": "fridge",
		"storedAt": "2026-08-20T08:00:00.000Z", "note": "上午吸的",
	})
	e := mustOK(t, r)
	var created milkInventoryOut
	jsonUnmarshal(e.Data, &created)
	if created.AmountMl != 80 || created.StorageType != "fridge" || created.Status != "available" {
		t.Fatalf("create payload wrong: %+v", created)
	}
	if created.ExpiresAt <= created.StoredAt {
		t.Fatalf("expiresAt should be after storedAt")
	}

	list := s.do(http.MethodGet, "/milk-inventory/?babyId="+bid, uid, nil)
	le := mustOK(t, list)
	var items []milkInventoryOut
	jsonUnmarshal(le.Data, &items)
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}

	upd := s.do(http.MethodPut, "/milk-inventory/"+created.ID, uid, map[string]interface{}{
		"status": "used",
	})
	ue := mustOK(t, upd)
	jsonUnmarshal(ue.Data, &created)
	if created.Status != "used" {
		t.Fatalf("status not updated: %s", created.Status)
	}

	usedList := s.do(http.MethodGet, "/milk-inventory/?babyId="+bid+"&status=used", uid, nil)
	ue2 := mustOK(t, usedList)
	jsonUnmarshal(ue2.Data, &items)
	if len(items) != 1 {
		t.Fatalf("used filter expected 1, got %d", len(items))
	}

	del := s.do(http.MethodDelete, "/milk-inventory/"+created.ID, uid, nil)
	mustOK(t, del)
	empty := s.do(http.MethodGet, "/milk-inventory/?babyId="+bid+"&status=all", uid, nil)
	ee := mustOK(t, empty)
	jsonUnmarshal(ee.Data, &items)
	if len(items) != 0 {
		t.Fatalf("expected empty after delete, got %d", len(items))
	}
}

func TestMilkInventoryValidationAndPermission(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	bad := s.do(http.MethodPost, "/milk-inventory/", uid, map[string]interface{}{
		"babyId": bid, "amountMl": 0, "storageType": "fridge",
	})
	if bad.status != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid amount, got %d", bad.status)
	}

	missing := s.do(http.MethodGet, "/milk-inventory/", uid, nil)
	if missing.status != http.StatusBadRequest {
		t.Fatalf("expected 400 without babyId, got %d", missing.status)
	}

	other := insertUser(t, "other", "Other", "user")
	deny := s.do(http.MethodPost, "/milk-inventory/", other, map[string]interface{}{
		"babyId": bid, "amountMl": 50, "storageType": "freezer",
	})
	if deny.status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", deny.status)
	}

	nf := s.do(http.MethodPut, "/milk-inventory/missing", uid, map[string]interface{}{"status": "used"})
	if nf.status != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", nf.status)
	}
}

func TestMarkExpiredMilkInventory(t *testing.T) {
	s := newTestServer(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")

	past := time.Now().Add(-6 * 24 * time.Hour).UTC().Format(time.RFC3339Nano)
	r := s.do(http.MethodPost, "/milk-inventory/", uid, map[string]interface{}{
		"babyId": bid, "amountMl": 40, "storageType": "fridge", "storedAt": past,
	})
	mustOK(t, r)

	markExpiredMilkInventory()
	list := s.do(http.MethodGet, "/milk-inventory/?babyId="+bid+"&status=expired", uid, nil)
	e := mustOK(t, list)
	var items []milkInventoryOut
	jsonUnmarshal(e.Data, &items)
	if len(items) != 1 {
		t.Fatalf("expected expired item, got %d; body=%s", len(items), string(list.body))
	}
}
