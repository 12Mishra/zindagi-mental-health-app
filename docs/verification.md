# Verification record — 2026-10-06

| Level | Check run | Result | What it establishes |
| --- | --- | --- | --- |
| Static | Server TypeScript build and Prisma format/validate/generate | Passed | Server source and schema are internally consistent. |
| Unit and controlled streams | `npm test` in `server` | 6 passed | Triage patterns, fail-closed checker behavior, Deepgram-style partial/final events over a local WebSocket, aligned PCM streaming, codec rejection. |
| Static | `npx tsc --noEmit` in `mobile` | Passed | Web and native TypeScript source compiles. |
| Web bundle | `npx expo export --platform web` in `mobile` | Passed | Expo Router and browser bundle resolve, including the Saved tab. |
| Data preparation | `python -m unittest training/test_prepare_dialogue.py` | 2 passed | Sanitization and scenario-family split logic on synthetic cases. |
| Attached data | Preparation script against the supplied JSON | 100 input records; 231 train, 27 validation, 42 test assistant targets | No model was trained; these are local file counts only. |

No migration was applied to a database here: the Docker daemon was unavailable and no isolated PostgreSQL instance was configured. No provider credentials or approved quota were supplied. Browser microphone, physical Android microphone/speaker, live 2–3 conversation capacity, summary crash recovery, latency, and cost remain unmeasured. The six server tests are controlled checks, not end-to-end live voice evidence.
