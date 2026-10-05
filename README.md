# Zindagi - AI Mental Health Companion ("Lisa")

Zindagi is an empathetic, voice-enabled AI mental health companion app designed to support college students. The companion, **Lisa**, is powered by a fine-tuned **Mistral 7B** model trained on **Psychological First Aid (PFA)** and **Panchkosh Adhyanam** principles.

---

## Architecture Overview

```
[ User Microphone / Voice ]
         │
         ▼
[ Web Speech Recognition (STT) ]  ──> Browser transcribes speech to text in real time
         │
         ▼
[ Expo React Native Frontend ]     ──> Mobile / Web UI (localhost:8081)
         │  (HTTP POST /api/conversation/:id/messages)
         ▼
[ Express 5 Backend (Port 4000) ]  ──> Session auth, context memory & orchestration
         │
         ├──> [ Context Service ]  ──> Injects user profile, themes & last 5 summaries
         ├──> [ Neon PostgreSQL ]   ──> User, Session, Message, Summary, CustomerProfile
         └──> [ Local Ollama Engine ]──> Mistral 7B (`lisa:latest`) on local GPU
         │
         ▼
[ Web Speech Synthesis (TTS) ]    ──> Plays Lisa's response in sweet female voice (0.96 rate)
```

- **`mobile/`**: Expo React Native frontend with Web Speech Recognition (STT), Text-to-Speech (TTS), interactive mood check-in, and conversation history.
- **`server/`**: Express 5 + Prisma backend connecting to PostgreSQL (Neon) over HTTPS/WebSocket (port 443), managing long-term user memory and background summarization.
- **`Local LLM`**: Local Ollama engine serving the fine-tuned Mistral 7B GGUF model (`lisa:latest`).
- **`training/`**: Scripts and Jupyter notebook for fine-tuning Mistral 7B on Google Colab (Unsloth T4 GPU) on 1,000+ conversations.

---

## Prerequisites

Before running the application, make sure you have:

