# Zindagi: Lisa realtime prototype

Lisa is an AI support companion for a college capstone demonstration. This repository is an engineering prototype, not validated clinical care. The existing `training/Modelfile` describes a Lisa GGUF distributed separately; its large weights are not committed to Git. No live-provider performance result is included.

The Expo app supports browser and Android development-build voice sessions. The existing Node API handles opaque-token authentication, consent, conversation ownership, and short-lived voice tickets. A separate TypeScript voice process handles PCM WebSocket sessions, streaming STT/LLM/TTS, interruption and response checking. A separate worker handles durable summaries and profile evidence. Audio is not retained.

- [Architecture and decisions](docs/architecture.md)
- [Voice protocol](docs/voice-protocol.md)
- [Local setup and demo runbook](docs/demo-runbook.md)
- [Model and data preparation](training/README.md)

Start on branch `codex/lisa-bilingual-realtime` from baseline `c8322ec`. Use a new isolated PostgreSQL database and the placeholder `.env.example` files. Do not run a schema reset against an existing database. Browser and Android live checks require approved provider credentials/quota; Android additionally requires a development build and a physical speaker/microphone test.

Quick static checks:

```powershell
cd server
npm ci
npx prisma generate
npm test
cd ../mobile
npm ci
npx tsc --noEmit
cd ..
python -m unittest discover -s training -p 'test_*.py' -v
```

The setup commands, concurrency settings, and failure behavior are in the runbook. The source synthetic dataset is not committed into the new pipeline; prepared output belongs in `training/prepared/`, which is Git ignored.
