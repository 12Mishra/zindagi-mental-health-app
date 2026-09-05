# Zindagi Voice Integration — Complete Guide

This document explains the end-to-end voice conversation feature in the Zindagi mental health app, covering both the **Go backend** and the **React Native (Expo) mobile app** changes.

---

## Overview

The voice feature allows students to have a spoken conversation with "Lisa", an AI mental health companion. The flow is:

```
Student opens app
    │
    ├─ Selects moods (Anxious, Sad, Fatigued, etc.)
    │
    ├─ Goes to Voice tab → breathing exercise + records audio
    │
    ├─ Taps "End Session" → audio uploaded to server
    │
    ├─ Server: Deepgram STT → Gemini LLM → Deepgram TTS
    │
    ├─ Navigates to Chat tab → sees conversation with Lisa
    │
    └─ Can continue chatting by tapping mic button
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mobile App (Expo)                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Mood Check-in │  │ Voice Screen │  │  Chat Screen │          │
│  │  (select      │  │ (breathing   │  │ (messages +  │          │
│  │   moods)      │  │  + record)   │  │  TTS playback)│         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│         └─────────────────┼──────────────────┘                   │
│                           │                                      │
│                    voice-api.ts                                  │
│                    (HTTP client)                                 │
└───────────────────────────┬──────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
    ┌─────────▼─────────┐     ┌──────────▼──────────┐
    │  Express Server    │     │   Go Voice Server    │
    │  (port 4000)       │     │   (port 4001)        │
    │                    │     │                      │
    │  - Login/Register  │     │  - POST /voice/conv  │
    │  - OTP verification│     │  - POST /voice/msg   │
    │  - Session mgmt    │     │  - GET /voice/msgs   │
    │                    │     │  - GET /voice/audio   │
    └─────────┬─────────┘     └──────────┬──────────┘
              │                           │
              └─────────┬─────────────────┘
                        │
              ┌─────────▼─────────┐
              │   PostgreSQL      │
              │   (Neon Cloud)    │
              │                   │
              │  - User           │
              │  - Session        │
              │  - OtpRequest     │
              │  - Conversation   │  ← NEW
              │  - Message        │  ← NEW
              └───────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐
    │Deepgram │   │  Gemini   │  │ Deepgram │
    │  STT    │   │  (LLM)   │  │   TTS    │
    │ nova-3  │   │ gemini-2  │  │ aura-2   │
    └─────────┘   └───────────┘  └──────────┘
```

---

## Step-by-Step User Flow

### Step 1: Login
The student logs in with phone number + OTP (handled by Express server on port 4000). A session token is stored in memory.

### Step 2: Mood Check-in (`mobile/app/(tabs)/mood-checkin.tsx`)
The student selects their current moods from 8 options: Anxious, Angry, Sad, Fatigued, Unsafe, Overwhelmed, Calm, Okay.

When they tap "Continue", the selected moods are passed to the Voice screen:
```typescript
router.push({
  pathname: "/voice",
  params: { moods: JSON.stringify([...selected]) }
});
```

### Step 3: Voice Screen (`mobile/app/(tabs)/voice.tsx`)
The student sees a guided breathing exercise (4-4-4-4 box breathing) with an animated ring. When they tap "Start":

1. Microphone permission is requested
2. Audio recording starts (using `expo-av`)
3. The breathing animation plays (inhale → hold → exhale → hold)
4. Recording continues through the entire breathing session

When they tap "End Session":
1. Recording stops, audio URI is saved
2. The recording is uploaded to the Go server:
   - First, a new conversation is created with the mood context
   - Then, the audio is sent as a voice message
3. The server processes it (STT → LLM → TTS)
4. The student is navigated to the Chat screen with the conversation loaded

### Step 4: Chat Screen (`mobile/app/(tabs)/chat.tsx`)
The chat screen shows:

