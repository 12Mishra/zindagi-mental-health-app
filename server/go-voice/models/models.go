package models

import "time"

type Conversation struct {
	ID        string     `json:"id"`
	UserID    string     `json:"userId"`
	Moods     []string   `json:"moods"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	Role           string    `json:"role"` // "USER" or "ASSISTANT"
	Content        string    `json:"content"`
	AudioURL       *string   `json:"audioUrl,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
}

type VoiceResponse struct {
	UserMessage      Message `json:"userMessage"`
	AssistantMessage Message `json:"assistantMessage"`
}
