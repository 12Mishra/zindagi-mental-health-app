# Lisa realtime prototype: architecture decision record

Status: code implementation prepared, 2026-10-06; live integration remains unverified. This is an engineering prototype for a supervised college demonstration, not validated clinical care.

## Confirmed requirements

- Keep the existing Node authentication and conversation API. Add a separate TypeScript voice process; do not use an agent orchestration framework.
- Start with one active voice session in development, test two and three concurrent active sessions, and run one summary job at a time. Limits are environment configuration, not capacity claims.
- Listen continuously after explicit session start, stream microphone frames and provider results, support barge-in, and check each Lisa response segment before any text/audio is released.
- Monitor stable student utterances live. Use separate triage, response review, acoustic features, and post-session summary paths.
- Never persist raw or synthesized audio. Persist transcripts only with explicit consent. No alert leaves Zindagi automatically: risk signals become pseudonymous alerts that a counsellor or admin reviews (see [system-flow.md](system-flow.md) §4).

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
- The voice process keeps a bounded per-session context and runs the realtime hot path described below. Urgent/unknown deterministic triage prevents any Lisa speech for that turn. The full response and actually delivered text are tracked separately.
- Pending summaries are represented as pending. New sessions load completed summaries only, with a bounded authorized transcript tail when available. Historical summaries and profiles are treated as data, not instructions.
- Consented transcript/session records expire after 30 days by default. Temporary unconsented session records expire within 24 hours. The student can delete saved sessions from the Saved tab; ownership is checked by the API.

## Realtime hot path (P1)

```
STT final ─► [A] regex triage (sync)
             ├─ URGENT/UNKNOWN ─► fixed bilingual policy message, no Lisa generation
             └─ LOW ─► [B] LLM triage ∥ [C] Lisa stream ─► clause chunker ─► ReleaseGate ─► sync regex review
                                                                              ─► persistent TTS socket ─► client
                                                         each released clause ─► [D] async LLM output audit
```

Only [A] and the bounded gate wait sit between end of speech and first audio. The LLM producer never awaits TTS; up to two clauses are synthesized ahead while audio is forwarded in segment order. TTS uses one Sarvam Bulbul v3 WebSocket per voice session (`TTS_TRANSPORT=ws`; `http` is the per-clause fallback). The voice language (`hi-IN` or `en-IN`) is chosen once per student turn from Devanagari or common Roman-Hindi words, and one speaker is used for the whole session.

**Safety/latency trade-off (fail-open on the latency budget only).** The release gate waits up to `VOICE_TRIAGE_GATE_MS` (default 350 ms) for the LLM triage. If it has not resolved and the deterministic triage said LOW, held clauses are released so the student is not left in silence. The LLM triage keeps running: a later ELEVATED/UNKNOWN/URGENT verdict (or a triage error, treated as UNKNOWN) aborts generation, cancels synthesis, sends `interrupted`, drops late chunks, and speaks the fixed policy message. A student who says something the regex patterns miss can therefore hear up to roughly one clause of Lisa audio before the cut. Turns where the deterministic triage is URGENT/UNKNOWN never play Lisa audio. Setting `VOICE_TRIAGE_GATE_MS` above the checker's p99 latency restores fully blocking behavior at the cost of latency.

Output review is an audit, not a per-clause blocker: deterministic regex review runs synchronously before each clause is released; the LLM checker runs in the background for each released clause (at most two at once per session) and a BLOCK cuts playback the same way. A checker that is unavailable (UNKNOWN) is logged by reason code and does not cut. `VOICE_OUTPUT_REVIEW=off` disables the audit. The safety checker must be configured explicitly (`VOICE_SAFETY_*`); it never falls back to the Lisa endpoint, to avoid correlated failure.

## Memory, context and continuity (P2)

Brief: [priority-2-memory-context.md](priority-2-memory-context.md). Lisa only speaks; a small secondary **context agent** (`CONTEXT_LLM_*`, Groq `qwen/qwen3.8-27b` in this prototype) runs off the hot path and is never awaited by a turn.

| Tier | Store | Lifetime | Contents |
|---|---|---|---|
| Working | `SessionContext` in the voice process | current turn | last `WORKING_TURNS` (8) verbatim messages; assistant turns are what the student actually heard |
| Session | Redis hash `zs:sess:{conversationId}` | the chat, +`SESSION_MEMORY_TTL_S` after end | rolling summary, notes, turn brief, recalled snippets, language, risk timeline |
| Long-term | Postgres `UserMemory`, `MemorySummary`, `RiskHistory` | until the student deletes it (summaries `MEMORY_RETENTION_DAYS`) | memory card, open threads, preferences, session summaries (+ embeddings), append-only risk history |

