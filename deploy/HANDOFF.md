# Handoff brief — deploy Zindagi

You are continuing a deployment that is **partly prepared and fully compiled, but not deployed**.
Work through the tasks in order. Each task has an acceptance check; do not move on until it passes.
Where a task needs information only the human has, stop and ask instead of inventing a value.

---

## 0. What this project is

`zindagi-mental-health-app` — a mental-health support platform with five deployable pieces:

| Piece | Path | Runtime | Port |
|---|---|---|---|
| Core API (REST + chat WebSocket at `/chat/ws`) | `server/` | Node 22, CommonJS, tsc → `dist/` | 4000 |
| Voice service (realtime audio WS at `/voice`) | `server/src/voice/` | Node 22, same image | 4001 |
| Worker (rollups, crisis alerts, briefs) | `server/src/worker/` | Node 22, same image | — |
| Admin portal | `admin/` | Next.js 15.5 | 3100 |
| Therapist portal | `therapist/` | Next.js 15.5 | 3200 |
| Mobile app | `mobile/` | Expo / React Native | — |

Postgres 17 with Prisma 7 (client generated into `server/src/generated/prisma`, compiled to `dist/`).

### Out of scope — do not touch

- `training/` — ML training pipeline. Excluded from this deployment entirely.
- The language model. **It is already deployed and serving.** This app only calls it over an
  OpenAI-compatible HTTP endpoint configured by `VOICE_LLM_BASE_URL` / `VOICE_LLM_API_KEY` /
  `VOICE_LLM_MODEL`. Do not deploy, host, or modify a model.

---

## 1. State of the repository right now (verified, do not redo)

These were done in the previous session and all pass:

- `server/`: `npm ci` → `npx prisma generate` (Prisma 7.8.0) → `npm run build` (tsc) **succeeds**.
  `dist/index.js`, `dist/voice/index.js`, `dist/worker/summary-worker.js` and
  `dist/generated/prisma/client.js` all exist.
- `admin/` and `therapist/`: `npm ci` → `next build` **succeeds** for both.
- `docker compose config` **validates** for both `deploy/docker-compose.yml` alone and combined
  with `deploy/docker-compose.portals.yml`.
- `node_modules/`, `dist/`, `.next/` are now present locally. **Never commit or copy them** to the
  VM; they are build output.

**Not verified:** the Docker images have never actually been built (the local Docker daemon was not
running), and nothing has been deployed. That is the first task.

### Files that already exist — extend, do not rewrite from scratch

```
deploy/
├── Dockerfile.server          one image, three entrypoints (core / voice / worker via `command`)
├── Dockerfile.portal          portal image; ARG NEXT_PUBLIC_CORE_WS_URL is inlined at build time
├── docker-compose.yml         db, redis, core, voice, worker, caddy
├── docker-compose.portals.yml optional override: adds admin + therapist
├── docker-compose.tunnel.yml  optional override: Cloudflare Tunnel instead of Caddy (no public IP)
├── Caddyfile                  api./voice./admin./counsellor. hostnames, automatic TLS
├── .env.example               infrastructure-only template
├── .env                       created; POSTGRES_PASSWORD already generated (gitignored)
└── README.md                  short runbook (keep it in sync if you change flags)
mobile/.env.example            EXPO_PUBLIC_API_URL, EXPO_PUBLIC_VOICE_WS_URL
mobile/eas.json                development / preview (APK) / production profiles
```

Compose service names, which later commands depend on: `db`, `redis`, `core`, `voice`, `worker`,
`caddy`. Image `zindagi-server:local` is built by `core`; `voice` and `worker` reuse it and are
marked `pull_policy: never`, **so `docker compose build core` must run before `up`**.

---

## 2. Changes already made to `server/.env` (deliberate — do not revert)

`server/.env` is the **single source of application configuration**; Compose reads it via `env_file`
and only overrides `DATABASE_URL`, `REDIS_URL`, `PORT`, `VOICE_PORT`, `PORTAL_ORIGINS`,
`VOICE_ALLOWED_ORIGINS`. A backup exists at `server/.env.bak.<timestamp>` (gitignored).

