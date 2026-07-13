"""Evening nudge: fires ONLY when no entry was logged today. Cron: 0 21 * * *.

The morning briefing pulls you in; this guards the streak at the other end of
the day. Deterministic, no LLM, silent when you've already logged.
"""

import os
import sys
import urllib.request
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
USER_ID = os.environ.get("MEMENTO_USER_ID", "00000000-0000-0000-0000-000000000001")
FORCE = os.environ.get("NUDGE_FORCE") == "1"

conn = psycopg.connect(os.environ["DATABASE_URL"])

logged_today = conn.execute(
    """SELECT count(*) FROM entries
       WHERE user_id = %s AND deleted_at IS NULL
         AND recorded_at::date = current_date""",
    (USER_ID,),
).fetchone()[0]

if logged_today and not FORCE:
    print("entry already logged today — no nudge")
    sys.exit(0)

sol, streak = conn.execute(
    """SELECT (current_date - journal_started_on) + 1,
              (SELECT count(*) FROM generate_series(1, 365) g
               WHERE EXISTS (
                 SELECT 1 FROM entries e WHERE e.user_id = %s
                   AND e.deleted_at IS NULL
                   AND e.recorded_at::date = current_date - g)
                 AND NOT EXISTS (
                 SELECT 1 FROM generate_series(1, g) h
                 WHERE NOT EXISTS (
                   SELECT 1 FROM entries e2 WHERE e2.user_id = %s
                     AND e2.deleted_at IS NULL
                     AND e2.recorded_at::date = current_date - h)))
       FROM users WHERE id = %s""",
    (USER_ID, USER_ID, USER_ID),
).fetchone()

# a hook to lower the blank-page cost — first available wins
hook = None
thread = conn.execute(
    """SELECT title FROM threads WHERE user_id = %s AND status = 'open'
       AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1""",
    (USER_ID,),
).fetchone()
story = conn.execute(
    """SELECT prompt FROM story_topics WHERE user_id = %s AND status = 'pending'
       ORDER BY ord LIMIT 1""",
    (USER_ID,),
).fetchone()
pin = conn.execute(
    """SELECT text FROM pins WHERE user_id = %s AND status = 'active'
       AND deleted_at IS NULL AND due_on = current_date + 1 LIMIT 1""",
    (USER_ID,),
).fetchone()

if thread:
    hook = f"Open thread: “{thread[0]}” — any movement today?"
elif story:
    hook = f"Or story time: {story[0]}"
elif pin:
    hook = f"Tomorrow: {pin[0]} — worth a thought tonight."

lines = [f"SOL {sol:03d} has no entry yet."]
if streak >= 2:
    lines.append(f"Your {streak}-day chain ends at midnight. One honest minute keeps it.")
else:
    lines.append("One honest minute before the day closes.")
if hook:
    lines.append(hook)

req = urllib.request.Request(
    f"{os.environ['NTFY_URL']}/{os.environ['NTFY_TOPIC']}",
    data="\n".join(lines).encode(),
    headers={"Title": f"MEMENTO · day closing", "Priority": "default",
             "Tags": "hourglass_flowing_sand"},
)
with urllib.request.urlopen(req, timeout=15) as resp:
    print(f"nudge sent ({resp.status})")
