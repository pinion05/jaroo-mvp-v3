#!/bin/bash
# Railway single-container entrypoint: runs web (Next.js) + crawler concurrently.
# - Web listens on $PORT (Railway-injected). Default 3000 locally.
# - Crawler listens on $CRAWLER_HOST:$CRAWLER_PORT (loopback only, default 127.0.0.1:3040).
# If either process dies, the other is killed and the container exits so Railway
# restarts it. (Equivalent to OCI's two systemd services in one container.)
set -e

: "${PORT:=3000}"
: "${CRAWLER_PORT:=3040}"
: "${CRAWLER_HOST:=127.0.0.1}"
export PORT CRAWLER_PORT CRAWLER_HOST

# Wisereport session cookies: Railway can't mount .env.cookie as a file, so we decode
# it from a base64 env var. with-local-env.cjs then auto-detects the file and wires
# WISEREPORT_GLOBAL_COOKIES_FILE for the crawler.
if [ -n "$WISEREPORT_COOKIES_B64" ]; then
  if printf '%s' "$WISEREPORT_COOKIES_B64" | base64 -d > "$PWD/.env.cookie" 2>/dev/null; then
    echo "[entrypoint] restored .env.cookie from WISEREPORT_COOKIES_B64"
  else
    echo "[entrypoint] WARNING: WISEREPORT_COOKIES_B64 decode failed — crawler will lack cookies"
  fi
fi

echo "[entrypoint] web -> :${PORT} | crawler -> ${CRAWLER_HOST}:${CRAWLER_PORT}"

node scripts/with-local-env.cjs node_modules/.bin/next start &
WEB_PID=$!

node scripts/with-local-env.cjs npm --prefix packages/crawler run start &
CRAWLER_PID=$!

cleanup() {
  echo "[entrypoint] shutting down (web=$WEB_PID crawler=$CRAWLER_PID)"
  kill "$WEB_PID" "$CRAWLER_PID" 2>/dev/null || true
  wait "$WEB_PID" "$CRAWLER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Block until the first child exits, then exit so Railway restarts the container.
wait -n
EXIT_CODE=$?
echo "[entrypoint] a child process exited (code=$EXIT_CODE)"
exit "$EXIT_CODE"