| Change | Reason | Do not undo |
|---|---|---|
| CRLF → LF | Windows line endings made every value arrive as `value\r` in Docker, breaking auth headers | Keep it LF |
| `OPENAI_TEST_API_KEY` commented out (value preserved on a commented line) | `config.ts:lisaLlm()` checks it **before** `VOICE_LLM_*`; while set, every Lisa reply went to OpenAI instead of the deployed model | Leave commented in production |
| `AUTH_OTP_CODE` rotated to `736799` | Was the literal default `1234`; on a public URL that lets anyone log in as any phone number | Never set it back to `1234` |
| Added `NOTES_ENCRYPTION_KEY`, `CONTACTS_ENCRYPTION_KEY` (32 random bytes hex) | Required in production; note/contact writes fail without them | **Irreversible**: once real records exist, rotating these makes them permanently unreadable |
| Added `PORTAL_ORIGINS`, `CONTACT_SENDER=console`, `VOICE_MAX_SESSION_MINUTES=30` | CORS allowlist; keep Twilio off until a verified sender exists; cap call duration | — |

`DATABASE_URL` still points at `localhost` — correct. Compose replaces it with the `db` service
hostname at runtime. Do not "fix" it.

### Known gaps in the app you may encounter (document, do not silently patch)

- **No SMS OTP exists.** Auth compares the submitted code with the single `AUTH_OTP_CODE`. These
  keys in `.env` are read by nothing: `OTP_PROVIDER`, `OTP_WORKER_CONCURRENCY`,
  `OTP_WORKER_IN_API`, `OTP_PROVIDER_MAX_PER_SECOND`, `OTP_SMS_BODY`, `TWOFACTOR_API_KEY`,
  `TWOFACTOR_TEMPLATE`, `GEMINI_API_KEY`. Implementing real OTP is a separate, approved task.
- `mobile/lib/auth-api.ts` falls back to a hard-coded LAN IP (`172.16.39.185:4000`) when
  `EXPO_PUBLIC_API_URL` is unset. Always set the variable; do not ship a build without it.
- `server/.gitignore` ignores `.env.example` (pre-existing quirk). If you add one, add an exception.

---

## 3. Inputs the human must supply — ask before starting Tasks 2, 6 and 7

You are running on the human's own machine, so you can drive the VM directly over SSH once the
items below are in hand. Do not fabricate domains, IPs, keys or credentials, and never read or print
secret values.

### 3.1 Choose a provider with the human

The stack needs roughly 700 MB – 1 GB of RAM for core, voice, worker, Postgres, Redis and Caddy,
plus real egress: a 10-minute voice call is about 48 MB (32 KB/s in, 48 KB/s out).

| Option | Spec to order | Cost | Verdict |
|---|---|---|---|
| **Kamatera**, India / Singapore | 2 GB RAM, 30 GB disk | ~30-day trial, then ~$4–6/mo | **Default recommendation.** `docker compose` works unchanged, low latency from India |
| Vultr / DigitalOcean | 2 GB (1 GB is the floor) | $12/mo (2 GB), $5–6 (1 GB) | Fine; prefer 2 GB |
| Hetzner CX23 | 2 vCPU / 4 GB / 40 GB | EUR 5.99/mo | Best value, often sold out, no India region |
| Google Cloud e2-micro | 2 shared vCPU / 1 GB / 30 GB | $0 always free | Only with the caveats below |
| Fly.io Free plan | $5 of usage per month, max 3 Machines | $0 within $5 | Needs the 4 services squashed into one machine plus an external Postgres. Not worth it |
| The PC you already have + Cloudflare Tunnel | your hardware | $0 | Demo-week stopgap; dies when the PC sleeps |

Google Cloud e2-micro caveats — state these before recommending it: 1 GB RAM for six processes
(only workable with 2 GB swap and `VOICE_MAX_CONVERSATIONS=1`), **1 GB egress per month**, which is
roughly 20 ten-minute calls, US-only regions (200–250 ms RTT from India, which lands directly on
voice turn latency), and the external IPv4 may be billed separately (~$0.0036/h).

