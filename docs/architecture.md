# Lisa realtime prototype: architecture decision record

Status: code implementation prepared, 2026-10-06; live integration remains unverified. This is an engineering prototype for a supervised college demonstration, not validated clinical care.

## Confirmed requirements

- Keep the existing Node authentication and conversation API. Add a separate TypeScript voice process; do not use an agent orchestration framework.
- Start with one active voice session in development, test two and three concurrent active sessions, and run one summary job at a time. Limits are environment configuration, not capacity claims.
- Listen continuously after explicit session start, stream microphone frames and provider results, support barge-in, and check each Lisa response segment before any text/audio is released.
- Monitor stable student utterances live. Use separate triage, response review, acoustic features, and post-session summary paths.
- Never persist raw or synthesized audio. Persist transcripts only with explicit consent. No paid services or automatic external alerts.

## Verified starting point

- Clean `feat/lisa-voice-pipeline` at `c8322ec`; implementation branch is `codex/lisa-bilingual-realtime`.
- Expo 54 / React Native 0.81.5, Node/Express API, Prisma 7 PostgreSQL schema, opaque SHA-256-hashed session tokens.
- Existing UI records a complete utterance before upload; web uses one-shot browser recognition. Existing server can fabricate STT text and summary results, and summary processing uses `setImmediate`.
- The supplied dialogue JSON contains 100 top-level examples and includes a credential-bearing field. It is reference input only and is never copied into the repository.

## Engineering decisions

- WebSocket transport for the prototype: binary little-endian signed PCM16, 16 kHz mono, nominal 20 ms frames. Web Audio and a native audio callback perform conversion; the server rejects unsupported format negotiation. Audio is not sent through the Express API per frame.
- `server` owns Prisma schema and migrations. Express issues one-use, short-lived opaque voice tickets after checking the normal session and conversation ownership. The voice process validates them with the database during a bounded handshake.
- A database summary-job table is the durable queue. Ending a conversation and creating its job happen in one transaction. A separate worker leases at most one job initially, retries boundedly, and reconciles expired leases. Deletion cascades prevent late jobs recreating removed records.
- Deepgram Nova-3 multilingual is the initial streaming STT adapter, Sarvam Bulbul v3 is the streaming TTS adapter, and a configurable OpenAI-compatible streaming endpoint is the initial hosted LLM adapter. Credentials and quotas must be explicitly supplied; absence is a visible unavailable state. No fallback silently processes student data elsewhere.
- The voice process keeps a bounded per-session context, streams stable clauses to a response policy gate and then to TTS. A blocked or unknown response never reaches the client. Urgent/unknown student triage prevents unreviewed speech. The full response and actually delivered text are tracked separately.
- Pending summaries are represented as pending. New sessions load completed summaries only, with a bounded authorized transcript tail when available. Historical summaries and profiles are treated as data, not instructions.
- Consented transcript/session records expire after 30 days by default. Temporary unconsented session records expire within 24 hours. The student can delete saved sessions from the Saved tab; ownership is checked by the API.

## Transport choice

Binary WebSocket is small enough for this prototype and supports web and React Native clients. WebRTC would provide stronger network media behavior and mature acoustic echo handling but adds signaling and codec complexity. Platform echo cancellation remains necessary and requires physical speaker testing.

## Phase boundaries

1. Branch, record decisions, schema/protocol, and isolated configuration.
2. Web capture, authenticated voice service, streaming STT/LLM/TTS, cancellation, and explicit failures.
3. Android development-build capture/playback and physical-device verification.
4. Live triage, response gate, acoustic features, durable summaries/profile, deletion and retention.
5. Training preparation, focused tests, load harness, diagnostics and demo runbook.

No live-provider, Android, latency, capacity, clinical, or training result is implied by code completion. Each requires its own evidence.
