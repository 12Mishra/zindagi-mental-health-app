package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"

	"zindagi-voice/models"
)

type VoiceService struct {
	pool      *pgxpool.Pool
	deepgram  *DeepgramService
	gemini    *GeminiService
	uploadDir string
}

func NewVoiceService(pool *pgxpool.Pool, deepgram *DeepgramService, gemini *GeminiService, uploadDir string) *VoiceService {
	return &VoiceService{
		pool:      pool,
		deepgram:  deepgram,
		gemini:    gemini,
		uploadDir: uploadDir,
	}
}

// StartConversation creates a new conversation for a user with mood context.
func (v *VoiceService) StartConversation(ctx context.Context, userID string, moods []string) (string, error) {
	var conversationID string
	err := v.pool.QueryRow(ctx,
		`INSERT INTO "Conversation" ("id", "userId", "moods") VALUES (gen_random_uuid()::text, $1, $2) RETURNING "id"`,
		userID, moods,
	).Scan(&conversationID)
	if err != nil {
		return "", fmt.Errorf("failed to create conversation: %w", err)
	}
	return conversationID, nil
}

// ProcessVoiceMessage handles the full STT → LLM → TTS pipeline.
func (v *VoiceService) ProcessVoiceMessage(ctx context.Context, userID, conversationID string, audioData []byte) (*models.VoiceResponse, error) {
	// 1. Verify conversation belongs to user
	var ownerID string
	err := v.pool.QueryRow(ctx,
		`SELECT "userId" FROM "Conversation" WHERE "id" = $1`, conversationID,
	).Scan(&ownerID)
	if err != nil {
		return nil, fmt.Errorf("conversation not found")
	}
	if ownerID != userID {
		return nil, fmt.Errorf("unauthorized")
	}

	// 2. Transcribe audio via Deepgram STT
	transcript, err := v.deepgram.TranscribeAudio(ctx, audioData)
	if err != nil {
		return nil, fmt.Errorf("transcription failed: %w", err)
	}
	if transcript == "" {
		transcript = "(no speech detected)"
	}

	// 3. Store USER message
	var userMsgID string
	err = v.pool.QueryRow(ctx,
		`INSERT INTO "Message" ("id", "conversationId", "role", "content")
		 VALUES (gen_random_uuid()::text, $1, 'USER', $2) RETURNING "id"`,
		conversationID, transcript,
	).Scan(&userMsgID)
	if err != nil {
		return nil, fmt.Errorf("failed to store user message: %w", err)
	}

	// 4. Fetch conversation history for context
	history, err := v.GetMessages(ctx, conversationID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch history: %w", err)
	}

	// 5. Get moods for context
	var moods []string
	err = v.pool.QueryRow(ctx,
		`SELECT "moods" FROM "Conversation" WHERE "id" = $1`, conversationID,
	).Scan(&moods)
	if err != nil {
		moods = []string{}
	}

	// 6. Generate Lisa's response via Gemini
	assistantText, err := v.gemini.GenerateResponse(ctx, history, transcript, moods)
	if err != nil {
		return nil, fmt.Errorf("LLM generation failed: %w", err)
	}

	// 7. Store ASSISTANT message (audioUrl updated later)
	var assistantMsgID string
	err = v.pool.QueryRow(ctx,
		`INSERT INTO "Message" ("id", "conversationId", "role", "content")
		 VALUES (gen_random_uuid()::text, $1, 'ASSISTANT', $2) RETURNING "id"`,
		conversationID, assistantText,
	).Scan(&assistantMsgID)
	if err != nil {
		return nil, fmt.Errorf("failed to store assistant message: %w", err)
	}

	// 8. Synthesize TTS audio
	audioBytes, err := v.deepgram.SynthesizeSpeech(ctx, assistantText)
	if err != nil {
		// Non-fatal: return response without audio
		return &models.VoiceResponse{
			UserMessage:      models.Message{ID: userMsgID, ConversationID: conversationID, Role: "USER", Content: transcript},
			AssistantMessage: models.Message{ID: assistantMsgID, ConversationID: conversationID, Role: "ASSISTANT", Content: assistantText},
		}, nil
	}

	// 9. Save audio file
	audioPath := filepath.Join(v.uploadDir, assistantMsgID+".mp3")
	if err := os.WriteFile(audioPath, audioBytes, 0644); err != nil {
		return nil, fmt.Errorf("failed to save audio: %w", err)
	}

	// 10. Update message with audio URL
	audioURL := "/voice/audio/" + assistantMsgID
	_, err = v.pool.Exec(ctx,
		`UPDATE "Message" SET "audioUrl" = $1 WHERE "id" = $2`, audioURL, assistantMsgID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update audio URL: %w", err)
	}

	return &models.VoiceResponse{
		UserMessage:      models.Message{ID: userMsgID, ConversationID: conversationID, Role: "USER", Content: transcript},
		AssistantMessage: models.Message{ID: assistantMsgID, ConversationID: conversationID, Role: "ASSISTANT", Content: assistantText, AudioURL: &audioURL},
	}, nil
}

// GetMessages fetches all messages for a conversation.
func (v *VoiceService) GetMessages(ctx context.Context, conversationID string) ([]models.Message, error) {
	rows, err := v.pool.Query(ctx,
		`SELECT "id", "conversationId", "role", "content", "audioUrl", "createdAt"
		 FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt" ASC`, conversationID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch messages: %w", err)
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var msg models.Message
		if err := rows.Scan(&msg.ID, &msg.ConversationID, &msg.Role, &msg.Content, &msg.AudioURL, &msg.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		messages = append(messages, msg)
	}

	if messages == nil {
		messages = []models.Message{}
	}

	return messages, nil
}