### 3.2 What to collect from the human

| # | Item | Where it comes from | Notes |
|---|---|---|---|
| 1 | **Static public IP** | provider console | If the panel calls it *ephemeral*, reserve it first. A changing IP breaks DNS and TLS |
| 2 | **SSH private key — file path only** | created in §3.3, or a key already on the human machine | The path, never the contents |
| 3 | **SSH user** | `root` on Kamatera / Vultr / DigitalOcean / Hetzner; the metadata user on GCP | All commands here assume `root` |
| 4 | **Hostnames + who edits DNS** | the domain they own, or names you suggest | They keep DNS credentials; you supply the records and verify them |
| 5 | **Portals on the VM or on Freebuff Sites?** | a decision | On-VM is the only path you can complete alone |

Optional but worth asking: the image and RAM actually ordered (free-tier capacity can force a shape
change), permission to install Docker and open 443, and whether `VOICE_LLM_BASE_URL` is a public
HTTPS URL — if it points at localhost or a private address the VM cannot reach the model and voice
fails at runtime. Ask "public HTTPS URL or local", not for the URL itself.

**Nothing else is needed:** Sarvam, Deepgram, Twilio and the model keys are already in `server/.env`,
which ships as-is.

### 3.3 Create the deploy key (once)

Use a dedicated key rather than the personal one:

```bash
ssh-keygen -t ed25519 -f deploy/id_ed25519 -N "" -C zindagi-deploy
cat deploy/id_ed25519.pub
```

Paste the **public** key into the provider SSH-key field at create time (or into
`~/.ssh/authorized_keys` afterwards). The private key stays on disk, is gitignored, and is never
pasted into chat or committed.

### 3.4 Handover template (give this to the human to fill in)

```
Provider:      Kamatera / Vultr / DigitalOcean / Hetzner / GCP
IP:            <static public ip>
SSH user:      root
SSH key path:  A:/zindagi/deploy/id_ed25519
Hostnames:     api.<domain> , voice.<domain>   (I will add DNS: yes/no)
Portals:       on the VM  /  Freebuff Sites
Image+RAM:     Ubuntu 24.04, 2 GB RAM, 30 GB disk, <region>
Model endpoint reachable publicly: yes/no
```

TLS is not optional: both portals set `secure` cookies when `NODE_ENV=production`, so plain HTTP
means nobody can log in.

### 3.5 Never ask for

Private key contents, `.env` contents, Sarvam / Deepgram / Twilio / provider API keys, or a console
password. The application keys already live in `server/.env`; the SSH key stays a file referenced by
path only.

### 3.6 First reachability check (run before Task 2)

The host has OpenSSH, `scp` and `ssh-keygen`; it does **not** have `rsync` or `dig` (use `nslookup`).

```bash
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i deploy/id_ed25519 root@<ip> "uname -a; command -v docker || echo no-docker"
```

**Acceptance:** the kernel line prints. `Permission denied` or a passphrase prompt means the key path
or the SSH user is wrong — ask, do not guess. `no-docker` is expected before Task 2.

## 4. Tasks

### Task 1 — build the images locally first (no VM needed)

```bash
cd <repo-root>
docker compose -f deploy/docker-compose.yml build core
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.portals.yml build admin therapist
```

**Acceptance:** all three images build with no errors.
If `prisma generate` fails inside the build, confirm the throwaway `ENV DATABASE_URL` line in
`deploy/Dockerfile.server` is still present — `prisma.config.ts` reads that variable even for
`generate`. If `COPY --from=build /app/src/generated` fails, the Prisma generator's output path
changed; check `server/prisma/schema.prisma` (`output = "../src/generated/prisma"`).

### Task 2 — provision the VM (any provider)

Nothing in `deploy/` is tied to a particular cloud. Any always-on Ubuntu 24.04 VM with root (or
passwordless sudo), a **static public IPv4**, **2 GB RAM minimum** and ~30 GB disk runs the whole
stack unchanged. Never accept a 512 MB tier, and read §3.1 before accepting 1 GB.

```bash
apt-get update && apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
docker --version && docker compose version     # Compose v2 ships with the docker package
```