- **User messages** (right-aligned, green bubbles) — the transcribed text from their voice
- **Lisa's messages** (left-aligned, white bubbles) — the AI-generated response
- **Play button** on Lisa's messages — plays the TTS audio

The student can continue the conversation by tapping the mic button at the bottom to record new messages.

---

## Mobile App Changes (What Was Modified)

### New File: `mobile/lib/voice-api.ts`
API client for the Go voice server. Contains:

| Function | Purpose |
|----------|---------|
| `startConversation(token, moods)` | Creates a new conversation with mood context |
| `sendVoiceMessage(token, conversationId, audioUri)` | Uploads audio, gets back transcript + AI response + audio URL |
| `getMessages(token, conversationId)` | Fetches conversation history |
| `getAudioUrl(messageId)` | Returns the full URL to play a TTS audio file |

The audio upload uses `FormData` (multipart/form-data) to send the audio file to the server.

**Important**: The API URL is hardcoded to `http://172.16.36.95:4001`. You need to change this to your machine's IP address.

### New File: `mobile/app/(tabs)/chat.tsx`
A complete chat screen with:

- **FlatList** of message bubbles (user right, Lisa left)
- **Recording** via `expo-av` (same as voice screen)
- **TTS playback** via `expo-av` Audio.Sound
- **Auto-scroll** to latest message
- **Processing indicator** ("Lisa is thinking...")
- **Empty state** with mic prompt

The screen accepts `conversationId` or `moods` as route params:
- If `conversationId` is provided, it loads existing messages
- If `moods` is provided (new conversation), it creates a conversation first

### Modified File: `mobile/app/(tabs)/voice.tsx`
Changes:
- Added `router` and `useLocalSearchParams` imports
- Added `sessionEnded`, `isUploading`, `lastRecordingUri` state
- `stopRecording()` now saves the URI
- `handleReset()` now uploads the recording and navigates to chat
- `uploadAndNavigateToChat()` handles the upload flow
- Bottom buttons change based on state:
  - **During session**: Crisis Support / Start-Pause / End Session
  - **Uploading**: Processing... (with spinner)
  - **After session**: Crisis Support / Chat with Lisa / New Session

### Modified File: `mobile/app/(tabs)/mood-checkin.tsx`
Change: The "Continue" button now passes selected moods to the voice screen as a JSON string parameter.

### Modified File: `mobile/app/(tabs)/_layout.tsx`
Change: Added a "Chat" tab with the `chat` icon (MaterialIcons) to the bottom tab bar.

---

## Go Server Changes (What Was Built)

### `config/config.go`
Loads environment variables:
- `DATABASE_URL` — Neon PostgreSQL connection string
- `DEEPGRAM_API_KEY` — for STT and TTS
- `GEMINI_API_KEY` — for LLM responses
- `PORT` — server port (default 4001)

### `db/db.go`
- `Connect()` — creates a pgx connection pool
- `Migrate()` — auto-creates Conversation and Message tables on startup

### `middleware/auth.go`
Validates bearer tokens against the existing `Session` table. The mobile app sends the same token it got from the Express auth server.

### `middleware/cors.go`
Allows the mobile app to make cross-origin requests.

### `models/models.go`
Go structs: `Conversation`, `Message`, `VoiceResponse`.

### `services/deepgram.go`
- `TranscribeAudio()` — sends audio to Deepgram STT API (nova-3 model)
- `SynthesizeSpeech()` — sends text to Deepgram TTS API (aura-2-thalia-en model)

### `services/gemini.go`
- `GenerateResponse()` — sends conversation history to Gemini LLM with Lisa's system prompt
- Lisa is positioned as a warm, empathetic mental health companion for Indian college students
- Responses are kept short (2-3 sentences) for TTS playback

### `services/voice.go`
- `StartConversation()` — creates a conversation record with mood context
- `ProcessVoiceMessage()` — the full pipeline (STT → store → LLM → store → TTS → save audio)
- `GetMessages()` — fetches conversation history

### `handlers/voice.go`
Four HTTP endpoints with proper error handling and JSON responses.

