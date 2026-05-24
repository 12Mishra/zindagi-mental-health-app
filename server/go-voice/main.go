package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	"zindagi-voice/config"
	"zindagi-voice/db"
	"zindagi-voice/handlers"
	"zindagi-voice/middleware"
	"zindagi-voice/services"
)

func main() {
	cfg := config.Load()

	// Connect to database
	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer pool.Close()

	// Run migrations
	if err := db.Migrate(pool); err != nil {
		log.Printf("Warning: migration failed (may already exist): %v", err)
	}

	ctx := context.Background()

	// Initialize services
	deepgramSvc := services.NewDeepgramService(cfg.DeepgramAPIKey)
	geminiSvc, err := services.NewGeminiService(ctx, cfg.GeminiAPIKey)
	if err != nil {
		log.Fatalf("Gemini client init failed: %v", err)
	}

	uploadDir := filepath.Join("uploads", "audio")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatalf("Failed to create upload directory: %v", err)
	}

	voiceSvc := services.NewVoiceService(pool, deepgramSvc, geminiSvc, uploadDir)
	voiceHandler := handlers.NewVoiceHandler(voiceSvc, uploadDir)
	wsHandler := handlers.NewWSHandler(pool, voiceSvc, deepgramSvc, geminiSvc)

	// Setup router
	r := chi.NewRouter()
	r.Use(middleware.CORS)

	// Health check
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok": true}`))
	})

	// WebSocket route (auth via query param)
	r.Get("/voice/ws", wsHandler.HandleWebSocket)

	// Voice routes (authenticated)
	r.Route("/voice", func(r chi.Router) {
		r.Use(middleware.AuthMiddleware(pool))
		r.Post("/conversation", voiceHandler.StartConversation)
		r.Post("/message", voiceHandler.SendMessage)
		r.Get("/messages", voiceHandler.GetMessages)
		r.Get("/audio/{messageID}", voiceHandler.GetAudio)
	})

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Voice server listening on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
