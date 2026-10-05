# Lisa voice protocol v1

The client opens `ws://HOST:4001/voice` or `wss://HOST/voice` and sends a JSON `hello` with a one-use voice ticket within five seconds. The normal bearer token is never placed in a URL. Browser origins are checked against `VOICE_ALLOWED_ORIGINS`.

`hello`: `{ "v":1, "type":"hello", "ticket":"...", "format":{"encoding":"pcm_s16le","sampleRate":16000,"channels":1,"frameMs":20} }`. The server rejects every other input format. Following `ready`, each binary WebSocket message is one or more complete PCM16 frames, bounded to 100 ms. The client keeps microphone capture active while Lisa plays so barge-in can be detected.

All JSON events have `v`, `type`, `conversationId`, `sessionId`, `turnId` when applicable, `generationId` when applicable, `seq`, and `at` (Unix milliseconds). Server events: `ready`, `speech_start`, `speech_end`, `transcript_partial`, `transcript_final`, `risk`, `response_text`, `audio_start`, `audio_chunk`, `audio_end`, `acoustic`, `turn_metrics`, `interrupted`, `error`, `session_end`. `error` has a stable `code`, `recoverable`, and a safe message. Binary server messages carry raw PCM16 audio only after `audio_start` declares format and generation; each JSON `audio_chunk` envelope precedes one binary frame and includes sequence/timestamp. Stale generations are discarded by both ends. `turn_metrics` uses a monotonic server clock for stage durations; output-token count is an explicitly labeled character-based estimate, not provider usage.

Client controls: `mute`, `unmute`, `interrupt`, `playback_progress`, and `end`. `playback_progress` reports the last fully played response segment. The server stores generated and delivered text separately. `end` is idempotent; it cancels providers, freezes the transcript boundary, ends the conversation, and returns `session_end` with summary status (`pending`, `completed`, `failed`, or `none`).

State sequence: connecting → ready/listening → user_speaking → endpointing → generating → playing → listening. Interruption moves playing/generating → interrupted → user_speaking. End may occur from any live state and moves ending → closed. Provider failure moves to recoverable error or closes with an explicit unavailable code. A session never restarts a cancelled generation.

Limits are configurable. Defaults: one active conversation, 64 KiB socket buffered output, 3.2 KiB input frame (100 ms), 60 seconds idle timeout, 30 minute maximum session. Overload rejects a new session with `capacity_reached`; it never queues microphone audio without bound.
