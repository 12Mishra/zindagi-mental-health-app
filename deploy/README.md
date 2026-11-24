# Deploying Zindagi

Three containers plus a database, a cache and a TLS terminator on one always-on VM.
The two portals can live on this VM too, or on Freebuff Sites.

```
caddy :80/:443
  api.<domain>    -> core:4000   (REST + /chat/ws)
  voice.<domain>  -> voice:4001  (realtime audio)
  admin.<domain>      -> admin:3100      (only with the portals profile)
  counsellor.<domain> -> therapist:3200  (only with the portals profile)
db: postgres 17      redis: 7      worker: dist/worker/summary-worker.js
```

## Files

| File | Purpose |
|---|---|
| `Dockerfile.server` | One image for core, voice and worker (`command` picks the entrypoint) |
| `Dockerfile.portal` | Production image for admin or therapist; build context is the portal dir |
| `docker-compose.yml` | db, redis, core, voice, worker, caddy |
| `docker-compose.portals.yml` | Optional: adds the two portals to the same VM |
| `docker-compose.tunnel.yml` | Optional: publish through a Cloudflare Tunnel instead of Caddy, with no public IP |
| `docker-compose.local.yml` | Optional: run the stack on this machine, API on every interface, no TLS |
| `docker-compose.quicktunnel.yml` | Optional: public `*.trycloudflare.com` URLs with no account or domain |
| `Caddyfile` | Hostnames, proxies, automatic certificates |
| `.env.example` | Infrastructure settings only — application config stays in `server/.env` |

## First run

```bash
cp deploy/.env.example deploy/.env      # POSTGRES_PASSWORD, ACME_EMAIL, API_DOMAIN, VOICE_DOMAIN
docker compose build core               # voice and worker reuse this image
docker compose up -d
docker compose exec core npx prisma migrate deploy
docker compose restart worker        # it starts before the schema exists and logs missing tables
docker compose logs -f core
```

On a brand-new database the worker logs `table ... does not exist` until the migration above runs;
the restart is what clears it on the first boot. Later boots are fine, because the schema is already
there.

Portals on this VM instead of Sites:

```bash
docker compose -f docker-compose.yml -f docker-compose.portals.yml up -d --build
```

### No public IP? Publish through a Cloudflare Tunnel

On a home PC, a laptop or any network behind CGNAT, skip Caddy entirely and let Cloudflare publish
the stack. Nothing is exposed inbound and no router change is needed:

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

The override scales `caddy` to 0 and runs one outbound-only `cloudflared` container using
`TUNNEL_TOKEN` from `deploy/.env`. Create the tunnel under Zero Trust → Networks → Tunnels, then add
public hostnames whose service is a compose name, not localhost:

| Hostname | Service |
|---|---|
| `api.<domain>` | `http://core:4000` (REST + `/chat/ws`) |
| `voice.<domain>` | `http://voice:4001` |
| `admin.<domain>` | `http://admin:3100` (portals override only) |
| `counsellor.<domain>` | `http://therapist:3200` (portals override only) |

`API_DOMAIN` / `VOICE_DOMAIN` stay the public HTTPS names, so `CORE_API_URL` and
`NEXT_PUBLIC_CORE_WS_URL` need no change. Two behaviours to expect:

