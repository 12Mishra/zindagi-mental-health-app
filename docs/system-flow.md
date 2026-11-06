# Zindagi: end-to-end system flow

Status: target architecture, 2026-11-06. Sections marked **(built)** exist in the code today; **(planned)** is specified in [portals-plan.md](portals-plan.md).

This is the source of truth for how data moves through Zindagi: from a student talking or checking in, through safety triage, memory and aggregation, to the college admin dashboard and the therapist portal.

## 1. Services

```
 ┌──────────────┐   ┌──────────────────┐   ┌──────────────────────┐
 │ Mobile app   │   │ Admin portal     │   │ Therapist portal     │
 │ Expo / RN    │   │ Next.js  :3100   │   │ Next.js  :3200       │
 │ students     │   │ college admins   │   │ counsellors          │
 └──────┬───────┘   └────────┬─────────┘   └──────────┬───────────┘
        │ HTTPS + WS          │ server-side HTTPS       │ server-side HTTPS
        ▼                     ▼                         ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │ CORE  (server/)  — the only component that reads or writes data │
 │  api     Express :4000   /auth /api /staff /admin /therapist    │
 │  voice   WS      :4001   realtime STT → Lisa → TTS              │
 │  worker  —               summaries, memory, rollups, alerts,    │
 │                          care briefs, retention                 │
 └──────────────┬──────────────────────────────┬───────────────────┘
                ▼                              ▼
        PostgreSQL (system of record)      Redis (session memory)
```

| Service | Users | Owns | Talks to |
|---|---|---|---|
| **Core** (built; extended) | — | Prisma schema, auth, consent, every read and write | Postgres, Redis, LLM / STT / TTS providers |
| **Admin portal** (planned) | College admins | Nothing; renders and proxies | Core `/staff/*`, `/admin/*` only |
| **Therapist portal** (planned) | Counsellors | Nothing; renders and proxies | Core `/staff/*`, `/therapist/*` only |

Rules:
- The portals never import Prisma and never hold a database URL. A bug in a portal cannot reach data that core's endpoint doesn't return.
- Browsers never hold a core token. Each portal keeps the staff session token in an httpOnly cookie and calls core from server components or route handlers.
- The admin API cannot return identity, transcripts, summaries or notes. Only the therapist API can return identity, and only with the student's active consent.

## 2. Data sources (what is written, by whom, under what consent)

| Data | Written by | Consent | Used by |
|---|---|---|---|
| `Message` (transcript) | api, voice **(built)** | `transcriptConsent` | Saved tab, summary worker |
| Redis session memory | voice **(built)** | none (TTL, ephemeral) | Lisa prompt, memory-only summaries |
| `ConversationSummary`, `ProfileObservation` | worker **(built)** | `transcriptConsent` | memory, kosha observations |
| `MemorySummary`, `UserMemory` | worker **(built)** | `memoryConsent` | Lisa memory, care briefs |
| `RiskEvent` (per turn, with evidence) | voice, api **(built)** | `transcriptConsent` | audit |
| `RiskHistory` (append-only) | worker **(built)**; voice for live non-LOW triage **(planned)** | see §4 | alerts |
| `Conversation.topics` | worker **(planned)** | either consent | Problem Frequency |
| `MoodCheckin` | api **(planned)** | the check-in itself | mood KPIs, heatmap, alerts |
| `Appointment`, `ConsentGrant`, `CareBrief`, `TherapistNote` | api, worker **(planned)** | explicit per-booking grants | therapist portal |
| `CohortDailyStat` | worker rollup **(planned)** | aggregate only, k-suppressed | admin portal |
| `Alert`, `Outreach` | worker, admin **(planned)** | pseudonymous | admin portal, student app |
| `AuditLog` | api **(planned)** | — | every staff read of student-linked data |

## 3. Flow A: student talks to Lisa (built)

