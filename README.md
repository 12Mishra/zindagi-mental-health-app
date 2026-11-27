# Zindagi: a voice-first AI mental health companion for college students

Zindagi (Hindi for "life") is a mental health support system for students in Indian colleges. Its core is a live, hands-free voice conversation with **Lisa**, an AI companion fine-tuned to give first-level emotional support in the style of the WHO *Psychological First Aid* (PFA) guide. Students can speak in **English, Hindi, Hinglish or Punjabi**, interrupt Lisa at any time, and be connected to their own college's counselling cell when they need a real person.

Around the voice companion sits a complete support system: daily mood check-ins, a safety layer that is independent of the AI, consent-based memory, counsellor booking, trusted contacts, a therapist portal and an anonymous admin dashboard.

> **Zindagi is a prototype for early support and referral.** It does not diagnose, does not prescribe, and is not an emergency service. In a crisis the app always points to **Tele-MANAS (14416)** and the emergency number **112**.

Capstone project, B.E. Electronics and Communication Engineering, Thapar Institute of Engineering & Technology (TIET), Patiala, November 2026. Group 79, supervised by Dr. Saurabh Sharma.

---

## Contents

- [The problem](#the-problem)
- [Our solution](#our-solution)
- [System architecture](#system-architecture)
- [One voice turn, step by step](#one-voice-turn-step-by-step)
- [Safety design](#safety-design)
- [Memory and the Panchakosha profile](#memory-and-the-panchakosha-profile)
- [The Lisa model](#the-lisa-model)
- [Results](#results)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Running the project locally](#running-the-project-locally)
- [Testing](#testing)
- [Limitations and future work](#limitations-and-future-work)
- [Team](#team)

---

## The problem

Student mental health in India is a serious and growing problem. More than 14,000 students died by suicide in India in 2024 (NCRB), around 70% of college students report moderate to severe stress or anxiety, and India has fewer than one mental health professional per one lakh people.

From our own campus and conversations with students we saw three practical gaps:

1. **Help is not there when it is needed.** A student who cannot sleep at 2 a.m. before an exam cannot book a counsellor at that hour.
2. **Typing in English is a barrier.** Many students would rather *speak* about their feelings, and often in a mix of Hindi and English.
3. **Existing apps stop at the app.** Woebot, Wysa, Replika, YourDOST and Amaha are mostly text-based, mostly English, and are not linked to the student's own college counselling cell. Several rely on the chatting model itself to notice a crisis.

At the same time, colleges have no reliable, privacy-safe way to see how their students are doing overall, so problems are noticed late.

**Problem statement.** *Design and build a voice-first, multilingual mental health support system for Indian college students that gives safe first-level support at any hour, detects possible crisis independently of the chatting AI, and connects students to human help, while keeping their identity private.*

## Our solution

| Objective | How Zindagi meets it |
|---|---|
| Real-time voice in Indian languages | Streaming speech-to-text (Sarvam saaras:v4, Deepgram nova-3 fallback) → Lisa → text-to-speech (Sarvam bulbul:v3), with barge-in so the student can interrupt mid-sentence |
| Calm, brief, safe replies | **Lisa v2**, a Qwen3-8B model fine-tuned with QLoRA on 1,328 synthetic PFA + Panchakosha conversations; replies under 45 words, one question at most |
| Crisis detection that does not depend on Lisa | Keyword check + separate AI risk classifier (Gemini Flash-Lite) on every turn; Lisa's first words wait up to **350 ms** for the check; a crisis plays a fixed helpline message |
| Memory across sessions, with consent | Three memory tiers (working, session, long-term) and a five-layer **Panchakosha** wellbeing profile, each behind its own consent switch |
| Connection to the student's own counsellor | Anonymous booking with a session code; the student chooses whether to share the AI summary and their identity; up to three trusted contacts |
| Campus picture without revealing anyone | Admin dashboard of grouped trends with **k-anonymity (k = 10)**, HMAC pseudonyms such as `#KR047`, and live alerts over Server-Sent Events |

### Features

**Student app (Android and web)**
- Phone number + OTP login
- Mood check-in (Anxious, Angry, Sad, Fatigued, Unsafe, Overwhelmed, Calm, Okay) with an optional note; picking *Unsafe* shows the helpline at once
- Voice chat with Lisa, with two consent switches before each session: save transcript and summary for 30 days, and let Lisa remember a short summary
- **Moss**, a sprout mascot with ten expressions that follow the tone of the conversation
- Counsellor booking and in-app chat with the counsellor
- *People I trust*: up to three trusted contacts, encrypted and visible only to the student
- Saved sessions (only if the student chose to save them)

**Therapist portal**: manage time slots, see the day's appointments by session code, read the AI-prepared care brief, write private notes (AES-256-GCM encrypted). The student's identity is shown only while their consent is active, and every view is audit-logged.

**Admin portal**: campus wellbeing cards, a mood heat map and trends by year and department, live risk and disengagement alerts, assignment to counsellors and in-app outreach cards, all without seeing who the student is.

## System architecture

Zindagi has three client apps, one backend split into three processes, two data stores, and a set of external AI services.

```
 ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
 │ Student app      │   │ Admin portal     │   │ Therapist portal     │
 │ Expo / RN        │   │ Next.js  :3100   │   │ Next.js  :3200       │
 │ Android + web    │   │ college admins   │   │ counsellors          │
 └────────┬─────────┘   └────────┬─────────┘   └──────────┬───────────┘
          │ HTTPS + WebSocket     │ server-side HTTPS       │ server-side HTTPS
          ▼                       ▼                         ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ CORE (server/) — the only component that reads or writes data       │
 │   api     Express 5  :4000   auth, consent, check-ins, booking,     │
 │                              staff APIs, chat socket, SSE alerts    │
 │   voice   WebSocket  :4001   STT → safety gate → Lisa → TTS         │
 │   worker  background         summaries, memory, Panchakosha profile,│
 │                              rollups, alerts, care briefs, retention│
 └──────────┬──────────────────────────┬──────────────────┬────────────┘
            ▼                          ▼                  ▼
   PostgreSQL (Prisma, 35 tables)   Redis (session   External AI services
   system of record                 memory, TTL)     (see table below)
```

- The portals never connect to the database. They call the core API from their own server side, and the browser never holds a backend token, so a bug in a portal cannot expose data the core API does not allow.
- Every staff request is scoped to that staff member's college by the core API.
- No audio is ever stored; only text, and only with consent.

### AI models and services

| Purpose | Model / service | Notes |
|---|---|---|
| Conversation (Lisa) | Lisa v2 (fine-tuned Qwen3-8B), served with vLLM on Modal | Temperature 0.5, max 120 tokens, streaming; scales to zero after 15 idle minutes |
| Speech-to-text | Sarvam saaras:v4 | Codemix mode, 16 kHz, 700 ms end-of-speech |
| Backup speech-to-text | Deepgram nova-3 | Multi-language |
| Text-to-speech | Sarvam bulbul:v3 | Speaker "Priya", 24 kHz |
| AI risk check | Gemini 3.5 Flash-Lite | LOW / ELEVATED / URGENT / UNKNOWN; 350 ms gate |
| In-call context agent | Qwen3 on Groq | Writes the session brief |
| Summaries and memory | gpt-oss-120b on Groq | Strict JSON, worker only |
| Check-in severity and insights | gpt-oss-20b on Groq | Worker only |
| Embeddings for recall | OpenAI text-embedding-3-small | 1,536 dimensions, cosine similarity |

Every LLM endpoint is OpenAI-compatible, so any of them can be swapped by changing a base URL and model name in `server/.env`.

## One voice turn, step by step

1. **Listen.** The app gets a short-lived voice ticket from the core API, then streams 16-bit PCM audio at 16 kHz over a WebSocket.
2. **Speech to text.** Audio streams to Sarvam saaras:v4 in codemix mode; Deepgram nova-3 takes over if Sarvam fails.
3. **Recall.** The prompt builder adds the last 8 turns, the student's memory card and the session brief.
4. **Reply.** Lisa streams her answer; a clause chunker cuts it into small speakable pieces so speech starts before the reply is finished.
5. **Gate.** The first piece waits up to 350 ms for the AI risk check. It is released if the check says the turn is safe, or if time runs out and the keyword check found nothing.
6. **Speak.** Released pieces go to Sarvam bulbul:v3; the language of each piece is detected from its script. If the student starts talking, playback stops at once (barge-in).
7. **Remember.** When the call ends, a summary job is queued; the worker writes the summary, topics and profile notes later, so the student never waits.

## Safety design

Safety has three layers, none of which depends on Lisa:

1. **Crisis keyword check** (English and Hindi). On a match, Lisa is not called at all; a fixed bilingual message with Tele-MANAS (14416) and 112 is played.
2. **AI risk check.** A separate model classifies every turn. If it later flags a turn, any audio still playing is stopped and the support message is played.
3. **Reply review.** Each piece of Lisa's reply is checked against rules before release, for example only approved helplines and no medicine advice.

Any non-LOW result writes a record (level and time, never the student's words) to the risk history. Every 30 seconds the worker's alert engine turns these into alerts for the admin portal:

| Alert | Rule | Severity |
|---|---|---|
| Risk | An URGENT result in the last 7 days | High |
| Risk | An ELEVATED result, or three lowest-score check-ins, in the last 7 days | Medium |
| Disengagement | A student with ≥ 3 check-ins has not checked in for 4 days | Medium |
| Cohort dip | A group's 7-day average mood is ≥ 0.6 below its 28-day average | Low |

An alert is only a prompt for a human to review.

## Memory and the Panchakosha profile

Lisa uses three memory tiers, each behind its own consent switch:

- **Working memory:** the last 8 turns of the current conversation.
- **Session memory (Redis):** short notes and a context brief written during the call; these expire automatically.
- **Long-term memory (PostgreSQL):** a memory card of key facts, past session summaries, profile notes and embeddings for semantic recall.

After each session the worker records observations under the five **Panchakosha** layers from Indian thought: *Annamaya* (sleep, food, body), *Pranamaya* (energy, fatigue), *Manomaya* (worries, moods), *Vijnanamaya* (thinking, decisions) and *Anandamaya* (joy, meaning). Over time this builds a simple wellbeing profile that helps Lisa ask the right gentle question.

## The Lisa model

General models with a long prompt wrote long replies, asked several questions at once, switched to English when the student spoke Hindi, and named unapproved helplines. Fine-tuning a smaller model fixed most of this and is cheaper to run.

**Data pipeline (`training/v2/`)**

1. Split the WHO PFA guide into sections that each generated conversation follows.
2. Plan ~3,000 conversations across all five Panchakosha layers, several languages and many situations (support, possible and clear crisis, declined exercises, memory recall, hostile users, boundary requests, good news).
3. Generate with a teacher model (gpt-oss-120b via OpenRouter; Qwen3-235B for Bengali and Punjabi), with a hard budget stop of $6.50.
4. Rule-filter every Lisa reply in code (≤ 45 words, ≤ 1 question, approved helplines only).
5. Judge with a different model family (Qwen3 on Groq) for PFA quality, safety, language match and memory use.
6. Keep 1,328 conversations (1,115 train / 90 validation / 123 test) → **4,258 training examples** in English, Hinglish, Hindi, Punjabi and Bengali.

**Fine-tuning:** Qwen3-8B, QLoRA (4-bit base, LoRA on all linear layers), rank 16, alpha 32, learning rate 1e-4 cosine, 2 epochs with early stopping, effective batch 16, loss on Lisa's replies only. Trained on a single rented GPU (Vast.ai) and served with vLLM on Modal.

## Results

| Item | Value |
|---|---|
| Apps / backend services | 3 / 3 |
| Spoken languages | English, Hindi, Hinglish, Punjabi (Bengali also in code and data) |
| Database tables | 35 |
| Automated tests passing | 118 (16 test files) |
| Hand-written crisis test cases | 78, in 5 languages |
| Lisa v2 rule pass rate | **95.2%** of 189 test cases (prompted base models: 41–59%) |
| Lisa v2 language match | **100%** (prompted base models: 67–85%) |
| Median reply length | 23 words |
| Total project cost | ~ US $28 (plus free Modal credits) |

**What did not work well:** Lisa's own crisis replies are not reliable enough (for example 0% in Bengali crisis cases), which is exactly why crisis handling never depends on her. Lisa sometimes acts as if she remembers a student when no memory exists. The crisis training data has not yet been reviewed by a counsellor, and the model server has a cold start after 15 idle minutes.

## Tech stack

| Layer | Technology |
|---|---|
| Student app | Expo SDK 58, React Native 0.88, TypeScript, `react-native-audio-api` |
| Portals | Next.js 15 (admin, therapist) |
| Backend | Node.js, TypeScript, Express 5, WebSockets, Prisma |
| Data | PostgreSQL 17, Redis 7 |
| Model training | Python, Unsloth / Transformers, PEFT (QLoRA) |
| Model serving | vLLM on Modal |
| Deployment | Docker Compose, Caddy, Cloudflare Tunnel, EAS Build |
| Security | AES-256-GCM, scrypt password hashing, HMAC pseudonyms, HTTPS/TLS |

## Repository layout

```
.
├── mobile/      Student app (Expo / React Native, Android + web)
├── server/      Core API, voice service and background worker (Node.js + Prisma)
│   ├── prisma/  Database schema and migrations
│   └── src/     api, voice/, worker/, memory/, booking/, contacts/, insights/, staff/
├── admin/       Admin portal (Next.js, port 3100)
├── therapist/   Therapist portal (Next.js, port 3200)
├── training/    Lisa dataset pipeline, fine-tuning and evaluation (see training/README.md)
├── deploy/      Docker Compose stack, Caddy, tunnels and deployment guide
└── docs/        Architecture, system flow, voice and memory design notes
```

More detail: [docs/system-flow.md](docs/system-flow.md), [docs/priority-1-hot-path.md](docs/priority-1-hot-path.md), [docs/priority-2-memory-context.md](docs/priority-2-memory-context.md), [deploy/README.md](deploy/README.md), [training/README.md](training/README.md).

## Running the project locally

### Prerequisites

- Node.js 20+ and npm
- PostgreSQL 17 and Redis 7 (installed locally, or via Docker)
- Docker Desktop (only for the one-command Docker option)
- API keys for the services you want to use: Sarvam (speech), Deepgram (optional backup STT), Groq, Gemini (risk check), OpenAI (embeddings), and an OpenAI-compatible endpoint for Lisa
- For voice on Android: an Android phone and an Expo **development build** (voice uses a native audio module, so it does not run in Expo Go)

### 1. Clone and install

```powershell
git clone https://github.com/12Mishra/zindagi-mental-health-app.git
cd zindagi-mental-health-app
git checkout zindagi-final-submission

cd server;    npm ci; cd ..
cd mobile;    npm ci; cd ..
cd admin;     npm ci; cd ..
cd therapist; npm ci; cd ..
```

### 2. Configure environment variables

Create `server/.env`. The most important values are:

```env
# Data stores — use a fresh, empty database
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/zindagi_dev
REDIS_URL=redis://localhost:6379
PORT=4000
VOICE_PORT=4001

# Which apps may call the API and the voice socket
PORTAL_ORIGINS=http://localhost:8082,http://localhost:3100,http://localhost:3200
VOICE_ALLOWED_ORIGINS=http://localhost:8082

# Dev login: every phone number accepts this OTP
AUTH_OTP_CODE=1234

# Lisa (any OpenAI-compatible endpoint: vLLM on Modal, Ollama, etc.)
VOICE_LLM_BASE_URL=https://<your-lisa-endpoint>/v1
VOICE_LLM_API_KEY=<key>
VOICE_LLM_MODEL=lisa-v2

# Speech
SARVAM_API_KEY=<key>
DEEPGRAM_API_KEY=<key>            # optional fallback

# Safety classifier (OpenAI-compatible)
VOICE_SAFETY_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
VOICE_SAFETY_API_KEY=<key>
VOICE_SAFETY_MODEL=<gemini-flash-lite-model>
VOICE_TRIAGE_GATE_MS=350

# Helper models (Groq) and embeddings (OpenAI)
CONTEXT_LLM_BASE_URL=https://api.groq.com/openai/v1
CONTEXT_LLM_API_KEY=<key>
SUMMARY_LLM_BASE_URL=https://api.groq.com/openai/v1
SUMMARY_LLM_API_KEY=<key>
SUMMARY_LLM_MODEL=openai/gpt-oss-120b
INSIGHTS_LLM_BASE_URL=https://api.groq.com/openai/v1
INSIGHTS_LLM_API_KEY=<key>
INSIGHTS_LLM_MODEL=openai/gpt-oss-20b
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_API_KEY=<key>
EMBEDDING_MODEL=text-embedding-3-small

# Encryption (64 hex chars each; required in production, dev falls back to a fixed key)
NOTES_ENCRYPTION_KEY=<64 hex chars>
CONTACTS_ENCRYPTION_KEY=<64 hex chars>

# Password used by the demo seed for staff accounts
SEED_STAFF_PASSWORD=<choose-one>
```

Generate an encryption key with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_VOICE_WS_URL=ws://localhost:4001/voice
```

For a phone on the same Wi-Fi, replace `localhost` with your computer's LAN IP. These values are baked in at build time, so restart Metro with `-c` after changing them.

Create `admin/.env` and `therapist/.env`:

```env
CORE_API_URL=http://localhost:4000
```

Never commit any `.env` file; they are git-ignored.

### 3. Set up the database

```powershell
cd server
npx prisma generate
npx prisma migrate deploy
npm run seed:portals      # demo college, staff accounts, students and sample data
cd ..
```

Only run migrations against a new, empty database.

### 4. Start everything

Run each in its own terminal:

```powershell
cd server; npm run dev                       # core API on :4000
```

```powershell
cd server; npm run build; npm run voice      # voice service on :4001
```

```powershell
cd server; npm run worker                    # background worker (after npm run build)
```

```powershell
cd mobile; npm run web                       # student app in the browser on :8082
```

```powershell
cd admin; npm run dev                        # admin portal on :3100
```

```powershell
cd therapist; npm run dev                    # therapist portal on :3200
```

### 5. Sign in

| App | URL | Login |
|---|---|---|
| Student app | http://localhost:8082 | Any phone number, OTP = `AUTH_OTP_CODE` |
| Admin portal | http://localhost:3100 | `admin@tiet.test` / `SEED_STAFF_PASSWORD` |
| Therapist portal | http://localhost:3200 | `therapist1@tiet.test` (also `therapist2`, `therapist3`) / `SEED_STAFF_PASSWORD` |

The admin portal hides any group smaller than 10 students, so sparse demo data shows "fewer than 10 students".

### Android (voice on a real phone)

```powershell
cd mobile
npx eas build --profile development --platform android   # once
npx expo start --dev-client -c
```

Point `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_VOICE_WS_URL` at your LAN IP (dev build) or an HTTPS deployment (preview/release APK, which blocks plain `http://`).

### Option: run the backend with Docker

The `deploy/` folder runs PostgreSQL, Redis, core, voice and worker in containers:

```powershell
cd deploy
cp .env.example .env          # set POSTGRES_PASSWORD; application settings stay in server/.env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose exec core npx prisma migrate deploy
docker compose restart worker
```

Public demo URLs without a domain, tunnels and the full VM setup are covered in [deploy/README.md](deploy/README.md).

### Serving Lisa

Lisa v2 is served with vLLM behind an OpenAI-compatible API (on Modal in our deployment). The model weights are not stored in Git. For local experiments any OpenAI-compatible server works, for example Ollama with `OLLAMA_URL` / `OLLAMA_MODEL`; set `VOICE_LLM_BASE_URL` and `VOICE_LLM_MODEL` accordingly. If the Modal server has been idle for 15 minutes, send one request to wake it before a demo.

## Testing

```powershell
cd server; npm test                 # 118 tests: voice, memory, staff, insights, booking, contacts
```

```powershell
cd mobile; npx tsc --noEmit; npm run lint
```

```powershell
python -m unittest discover -s training -p "test_*.py" -v
```

Lisa evaluation results are in `training/v2/data/eval_runs/`, and the dataset manifest is in `training/v2/data/final/manifest.json`.

## Limitations and future work

**Current limits**
- The crisis training data has not been reviewed by a counsellor, and Lisa's own crisis replies are weak in some languages. Crisis handling therefore relies on the separate safety layer.
- The system has been tested by the team only, not in a study with real students.
- The Modal model server shuts down after 15 idle minutes and has a cold start.
- Emotion detection from voice tone and check-ins through an outside chat app, planned at mid-term, were replaced by text-based emotion cues and in-app check-ins.

**Planned**
- A pilot with the TIET counselling cell measuring PHQ-9 and GAD-7, with counsellor review of all crisis content
- Retraining Lisa with counsellor-reviewed crisis examples and more "no memory" cases
- Keeping one GPU warm during peak hours (for example nights before exams)
- More languages: Tamil, Telugu, Marathi and Bengali voice
- Google Play release and rollout to other colleges; optional video sessions with counsellors

## Ethics and privacy

- Separate consent switches for transcripts and memory, shown before each chat; transcripts are deleted after 30 days
- No audio is stored anywhere
- Counsellors see a session code; the student's name only with consent, and every view is audit-logged
- Admins see pseudonyms and groups of at least ten students, never names
- Therapist notes and trusted contacts are encrypted with AES-256-GCM; staff passwords are hashed with scrypt
- Lisa says she is an AI, does not diagnose, and does not suggest medicines
- Designed with the IEEE Code of Ethics, IEEE 7000-2021 and India's Digital Personal Data Protection Act, 2023 in mind

## Team

| Member | Main contribution |
|---|---|
| Aviral Jain | Lisa model: PFA and Panchakosha conversation design, v2 data pipeline, QLoRA fine-tuning, vLLM serving on Modal |
| Abhyuday Mishra | Student app (React Native / Expo), real-time voice pipeline, frontend–backend integration, summaries, Moss redesign |
| Tanay Sachdeva | Student app, memory and context tiers, personalization and the Panchakosha profile |
| Varun Khera | Safety and alerting, alert engine, privacy-focused counsellor booking, trusted contacts |
| Pranjal Sharma | Admin portal and campus analytics, monitoring, automated testing, documentation |

**Supervisor:** Dr. Saurabh Sharma, Assistant Professor, Department of Electronics and Communication Engineering, TIET Patiala.

---

*If you or someone you know is struggling, call Tele-MANAS at **14416** (India, 24×7) or **112** in an emergency.*