1. **Node.js** (v20+ recommended) & **npm**
2. **Ollama** installed on your system ([Download Ollama](https://ollama.com))
3. **PostgreSQL Database** (Cloud [Neon PostgreSQL](https://neon.tech) or a local PostgreSQL instance)
4. **Google Chrome / Microsoft Edge** (for Web Speech API microphone and voice support)

---

## Quick Start Guide

Follow these 3 steps to get the entire system running locally.

---

### Step 1: Start the Local LLM (Ollama)

1. Make sure Ollama is installed and running:
   ```bash
   ollama --version
   ```
2. If you have the fine-tuned `lisa-mistral-7b-q4km.gguf` file in the `training/` folder, create the Lisa model in Ollama:
   ```bash
   ollama create lisa -f training/Modelfile
   ```
   *(Alternatively, if testing without the custom GGUF, you can use `ollama run mistral` or alias it).*
3. Verify that Ollama is responding on `http://127.0.0.1:11434`:
   ```bash
   curl http://127.0.0.1:11434/api/tags
   ```

---

### Step 2: Setup & Start the Backend (`server`)

1. Navigate to the `server` directory and install dependencies:
   ```bash
   cd server
   npm install
   ```

2. Create a `.env` file in the `server/` directory:
   ```env
   # PostgreSQL Connection (Neon or Local)
   DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@YOUR_HOST.neon.tech/neondb?sslmode=require&channel_binding=require"

   PORT=4000
   AUTH_OTP_CODE=1234
   AUTH_OTP_TTL_MINUTES=10
   AUTH_SESSION_TTL_DAYS=30

   # Local Ollama Settings
   OLLAMA_URL="http://127.0.0.1:11434"
   OLLAMA_MODEL="lisa"

   # Optional: Fast Cloud Summarization (Gemini or Grok)
   # GEMINI_API_KEY=""
   # GROK_API_KEY=""
   ```

3. Generate Prisma client & push database schema to PostgreSQL:
   ```bash
   npm run prisma:generate
   npx prisma db push
   ```

4. Start the backend development server:
   ```bash
   npm run dev
   ```
   The backend will start on: **`http://localhost:4000`**

5. Verify backend health check:
   - Open in browser: `http://localhost:4000/health`
   - Should return: `{"status":"ok","timestamp":"..."}`

> **Tip:** You can inspect all database tables (Users, Conversations, Messages, Summaries, Extracted Profiles) directly in your terminal at any time by running:
> ```bash
> npm run db:view
> ```

---

### Step 3: Setup & Start the Frontend (`mobile`)

1. Open a new terminal, navigate to the `mobile` directory, and install dependencies:
   ```bash
   cd mobile
   npm install
   ```

2. Create a `.env` file in the `mobile/` directory:
   ```env
   EXPO_PUBLIC_API_URL=http://localhost:4000
   ```
   *(For testing on a physical phone via Expo Go, replace `localhost` with your computer's LAN IP, e.g., `http://192.168.1.100:4000`).*

3. Start the application in your browser (recommended for voice testing):
   ```bash
   npm run web
   ```
   The app will open at: **`http://localhost:8081`**

   *(To run on native emulators: `npm run android` or `npm run ios`).*

---

## How to Test the Voice Conversation

1. **Login**: Enter any phone number (e.g. `+919999988888`) and the OTP code: **`1234`**. Complete user profile registration if first time.
2. **Mood Check-in**: Select your current mood tags and optional note, then tap **Continue to Voice Session**.
3. **Start Session**: Tap **Start Session** on the Voice screen.
   - Lisa greets you with: *"Hi there. I am Lisa. I am here to listen. How are you feeling right now?"* in a sweet female voice at rate `0.96`.
4. **Speak or Type**:
   - Tap the microphone button and speak your thoughts aloud (e.g., *"I'm feeling really overwhelmed with my exams and can't sleep"*).
   - Or type in the message text input at the bottom and press send.
5. **Real-Time Empathy Response**:
   - Lisa processes your context, past summaries, and mood, then speaks an empathetic response in 2-3 seconds.
6. **End Session**:
   - Tap **End Session**.
   - The session ends instantly (<15ms) on the UI.
   - In the background, Lisa generates a session summary, extracts themes and keywords, and updates your cumulative `CustomerProfile` in PostgreSQL.

---

## Fine-Tuning the Model (Colab T4)

To train or fine-tune Lisa on a new/larger dataset (1,000+ conversations):

1. Open Google Colab: [colab.research.google.com](https://colab.research.google.com)
2. Upload `training/finetune_1000_conversations.ipynb` (or copy `training/finetune_colab.py`).
3. Set runtime to **T4 GPU** (`Runtime > Change runtime type`).
4. Upload your dataset (`.json` or `.jsonl`).
5. Run the cells sequentially. The script:
   - Uses **Unsloth** for 5x faster 4-bit LoRA training.
   - Automatically saves checkpoints and exports the final GGUF model (`lisa-mistral-7b-v2-q4km.gguf`) directly to your **Google Drive**.
6. Download the `.gguf` file to your PC and register it in Ollama:
   ```bash
   ollama create lisa -f training/Modelfile
   ```

---

## Project Structure

```text
zindagi-mental-health-app/
├── mobile/                      # Expo React Native Frontend
│   ├── app/                     # File-based routing (tabs: mood, voice, history)
│   │   └── (tabs)/voice.tsx     # Voice recording, STT & TTS female voice logic
│   ├── lib/                     # API clients (auth, conversation-api)
│   └── package.json
├── server/                      # Express 5 Backend
│   ├── prisma/                  # Database schema & migrations
│   │   └── schema.prisma        # User, Session, Conversation, Message, CustomerProfile
│   ├── src/
│   │   ├── conversation/        # Controller, routes, LLM & STT services
│   │   │   └── services/
│   │   │       ├── context.service.ts   # Assembles PFA context & memory
│   │   │       ├── llm.service.ts       # Ollama / Gemini / Grok integration
│   │   │       └── conversation.service.ts # Session handling & background summarizer
│   │   ├── db.ts                # Neon PostgreSQL WebSocket adapter setup
│   │   └── scripts/view-tables.ts # Terminal database viewer (`npm run db:view`)
│   └── package.json
├── training/                    # Fine-Tuning Pipeline
│   ├── finetune_1000_conversations.ipynb # Ready-to-run Colab notebook
│   ├── finetune_colab.py        # Python fine-tuning script with Unsloth
│   ├── prepare_dataset.py       # PFA + Panchkosh conversation dataset builder
│   └── Modelfile                # Ollama model definition file
├── .gitignore                   # Excludes large binaries (*.gguf) and secrets
└── README.md                    # Project documentation & setup instructions
```

---

## License

ISC License. Built for student mental health and well-being.