```
mic PCM ─► voice WS ─► Deepgram STT ─► turn end
                                         ├─[A] regex triage (sync)
                                         │    URGENT/UNKNOWN ─► fixed bilingual message (Tele-MANAS 14416 / 112)
                                         ├─[B] LLM severity triage (async, VOICE_SAFETY_*) ─► ReleaseGate
                                         └─[C] Lisa LLM stream ─► clause chunker ─► ReleaseGate ─► regex review
                                                                    ─► Sarvam TTS socket ─► client
                     memory: working turns + Redis notes/brief + Postgres memory card ─► prompt builder
                     on end: SummaryJob (durable queue) ─► worker
```

The severity LLM in [B] is any OpenAI-compatible model that can classify text into `LOW | ELEVATED | URGENT | UNKNOWN`. It is configured separately from Lisa (`VOICE_SAFETY_*`) so both don't fail together. The classifier behind it will be replaced by a better severity measure later; everything downstream depends only on the four-level `RiskLevel`, so swapping it changes nothing else.

## 4. Flow B: safety signal to alert (planned)

```
live triage non-LOW ─► RiskHistory(level, flag='live_triage', no evidence text)
summary riskFlags   ─► RiskHistory(level=UNKNOWN, flag)                      (built)
check-in note       ─► worker severity classifier ─► MoodCheckin.severity
                                     │
                     worker alert engine (every 30 s, idempotent)
                                     ▼
       Alert { kind, severity, subjectPseudonym | cohortKey, dedupeKey @unique, status NEW }
                                     │ pg_notify('zindagi_alerts')
                                     ▼
       core api LISTEN ─► SSE /admin/alerts/stream ─► admin portal (live list)
```