### `main.go`
Wires everything together: config → DB → migration → services → router → start.

### `migrations/001_create_conversation_message.sql`
SQL schema for the Conversation and Message tables (also runs via auto-migration).

---

## How to Run Everything

### Option A: Docker (Recommended)

The easiest way to run both servers is with Docker Compose.

**Prerequisites:**
- **Docker Desktop** installed — https://www.docker.com/products/docker-desktop/
- **Deepgram API key** — sign up at https://console.deepgram.com
- **Gemini API key** — get from https://aistudio.google.com/apikey

**Step 1: Configure API keys**

Edit the `.env` file in the project root:
```bash
# Open .env in your editor and fill in:
DEEPGRAM_API_KEY=your_actual_deepgram_key
GEMINI_API_KEY=your_actual_gemini_key
```

The DATABASE_URL is already configured for the Neon database.

**Step 2: Start everything**

```bash
# From the project root directory
docker compose up
```

This starts:
- Express auth server on port 4000
- Go voice server on port 4001

You should see:
```
auth-server-1   | Server listening on 0.0.0.0:4000
voice-server-1  | Voice server listening on :4001
```

**Step 3: Run the mobile app**

```bash
cd mobile
npm install    # or pnpm install
npx expo start
```

**Step 4: Test the full flow** (see below)

**Useful Docker commands:**
```bash
docker compose up              # Start in foreground (see logs)
docker compose up -d           # Start in background
docker compose down            # Stop all containers
docker compose logs -f         # Follow logs
docker compose build           # Rebuild after code changes
docker compose up --build      # Rebuild + start
```

---

### Option B: Run Manually (Without Docker)

**Prerequisites:**
1. **Go** installed (version 1.21+) — https://go.dev/dl/
2. **Node.js** installed (version 18+) — https://nodejs.org/
3. **Deepgram API key** — sign up at https://console.deepgram.com
4. **Gemini API key** — get from https://aistudio.google.com/apikey

**Step 1: Set up the Go Voice Server**

```bash
cd server/go-voice

# Edit .env with your actual API keys
# Open .env in your editor and fill in:
#   DATABASE_URL=your_neon_connection_string
#   DEEPGRAM_API_KEY=your_deepgram_key
#   GEMINI_API_KEY=your_gemini_key
```

**Step 2: Run the Go Server**

```bash
go run .
# You should see: "Voice server listening on :4001"
```

**Step 3: Run the Express Auth Server**

```bash
# In a separate terminal
cd server
npm install
npm run dev
# You should see: "Server listening on 0.0.0.0:4000"
```

**Step 4: Run the Mobile App**

```bash
# In a separate terminal
cd mobile
npm install
npx expo start
```

---

### Testing the Full Flow

1. **Login** with phone number (OTP defaults to `1234` in dev mode)
2. **Complete profile** if first time (name, age, college, history)
3. **Select moods** on the Mood Check-in screen
4. **Tap Continue** → goes to Voice screen
5. **Tap Start** → breathing exercise begins, recording starts
6. **Tap End Session** → recording uploads, processing begins
7. **Chat screen** opens → see transcribed text + Lisa's response + play TTS audio
8. **Tap mic button** → record more messages to continue the conversation

---

## API Reference

### `POST /voice/conversation`
Creates a new conversation.

**Headers**: `Authorization: Bearer <token>`

**Body**:
```json
{
  "moods": ["anxious", "sad"]
}
```

