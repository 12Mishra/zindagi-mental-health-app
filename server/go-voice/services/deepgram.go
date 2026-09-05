package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	api "github.com/deepgram/deepgram-go-sdk/v3/pkg/api/listen/v1/rest"
	speakapi "github.com/deepgram/deepgram-go-sdk/v3/pkg/api/speak/v1/rest"
	interfaces "github.com/deepgram/deepgram-go-sdk/v3/pkg/client/interfaces"
	listenclient "github.com/deepgram/deepgram-go-sdk/v3/pkg/client/listen"
	speakclient "github.com/deepgram/deepgram-go-sdk/v3/pkg/client/speak"
)

type DeepgramService struct {
	apiKey string
}

func NewDeepgramService(apiKey string) *DeepgramService {
	return &DeepgramService{apiKey: apiKey}
}

// TranscribeAudio sends audio data to Deepgram STT and returns the transcript.
func (d *DeepgramService) TranscribeAudio(ctx context.Context, audioData []byte) (string, error) {
	c := listenclient.NewREST(d.apiKey, &interfaces.ClientOptions{
		Host: "https://api.deepgram.com",
	})
	dg := api.New(c)

	options := &interfaces.PreRecordedTranscriptionOptions{
		Model:       "nova-3",
		SmartFormat: true,
		Language:    "en",
	}

	res, err := dg.FromStream(ctx, bytes.NewReader(audioData), options)
	if err != nil {
		return "", fmt.Errorf("deepgram STT failed: %w", err)
	}

	if len(res.Results.Channels) == 0 || len(res.Results.Channels[0].Alternatives) == 0 {
		return "", fmt.Errorf("no transcription results")
	}

	return res.Results.Channels[0].Alternatives[0].Transcript, nil
}

// SynthesizeSpeech sends text to Deepgram TTS and returns audio bytes.
func (d *DeepgramService) SynthesizeSpeech(ctx context.Context, text string) ([]byte, error) {
	c := speakclient.NewREST(d.apiKey, &interfaces.ClientOptions{
		Host: "https://api.deepgram.com",
	})
	dg := speakapi.New(c)

	options := &interfaces.SpeakOptions{
		Model:    "aura-2-thalia-en",
		Encoding: "mp3",
	}

	var buf bytes.Buffer
	_, err := dg.ToFile(ctx, text, options, &buf)
	if err != nil {
		return nil, fmt.Errorf("deepgram TTS failed: %w", err)
	}

	return buf.Bytes(), nil
}

// SynthesizeSpeechHTTP is a fallback using direct HTTP if SDK gives issues.
func (d *DeepgramService) SynthesizeSpeechHTTP(ctx context.Context, text string) ([]byte, error) {
	url := "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3"

	body, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal TTS request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create TTS request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Token "+d.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("deepgram TTS request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("deepgram TTS error (status %d): %s", resp.StatusCode, string(respBody))
	}

	audioBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read TTS response: %w", err)
	}

	return audioBytes, nil
}
