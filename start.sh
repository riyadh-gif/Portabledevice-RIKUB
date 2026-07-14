#!/usr/bin/env bash
# Start Jaga Padi: project-local PostgreSQL (loopback :5433) + FastAPI backend
# over HTTPS on LAN :8000 (self-signed cert in certs/ — HTTPS is required so the
# browser Geolocation API works from other devices). Access: https://<pi-ip>:8000
set -euo pipefail
ROOT=/home/pi/rikub-project
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)

# Start the project-local Postgres cluster if not already running.
"$PG_BIN/pg_ctl" -D "$ROOT/pgdata" -l "$ROOT/pgdata/server.log" \
  -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=$ROOT/pgrun" \
  -w start || true

# Run the backend (serves API + built SPA at web/dist). Ctrl-C stops the backend;
# Postgres keeps running (use ./stop.sh to stop it too).
cd "$ROOT/server"
export MPLCONFIGDIR="$ROOT/.cache/matplotlib"
exec ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile "$ROOT/certs/key.pem" --ssl-certfile "$ROOT/certs/cert.pem"
