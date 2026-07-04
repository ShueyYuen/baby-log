package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const apiPrefix = "/api/v1"

func main() {
	initDB()

	if err := ensureAdmin(); err != nil {
		log.Fatalf("Failed to bootstrap admin: %v", err)
	}
	if err := ensureAllMemberships(); err != nil {
		log.Printf("[Membership] ensureAllMemberships failed: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "uploads"
	}

	r := buildRouter(uploadDir, resolveWebDistDir())

	if vapidConfigured() {
		log.Println("[Push] VAPID keys configured")
	}

	startReminderScheduler()
	startCleanupScheduler()

	addr := ":" + port
	log.Printf("Server running on http://localhost:%s", port)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// buildRouter 构建带全部中间件与路由的 HTTP handler。
// 抽离出来以便测试通过 httptest 复用与生产完全一致的路由。
func buildRouter(uploadDir, webDist string) *chi.Mux {
	r := chi.NewRouter()
	r.Use(panicRecovery)
	r.Use(corsMiddleware)
	r.Use(httpLogger)

	r.Route(apiPrefix, func(r chi.Router) {
		// 静态文件（上传目录）
		r.Handle("/uploads/*", http.StripPrefix(apiPrefix+"/uploads/", http.FileServer(http.Dir(uploadDir))))

		r.Route("/auth", func(r chi.Router) {
			r.Post("/login", handleLogin)
			r.Group(func(r chi.Router) {
				r.Use(authMiddleware)
				r.Get("/me", handleMe)
				r.Post("/users", handleCreateUser)
				r.Get("/users", handleListUsers)
				r.Delete("/users/{id}", handleDeleteUser)
				r.Post("/users/{id}/reset-password", handleResetPassword)
				r.Put("/users/{id}/role", handleSetUserRole)
			})
		})

		// 需鉴权的业务路由
		r.Group(func(r chi.Router) {
			r.Use(authMiddleware)
			r.Use(idempotencyMiddleware)

			r.Route("/babies", func(r chi.Router) {
				r.Get("/", handleListBabies)
				r.Get("/{id}", handleGetBaby)
				r.Group(func(r chi.Router) {
					r.Use(requireEditorRole)
					r.Post("/", handleCreateBaby)
					r.Put("/{id}", handleUpdateBaby)
				})
			})

			r.Route("/records", func(r chi.Router) {
				r.Get("/", handleListRecords)
				r.Group(func(r chi.Router) {
					r.Use(requireEditorRole)
					r.Post("/", handleCreateRecord)
					r.Put("/{id}", handleUpdateRecord)
					r.Delete("/{id}", handleDeleteRecord)
				})
			})

			r.Route("/plans", func(r chi.Router) {
				r.Get("/", handleListPlans)
				r.Group(func(r chi.Router) {
					r.Use(requireEditorRole)
					r.Post("/", handleCreatePlan)
					r.Put("/{id}", handleUpdatePlan)
					r.Delete("/{id}", handleDeletePlan)
				})
			})

			r.Route("/growth", func(r chi.Router) {
				r.Get("/", handleListGrowth)
				r.Group(func(r chi.Router) {
					r.Use(requireEditorRole)
					r.Post("/", handleCreateGrowth)
					r.Put("/{id}", handleUpdateGrowth)
					r.Delete("/{id}", handleDeleteGrowth)
				})
			})

			r.Route("/milestones", func(r chi.Router) {
				r.Get("/", handleListMilestones)
				r.Group(func(r chi.Router) {
					r.Use(requireEditorRole)
					r.Post("/", handleCreateMilestone)
					r.Put("/{id}", handleUpdateMilestone)
					r.Delete("/{id}", handleDeleteMilestone)
				})
			})

		r.Route("/stats", func(r chi.Router) {
			r.Get("/summary", handleStatsSummary)
			r.Get("/predict", handleStatsPredict)
			r.Get("/daily", handleStatsDaily)
			r.Get("/range", handleStatsRange)
		})

		r.Get("/timeline", handleTimeline)

			r.Route("/upload", func(r chi.Router) {
				r.Post("/", handleUploadSingle)
				r.Post("/multiple", handleUploadMultiple)
			})

			r.Route("/moments", func(r chi.Router) {
				r.Post("/upload", handleUploadMomentMedia)
				r.Get("/", handleListMoments)
				r.Post("/", handleCreateMoment)
				r.Put("/{id}", handleUpdateMoment)
				r.Delete("/{id}", handleDeleteMoment)
				r.Post("/{id}/comments", handleCreateMomentComment)
				r.Delete("/{id}/comments/{commentId}", handleDeleteMomentComment)
			})

			r.Route("/push", func(r chi.Router) {
				r.Get("/vapid-key", handleVapidKey)
				r.Post("/subscribe", handlePushSubscribe)
				r.Delete("/subscribe", handlePushUnsubscribe)
				r.Post("/reminder", handleCreateReminder)
				r.Get("/reminder", handleListReminders)
				r.Post("/due-reminders", handleDueReminders)
			})

			r.Post("/admin/cleanup", handleManualCleanup)
		})

		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":    "ok",
				"timestamp": time.Now().UTC().Format(isoLayout),
			})
		})
	})

	// SPA 静态资源与回退
	log.Printf("[Static] Web dist dir: %s", orNotFound(webDist))
	if webDist != "" {
		indexHTML := filepath.Join(webDist, "index.html")
		if _, err := os.Stat(indexHTML); err == nil {
			log.Printf("[Static] index.html exists: true")
		}
		r.Handle("/*", spaHandler(webDist))
	} else {
		log.Println("[Static] No web dist directory found, SPA fallback disabled")
	}

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func httpLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("[HTTP] %s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}

func panicRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rv := recover(); rv != nil {
				log.Printf("[PANIC] %s %s: %v\n%s", r.Method, r.URL.Path, rv, debug.Stack())
				writeErr(w, http.StatusInternalServerError, "Internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func spaHandler(webDist string) http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(webDist))
	indexHTML := filepath.Join(webDist, "index.html")
	absWebDist, _ := filepath.Abs(webDist)
	return func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean("/" + r.URL.Path)
		full := filepath.Join(absWebDist, clean)
		if !strings.HasPrefix(full, absWebDist) {
			http.ServeFile(w, r, indexHTML)
			return
		}
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, indexHTML)
	}
}