Only two things differ between providers: the SSH user, and where the firewall lives.

| Provider | SSH user | Ports opened in | Notes |
|---|---|---|---|
| **Kamatera** (India / Singapore) | `root` | `ufw` only — no cloud firewall by default | ~30-day trial, hourly billing with a monthly cap |
| Vultr | `root` | cloud firewall **and** `ufw` | Mumbai, Singapore |
| DigitalOcean | `root` | cloud firewall **and** `ufw` | Bangalore |
| Hetzner | `root` | `ufw` only | 2 vCPU / 4 GB for EUR 5.99 incl. IPv4; often sold out |
| Google Cloud | the user in your SSH metadata | VPC firewall rules | 1 GB RAM, 1 GB egress per month — see §3.1 |

Blockers that fail silently:

- A **cloud firewall or security group** (Vultr, DigitalOcean, GCP, Azure) still blocks 80/443 when
  `ufw` allows them. Open both places.
- Oracle images additionally ship `iptables` `REJECT` rules. If `iptables -L` shows them, remove them.
- SSH must be key-based and non-interactive: the deploy public key from §3.3 goes into
  `~/.ssh/authorized_keys`. Never ask the human for a password.

**Acceptance:** from outside, `curl -I http://<ip>` returns *something* (even a 404) rather than
timing out, and `docker compose version` prints v2.x.

If the human has **no public IPv4 at all** (home PC, CGNAT, laptop), there is no Task 2 to do: skip
the firewall work and use `docker compose -f docker-compose.yml -f docker-compose.tunnel.yml`, which
scales Caddy to 0 and publishes through a Cloudflare Tunnel. It still needs a domain on Cloudflare,
and the override forces `--protocol http2` on purpose — see the README section before removing it.

### Task 3 — DNS

Create A records for `api.<domain>` and `voice.<domain>` (and `admin.` / `counsellor.` if the
portals run on the VM) pointing at the VM IP.

**Acceptance:** `dig +short api.<domain>` returns the VM IP from a machine outside the VM, and
`dig +short voice.<domain>` does too. **Do not start the stack before this resolves** — Caddy will
fail certificate issuance and back off.

### Task 4 — get the code onto the VM

This working copy is **not a git repository** (no `.git`; it came from an archive). Choose one, and
always land the tree at `/srv/zindagi` on the VM (all later commands assume it):

- Push to the private GitHub repo and `sudo git clone <url> /srv/zindagi` with a read-only deploy
  key, or
- From the Windows host, `tar` + `scp` — `rsync` is **not** installed there:
  ```bash
  tar --exclude=node_modules --exclude=dist --exclude=.next --exclude=.git -czf /tmp/zindagi.tgz .
  scp -i "<key-path>" /tmp/zindagi.tgz ubuntu@<ip>:/tmp/
  ssh -i "<key-path>" ubuntu@<ip> 'sudo rm -rf /srv/zindagi && sudo mkdir -p /srv/zindagi \
    && sudo tar -xzf /tmp/zindagi.tgz -C /srv/zindagi'
  ```

**Acceptance:** `server/.env`, `deploy/.env` and all of `deploy/` exist on the VM, and
`node_modules`, `dist`, `.next` do **not**.

### Task 5 — configure and start

```bash
cd /srv/zindagi
# deploy/.env: API_DOMAIN, VOICE_DOMAIN, ACME_EMAIL (and ADMIN_DOMAIN, COUNSELLOR_DOMAIN if used)
#              POSTGRES_PASSWORD is already generated — keep it, or regenerate before first boot
docker compose build core
docker compose up -d
docker compose exec core npx prisma migrate deploy
```

If the portals run on this VM, use the merged form from the start instead:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.portals.yml up -d
```

**Acceptance — all four, in order:**

1. `docker compose ps` shows `db` healthy and `core`, `voice`, `worker`, `caddy` up.
2. `docker compose logs core` shows it listening on 4000 with no crash loop.
3. `curl -fsS https://api.<domain>/health` returns 200 over a **valid** certificate
   (not `-k`). If TLS fails, DNS or port 443 is wrong — fix that, do not add `-k`.