Consent decision (pending counsellor sign-off, controlled by `SAFETY_SIGNALS_WITHOUT_CONSENT`, default `true`): a non-LOW live triage always writes a minimal `RiskHistory` row (level, time, conversation; never the student's words). Without it, alerts would only work for consenting students. If the counsellor decides otherwise, set the flag to `false`.

Alert rules:

| Kind | Rule | Severity |
|---|---|---|
| `RISK` | URGENT in the last 7 days | HIGH |
| `RISK` | ≥ 1 ELEVATED, or ≥ 3 check-ins scored 1, in the last 7 days | MEDIUM |
| `DISENGAGEMENT` | Opted into check-ins, had ≥ 3 before, none in the last 4 days | MEDIUM |
| `COHORT_DIP` | Cohort 7-day mean mood ≥ 0.6 below its prior 28-day mean, both windows n ≥ k | LOW |

`dedupeKey` (for example `risk:{pseudonym}:{isoWeek}`) makes each tick an upsert, so re-running the engine never duplicates alerts. Each row counts its occurrences ("flagged 3 times this week").

No alert is sent outside Zindagi automatically. A human (counsellor or admin) reviews every alert. The student always receives the Tele-MANAS message in the moment.

## 5. Flow C: aggregation to the admin dashboard (planned)

```
raw rows (Conversation, MoodCheckin, User.yearOfStudy/department, Conversation.topics)
        │
        │ worker rollup job: every ROLLUP_INTERVAL_MS (15 min) recompute today + yesterday;
        │ nightly recompute last 2 days; on first start backfill 84 days.
        │ SQL GROUP BY institution, day, cohortKey  →  UPSERT CohortDailyStat(metric, value, n)
        ▼
CohortDailyStat ──► core GET /admin/overview ──► k-suppression (n < Institution.kAnonymity → null)
                                              ──► admin portal server component ──► dashboard design
```

`cohortKey` takes the values `all`, `year:{1-5}` and `dept:{code}`. Year × department cross-cuts are never stored; that is where re-identification starts.

Metrics, one row per (institution, day, cohort, metric):

| Metric | Value | `n` |
|---|---|---|
| `active_students` | distinct students with a conversation or check-in that day | same |
| `mood_avg` | mean `MoodCheckin.score` (1–5) | distinct students who checked in |
| `checkins` | count | distinct students |
| `sessions_started`, `sessions_ended` | conversations | distinct students |
| `topic:{TOPIC}` | distinct students with that topic | distinct students with any topic |

Mapping to the dashboard design in `mobile/app/(tabs)/dashboard.tsx` (moving into `admin/`):

| Widget | Computed from |
|---|---|
| Active Students + sparkline | 7-day distinct actives; 7 daily `active_students` values |
| Avg Mood Score | 7-day `mood_avg` × 2 (0–10 scale) vs previous 7 days |
| Crisis Alerts | `Alert` with status NEW/ACK; "pending review" = NEW |
| Sessions Today | `sessions_started` today; "completed" = `sessions_ended` |
| Mood Trends heatmap (12 × 7) | daily `mood_avg` for `all`; bucket = 6 − round(avg); suppressed or empty = 0 |
| Problem Frequency | Σ `topic:X` ÷ Σ n over the range, top 5 |
| Year Distribution | 7-day actives per `year:N` cohort |
| Recent Alerts | latest 5 `Alert`, then SSE |

Suppression is applied in core, never in the UI. Cohort filters with fewer than k students are rejected, which also blocks differencing two published totals.

From an alert an admin can acknowledge, resolve, assign to a therapist, or send **outreach**: an in-app card to that pseudonym's device ("A counsellor is available, would you like to talk?"). Admins cannot unmask a student. A break-glass reveal for URGENT is a college policy decision and is not built.

## 6. Flow D: therapist booking (planned)

```
Mobile: "Talk to a counsellor" | offer after ELEVATED+ triage | outreach card
  └─► GET /api/booking/slots ─► pick slot ─► consent screen
        [x] share AI summary (default on)   [ ] share my name & contact (default off)
  └─► POST /api/booking/appointments
        tx: AvailabilitySlot OPEN→BOOKED (updateMany guard; 0 rows → 409)
            Appointment CONFIRMED + sessionCode (e.g. ZK-7QF3) + ConsentGrant rows
  └─► worker brief job: BRIEF granted and no brief →
        UserMemory card + last 3 MemorySummary + 4-week mood trend + risk levels (no evidence text)
        ─► LLM with strict JSON schema (deterministic fallback when unconfigured) ─► CareBrief (frozen)

Therapist portal
  /slots          create / remove availability
  /appointments   day list: session code, pseudonym, topic, consent badges
  /appointments/[id]
     brief        visible only while BRIEF grant active
     identity     403 unless IDENTITY grant active; every read → AuditLog
     notes        encrypted at rest (AES-256-GCM, NOTES_ENCRYPTION_KEY), therapist-only
     status       COMPLETED | NO_SHOW | CANCELLED_THERAPIST  → related Alert RESOLVED
```

Sessions happen in person or by phone. Video comes later. Students can revoke any grant until the session starts. A revoked BRIEF hides the brief immediately.

## 7. Flow E: student check-ins (planned)

`POST /api/checkins { score 1–5, tags[], note? }` writes `MoodCheckin(source=APP)`. A note is classified by the severity classifier in the worker, never on the request path. WhatsApp check-ins arrive later as `source=WHATSAPP` through the same table; nothing downstream changes.

## 8. Identity and pseudonyms

- Students authenticate with phone OTP (built). Staff authenticate with email and password (scrypt), have a role (`ADMIN | THERAPIST`) and belong to one `Institution`.
- `User.pseudonym` is a stored HMAC of the user id with `Institution.pseudonymSalt`, shown as `#A047`. It is the only student reference in alerts and in the therapist list.
- Every staff query is scoped by `institutionId` in core middleware. Portals send their portal name at login, and core refuses a role that doesn't match.

## 9. Retention

Transcripts expire at 30 days (built). `CohortDailyStat` holds no personal data and is kept for the academic year. Alerts are kept for 1 year, appointments and notes until the student deletes their account (planned in `DELETE /api/memory`).
