# Priority 1 — Voice hot path latency refactor (implementation brief)

Audience: the engineer/agent implementing this change. Read fully before editing.
Branch base: `codex/lisa-bilingual-realtime`. Create branch `feat/p1-hot-path-latency`.

## 1. Goal

Cut "student stops speaking → first Lisa audio" from tens of seconds to **p50 < 800 ms, p95 < 1500 ms**, with **no audible gaps between sentences** and **no self-interruption**, without weakening safety (no unchecked Lisa audio may play while the student's turn is classified URGENT/ELEVATED/UNKNOWN).

Scope is ONLY the realtime voice hot path. Out of scope (later priorities — do not start them): memory/context agent (P2), WebRTC/LiveKit (P3), fine-tuned safety classifier (P4), emotion model (P5), LLM retraining (P6). Do not change the Prisma schema except where stated.

## 2. Target architecture (source of truth)

```
STT partials/finals ─► turn end
                        ├─► [A] deterministic triage (regex, sync, ~0 ms)
                        ├─► [B] LLM triage (async, parallel)          ─┐
                        └─► [C] Lisa LLM stream (starts immediately)   │
                                 └─► clause chunker ─► ReleaseGate ◄───┘ (waits for B, bounded)
                                                        └─► TTS queue ─► persistent TTS socket ─► client
                                 each released clause ─► [D] async output review (audit; BLOCK => cut playback)
```

Hot-path rule: **only [A] and the bounded wait on [B] may sit between turn end and first audio.** Everything else is parallel or async.

## 3. Files involved

| File | Role |
|---|---|
| `server/src/voice/index.ts` | `VoiceSession` state machine — main refactor |
| `server/src/voice/providers.ts` | STT/LLM/TTS adapters — TTS rewrite, Deepgram params |
| `server/src/voice/safety-classifier.ts` | LLM triage + output review — make non-blocking-friendly |
| `server/src/voice/policy.ts` | regex triage/review, fixed messages — bilingual messages |
| `server/src/config.ts`, `server/.env.example` | new knobs, remove dead config |
| `server/src/voice/*.test.ts` | extend tests |
| `mobile/app/(tabs)/voice.tsx` | remove stale latency notice |
| `docs/voice-protocol.md`, `docs/demo-runbook.md` | update to match |

New files (suggested): `server/src/voice/clause-chunker.ts`, `server/src/voice/tts-session.ts`, `server/src/voice/release-gate.ts`, `server/src/voice/trace.ts`, tests for each.

## 4. Work items (do in this order)

### 4.1 Per-stage latency tracing (do first, it is the baseline)
- Add `trace.ts`: a per-turn object recording monotonic `performance.now()` marks: `speechFinal`, `triageRegexDone`, `triageLlmDone`, `llmRequestSent`, `llmFirstToken`, `firstClauseReady`, `gateReleased`, `ttsRequestSent`, `ttsFirstByte`, `firstAudioSent`, `lastAudioSent`, plus per-clause `reviewDone`.
- Emit them inside the existing `turn_metrics` event (add a `stages` object of ms offsets from `speechFinal`). Keep existing fields for compatibility.
- Log one line per turn to stdout: turn id + stage offsets. **Never log transcript text or audio.**
- Record a baseline (20 turns) BEFORE the remaining changes and paste it into the PR description.

### 4.2 LLM serving: configuration only, no code coupling to Ollama
- The voice LLM must be reached only through the OpenAI-compatible `VOICE_LLM_BASE_URL` (already true in `streamLisa`). Target deployment: vLLM or Fireworks/Together on GPU. Document in runbook: `vllm serve <model> --enable-lora --lora-modules lisa=<path>` style setup and the env values.
- In `streamLisa`: set `max_tokens` from new config `VOICE_LLM_MAX_TOKENS` (default **120**), add `temperature` from `VOICE_LLM_TEMPERATURE` (default 0.6; only sent when set, so Ollama Modelfile defaults still work locally), add `stream_options: { include_usage: true }` and record real token usage when returned.
- Add a connection warm-up: on session `ready`, fire a 1-token request (`max_tokens: 1`) to the LLM in the background, ignoring result, to avoid cold-start on the first turn. Make it toggleable (`VOICE_LLM_WARMUP=true`).
- System prompt length directive: append to the existing `SYSTEM_PROMPT` in `context.service.ts` one line: "Speak in at most 2–3 short sentences (under 45 words)." (Only this edit to context.service.ts in P1.)

### 4.3 Student triage in parallel with generation
Current: `respond()` awaits `assessStudentUtterance()` (LLM call, up to `VOICE_SAFETY_TIMEOUT_MS`, often much longer in practice) before starting Lisa.
New:
1. Run `triageStableUtterance` (regex) synchronously.
   - URGENT → speak `URGENT_SUPPORT` immediately, start no LLM generation. Still run LLM triage for the record.
   - UNKNOWN from regex → speak `SAFETY_CLARIFICATION` immediately (current behaviour preserved).
2. Otherwise start **both** `assessStudentUtterance` (LLM triage) and `streamLisa` at the same time with the same AbortSignal.
3. Lisa clauses flow into a `ReleaseGate`. The gate holds clauses until LLM triage resolves:
   - LOW → release all held + future clauses.
   - ELEVATED/UNKNOWN → abort Lisa generation, discard held clauses, speak `SAFETY_CLARIFICATION`.
   - URGENT → abort, discard, speak `URGENT_SUPPORT`.
   - **Timeout**: new config `VOICE_TRIAGE_GATE_MS` (default **350**). If LLM triage has not resolved by then AND regex said LOW, release (fail-open on the latency budget only for regex-LOW turns). LLM triage keeps running; if it later returns non-LOW, cut playback (send `interrupted`, abort, then speak the fixed policy message). If the triage call errors, treat as UNKNOWN → cut + clarify. Document this trade-off in `docs/architecture.md`.
4. Persist `RiskEvent` when triage resolves (unchanged semantics, consent-gated), not before generation.
5. Persisting the user message (`persistUser`) must not block generation start; it already runs in `commit` — keep it parallel and only await it before writing the assistant row.

### 4.4 Output review becomes async audit, not a per-clause blocker
Current: `speak()` awaits `checkLisaSegment()` (an LLM call) before EVERY clause → one network round trip per sentence.
New:
- Keep `reviewLisaSegment` (regex) **synchronous** before a clause is released. Regex BLOCK → drop the clause, abort generation, speak `RESPONSE_UNAVAILABLE` if nothing was spoken yet, else end the turn.
- Run the LLM `checkLisaSegment` **asynchronously** per released clause (bounded concurrency 2 per session). Result is written to `ResponseReview` (consent-gated, as today). If it returns BLOCK for the current generation: send `interrupted`, abort generation/TTS, drop late chunks. UNKNOWN (checker unavailable) → log reason code only, do not cut.
- Make the async review toggleable: `VOICE_OUTPUT_REVIEW=async|off` (default `async`).

### 4.5 Decouple LLM → clauses → TTS
Current: `await this.speak(...)` inside the `for await` token loop — clause N+1 is not processed until clause N's audio has fully streamed.
New:
- `clause-chunker.ts`: pure function/class fed tokens, emits clauses.
  - First clause: emit at first of `[,.!?।;:—]` after ≥ 4 words, or at 10 words on a space boundary.
  - Later clauses: emit at sentence end `[.!?।]` after ≥ 6 words, or at 25 words on a space boundary.
  - Flush remainder on stream end. Never split inside a number/abbreviation like "Dr." (keep a tiny exception list). Unit-test with English, Devanagari and Roman Hinglish.
- Producer (LLM loop) pushes clauses into a per-generation queue and NEVER awaits TTS.
- Consumer: one async loop per generation drains queue → ReleaseGate → regex review → TTS session. Order preserved by `segmentIndex`.
- Keep existing `response_text`, `audio_start`, `audio_chunk`, `audio_end`, `playback_progress` semantics and the `delivered` vs `generated` tracking.

### 4.6 Persistent streaming TTS session
Current: `streamSarvamPcm` = one HTTPS POST per clause (connection + TTFB each time).
New `tts-session.ts`:
- Interface (provider-agnostic):
  ```ts
  interface TtsSession {
    open(): Promise<void>;                       // once per voice session, at ready
    speak(text: string, segmentIndex: number, onChunk: (pcm: Buffer) => void, signal: AbortSignal): Promise<void>;
    cancel(): void;                              // barge-in: flush/cancel current synthesis
    close(): void;
  }
  ```
- Implement with **Sarvam's streaming TTS WebSocket API** (Bulbul v3, PCM16 24 kHz mono). Check Sarvam's current docs for the exact WS URL, config message and flush/cancel messages; do not guess silently — if a feature (e.g. cancel) is not supported, implement cancel by closing and lazily reopening the socket, and note it.
- Keep the existing HTTP `streamSarvamPcm` as a fallback adapter selected by `TTS_TRANSPORT=ws|http` (default `ws`) so the demo can fall back.
- Keep existing PCM alignment, codec sniffing and output byte limits.
- Open the TTS socket at session `ready` (parallel with STT connect), with keepalive if the provider requires it.

### 4.7 TTS language selection fix
Current: `language_code = /[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-IN'` → Roman Hinglish is read by an English voice mid-conversation, and the voice/accent can flip between clauses.
New: decide language **per turn, not per clause**, from the student's turn: Devanagari present OR Roman-Hindi lexicon hit (reuse the `ROMAN_HINDI` word list idea from `training/prepare_dialogue.py`, ~40 common words) → `hi-IN`; else `en-IN`. Keep one speaker for the whole session (`TTS_SPEAKER` config, default current `shubh`). Bulbul handles code-mixed text under `hi-IN`.

### 4.8 Turn-taking and barge-in
- Deepgram params (in `DeepgramStream.connect`): `endpointing` from config `STT_ENDPOINTING_MS` (default **300**), add `utterance_end_ms=1000`, keep `interim_results`, `vad_events`, `smart_format=true`. Treat `UtteranceEnd` as a turn end when no `speech_final` arrived (dedupe so one turn = one final).
- **Barge-in no longer triggers on `SpeechStarted`.** While state is `generating`/`playing`, interrupt only when a partial transcript adds ≥ `BARGE_IN_MIN_WORDS` (default **2**) new words since Lisa started speaking. `SpeechStarted` may still emit the `speech_start` event to the client but must not call `interrupt()` during `playing`.
- Barge-in must: abort LLM, cancel the TTS session, clear the clause queue, bump generation, emit `interrupted` (existing logic), and record delivered text only.
- Short backchannels ("hmm", "haan", "ok", "accha") under the word threshold must not interrupt; add a test.

### 4.9 Bilingual fixed policy messages
In `policy.ts`, `URGENT_SUPPORT`, `SAFETY_CLARIFICATION`, `RESPONSE_UNAVAILABLE` become `{ en, hi }` pairs selected by the turn language from 4.7. `URGENT_SUPPORT` must include India's Tele-MANAS helpline **14416** and "or call 112 in an emergency". Keep `allowedPolicyText` logic working with both variants. Have the team's counsellor approve the exact wording (leave a TODO comment with the draft).

## 5. Scrap / remove list (redundant or conflicting with target architecture)

| # | Current logic | Location | Action | Reason |
|---|---|---|---|---|
| S1 | Awaiting LLM `assessStudentUtterance` before generation | `voice/index.ts` `respond()` (`Promise.all([assessStudentUtterance…, commit])`) | **Replace** with parallel triage + ReleaseGate (4.3) | Serial LLM call on every turn is the largest blocker |
| S2 | Awaiting LLM `checkLisaSegment` before every clause | `voice/index.ts` `speak()` | **Replace** with sync regex + async LLM audit (4.4) | One extra network round trip per sentence → audible gaps |
| S3 | `await this.speak()` inside the token loop | `voice/index.ts` `respond()` | **Remove**; producer/consumer queue (4.5) | Serialises LLM and TTS |
| S4 | Inline clause splitting (`pending.search(/[.!?।]\s/)`, 18-char / 120-char rules) | `voice/index.ts` `respond()` | **Delete**, replaced by `clause-chunker.ts` | First clause waits for a full sentence; untestable inline |
| S5 | Per-clause HTTP TTS as the primary path | `providers.ts` `streamSarvamPcm` | **Demote** to fallback behind `TTS_TRANSPORT=http` | New connection + TTFB per clause |
| S6 | Devanagari-only per-clause language detection | `providers.ts` `streamSarvamPcm` | **Delete**, per-turn detection (4.7) | Roman Hinglish voiced in English; accent flips mid-reply |
| S7 | `interrupt()` on Deepgram `SpeechStarted` while playing | `voice/index.ts` `onSpeechStart()` | **Remove** the interrupt call (4.8) | VAD fires on echo/noise → Lisa interrupts herself |
| S8 | `onFinal` calling `interrupt()` then `interrupt(false)` back-to-back | `voice/index.ts` `onFinal()` | **Simplify** to one cancellation path via the new barge-in function | Duplicate, confusing generation bumps |
| S9 | `voiceSafetyBaseUrl`/`voiceSafetyApiKey` silently falling back to the LLM URL/key | `config.ts` | **Remove fallback**; require explicit safety config | Correlated failure: same slow model doing both jobs |
| S10 | Unused config `geminiApiKey`, `grokApiKey` | `config.ts` | **Delete** | Dead config |
| S11 | Hard-coded `max_tokens: 200` | `providers.ts` `streamLisa` | **Replace** with `VOICE_LLM_MAX_TOKENS` (120) | Too long for voice |
| S12 | Character/4 token *estimates* as the only usage figure | `voice/index.ts` metrics | **Keep as fallback**, prefer real `usage` from stream (4.2) | Accurate cost/latency data |
| S13 | Client notice "may take 15–60 seconds… please pause" | `mobile/app/(tabs)/voice.tsx` ~line 56 | **Delete**; show a short "thinking" state only | Contradicts target UX |
| S14 | Docs stating per-segment blocking review and Gemini safety >10 s setup as the local recipe | `docs/demo-runbook.md`, `docs/architecture.md`, `docs/voice-protocol.md` | **Update** to the new flow | Docs must match the source of truth |

Do NOT remove in P1 (they belong to later priorities): `acoustic.ts`/`acoustic-worker.ts` (P5 replaces), context injection as a fake user message in `context.service.ts` and `history.slice(-20)` (P2 fixes), legacy typed-chat `processMessage` in `conversation.service.ts` (leave working; it may keep the blocking checks), training files (P6).

## 6. New / changed config (`server/.env.example` + `config.ts`)

```
VOICE_LLM_MAX_TOKENS=120
VOICE_LLM_TEMPERATURE=            # empty = server/model default
VOICE_LLM_WARMUP=true
VOICE_TRIAGE_GATE_MS=350
VOICE_OUTPUT_REVIEW=async         # async | off
TTS_TRANSPORT=ws                  # ws | http
TTS_SPEAKER=shubh
STT_ENDPOINTING_MS=300
BARGE_IN_MIN_WORDS=2
```
Validate all with the existing `positiveInteger`/enum style helpers; fail fast on invalid values.

## 7. Tests (`npm test` in `server`, node:test, no live providers)

Add/extend with local fakes (pattern already used in `providers.test.ts`):
1. `clause-chunker`: first-clause early emit; sentence splitting; Devanagari `।`; Hinglish; abbreviation not split; flush on end.
2. `release-gate`: LOW releases held clauses in order; ELEVATED/URGENT discards and yields the policy message; timeout releases only when regex LOW; late non-LOW after release triggers cut.
3. Pipeline: fake LLM emitting tokens with delays + fake TTS → assert clause 2 TTS starts before clause 1 audio finishes (no serialisation), and order of `segmentIndex` is preserved.
4. Barge-in: 1-word backchannel during playback does not interrupt; 2+ new words does; `SpeechStarted` alone does not.
5. Async review BLOCK on a released clause sends `interrupted` and drops later chunks of that generation.
6. Language selection: Devanagari → hi-IN; "mujhe exams ka stress hai" → hi-IN; pure English → en-IN; constant across clauses of one turn.
7. Existing 6 tests still pass.

## 8. Acceptance criteria

- `npm run build` and `npm test` pass in `server`; `npx tsc --noEmit` passes in `mobile`.
- With a GPU-served LLM and live Deepgram/Sarvam keys, 20-turn manual run (English, Hindi, Hinglish) shows from `turn_metrics.stages`: **p50 speechFinal→firstAudioSent < 800 ms**, p95 < 1500 ms; inter-clause gap (audio_end of N → audio_start of N+1) p95 < 150 ms. Report the numbers in the PR with the baseline from 4.1.
- No Lisa audio is ever sent for a turn whose regex triage is URGENT/UNKNOWN; unchecked audio after a late non-LOW LLM triage is cut within one chunk.
- Lisa does not interrupt herself on speaker playback during a headphone-free web test (echo case is a P3 concern on Android; note results).
- Docs in §5 S14 updated. No transcript text in logs.

## 9. Notes for the implementer

- Keep the existing code style: compact TypeScript, no new frameworks, no new runtime deps unless unavoidable (the `ws` package already exists for the TTS socket).
- Every async path must honour the generation id + AbortSignal; late events from an old generation are dropped (existing invariant).
- If a provider API detail is uncertain (Sarvam WS protocol, Deepgram `UtteranceEnd` field names), verify against current official docs and cite the doc URL in a code comment.
- Commit in small steps matching sections 4.1–4.9.