4. `docker compose exec core npx prisma migrate status` reports no pending migrations.
   (Do not run `prisma migrate dev` anywhere — it can reset data.)

### Task 6 — bootstrap staff accounts

`seed-portals` deliberately refuses to run when `NODE_ENV=production`, and the `core` service sets
it. Run it once as a one-off container:

```bash
docker compose run --rm -e NODE_ENV=development core node dist/scripts/seed-portals.js
```

Creates `admin@tiet.test` and `therapist1..3@tiet.test` using `SEED_STAFF_PASSWORD`, plus demo data.
On a real deployment skip the demo data and insert staff rows directly — ask the human which.

**Acceptance:** a row exists in the staff table (`SELECT email, role FROM "Staff";` via
`docker compose exec db psql -U zindagi zindagi`).

### Task 7 — portals

**(a) On the VM** — already covered by the compose override:

```bash
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.portals.yml up -d --build
```

`CORE_API_URL` is derived from `API_DOMAIN`, and `NEXT_PUBLIC_CORE_WS_URL` is passed as a **build
arg** because Next inlines `NEXT_PUBLIC_*` at build time. If the API hostname changes, the therapist
image must be **rebuilt**, not restarted.

**(b) Freebuff Sites** — outside the scope of these files; report back and the human will route it.

**Acceptance:** `https://admin.<domain>/login` renders the login page (HTTP 200, no certificate
error), and a staff login with the seeded credentials reaches the dashboard. Check the browser
console for CORS errors; if the portals call the API from the browser, add their origins to
`PORTAL_ORIGINS` in `deploy/.env` and `docker compose up -d` to restart `core`.

### Task 8 — mobile

```bash
cd mobile
cp .env.example .env      # EXPO_PUBLIC_API_URL=https://api.<domain>
                          # EXPO_PUBLIC_VOICE_WS_URL=wss://voice.<domain>/voice
npx eas build -p android --profile preview   # produces an installable APK
```

Voice requires a **development build**; `react-native-audio-api` is absent from Expo Go, so an
Expo Go test of the call flow will fail by design.

**Acceptance:** the APK installs, registers/logs in against the real API, and starts a text chat.
Report whether an audio call was attempted — do not claim it works if it was not exercised.

### Task 9 — hardening hand-off

Do these only if the human confirms, and report them as **outstanding** either way:

- Real OTP delivery (not implemented; `AUTH_OTP_CODE` is a single shared code).
- `CONTACT_SENDER=twilio` once a verified sender exists (`TWILIO_*` are already in `.env`).
- Nightly backup: `docker compose exec -T db pg_dump -U zindagi zindagi | gzip > zindagi-$(date +%F).sql.gz`,
  plus an off-box copy of `server/.env` (losing the encryption keys loses notes and contacts).
- Many clouds reclaim idle instances (Oracle Always Free in particular: 95th-percentile CPU,
  network and memory all under 20% for 7 days). Take a volume snapshot once it works, or keep
  memory above ~2.4 GB.

---

## 5. Behavioural rules

- **Never** print, echo, log or commit secrets. Read `.env` values only through the running app.
  Never open `.env` files with a generic file reader; key names may be inspected, values may not.
- **Never** rotate `NOTES_ENCRYPTION_KEY` or `CONTACTS_ENCRYPTION_KEY` after real data exists.
- **Never** set `OPENAI_TEST_API_KEY` — it routes student conversations to OpenAI.
- **Never** change `AUTH_OTP_CODE` back to `1234`.
- **Never** run the seeder without the `NODE_ENV=development` override on a live database; it adds
  demo data.
- Do not modify `training/`, the model, or any ML code.
- Do not publish, deploy to a new environment, or push to a remote without explicit approval.
- Prefer the existing `deploy/` files. If something must change, change the minimum and keep
  `deploy/README.md` accurate.
- Report failures honestly, including checks you could not run.

## 6. Report back

For each task: what you ran, the acceptance result, and anything still blocked. Include the exact
URLs that answered, and explicitly list what was **not** tested (e.g. "audio call not exercised",
"no browser click-through of the portals").
