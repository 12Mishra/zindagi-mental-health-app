# Priority 3 — Admin portal, therapist portal and their core APIs (implementation brief)

Audience: the engineer/agent implementing this. Read [system-flow.md](system-flow.md) first; it is the data-flow source of truth. Branch from the P2 work: `feat/p3-portals`.

## 1. Goal

Replace the static admin dashboard with real, privacy-preserving aggregates, and add an anonymous therapist booking pipeline, as two Next.js apps backed by core (`server/`). Student-side mobile UI (check-in wiring, booking screens, outreach cards, removing the Dashboard tab) is **phase 2 of this priority** and comes after the portals; its core endpoints are built here.

Out of scope: WhatsApp transport, video sessions, push notifications, a fine-tuned severity model (the classifier is pluggable; any OpenAI-compatible model that can categorise is fine for now).

## 2. Repository layout

```
server/                 core (existing): api + voice + worker, owns Prisma
  src/staff/            staff auth, requireStaff middleware
  src/admin/            overview, alerts, SSE, outreach
  src/therapist/        slots, appointments, brief, identity, notes
  src/booking/          student booking + consents
  src/checkins/         student check-ins
  src/insights/         rollup SQL, suppression, pseudonyms, severity classifier
  src/worker/           + rollup-job.ts, alert-engine.ts, brief-job.ts
  src/scripts/seed-portals.ts
admin/                  Next.js 15 (App Router), port 3100
therapist/              Next.js 15 (App Router), port 3200
docs/system-flow.md, docs/portals-plan.md
```

Each portal keeps its own `lib/types.ts` mirroring core's response types. Promote them to a shared `packages/contracts` only if they start to drift.

## 3. Schema (one migration: `p3_portals`)

```prisma
model Institution { id, name, slug @unique, kAnonymity Int @default(10), pseudonymSalt String, createdAt }
User           += institutionId String?, yearOfStudy Int?, department String?, pseudonym String? @unique, checkinOptIn Boolean @default(false)
Conversation   += topics Topic[] @default([])
enum Topic     { ACADEMIC ANXIETY RELATIONSHIPS FINANCIAL FAMILY SLEEP CAREER HEALTH OTHER }

enum StaffRole { ADMIN THERAPIST }
model StaffUser    { id, institutionId, email @unique, passwordHash, role, displayName, active, createdAt }
model StaffSession { id, staffUserId, tokenHash @unique, expiresAt, createdAt }          // same hashing as Session

model MoodCheckin { id, userId, score Int /*1-5*/, tags String[], note String?, source CheckinSource /*APP|WHATSAPP*/,
                    severity RiskLevel?, classifiedAt DateTime?, createdAt; @@index([userId, createdAt]) }

model CohortDailyStat { institutionId, day DateTime @db.Date, cohortKey String, metric String, value Float, n Int, updatedAt;
                        @@id([institutionId, day, cohortKey, metric]) }

enum AlertKind { RISK DISENGAGEMENT COHORT_DIP }   enum AlertSeverity { LOW MEDIUM HIGH }   enum AlertStatus { NEW ACK RESOLVED }
model Alert { id, institutionId, kind, severity, status @default(NEW), dedupeKey @unique, subjectUserId String? /*never returned by admin API*/,
              subjectPseudonym String?, cohortKey String?, occurrences Int, message String, assigneeId String?, firstSeenAt, lastSeenAt, resolvedAt?;
              @@index([institutionId, status, lastSeenAt]) }
model Outreach { id, alertId, userId, message, createdAt, seenAt?, dismissedAt? }

model TherapistProfile { staffUserId @id, languages String[], specialties Topic[], bio String? }
enum SlotStatus { OPEN BOOKED REMOVED }   enum SessionMode { IN_PERSON PHONE VIDEO }
model AvailabilitySlot { id, therapistId, startsAt, endsAt, mode, status @default(OPEN); @@index([therapistId, startsAt]) }
enum AppointmentStatus { CONFIRMED COMPLETED NO_SHOW CANCELLED_STUDENT CANCELLED_THERAPIST }
model Appointment { id, slotId, studentId, therapistId, institutionId, status, sessionCode @unique, reason Topic?, alertId?, createdAt, updatedAt }
enum ConsentScope { BRIEF IDENTITY CONTACT }
model ConsentGrant { id, appointmentId, scope, grantedAt, revokedAt?; @@unique([appointmentId, scope]) }
model CareBrief    { appointmentId @id, content Json, generator String /*llm|fallback*/, generatedAt }
model TherapistNote { id, appointmentId, authorId, ciphertext String, iv String, tag String, createdAt }
model AuditLog     { id, actorId, actorRole, action, targetType, targetId, at; @@index([targetType, targetId]) }
```

