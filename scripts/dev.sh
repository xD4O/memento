#!/usr/bin/env bash
# Start the full Memento stack for development.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d --wait
bash scripts/migrate.sh

trap 'kill 0' EXIT
(cd worker && .venv/bin/python worker.py) &
(cd web && npm run dev) &
wait
