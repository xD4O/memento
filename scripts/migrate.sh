#!/usr/bin/env bash
# Apply db/schema.sql to the memento Postgres container (idempotent).
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U memento -d memento < db/schema.sql
echo "migrate: OK"
