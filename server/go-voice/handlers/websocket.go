package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/jackc/pgx/v5/pgxpool"

	"zindagi-voice/services"
)

type WSHandler struct {
	pool     *pgxpool.Pool
	voice    *services.VoiceService
	deepgram *services.DeepgramService
	gemini   *services.GeminiService
}

func NewWSHandler(pool *pgxpool.Pool, voice *services.VoiceService, deepgram *services.DeepgramService, gemini *services.GeminiService) *WSHandler {
	return &WSHandler{
		pool:     pool,
		voice:    voice,
		deepgram: deepgram,
		gemini:   gemini,
	}
}

// WSMessage represents incoming/outgoing JSON messages over WebSocket
type WSMessage struct {
	Type           string `json:"type"`
	ConversationID string `json:"conversationId,omitempty"`
	Content        string `json:"content,omitempty"`
	Text           string `json:"text,omitempty"`
	IsFinal        bool   `json:"isFinal,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
	AudioURL       string `json:"audioUrl,omitempty"`
	Message        string `json:"message,omitempty"`
}

// HandleWebSocket upgrades HTTP to WebSocket and manages the voice conversation
func (h *WSHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Authenticate via query param token
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, `{"error":"token query param required"}`, http.StatusUnauthorized)
		return
	}

	userID, err := h.authenticateToken(r.Context(), token)
	if err != nil {
		http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
		return
	}

	// Upgrade to WebSocket
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow cross-origin for mobile
	})
	if err != nil {
		log.Printf("WebSocket accept failed: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	log.Printf("WebSocket connected: user=%s", userID)

	// Derive lifecycle context — cancelled when read loop exits
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Per-connection state
	var (
		mu             sync.Mutex
		conversationID string
		audioBuffer    []byte
	)

	// Single read loop — no CloseRead, no concurrent readers
	for {
		msgType, data, err := conn.Read(ctx)
		if err != nil {
			// Connection closed or error — cancel context to stop processing
			cancel()
			return
		}

		switch msgType {
		case websocket.MessageText:
			var msg WSMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}

			switch msg.Type {
			case "start":
				mu.Lock()
				conversationID = msg.ConversationID
				audioBuffer = nil
				mu.Unlock()
				sendJSON(ctx, conn, WSMessage{Type: "status", Text: "listening"})

			case "stop":
				// Process the accumulated audio
				mu.Lock()
				audio := make([]byte, len(audioBuffer))
				copy(audio, audioBuffer)
				convID := conversationID
				audioBuffer = nil
				mu.Unlock()

				if len(audio) > 0 && convID != "" {
					go h.processAudio(ctx, conn, userID, convID, audio)
				}

			case "text":
				// Text message fallback
				if msg.ConversationID != "" && msg.Content != "" {
					mu.Lock()
					conversationID = msg.ConversationID
					convID := conversationID
					mu.Unlock()
					go h.processText(ctx, conn, userID, convID, msg.Content)
				}
			}

		case websocket.MessageBinary:
			// Accumulate audio data
			mu.Lock()
			audioBuffer = append(audioBuffer, data...)
			mu.Unlock()
		}
	}
}

// processAudio handles the full STT → LLM → TTS pipeline for audio
func (h *WSHandler) processAudio(ctx context.Context, conn *websocket.Conn, userID, conversationID string, audioData []byte) {
	// 1. Verify conversation ownership
	if err := h.voice.VerifyOwnership(ctx, userID, conversationID); err != nil {
		sendJSON(ctx, conn, WSMessage{Type: "error", Message: "Unauthorized"})
		return
	}

	// 2. Deepgram STT
	sendJSON(ctx, conn, WSMessage{Type: "status", Text: "transcribing"})

	transcript, err := h.deepgram.TranscribeAudio(ctx, audioData)
	if err != nil {
		log.Printf("STT error: %v", err)
		sendJSON(ctx, conn, WSMessage{Type: "error", Message: "Transcription failed"})
		return
	}

	if transcript == "" {
		transcript = "(no speech detected)"
	}

	// Send final transcript
	sendJSON(ctx, conn, WSMessage{Type: "transcript", Text: transcript, IsFinal: true})

	// 3. Store user message
	if _, err := h.voice.StoreMessage(ctx, conversationID, "USER", transcript, ""); err != nil {
		log.Printf("Failed to store user message: %v", err)
	}

	// 4. Get conversation history
	history, err := h.voice.GetMessages(ctx, conversationID)
	if err != nil {
		log.Printf("Failed to get history: %v", err)
		history = nil
	}

	// 5. Get moods
	moods, _ := h.voice.GetMoods(ctx, conversationID)

	// 6. Gemini streaming response
	sendJSON(ctx, conn, WSMessage{Type: "status", Text: "thinking"})

	responseChan := make(chan string, 64)
	go func() {
		h.gemini.GenerateResponseStream(ctx, history, transcript, moods, responseChan)
	}()

	var fullResponse string
	for chunk := range responseChan {
		fullResponse += chunk
		sendJSON(ctx, conn, WSMessage{Type: "response_chunk", Text: chunk})
	}

	if fullResponse == "" {
		fullResponse = "I hear you. Tell me more about how you're feeling."
		sendJSON(ctx, conn, WSMessage{Type: "response_chunk", Text: fullResponse})
	}

	// 7. Store assistant message
	msgID, err := h.voice.StoreMessage(ctx, conversationID, "ASSISTANT", fullResponse, "")
	if err != nil {
		log.Printf("Failed to store assistant message: %v", err)
	}

	// 8. Deepgram TTS
	sendJSON(ctx, conn, WSMessage{Type: "status", Text: "speaking"})

	audioBytes, err := h.deepgram.SynthesizeSpeech(ctx, fullResponse)
	if err != nil {
		log.Printf("TTS error: %v", err)
		// Non-fatal: response text already sent
		sendJSON(ctx, conn, WSMessage{Type: "response_end", MessageID: msgID})
		return
	}

	// Save audio file and update message
	audioURL := ""
	if msgID != "" {
		audioURL = "/voice/audio/" + msgID
		if err := h.voice.SaveAudioFile(ctx, msgID, audioBytes); err != nil {
			log.Printf("Failed to save audio: %v", err)
		} else {
			h.voice.UpdateAudioURL(ctx, msgID, audioURL)
		}
	}

	// 9. Send TTS audio as binary
	conn.Write(ctx, websocket.MessageBinary, audioBytes)

	// 10. Send response end
	sendJSON(ctx, conn, WSMessage{Type: "response_end", MessageID: msgID, AudioURL: audioURL})
}

// processText handles a text message (no STT needed)
func (h *WSHandler) processText(ctx context.Context, conn *websocket.Conn, userID, conversationID, userText string) {
	if err := h.voice.VerifyOwnership(ctx, userID, conversationID); err != nil {
		sendJSON(ctx, conn, WSMessage{Type: "error", Message: "Unauthorized"})
		return
	}

	// Store user message
	_, _ = h.voice.StoreMessage(ctx, conversationID, "USER", userText, "")

	// Get history + moods
	history, _ := h.voice.GetMessages(ctx, conversationID)
	moods, _ := h.voice.GetMoods(ctx, conversationID)

	// Gemini streaming
	sendJSON(ctx, conn, WSMessage{Type: "status", Text: "thinking"})

	responseChan := make(chan string, 64)
	go func() {
		h.gemini.GenerateResponseStream(ctx, history, userText, moods, responseChan)
	}()

	var fullResponse string
	for chunk := range responseChan {
		fullResponse += chunk
		sendJSON(ctx, conn, WSMessage{Type: "response_chunk", Text: chunk})
	}

	if fullResponse == "" {
		fullResponse = "I hear you. Tell me more about how you're feeling."
	}

	// Store assistant message
	msgID, _ := h.voice.StoreMessage(ctx, conversationID, "ASSISTANT", fullResponse, "")

	// TTS
	sendJSON(ctx, conn, WSMessage{Type: "status", Text: "speaking"})

	audioBytes, err := h.deepgram.SynthesizeSpeech(ctx, fullResponse)
	if err != nil {
		log.Printf("TTS error: %v", err)
		sendJSON(ctx, conn, WSMessage{Type: "response_end", MessageID: msgID})
		return
	}

	audioURL := ""
	if msgID != "" {
		audioURL = "/voice/audio/" + msgID
		h.voice.SaveAudioFile(ctx, msgID, audioBytes)
		h.voice.UpdateAudioURL(ctx, msgID, audioURL)
	}

	conn.Write(ctx, websocket.MessageBinary, audioBytes)
	sendJSON(ctx, conn, WSMessage{Type: "response_end", MessageID: msgID, AudioURL: audioURL})
}

// authenticateToken validates a bearer token and returns the userID
func (h *WSHandler) authenticateToken(ctx context.Context, token string) (string, error) {
	tokenHash := sha256Hex(token)

	var userID string
	err := h.pool.QueryRow(ctx,
		`UPDATE "Session" SET "lastSeenAt" = $1
		 WHERE "tokenHash" = $2 AND "revokedAt" IS NULL AND "expiresAt" > $1
		 RETURNING "userId"`,
		time.Now(), tokenHash,
	).Scan(&userID)

	return userID, err
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func sendJSON(ctx context.Context, conn *websocket.Conn, msg WSMessage) {
	if err := wsjson.Write(ctx, conn, msg); err != nil {
		log.Printf("WebSocket write error: %v", err)
	}
}
