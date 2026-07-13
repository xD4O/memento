#!/usr/bin/env bash
# Nightly Memento backup: pg_dump (14-day retention) + media mirror.
# Cron: 10 3 * * *  (see README). Run manually any time — idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${MEMENTO_BACKUP_DIR:-$HOME/memento-backups}"
mkdir -p "$DEST/db" "$DEST/media"

STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U memento -d memento -Fc > "$DEST/db/memento-$STAMP.dump"
echo "db dump: $DEST/db/memento-$STAMP.dump ($(du -h "$DEST/db/memento-$STAMP.dump" | cut -f1))"

# retention: keep newest 14 dumps
ls -1t "$DEST"/db/memento-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --

worker/.venv/bin/python scripts/backup_media.py "$DEST/media"

# ── offsite: encrypted bundle of the latest dump + transcript-bearing tables ──
# BACKUP_KEY from .env; set OFFSITE_CMD (e.g. an rclone/rsync line) to ship
# $DEST/offsite — until then bundles stage locally and a reminder is logged.
set -a; source .env; set +a
if [ -n "${BACKUP_KEY:-}" ]; then
  mkdir -p "$DEST/offsite"
  LATEST=$(ls -1t "$DEST"/db/memento-*.dump | head -1)
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass "pass:$BACKUP_KEY" \
    -in "$LATEST" -out "$DEST/offsite/$(basename "$LATEST").enc"
  ls -1t "$DEST"/offsite/*.enc 2>/dev/null | tail -n +15 | xargs -r rm --
  if [ -n "${OFFSITE_CMD:-}" ]; then
    eval "$OFFSITE_CMD" && echo "offsite sync: OK"
  else
    echo "offsite: staged only — OFFSITE_CMD not configured (no offsite copy!)"
  fi
fi

echo "backup OK $(date -Is)"