The prompt (`memory/prompt-builder.ts`, pure) is one system message (policy + `<memory_card>` + `<session_notes>` + `<recalled_memories>` + `<turn_brief>`, all marked untrusted) followed by alternating working turns, within `PROMPT_TOKEN_BUDGET`. Over budget it drops recalled snippets, then oldest turns (min 4), then note lists, then the rolling summary; the policy prompt and memory card are never dropped. It reads an in-process mirror, so `promptBuildMs` (in `turn_metrics` and the `[turn]` log line) should stay well under 15 ms.

Context agent jobs: (1) on a stable partial (>= 6 new words, >= 700 ms apart, one in flight, cancelled when the turn is finalised) it writes a turn brief and, if embeddings are configured, recalls up to 3 past summaries; (2) after each turn it merges session notes and folds turns that left the working window into the rolling summary; (3) at ticket issue it pre-generates a personalised opening line, used on `ready` if present within 300 ms, else a static bilingual greeting. If Redis or the agent is unavailable Lisa still answers with the memory card and working turns.

**Durable worker.** Per ended conversation it summarises either the consented transcript or, for memory-only consent, the Redis snapshot stored in `SummaryJob.payload` (rolling summary + notes, never raw turns), writes `MemorySummary` with its embedding, appends `RiskHistory`, and merges the memory card with an LLM call (`SUMMARY_LLM_*`) under optimistic concurrency (`UserMemory.version`, up to 3 retries). `CustomerProfile` is no longer written.

**Consent.** `transcriptConsent` stores the transcript for 30 days and feeds the Saved tab. `memoryConsent` (default on) allows only a short summary, the memory card, risk history and embeddings. With neither flag nothing outlives the 24 h temporary record, though the memory card is still read and Redis session memory is used during the chat. `RISK_HISTORY_REQUIRES_CONSENT=true` gates `RiskHistory` on memory consent (TODO: counsellor decision for URGENT events). Students can read, delete and set preferences through `GET|DELETE /api/memory` and `PATCH /api/memory/preferences`.

**Retention.** Conversation expiry deletes transcript data only; `MemorySummary`, `ProfileObservation` and `RiskHistory` keep their rows with `conversationId = null`.

**Database.** The native PostgreSQL 17 `zindagi_voice_dev` has no `pgvector`. Embeddings are stored as `Float[]` and ranked in Node (`memory/vector.ts`, one user's rows only, `MEMORY_SEARCH_MAX_ROWS`). Upgrade path when a user's history outgrows that: Docker `pgvector/pgvector:pg17` on port 5433, or Supabase/Neon, swapping only `vector.ts` plus one migration. Groq has no embeddings endpoint, so recall stays off until `EMBEDDING_*` points at a multilingual embedding model.

## Portals and aggregation (P3, planned)

End-to-end data flow: [system-flow.md](system-flow.md). Implementation brief: [portals-plan.md](portals-plan.md). Core (`server/`) stays the only component with database access; the college admin portal (`admin/`) and therapist portal (`therapist/`) are separate Next.js apps that call core's `/staff`, `/admin` and `/therapist` APIs server-side. Admin analytics come from k-suppressed `CohortDailyStat` rollups computed by the worker; therapists see a pseudonym, session code and a consented care brief, and identity only with an explicit grant. The static dashboard in the mobile app is demo data and will be removed from the student app.

## Transport choice

Binary WebSocket is small enough for this prototype and supports web and React Native clients. WebRTC would provide stronger network media behavior and mature acoustic echo handling but adds signaling and codec complexity. Platform echo cancellation remains necessary and requires physical speaker testing.

## Phase boundaries

1. Branch, record decisions, schema/protocol, and isolated configuration.
2. Web capture, authenticated voice service, streaming STT/LLM/TTS, cancellation, and explicit failures.
3. Android development-build capture/playback and physical-device verification.
4. Live triage, response gate, acoustic features, durable summaries/profile, deletion and retention.
5. Training preparation, focused tests, load harness, diagnostics and demo runbook.

No live-provider, Android, latency, capacity, clinical, or training result is implied by code completion. Each requires its own evidence.