Migration notes: backfill `User.institutionId` by matching `User.college` to the seeded institution (case-insensitive); compute `pseudonym` for every user.

## 4. Core API

All responses JSON; every staff route passes `requireStaff(role)`, which loads `StaffSession`, checks role, and attaches `{ staffId, role, institutionId }`. Every query filters by that `institutionId`.

| Method + path | Role | Notes |
|---|---|---|
| `POST /staff/login` `{email,password,portal}` | — | `portal` must match role (`admin`→ADMIN, `therapist`→THERAPIST); returns opaque token; rate-limit 5/min/IP |
| `POST /staff/logout`, `GET /staff/me` | staff | |
| `GET /admin/overview?weeks=12&cohort=all` | ADMIN | one payload for the whole dashboard (§5) |
| `GET /admin/alerts?status=&cursor=` | ADMIN | never includes `subjectUserId` |
| `GET /admin/alerts/stream` | ADMIN | SSE; events `alert.created`, `alert.updated`; 25 s heartbeat |
| `PATCH /admin/alerts/:id` `{status?, assigneeId?}` | ADMIN | |
| `POST /admin/alerts/:id/outreach` `{message?}` | ADMIN | RISK/DISENGAGEMENT only; default bilingual message; 1 per alert per 24 h |
| `GET /admin/therapists` | ADMIN | names for assignment |
| `GET|POST /therapist/slots`, `DELETE /therapist/slots/:id` | THERAPIST | delete only OPEN slots (→ REMOVED) |
| `GET /therapist/appointments?from&to` | THERAPIST | own only; pseudonym, sessionCode, reason, consent flags |
| `GET /therapist/appointments/:id` | THERAPIST | brief only while BRIEF active; audit-logged |
| `GET /therapist/appointments/:id/identity` | THERAPIST | 403 unless IDENTITY active; returns name (+ phone if CONTACT); audit-logged |
| `GET|POST /therapist/appointments/:id/notes` | THERAPIST | AES-256-GCM with `NOTES_ENCRYPTION_KEY` |
| `PATCH /therapist/appointments/:id` `{status}` | THERAPIST | COMPLETED resolves `alertId`; CANCELLED_THERAPIST reopens the slot |
| `POST /api/checkins`, `GET /api/checkins/me` | student | score 1–5, ≤ 5 tags, note ≤ 500 chars |
| `GET /api/booking/slots?topic&lang` | student | next 14 days, own institution, OPEN only |
| `POST /api/booking/appointments` `{slotId, reason?, consents[], alertId?}` | student | tx with `updateMany({status:'OPEN'})` guard → 409 on race; max 2 active per student |
| `GET /api/booking/appointments`, `DELETE /api/booking/appointments/:id` | student | cancel reopens slot |
| `PATCH /api/booking/appointments/:id/consents` `{scope, granted}` | student | until `startsAt` |
| `GET /api/outreach`, `POST /api/outreach/:id/seen` | student | |

## 5. `/admin/overview` response

```ts
{ asOf: string; institution: { name: string; activeStudents: number };
  kpis: Array<{ id: 'students'|'mood'|'alerts'|'sessions'; value: number|null; delta: string; spark: (number|null)[] }>;
  heatmap: number[][];              // [week][day], 0 = no data or suppressed, 1-5
  problems: Array<{ topic: Topic; pct: number }> | null;   // top 5, null if suppressed
  years: Array<{ year: number; pct: number }> | null;
  alerts: Array<{ id; kind; severity; message; lastSeenAt; status }>; }
```

## 6. Worker jobs (all idempotent, all in `summary-worker.ts`'s process)

1. **Topics**: extend `generateSummaryAndKeywords` to return `topics` (enum list, ≤ 3); invalid values are dropped, not fatal. Write `Conversation.topics` in the existing transaction.
2. **Rollup** (`ROLLUP_INTERVAL_MS`, default 900000): SQL in §5 of system-flow.md, `INSERT … ON CONFLICT DO UPDATE`. On start, if no rows exist, backfill 84 days.
3. **Alert engine** (`ALERT_INTERVAL_MS`, default 30000): rules in system-flow.md §4; upsert by `dedupeKey`; `pg_notify` on insert or severity change.
4. **Severity classifier for check-in notes**: `insights/severity.ts`, interface `classifySeverity(text): Promise<RiskLevel>`. Uses `SEVERITY_LLM_*`, falling back to `VOICE_SAFETY_*`; regex `triageStableUtterance` runs first and URGENT short-circuits. Unavailable → `UNKNOWN`, which never raises an alert alone.
5. **Brief job** (poll 5 s): appointments with an active BRIEF and no `CareBrief`. LLM via `summaryJson` with schema `{presenting: string, themes: Topic[], moodTrend: 'improving'|'stable'|'declining'|'unknown', riskLevels: RiskLevel[], whatHelped: string[], openThreads: string[], caution: string}`; deterministic fallback from structured fields when the LLM is unconfigured or invalid.
6. **Live triage signal**: in `voice/index.ts persistRisk` and `conversation.service.ts`, append a `RiskHistory` row for non-LOW triage when `SAFETY_SIGNALS_WITHOUT_CONSENT=true`, independent of the existing consent-gated `RiskEvent`.

