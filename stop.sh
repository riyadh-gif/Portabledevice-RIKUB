#!/usr/bin/env bash
# Stop Jaga Padi: backend (uvicorn) + project-local PostgreSQL cluster.
set -euo pipefail
ROOT=/home/pi/rikub-project
pkill -f "uvicorn main:app" || true
PG_BIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
"$PG_BIN/pg_ctl" -D "$ROOT/pgdata" -m fast stop || true
