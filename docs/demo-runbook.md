# Local Lisa prototype runbook

## Prerequisites

- Node and npm compatible with Expo 54 and Prisma 7, Python 3.10+, PostgreSQL, and (for Android) Android SDK plus a physical device or emulator.
- Fresh database `zindagi_voice_dev`. Never run a reset against the existing project database. The API, voice process, and worker use the same new database URL.
- Explicitly approved Deepgram, Sarvam, LLM, safety-checker, and optional summary-model credentials/quota. Do not use supplied dataset keys. External providers may retain data under their own terms.
- A configured base-model endpoint that supports OpenAI-compatible streamed chat completions, plus a structured safety-checker endpoint. If the same model is used for both, failures are correlated.

## Setup

From the repository root in PowerShell:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item mobile/.env.example mobile/.env
# Edit the two local .env files with your new database, approved providers and reachable host URLs.
cd server
npm ci
npx prisma migrate deploy
npx prisma generate
npm run build
```

The first checked-in migration creates auth tables, the next adds the formerly unmigrated conversation tables, and the third adds voice lifecycle and job tables. `migrate deploy` is intended for a **new isolated database**. It was not run against the user's existing database in this implementation.

Open three terminals in `server`:

```powershell
npm start
npm run voice
npm run worker
```

For browser development, set `EXPO_PUBLIC_API_URL=http://localhost:4000`, `EXPO_PUBLIC_VOICE_WS_URL=ws://localhost:4001/voice`, and include the Expo web origin in `VOICE_ALLOWED_ORIGINS`. Then:

```powershell
cd mobile
npm ci
npm run web
```

Restart Expo after changing `mobile/.env`; the browser bundle embeds these URLs. Start `npm run voice` before beginning a hands-free session. If the voice server or a required provider is unavailable, the browser stays on the start screen and shows the startup error.

### LLM serving

The voice LLM is reached only through the OpenAI-compatible `VOICE_LLM_BASE_URL`; nothing in the voice path is coupled to Ollama. The latency target assumes a GPU-served model, for example vLLM with the Lisa LoRA:

```bash
vllm serve <base-model> --enable-lora --lora-modules lisa=<path-to-lisa-adapter> --max-model-len 4096
```

then `VOICE_LLM_BASE_URL=http://<gpu-host>:8000/v1`, `VOICE_LLM_MODEL=lisa`, and `VOICE_LLM_API_KEY` if the server requires one. Fireworks or Together with an uploaded LoRA work the same way with their base URL and key. For local development, Ollama (`http://127.0.0.1:11434/v1/`) or llama.cpp `llama-server` also work but will not meet the latency target. `VOICE_LLM_MAX_TOKENS` (default 120) caps reply length; `VOICE_LLM_TEMPERATURE` is only sent when set, so a Modelfile's own sampling settings apply otherwise. `VOICE_LLM_WARMUP=true` sends a 1-token request when a session becomes ready to avoid a cold first turn.

### Safety checker

Configure a separate, fast structured checker with `VOICE_SAFETY_BASE_URL`, `VOICE_SAFETY_MODEL` and `VOICE_SAFETY_API_KEY` (for example an approved Gemini Flash-Lite key through `https://generativelanguage.googleapis.com/v1beta/openai/`). It is required and never falls back to the Lisa endpoint. It no longer blocks the start of Lisa's reply: see `docs/architecture.md` for the parallel triage, `VOICE_TRIAGE_GATE_MS` release gate and async output audit. In a live check on 2026-10-30 a Gemini triage call took 0.8–1.6 s, so with the 350 ms gate the fail-open path is the normal case.

### Memory and context (P2)

Redis holds session memory, the ticket-time prefetch and the pre-generated greeting. Run it locally with `docker run -d -p 6379:6379 redis:7` (or use a managed Redis such as Upstash) and set `REDIS_URL`. Without Redis the voice session still works in a degraded mode (memory card + working turns, static greeting) and logs `session_memory_unavailable`.

The context agent uses Groq's OpenAI-compatible API. Put the key in `server/.env` as `CONTEXT_SAVING_LLM_GROQ` (or `CONTEXT_LLM_API_KEY`); `CONTEXT_LLM_BASE_URL` and `CONTEXT_LLM_MODEL` default to `https://api.groq.com/openai/v1` and `qwen/qwen3.8-27b` when that key is set. Without a key the agent is disabled. Do not commit the key. Other knobs: `WORKING_TURNS`, `PROMPT_TOKEN_BUDGET`, `SESSION_MEMORY_TTL_S`, `CONTEXT_LLM_TIMEOUT_MS`, `CONTEXT_RECALL_MIN_SCORE`, `MEMORY_RETENTION_DAYS`, `RISK_HISTORY_REQUIRES_CONSENT`.

Recall needs `EMBEDDING_BASE_URL/API_KEY/MODEL` and a matching `EMBEDDING_DIM` (OpenAI-compatible `/embeddings`, multilingual model). pgvector is **not** required: vectors are ranked in Node. After configuring embeddings run `npm run memory:embed-backfill`.

After pulling this change, in `server`:

