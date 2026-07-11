#!/bin/sh
# Restore pi.dev credentials from env (Coolify secrets) before starting.
set -e
PI_DIR="${HOME}/.pi/agent"
mkdir -p "$PI_DIR"
[ -n "$PI_AUTH_JSON_B64" ] && printf '%s' "$PI_AUTH_JSON_B64" | base64 -d > "$PI_DIR/auth.json" && chmod 600 "$PI_DIR/auth.json"
[ -n "$PI_MODELS_JSON_B64" ] && printf '%s' "$PI_MODELS_JSON_B64" | base64 -d > "$PI_DIR/models.json"
# gh CLI auth via GH_TOKEN is automatic (gh reads the env var).

# Optional Telegram bot: separate process in the same container, talking to
# the local REST API. Restarts with the container; crash does not kill the server.
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  : "${HIVE_URL:=http://localhost:${PORT:-8080}}"
  : "${HIVE_TOKEN:=$API_TOKEN}"
  export HIVE_URL HIVE_TOKEN
  (
    # wait for the server to accept connections, then run the bot; respawn on crash
    sleep 3
    while :; do
      node dist/telegram/bot.js || echo "[telegram] bot exited ($?), respawning in 10s"
      sleep 10
    done
  ) &
fi

exec node dist/index.js