## 7. Portals

Shared design: port `ZColors`, `ZRadius`, `ZShadow` from `mobile/constants/zindagi-theme.ts` into CSS variables (`app/globals.css`), with dark mode. No UI framework, no chart library: KPI cards, sparkline, heatmap, bar chart and stacked bar are plain divs as in `dashboard.tsx`.

Auth pattern (both apps):
- `app/login/page.tsx` → server action → core `/staff/login` → `cookies().set('zs_staff', token, { httpOnly, sameSite: 'lax', secure in prod, maxAge 12h })`.
- `middleware.ts` redirects to `/login` without the cookie. `lib/core.ts` is a server-only fetch wrapper adding `Authorization`; a 401 clears the cookie and redirects.
- Mutations are server actions. The SSE proxy is `app/api/alerts/stream/route.ts`, which streams core's response body through.

**admin/** routes: `/` (dashboard, the design from `dashboard.tsx`, live alerts via EventSource), `/alerts` (filterable list; ack, resolve, assign, send outreach), `/login`.

**therapist/** routes: `/` (today and upcoming appointments), `/appointments/[id]` (brief, consent badges, reveal identity button, notes, status), `/availability` (week grid; add and remove slots), `/login`.

Env: `CORE_API_URL=http://localhost:4000`, `PORT`.

## 8. Seed (`npm run seed:portals`, dev only, refuses when `NODE_ENV=production`)

One institution (`tiet`, k = 10); 1 admin and 2 therapists (emails `*@tiet.test`, password from `SEED_STAFF_PASSWORD`); 150 synthetic students across years 1–4 and 5 departments; 12 weeks of check-ins with exam-week dips; ~400 ended conversations with topics; risk rows producing 2 HIGH and 3 MEDIUM alerts; therapist slots for the next 14 days; 3 appointments (one with identity consent). Then it runs the rollup backfill and one alert-engine pass. Seed users have phone numbers in a reserved test range so they can never collide with real ones.

## 9. Order of work

| Step | Deliverable | Done when |
|---|---|---|
| 1 | Migration, staff auth, seed | `seed:portals` runs; staff login returns a token; wrong portal → 403 |
| 2 | Check-ins, topics, rollup, `/admin/overview` | overview matches hand-written SQL on seed data; cells with n < k are null |
| 3 | Alert engine, SSE, alerts API, outreach | inserting an URGENT `RiskHistory` row shows in the stream within 2 s |
| 4 | `admin/` app | dashboard renders seed data; suppressed cells render as empty; live alert appears without reload |
| 5 | Booking, therapist API, brief job, notes encryption | concurrent booking of one slot → one 201 and one 409; revoking BRIEF hides it |
| 6 | `therapist/` app | full path: slot → booking (via API) → brief → reveal (with consent) → notes → complete resolves alert |
| 7 | Student mobile UI (phase 2) | check-in, booking, consent, outreach screens; Dashboard tab removed from the student app |

## 10. Tests (`node:test`, no live providers)

- Authorization: admin token on `/therapist/*` → 403; therapist A cannot read therapist B's appointment; institution X staff see nothing of institution Y; admin responses never contain `subjectUserId`, names or phone numbers (assert on serialized JSON).
- Suppression: cohort with n = k − 1 → null; filter rejected below k.
- Rollup and alert engine: running twice produces identical rows (idempotence).
- Booking race: two parallel bookings → exactly one success.
- Consent: identity 403 without grant; brief hidden after revoke; notes round-trip encrypt/decrypt and are unreadable in the database.

## 11. Open decisions (owner: counsellor + supervisor)

1. `SAFETY_SIGNALS_WITHOUT_CONSENT` default (`true` in this brief).
2. Break-glass identity reveal for URGENT alerts (not built).
3. k value (10 proposed).
4. Exact outreach and consent-screen wording, English and Hindi.
