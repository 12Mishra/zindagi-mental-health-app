# Zindagi admin portal

Next.js 15 (App Router) app for college administrators. It has no database: every number comes from the core API (`server/`).

```bash
npm install
npm run dev      # http://localhost:3100
npm run build && npm start
```

Core must be running (`cd ../server && npm run dev`) with its worker (`npm run worker`), and seeded for demos (`SEED_STAFF_PASSWORD=... npm run seed:portals`). Sign in as `admin@tiet.test`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CORE_API_URL` | `http://localhost:4000` | Base URL of core. Called only from the server side of this app. |

## How it talks to core

| Piece | File | Core endpoint |
|---|---|---|
| Sign in / out | `lib/actions.ts` | `POST /staff/login` (portal `admin`), `POST /staff/logout` |
| Session | `lib/session.ts`, `middleware.ts` | token kept in the httpOnly cookie `zs_staff`; no cookie means redirect to `/login` |
| Dashboard | `lib/data.ts` `getOverview` | `GET /admin/overview?cohort=` |
| Alerts, counsellors | `lib/data.ts` `getAlerts` | `GET /admin/alerts`, `GET /admin/therapists` |
| Acknowledge, resolve, assign | `lib/actions.ts` `updateAlert` | `PATCH /admin/alerts/:id` |
| Outreach | `lib/actions.ts` `sendOutreach` | `POST /admin/alerts/:id/outreach` |
| Live alerts | `app/api/alerts/stream/route.ts` | `GET /admin/alerts/stream` (server-sent events, proxied so the token never reaches the browser) |

All calls go through `lib/core.ts` (`coreJson`), which attaches the token, turns a 401 into a redirect to `/login?expired=1`, and throws `CoreError` for other failures. The browser never holds the token and never calls core directly.

Numbers that fewer than the institution's k students stand behind arrive as `null` or `[]`/`null` cards and are shown as "Hidden: fewer than 10 students". Cohort groups below k are refused by core with 422.
