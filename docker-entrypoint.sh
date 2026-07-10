#!/bin/sh
# Restore pi.dev credentials from env (Coolify secrets) before starting.
set -e
PI_DIR="${HOME}/.pi/agent"
mkdir -p "$PI_DIR"
[ -n "$PI_AUTH_JSON_B64" ] && printf '%s' "$PI_AUTH_JSON_B64" | base64 -d > "$PI_DIR/auth.json" && chmod 600 "$PI_DIR/auth.json"
[ -n "$PI_MODELS_JSON_B64" ] && printf '%s' "$PI_MODELS_JSON_B64" | base64 -d > "$PI_DIR/models.json"
# gh CLI auth via GH_TOKEN is automatic (gh reads the env var).
exec node dist/index.js
