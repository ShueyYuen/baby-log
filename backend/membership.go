package main

import "github.com/google/uuid"

// 家庭共享模型：所有用户共享所有宝宝。

const defaultRole = "editor"

func addUserToAllBabies(userID, role string) error {
	rows, err := db.Query(`SELECT id FROM "Baby"`)
	if err != nil {
		return err
	}
	var babyIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		babyIDs = append(babyIDs, id)
	}
	rows.Close()
	if len(babyIDs) == 0 {
		return nil
	}

	have := map[string]bool{}
	er, err := db.Query(`SELECT babyId FROM "BabyMember" WHERE userId = ?`, userID)
	if err != nil {
		return err
	}
	for er.Next() {
		var bid string
		if err := er.Scan(&bid); err != nil {
			er.Close()
			return err
		}
		have[bid] = true
	}
	er.Close()

	for _, bid := range babyIDs {
		if have[bid] {
			continue
		}
		if _, err := db.Exec(`INSERT INTO "BabyMember" (id, userId, babyId, role) VALUES (?, ?, ?, ?)`,
			uuid.NewString(), userID, bid, role); err != nil {
			return err
		}
	}
	return nil
}

func addBabyToAllUsers(babyID, role string) error {
	rows, err := db.Query(`SELECT id FROM "User"`)
	if err != nil {
		return err
	}
	var userIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		userIDs = append(userIDs, id)
	}
	rows.Close()
	if len(userIDs) == 0 {
		return nil
	}

	have := map[string]bool{}
	er, err := db.Query(`SELECT userId FROM "BabyMember" WHERE babyId = ?`, babyID)
	if err != nil {
		return err
	}
	for er.Next() {
		var uid string
		if err := er.Scan(&uid); err != nil {
			er.Close()
			return err
		}
		have[uid] = true
	}
	er.Close()

	for _, uid := range userIDs {
		if have[uid] {
			continue
		}
		if _, err := db.Exec(`INSERT INTO "BabyMember" (id, userId, babyId, role) VALUES (?, ?, ?, ?)`,
			uuid.NewString(), uid, babyID, role); err != nil {
			return err
		}
	}
	return nil
}

// ensureAllMemberships 回填：确保每个用户都是每个宝宝的成员。
func ensureAllMemberships() error {
	var userIDs, babyIDs []string

	ur, err := db.Query(`SELECT id FROM "User"`)
	if err != nil {
		return err
	}
	for ur.Next() {
		var id string
		if err := ur.Scan(&id); err != nil {
			ur.Close()
			return err
		}
		userIDs = append(userIDs, id)
	}
	ur.Close()

	br, err := db.Query(`SELECT id FROM "Baby"`)
	if err != nil {
		return err
	}
	for br.Next() {
		var id string
		if err := br.Scan(&id); err != nil {
			br.Close()
			return err
		}
		babyIDs = append(babyIDs, id)
	}
	br.Close()

	if len(userIDs) == 0 || len(babyIDs) == 0 {
		return nil
	}

	have := map[string]bool{}
	mr, err := db.Query(`SELECT userId, babyId FROM "BabyMember"`)
	if err != nil {
		return err
	}
	for mr.Next() {
		var uid, bid string
		if err := mr.Scan(&uid, &bid); err != nil {
			mr.Close()
			return err
		}
		have[uid+":"+bid] = true
	}
	mr.Close()

	count := 0
	for _, uid := range userIDs {
		for _, bid := range babyIDs {
			if have[uid+":"+bid] {
				continue
			}
			if _, err := db.Exec(`INSERT INTO "BabyMember" (id, userId, babyId, role) VALUES (?, ?, ?, ?)`,
				uuid.NewString(), uid, bid, defaultRole); err != nil {
				return err
			}
			count++
		}
	}
	if count > 0 {
		logInfo("[Membership] Backfilled %d baby membership(s)", count)
	}
	return nil
}

// findMembership 查询用户对某宝宝的成员关系；roles 非空时要求角色在集合内。
func findMembership(babyID, userID string, roles ...string) (bool, error) {
	query := `SELECT 1 FROM "BabyMember" WHERE babyId = ? AND userId = ?`
	args := []interface{}{babyID, userID}
	if len(roles) > 0 {
		query += ` AND role IN (` + placeholders(len(roles)) + `)`
		for _, r := range roles {
			args = append(args, r)
		}
	}
	query += ` LIMIT 1`
	var one int
	err := db.QueryRow(query, args...).Scan(&one)
	if err != nil {
		if isNoRows(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
