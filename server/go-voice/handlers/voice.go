package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"

	"zindagi-voice/middleware"
	"zindagi-voice/services"
)

type VoiceHandler struct {
	voice     *services.VoiceService
	uploadDir string
}

func NewVoiceHandler(voice *services.VoiceService, uploadDir string) *VoiceHandler {
	return &VoiceHandler{voice: voice, uploadDir: uploadDir}
}

// POST /voice/conversation
func (h *VoiceHandler) StartConversation(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	var body struct {
		Moods []string `json:"moods"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	conversationID, err := h.voice.StartConversation(r.Context(), userID, body.Moods)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"conversationId": conversationID})
}

// POST /voice/message
func (h *VoiceHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	// Parse multipart form (max 25MB)
	if err := r.ParseMultipartForm(25 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid multipart form"})
		return
	}

	conversationID := r.FormValue("conversationId")
	if conversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId is required"})
		return
	}

	file, _, err := r.FormFile("audio")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Audio file is required"})
		return
	}
	defer file.Close()

	audioData, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to read audio file"})
		return
	}

	result, err := h.voice.ProcessVoiceMessage(r.Context(), userID, conversationID, audioData)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// GET /voice/messages
func (h *VoiceHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}

	conversationID := r.URL.Query().Get("conversationId")
	if conversationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId query param is required"})
		return
	}

	messages, err := h.voice.GetMessages(r.Context(), conversationID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"messages": messages})
}

// GET /voice/audio/{messageID}
func (h *VoiceHandler) GetAudio(w http.ResponseWriter, r *http.Request) {
	messageID := chi.URLParam(r, "messageID")
	if messageID == "" {
		http.Error(w, "messageID required", http.StatusBadRequest)
		return
	}

	audioPath := filepath.Join(h.uploadDir, messageID+".mp3")
	if _, err := os.Stat(audioPath); os.IsNotExist(err) {
		http.Error(w, `{"error":"Audio not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "audio/mpeg")
	http.ServeFile(w, r, audioPath)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