- The override forces `--protocol http2`. On the default QUIC transport `cloudflared` can drop the
  `Upgrade: websocket` header before it reaches the origin (cloudflared#1652), which breaks both
  sockets with browser code 1006, and QUIC idle timers on consumer routers kill long-lived sockets.
- Cloudflare closes a WebSocket that stays silent for about 100 s. `/chat/ws` pings every 25 s
  (`server/src/chat/chat.hub.ts`), so it survives; the voice socket has no server-side ping, so a
  call that sits silent for over a minute on the tunnel can be dropped. Adding a 25 s ping to the
  voice server is the fix if that shows up.

Cloudflare also restarts edge servers during its own deployments, which closes WebSockets; the
clients must reconnect, so expect an occasional reconnect during a long call.

### Public URL with no account, domain or token (quick tunnels)

For a demo from any network — no DNS, no Cloudflare account, no inbound ports:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.quicktunnel.yml up -d

docker logs zindagi-tunnel-api-1   | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
docker logs zindagi-tunnel-voice-1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

Each service gets its own `https://<slug>.trycloudflare.com`. Put the first in
`EXPO_PUBLIC_API_URL` and the second in `EXPO_PUBLIC_VOICE_WS_URL` as `wss://<slug>/voice`; the
chat socket is derived from the API URL, so `/chat/ws` is covered.

- **The hostnames change every time the container restarts** and Cloudflare rate-limits quick
tunnels. Treat them as a demo seam, not a release.
- If a fresh hostname does not resolve (`NXDOMAIN` from `nslookup <slug>.trycloudflare.com 1.1.1.1`),
  the tunnel was rate-limited: restart the container for a new hostname. A connected tunnel whose
  hostname never appears in public DNS is the symptom.
- For permanent URLs, use `docker-compose.tunnel.yml` with your own domain instead; both files scale
  `caddy` to 0, so never run them together.

### Mobile app (Expo)

The app reads two build-time variables. Both are inlined into the bundle, so changing them means
restarting Metro with `-c` or rebuilding the dev client — setting them at runtime does nothing.

```bash
cd mobile && cp .env.example .env

# public deployment
EXPO_PUBLIC_API_URL=https://api.<domain>
EXPO_PUBLIC_VOICE_WS_URL=wss://voice.<domain>/voice

# testing against this machine, phone on the same Wi-Fi
EXPO_PUBLIC_API_URL=http://<LAN-IP>:4000
EXPO_PUBLIC_VOICE_WS_URL=ws://<LAN-IP>:4001/voice
```

The chat socket needs no separate setting: `mobile/lib/chat-api.ts` derives it from
`EXPO_PUBLIC_API_URL` (http → ws), so it always tracks the API host. The voice socket is the full
URL including the `/voice` path.

- **A development build is required.** `react-native-audio-api` is a native module, so the voice
  screen cannot run in Expo Go. Build once with `npx eas build --profile development --platform android`
  and start Metro with `npx expo start --dev-client`.
- **Cleartext `http://` only works in a dev/debug build.** Android blocks it in release APKs and iOS
  blocks it outside localhost, so a `preview` APK or a store build must point at the HTTPS
  deployment, not at a LAN IP.
- For the LAN case the API must be reachable from the phone: `docker-compose.local.yml` publishes
  `4000`/`4001` on all interfaces, and Windows asks once to allow Docker through the firewall.
- `EXPO_PUBLIC_API_URL` is required. The app throws `EXPO_PUBLIC_API_URL is not configured.` instead
  of silently falling back to some machine's old IP.
- **EAS builds never see `mobile/.env`** (it is gitignored), so the two URLs also live in the `env`
  blocks of `mobile/eas.json`. Refresh them there when the tunnel hostnames change and rebuild: an
  installed APK keeps whatever was baked in at build time.

## Staff accounts

`seed-portals` refuses to run under `NODE_ENV=production`, deliberately. To bootstrap the first
staff logins (and demo data) once:

```bash
docker compose run --rm -e NODE_ENV=development core node dist/scripts/seed-portals.js
```

Uses the `SEED_STAFF_PASSWORD` from `server/.env`. On a real deployment, insert staff rows directly
instead and skip the demo data.

## Coming back after a restart

```bash
bash deploy/start.sh
```

That is the whole thing: it starts the stack, waits for the tunnels and prints the two public URLs.
What it does, and what matters on a cold morning:

1. **It starts Docker Desktop itself** if the engine is down, and waits up to three minutes for it.
   If that still fails you get one clear line instead of a stack trace.
2. `docker compose up -d` with the local and quick-tunnel files. **No rebuild, no migration:** the
   images are on disk, the schema is applied, and the database lives in the `zindagi_db` volume.
   `server/.env` and `deploy/.env` are plain files, so keys, `AUTH_OTP_CODE` and
   `POSTGRES_PASSWORD` survive too.
3. **Quick-tunnel hostnames are new after every restart**, so the script rewrites the two
   `EXPO_PUBLIC_*` lines in `mobile/.env` *and* the two `env` blocks in `mobile/eas.json` by itself,
   then re-parses the JSON to prove it is still valid. Both files are skipped when they already point
   at a named tunnel (`https://api.<domain>`), so switching later does not get clobbered. You still
   start Metro with `-c` so the cached bundle drops the old URL.
   An APK that was already built keeps its old URLs — rebuild it after a hostname change.

Stop everything with:

```bash
bash deploy/start.sh down
```
4. Staff accounts and student accounts are in the volume; `seed-portals` does not need re-running.

Stop everything with the same three files (`down` keeps the volume):

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.quicktunnel.yml down
```

## Backups

```bash
docker compose exec -T db pg_dump -U zindagi zindagi | gzip > zindagi-$(date +%F).sql.gz
```

Notes and contacts are encrypted with `NOTES_ENCRYPTION_KEY` / `CONTACTS_ENCRYPTION_KEY`: a dump
restored **without those keys** loses them permanently. Back up `server/.env` separately.

## Operating notes

- `server/.env` is read at container start, so a change needs `docker compose up -d` to restart.
- Vendor images are pinned by tag; `docker compose pull && docker compose up -d` updates db/redis/caddy.
- The worker must stay running — without it there are no rollups, no alerts and no briefs.
