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

For Android, use the development PC's reachable LAN IP in both mobile URLs and rebuild after adding the native audio library:

```powershell
cd mobile
npx expo run:android --device
npx expo start --dev-client
```

The native capture/playback module is not in stock Expo Go. Android microphone and speaker behavior, acoustic echo cancellation, background cleanup, and interruption latency require a physical-device check. This code intentionally stops on app backgrounding and does not record in the background.

## Demonstration and evidence

1. Register/login through the existing app. Start Lisa with transcript consent off; confirm no transcript or summary is stored. The temporary session record expires within 24 hours. Start a new session with consent on to exercise summaries and deletion in the Saved tab.
2. Speak English, Hindi, and mixed Hindi-English in a single session. Observe partial/final transcripts, response review, audio chunks, and interruption. A checker failure must show an error instead of playing unchecked Lisa text.
3. Start with `VOICE_MAX_CONVERSATIONS=1`; set 2, then 3 for explicit concurrent-session tests. Keep `SUMMARY_CONCURRENCY=1`. Do not count idle sockets as active conversations.
   For a transport-level run with a synthetic or consented raw PCM16 16 kHz mono fixture and fresh one-use tickets, use `node server/scripts/load-voice.mjs --tickets tickets.json --pcm synthetic-16k-mono.pcm --sessions 2`. This harness cannot establish actual speaker playback latency.
4. Observe `SummaryJob` pending/running/completed/failed states in the isolated database. A pending previous summary is represented as pending with a bounded transcript tail; no fabricated result is shown.
5. Delete a conversation in the Saved tab or through `DELETE /api/conversations/:id` with its owner token and verify linked messages/jobs/summaries are gone. Cross-user access must fail.

The application logs connection/state/error codes without transcript text or audio. It emits per-turn first-token/first-audio timing, rough token/character counts, and a session STT-duration estimate. Set the `COST_*` rates from approved provider pricing to calculate rough USD estimates; zero defaults mean no pricing has been entered. Capture actual client playback timing, billable provider usage, and resource consumption before claiming latency or capacity results; client and server clocks need alignment. No live-provider, Android-device, three-session, latency, training, or clinical result was measured during the initial code build.

## Failure behavior

- Missing or expired ticket, disallowed origin, malformed frame, overloaded connection, and absent provider configuration close the voice session with an explicit error code.
- Urgent or uncertain student safety routes to a fixed safety/clarification message. LLM response segments are held until both deterministic and structured checks allow them; checker errors block output.
- Barge-in cancels model/synthesis, clears client playback, advances the generation, and drops late chunks. The native library version used here does not expose confirmed Android echo cancellation, so speaker testing is a release gate.
- Summary generation uses a durable database job with a lease, up to three attempts, and a separate worker. A failed summary remains failed; it is never replaced with a generic positive summary.
- Raw input and synthesized audio remain in bounded memory only. Acoustic features run in a worker thread; no emotion model is available, so emotion is `not_available`.

## Suggested five-person ownership

1. Frontend/audio: web and Android capture/playback, permissions, device QA.
2. Realtime orchestration: tickets, protocol, state machine, cancellation, backpressure.
3. Model/data: base endpoint, sanitizer, Colab preparation, bilingual regression cases.
4. Triage/profile: versioned policies, response checks, summary evidence and counsellor review.
5. Testing/demo: isolated DB, load and latency evidence, runbook, panel rehearsal.

The team implements session state, turn boundaries, safety routing, consent, and recovery. Provider services supply speech recognition, language generation, and synthesis; this project does not claim to train those base models.