func resolveWebDistDir() string {
	candidates := []string{
		os.Getenv("WEB_DIST_DIR"),
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "web"),      // 生产镜像布局：dist 已拷贝到 <cwd>/web
			filepath.Join(cwd, "web/dist"), // 本地：backend 同级 web 目录
			filepath.Join(cwd, "../web/dist"),
		)
	}
	for _, dir := range candidates {
		if dir == "" {
			continue
		}
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}

func orNotFound(s string) string {
	if s == "" {
		return "NOT FOUND"
	}
	return s
}

func ensureAdmin() error {
	username := os.Getenv("ADMIN_USERNAME")
	password := os.Getenv("ADMIN_PASSWORD")
	if username == "" || password == "" {
		log.Println("ADMIN_USERNAME/ADMIN_PASSWORD not set, skipping admin bootstrap")
		return nil
	}
	if len(password) < 8 {
		log.Println("ADMIN_PASSWORD must be at least 8 characters")
		os.Exit(1)
	}

	var id, role, existingHash string
	err := db.QueryRow(`SELECT id, role, password FROM "User" WHERE username = ?`, username).Scan(&id, &role, &existingHash)
	if err == nil {
		if role != "admin" || !checkPassword(existingHash, password) {
			now := nowMillis()
			if _, err := db.Exec(`UPDATE "User" SET role = 'admin', password = ?, updatedAt = ? WHERE username = ?`,
				hashPassword(password), int64(now), username); err != nil {
				return err
			}
			log.Printf("Admin account %q updated", username)
		}
		return nil
	}
	if !isNoRows(err) {
		return err
	}

	now := nowMillis()
	if _, err := db.Exec(`INSERT INTO "User" (id, username, password, displayName, role, createdAt, updatedAt) VALUES (?, ?, ?, '管理员', 'admin', ?, ?)`,
		uuid.NewString(), username, hashPassword(password), int64(now), int64(now)); err != nil {
		return err
	}
	log.Printf("Admin account %q created", username)
	return nil
}