```powershell
npx prisma migrate deploy
npx prisma generate
npm run memory:migrate -- --dry-run   # counts only
npm run memory:migrate                # idempotent: legacy profiles/summaries -> UserMemory/RiskHistory/MemorySummary
```

The memory worker is the same `npm run worker` process. Student controls: `GET /api/memory`, `DELETE /api/memory`, `PATCH /api/memory/preferences`.

### Realtime knobs

`TTS_TRANSPORT=ws` (persistent Sarvam socket, default) or `http` (per-clause fallback), `TTS_SPEAKER` (default `shubh`), `STT_ENDPOINTING_MS` (default 300), `BARGE_IN_MIN_WORDS` (default 2), `VOICE_OUTPUT_REVIEW=async|off`. Keep `DEEPGRAM_API_KEY` and `SARVAM_API_KEY` configured for live audio.

For Android, use the development PC's reachable LAN IP in both mobile URLs and rebuild after adding the native audio library:

```powershell
cd mobile
npx expo run:android --device
npx expo start --dev-client
```

The native capture/playback module is not in stock Expo Go. Android microphone and speaker behavior, acoustic echo cancellation, background cleanup, and interruption latency require a physical-device check. This code intentionally stops on app backgrounding and does not record in the background.

## Demonstration and evidence

1. Register/login through the existing app. Start Lisa with transcript consent off; confirm no transcript or summary is stored. The temporary session record expires within 24 hours. Start a new session with consent on to exercise summaries and deletion in the Saved tab.
2. Speak English, Hindi, and mixed Hindi-English in a single session. Observe partial/final transcripts, audio chunks, and interruption. Say "hmm" or "haan" while Lisa speaks (no interruption), then two or more words (interruption). Collect `turn_metrics.stages` (or the `[turn]` log lines) for 20 turns and report p50/p95 of `firstAudioSent` and the inter-clause gap (audio_end of N → audio_start of N+1).
3. Start with `VOICE_MAX_CONVERSATIONS=1`; set 2, then 3 for explicit concurrent-session tests. Keep `SUMMARY_CONCURRENCY=1`. Do not count idle sockets as active conversations.
   For a transport-level run with a synthetic or consented raw PCM16 16 kHz mono fixture and fresh one-use tickets, use `node server/scripts/load-voice.mjs --tickets tickets.json --pcm synthetic-16k-mono.pcm --sessions 2`. This harness cannot establish actual speaker playback latency.
4. Observe `SummaryJob` pending/running/completed/failed states in the isolated database. A pending previous summary is represented as pending with a bounded transcript tail; no fabricated result is shown.
5. Delete a conversation in the Saved tab or through `DELETE /api/conversations/:id` with its owner token and verify linked messages/jobs/summaries are gone. Cross-user access must fail.

The application logs connection/state/error codes without transcript text or audio. It emits per-turn stage timings (`turn_metrics.stages` and one `[turn]` log line), provider token usage when returned (character estimates otherwise), and a session STT-duration estimate. Set the `COST_*` rates from approved provider pricing to calculate rough USD estimates; zero defaults mean no pricing has been entered. Capture actual client playback timing, billable provider usage, and resource consumption before claiming latency or capacity results; client and server clocks need alignment. No live-provider, Android-device, three-session, latency, training, or clinical result was measured during the initial code build.

## Failure behavior

- Missing or expired ticket, disallowed origin, malformed frame, overloaded connection, and absent provider configuration close the voice session with an explicit error code.
- Urgent or uncertain deterministic triage routes immediately to a fixed bilingual safety/clarification message (the urgent one names Tele-MANAS 14416 and 112). Otherwise Lisa clauses are held by the release gate until LLM triage says LOW or `VOICE_TRIAGE_GATE_MS` passes; a later non-LOW verdict or triage error cuts playback and speaks the fixed message. Deterministic output review blocks a clause synchronously; the LLM output audit runs in the background and cuts playback on BLOCK.
- Barge-in (two or more new non-backchannel words, never VAD alone) cancels model/synthesis, closes and reopens the TTS socket (Sarvam has no in-band cancel), clears client playback, advances the generation, and drops late chunks. The native library version used here does not expose confirmed Android echo cancellation, so speaker testing is a release gate.
- Summary generation uses a durable database job with a lease, up to three attempts, and a separate worker. A failed summary remains failed; it is never replaced with a generic positive summary.
- Raw input and synthesized audio remain in bounded memory only. Acoustic features run in a worker thread; no emotion model is available, so emotion is `not_available`.

## Suggested five-person ownership

1. Frontend/audio: web and Android capture/playback, permissions, device QA.
2. Realtime orchestration: tickets, protocol, state machine, cancellation, backpressure.
3. Model/data: base endpoint, sanitizer, Colab preparation, bilingual regression cases.
4. Triage/profile: versioned policies, response checks, summary evidence and counsellor review.
5. Testing/demo: isolated DB, load and latency evidence, runbook, panel rehearsal.

The team implements session state, turn boundaries, safety routing, consent, and recovery. Provider services supply speech recognition, language generation, and synthesis; this project does not claim to train those base models.
