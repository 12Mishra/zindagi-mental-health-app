package services

import (
	"context"
	"fmt"
	"log"
	"strings"

	"google.golang.org/genai"

	"zindagi-voice/models"
)

type GeminiService struct {
	client *genai.Client
}

func NewGeminiService(ctx context.Context, apiKey string) (*GeminiService, error) {
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini client: %w", err)
	}

	return &GeminiService{client: client}, nil
}

const systemPrompt = `You are Lisa, a warm and empathetic mental health companion for Indian college students on the Zindagi app.

Your personality:
- Warm, caring, non-judgmental, and supportive
- You listen actively and validate feelings
- You speak in a calm, reassuring tone
- You use simple, clear language

Guidelines:
- Keep responses SHORT (2-3 sentences max) — they will be spoken aloud via text-to-speech
- Reference the user's current mood when relevant
- Ask gentle follow-up questions to encourage sharing
- Never provide medical diagnoses or prescribe medication
- If the user expresses suicidal thoughts, self-harm, or crisis, gently suggest contacting crisis support (iCall: 9152987821, Vandrevala Foundation: 1860-2662-345)
- Be culturally sensitive to Indian college student experiences (academic pressure, family expectations, etc.)
- Do not use emojis or special formatting — your responses will be read by a TTS engine`

func (g *GeminiService) GenerateResponse(ctx context.Context, history []models.Message, userMessage string, moods []string) (string, error) {
	var contents []*genai.Content

	// Add mood context as first exchange if this is the start of conversation
	if len(history) == 0 && len(moods) > 0 {
		moodContext := fmt.Sprintf("The user selected these moods during check-in: %s. Acknowledge this gently.", strings.Join(moods, ", "))
		contents = append(contents, genai.NewContentFromText(moodContext, genai.RoleUser))
		contents = append(contents, genai.NewContentFromText("I understand. I'm here for you. How are you feeling right now?", genai.RoleModel))
	}

	// Add conversation history
	for _, msg := range history {
		var role genai.Role = genai.RoleUser
		if msg.Role == "ASSISTANT" {
			role = genai.RoleModel
		}
		contents = append(contents, genai.NewContentFromText(msg.Content, role))
	}

	// Add current user message
	contents = append(contents, genai.NewContentFromText(userMessage, genai.RoleUser))

	result, err := g.client.Models.GenerateContent(ctx, "gemini-2.5-flash", contents, &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(systemPrompt, genai.RoleUser),
		MaxOutputTokens:   150,
	})
	if err != nil {
		return "", fmt.Errorf("Gemini generation failed: %w", err)
	}

	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return "I hear you. Tell me more about how you're feeling.", nil
	}

	return result.Candidates[0].Content.Parts[0].Text, nil
}

// GenerateResponseStream streams Gemini response chunks to a channel.
func (g *GeminiService) GenerateResponseStream(ctx context.Context, history []models.Message, userMessage string, moods []string, out chan<- string) {
	defer close(out)

	var contents []*genai.Content

	if len(history) == 0 && len(moods) > 0 {
		moodContext := fmt.Sprintf("The user selected these moods during check-in: %s. Acknowledge this gently.", strings.Join(moods, ", "))
		contents = append(contents, genai.NewContentFromText(moodContext, genai.RoleUser))
		contents = append(contents, genai.NewContentFromText("I understand. I'm here for you. How are you feeling right now?", genai.RoleModel))
	}

	for _, msg := range history {
		var role genai.Role = genai.RoleUser
		if msg.Role == "ASSISTANT" {
			role = genai.RoleModel
		}
		contents = append(contents, genai.NewContentFromText(msg.Content, role))
	}

	contents = append(contents, genai.NewContentFromText(userMessage, genai.RoleUser))

	stream := g.client.Models.GenerateContentStream(ctx, "gemini-2.5-flash", contents, &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(systemPrompt, genai.RoleUser),
		MaxOutputTokens:   150,
	})

	for resp, err := range stream {
		if err != nil {
			log.Printf("Gemini stream error: %v", err)
			return
		}
		if len(resp.Candidates) > 0 && len(resp.Candidates[0].Content.Parts) > 0 {
			text := resp.Candidates[0].Content.Parts[0].Text
			if text != "" {
				out <- text
			}
		}
	}
}
