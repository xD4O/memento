"""Morning briefing: SOL, streak, reminders, open threads → ntfy push.

Deterministic by design — no LLM in the wake-up path. Cron: 0 8 * * *.
"""

import os
import urllib.request
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

USER_ID = os.environ.get("MEMENTO_USER_ID", "00000000-0000-0000-0000-000000000001")

conn = psycopg.connect(os.environ["DATABASE_URL"])

sol, streak = conn.execute(
    """SELECT (current_date - journal_started_on) + 1,
              COALESCE((
                SELECT count(*) FROM (
                  SELECT DISTINCT recorded_at::date AS d FROM entries
                  WHERE user_id = %s AND deleted_at IS NULL
                ) days
                WHERE d > (
                  -- most recent gap day before today
                  SELECT COALESCE(max(g), '1970-01-01'::date) FROM
                    generate_series(current_date - 365, current_date - 1, '1 day') g
                  WHERE NOT EXISTS (
                    SELECT 1 FROM entries e WHERE e.user_id = %s
                      AND e.deleted_at IS NULL AND e.recorded_at::date = g)
                )
              ), 0)
       FROM users WHERE id = %s""",
    (USER_ID, USER_ID, USER_ID),
).fetchone()

pins = conn.execute(
    """SELECT text, due_on::text, (due_on < current_date) AS overdue
       FROM pins WHERE user_id = %s AND deleted_at IS NULL AND status = 'active'
         AND due_on IS NOT NULL AND due_on <= current_date
       ORDER BY due_on LIMIT 6""",
    (USER_ID,),
).fetchall()

threads = conn.execute(
    """SELECT title FROM threads
       WHERE user_id = %s AND status = 'open' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 3""",
    (USER_ID,),
).fetchall()

yesterday = conn.execute(
    """SELECT summary, mood FROM daily_summaries
       WHERE user_id = %s AND day = current_date - 1""",
    (USER_ID,),
).fetchone()

logged_today = conn.execute(
    """SELECT count(*) FROM entries WHERE user_id = %s AND deleted_at IS NULL
       AND recorded_at::date = current_date""",
    (USER_ID,),
).fetchone()[0]

capsules = conn.execute(
    """SELECT sol FROM entries
       WHERE user_id = %s AND deleted_at IS NULL AND deliver_on = current_date""",
    (USER_ID,),
).fetchall()

lines = []
for (csol,) in capsules:
    lines.append(f"◍ A message from your past arrives today — sealed on SOL {csol:03d}.")
if pins:
    lines.append("DUE:")
    for text, due, overdue in pins:
        lines.append(f"  {'⚠ OVERDUE ' if overdue else '◪ '}{text}")
if threads:
    lines.append("OPEN THREADS: " + " · ".join(t[0] for t in threads))
if yesterday and yesterday[0]:
    lines.append(f"YESTERDAY ({yesterday[1] or '-'}): {yesterday[0]}")
if streak >= 2:
    lines.append(f"STREAK: {streak} days of logging — keep the chain.")
elif not logged_today:
    lines.append("No entry yet today. One honest minute is enough.")

body = "\n".join(lines) or "Quiet board. Log something worth remembering."
title = f"MEMENTO · SOL {sol:03d}"

req = urllib.request.Request(
    f"{os.environ['NTFY_URL']}/{os.environ['NTFY_TOPIC']}",
    data=body.encode(),
    headers={"Title": title, "Priority": "default", "Tags": "clipboard"},
)
with urllib.request.urlopen(req, timeout=15) as resp:
    print(f"briefing sent: {title} ({resp.status})")
