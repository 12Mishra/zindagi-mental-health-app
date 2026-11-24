#!/usr/bin/env bash
# ONE command for a cold machine: start the stack, publish it, point the app at it.
#
#   bash deploy/start.sh        start + print the live URLs (safe to run repeatedly)
#   bash deploy/start.sh down   stop everything (the database volume is kept)
#
# Nothing is rebuilt and no migration runs. Images, schema, accounts, server/.env and the
# zindagi_db volume all survive a reboot.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.quicktunnel.yml"
MOBILE_ENV="../mobile/.env"
MOBILE_EAS="../mobile/eas.json"

if [ "${1:-}" = "down" ] || [ "${1:-}" = "--down" ]; then
  $COMPOSE down
  echo "stopped - database volume zindagi_db kept"
  exit 0
fi

# 1. Docker engine
if ! docker info >/dev/null 2>&1; then
  echo "Docker engine is down, starting Docker Desktop..."
  if [ -x "/c/Program Files/Docker/Docker/Docker Desktop.exe" ]; then
    "/c/Program Files/Docker/Docker/Docker Desktop.exe" >/dev/null 2>&1 &
  fi
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  if ! docker info >/dev/null 2>&1; then
    echo "Docker did not start. Open Docker Desktop, wait for 'Engine running', rerun." >&2
    exit 1
  fi
  echo "Docker is up."
fi

# 2. containers
$COMPOSE up -d

# 3. tunnels + health
find_urls() {
  API=$(docker logs zindagi-tunnel-api-1 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  VOICE=$(docker logs zindagi-tunnel-voice-1 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
}
healthy() { [ -n "${API:-}" ] && [ -n "${VOICE:-}" ] && curl -fsS --max-time 10 "$API/health" >/dev/null 2>&1; }

echo "waiting for the public URLs..."
API=""; VOICE=""
for _ in $(seq 1 40); do find_urls; healthy && break; sleep 3; done

if ! healthy; then
  echo "tunnel did not answer, restarting it for a fresh hostname..."
  $COMPOSE restart tunnel-api tunnel-voice >/dev/null 2>&1 || true
  sleep 15
  API=""; VOICE=""
  for _ in $(seq 1 40); do find_urls; healthy && break; sleep 3; done
fi

if ! healthy; then
  echo "Tunnel is not answering. Check: $COMPOSE logs tunnel-api tunnel-voice" >&2
  exit 1
fi

WSS="${VOICE/https:/wss:}/voice"

# 4. keep the app's config in sync with today's hostnames
if [ -f "$MOBILE_ENV" ]; then
  if grep -qE '^EXPO_PUBLIC_API_URL=https://api\.' "$MOBILE_ENV"; then
    echo "mobile/.env targets a named tunnel - left alone."
  else
    sed -i "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=$API|" "$MOBILE_ENV"
    sed -i "s|^EXPO_PUBLIC_VOICE_WS_URL=.*|EXPO_PUBLIC_VOICE_WS_URL=$WSS|" "$MOBILE_ENV"
    echo "mobile/.env updated."
  fi
fi

if [ -f "$MOBILE_EAS" ]; then
  if grep -q 'https://api\.' "$MOBILE_EAS"; then
    echo "mobile/eas.json targets a named tunnel - left alone."
  else
    sed -i "s|https://[a-z0-9-]*\.trycloudflare\.com|$API|g" "$MOBILE_EAS"
    sed -i "s|wss://[a-z0-9-]*\.trycloudflare\.com/voice|$WSS|g" "$MOBILE_EAS"
    if command -v node >/dev/null 2>&1 && ! node -e "JSON.parse(require('fs').readFileSync('$MOBILE_EAS','utf8'))" 2>/dev/null; then
      echo "WARNING: mobile/eas.json is no longer valid JSON - fix before building." >&2
    else
      echo "mobile/eas.json updated (next APK build uses these URLs)."
    fi
  fi
fi

OTP=$(grep -E '^AUTH_OTP_CODE=' ../server/.env 2>/dev/null | cut -d= -f2- || true)

echo
echo "  API     $API"
echo "  VOICE   $WSS"
echo "  health  $API/health"
[ -n "$OTP" ] && echo "  OTP     $OTP   (dev login code)"
echo
echo "  app:    cd mobile && npm install && npx expo start --dev-client -c"
echo "  stop:   bash deploy/start.sh down"
