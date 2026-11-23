#!/bin/bash
# Railway single-container entrypoint: runs web (Next.js) + crawler + paper-trade
# + ai-trader concurrently — four processes in one container.
# - Web listens on $PORT (Railway-injected). Default 3000 locally.
# - Crawler listens on $CRAWLER_HOST:$CRAWLER_PORT (loopback only, default 127.0.0.1:3040).
# - Paper-trade listens on 127.0.0.1:$PAPER_TRADE_PORT (loopback only, default 3041).
# - AI trader listens on 127.0.0.1:$AI_TRADER_PORT (loopback only, default 3042).
# If any process dies, the others are killed and the container exits so Railway
# restarts it. (Equivalent to OCI's systemd services in one container.)
set -e

: "${PORT:=3000}"
: "${CRAWLER_PORT:=3040}"
: "${CRAWLER_HOST:=127.0.0.1}"
: "${PAPER_TRADE_PORT:=3041}"
: "${AI_TRADER_PORT:=3042}"
export PORT CRAWLER_PORT CRAWLER_HOST PAPER_TRADE_PORT AI_TRADER_PORT

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

echo "[entrypoint] web -> :${PORT} | crawler -> ${CRAWLER_HOST}:${CRAWLER_PORT} | paper-trade -> 127.0.0.1:${PAPER_TRADE_PORT} | ai-trader -> 127.0.0.1:${AI_TRADER_PORT}"

node scripts/with-local-env.cjs node_modules/.bin/next start &
WEB_PID=$!

node scripts/with-local-env.cjs npm --prefix packages/crawler run start &
CRAWLER_PID=$!

node scripts/with-local-env.cjs npm --prefix packages/paper-trade run start &
PAPER_TRADE_PID=$!

node scripts/with-local-env.cjs npm --prefix packages/ai-trader run start &
AI_TRADER_PID=$!

cleanup() {
  echo "[entrypoint] shutting down (web=$WEB_PID crawler=$CRAWLER_PID paper-trade=$PAPER_TRADE_PID ai-trader=$AI_TRADER_PID)"
  kill "$WEB_PID" "$CRAWLER_PID" "$PAPER_TRADE_PID" "$AI_TRADER_PID" 2>/dev/null || true
  wait "$WEB_PID" "$CRAWLER_PID" "$PAPER_TRADE_PID" "$AI_TRADER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Block until the first child exits, then exit so Railway restarts the container.
wait -n
EXIT_CODE=$?
echo "[entrypoint] a child process exited (code=$EXIT_CODE)"
exit "$EXIT_CODE"
