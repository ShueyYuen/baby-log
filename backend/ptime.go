package main

import (
	"strconv"
	"time"
)

// Millis 表示 Unix 毫秒时间戳。
// Prisma 在 SQLite 中把 DateTime 存为毫秒整数，JSON 输出为 ISO8601（带 3 位毫秒、UTC "Z"），
// 例如 2025-06-01T00:00:00.000Z。这里保持完全一致，以兼容原 TypeScript 后端接口。
type Millis int64

const isoLayout = "2006-01-02T15:04:05.000Z07:00"

func (m Millis) Time() time.Time {
	return time.UnixMilli(int64(m)).UTC()
}

func (m Millis) MarshalJSON() ([]byte, error) {
	s := m.Time().Format(isoLayout)
	buf := make([]byte, 0, len(s)+2)
	buf = append(buf, '"')
	buf = append(buf, s...)
	buf = append(buf, '"')
	return buf, nil
}

func (m *Millis) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" {
		return nil
	}
	// 允许直接是数字毫秒
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		*m = Millis(n)
		return nil
	}
	// 去掉引号后按 ISO 解析
	if len(s) >= 2 && s[0] == '"' {
		s = s[1 : len(s)-1]
	}
	t, err := parseFlexibleTime(s)
	if err != nil {
		return err
	}
	*m = Millis(t.UnixMilli())
	return nil
}

func nowMillis() Millis {
	return Millis(time.Now().UnixMilli())
}

// parseFlexibleTime 解析多种常见的日期时间字符串（ISO、纯日期等）。
func parseFlexibleTime(s string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z07:00",
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	var lastErr error
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		} else {
			lastErr = err
		}
	}
	return time.Time{}, lastErr
}

// millisFromInput 把接口入参（ISO 字符串）转成毫秒时间戳。
func millisFromInput(s string) (Millis, error) {
	t, err := parseFlexibleTime(s)
	if err != nil {
		return 0, err
	}
	return Millis(t.UnixMilli()), nil
}