**Response** (201):
```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `POST /voice/message`
Uploads audio and gets the full pipeline response.

**Headers**: `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`

**Body** (form-data):
- `audio` — the audio file (m4a, aac, etc.)
- `conversationId` — the conversation ID

**Response** (200):
```json
{
  "userMessage": {
    "id": "msg-uuid-1",
    "conversationId": "conv-uuid",
    "role": "USER",
    "content": "I've been feeling really stressed about exams lately",
    "createdAt": "2026-05-24T22:30:00Z"
  },
  "assistantMessage": {
    "id": "msg-uuid-2",
    "conversationId": "conv-uuid",
    "role": "ASSISTANT",
    "content": "I hear you. Exam pressure can feel really overwhelming. What's been weighing on you the most?",
    "audioUrl": "/voice/audio/msg-uuid-2",
    "createdAt": "2026-05-24T22:30:02Z"
  }
}
```

---

### `GET /voice/messages?conversationId=...`
Fetches all messages in a conversation.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "messages": [
    {
      "id": "msg-uuid-1",
      "conversationId": "conv-uuid",
      "role": "USER",
      "content": "I've been feeling really stressed about exams",
      "audioUrl": null,
      "createdAt": "2026-05-24T22:30:00Z"
    },
    {
      "id": "msg-uuid-2",
      "conversationId": "conv-uuid",
      "role": "ASSISTANT",
      "content": "I hear you. Exam pressure can feel overwhelming.",
      "audioUrl": "/voice/audio/msg-uuid-2",
      "createdAt": "2026-05-24T22:30:02Z"
    }
  ]
}
```

---

### `GET /voice/audio/{messageID}`
Serves the TTS audio file for a message.

**Headers**: `Authorization: Bearer <token>`

**Response** (200): MP3 audio file with `Content-Type: audio/mpeg`

---

## Troubleshooting

### Server won't start — "Database connection failed"
- Check your `DATABASE_URL` in `.env`
- Make sure the Neon database is accessible
- Check if `sslmode=require` is in the connection string

### "Deepgram STT error" or "Deepgram TTS error"
- Verify your `DEEPGRAM_API_KEY` in `.env`
- Check your Deepgram account has credits
- The key should start with a long alphanumeric string

### "Gemini generation failed"
- Verify your `GEMINI_API_KEY` in `.env`
- Get a key from https://aistudio.google.com/apikey
- Make sure the Generative Language API is enabled in your Google Cloud project

### Mobile app can't connect to server
- Make sure both servers are running (Express on 4000, Go on 4001)
- Check the IP address in `voice-api.ts` matches your machine's IP
- Your phone and computer must be on the same WiFi network
- Check Windows Firewall isn't blocking ports 4000/4001

### "Unauthorized" error
- The session token from Express auth is used for Go voice endpoints
- Make sure you're logged in through the Express server first
- Session tokens expire after 30 days (configurable)

### Audio doesn't play
- Check the `audioUrl` in the API response is not null
- TTS might have failed (non-fatal error) — the text response still works
- Try the URL directly in a browser: `http://YOUR_IP:4001/voice/audio/{messageId}`

---

## File Reference

### Go Backend (`server/go-voice/`)
| File | Lines | Purpose |
|------|-------|---------|
| `main.go` | ~70 | Entry point, router setup, server startup |
| `config/config.go` | ~35 | Environment variable loading |
| `db/db.go` | ~65 | PostgreSQL connection + auto-migration |
| `middleware/auth.go` | ~55 | Bearer token validation |
| `middleware/cors.go` | ~20 | CORS headers |
| `models/models.go` | ~25 | Data structures |
| `services/deepgram.go` | ~90 | Deepgram STT + TTS |
| `services/gemini.go` | ~95 | Gemini LLM integration |
| `services/voice.go` | ~130 | Pipeline orchestration |
| `handlers/voice.go` | ~120 | HTTP request handlers |

### Mobile (`mobile/`)
| File | Lines | Purpose |
|------|-------|---------|
| `lib/voice-api.ts` | ~110 | Voice API client |
| `app/(tabs)/chat.tsx` | ~280 | Chat screen |
| `app/(tabs)/voice.tsx` | ~350 | Breathing + recording screen (modified) |
| `app/(tabs)/mood-checkin.tsx` | ~250 | Mood selection (modified) |
| `app/(tabs)/_layout.tsx` | ~75 | Tab navigation (modified) |
