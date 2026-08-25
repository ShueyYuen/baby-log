package main

import (
	"testing"
)

func TestFindMembershipRoles(t *testing.T) {
	setupTestDB(t)
	uid := insertUser(t, "u", "U", "user")
	bid := createBabyFor(t, uid, "宝宝")
	userID := tokenToUserID(uid)

	ok, err := findMembership(bid, userID)
	if err != nil || !ok {
		t.Fatalf("admin member should match any-role query: ok=%v err=%v", ok, err)
	}
	ok, err = findMembership(bid, userID, "admin")
	if err != nil || !ok {
		t.Fatalf("creator should be admin")
	}
	ok, _ = findMembership(bid, userID, "editor")
	if ok {
		t.Fatalf("admin should not match editor-only filter")
	}
	ok, _ = findMembership(bid, userID, "admin", "editor")
	if !ok {
		t.Fatalf("admin should match admin|editor")
	}

	other := insertUser(t, "o", "O", "user")
	ok, _ = findMembership(bid, tokenToUserID(other))
	if ok {
		t.Fatalf("non-member should not match")
	}
}

func TestAddUserToAllBabiesAndAddBabyToAllUsers(t *testing.T) {
	setupTestDB(t)
	u1 := insertUser(t, "u1", "U1", "user")
	bid := createBabyFor(t, u1, "A")

	u2 := insertUser(t, "u2", "U2", "user")
	if err := addUserToAllBabies(tokenToUserID(u2), defaultRole); err != nil {
		t.Fatal(err)
	}
	ok, _ := findMembership(bid, tokenToUserID(u2), defaultRole)
	if !ok {
		t.Fatalf("u2 should be added to existing babies")
	}

	bid2 := createBabyFor(t, u1, "B")
	if err := addBabyToAllUsers(bid2, defaultRole); err != nil {
		t.Fatal(err)
	}
	ok, _ = findMembership(bid2, tokenToUserID(u2), defaultRole)
	if !ok {
		t.Fatalf("existing users should be added to the new baby")
	}
}

func TestEnsureAllMembershipsBackfill(t *testing.T) {
	setupTestDB(t)
	u1 := insertUser(t, "u1", "U1", "user")
	bid := createBabyFor(t, u1, "A")
	u2 := insertUser(t, "u2", "U2", "user")

	ok, _ := findMembership(bid, tokenToUserID(u2))
	if ok {
		t.Fatalf("u2 should not be a member before backfill")
	}
	if err := ensureAllMemberships(); err != nil {
		t.Fatal(err)
	}
	ok, _ = findMembership(bid, tokenToUserID(u2))
	if !ok {
		t.Fatalf("backfill should make every user a member of every baby")
	}
}
