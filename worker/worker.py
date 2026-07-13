"""Memento transcription worker.

Polls Postgres for entries with status='uploaded' (SKIP LOCKED so multiple
workers are safe), pulls media from MinIO, extracts 16k mono audio with
ffmpeg, transcribes with faster-whisper (word timestamps), writes segments,
and advances entry status: uploaded -> transcribing -> indexed | error.

Transcripts are derived data: safe to re-run on any entry by resetting its
status to 'uploaded'.
"""

import os
import signal
import subprocess
import sys
import tempfile
import time
import json
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from minio import Minio

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DB_URL = os.environ["DATABASE_URL"]
S3 = Minio(
    f"{os.environ['S3_ENDPOINT_HOST']}:{os.environ['S3_ENDPOINT_PORT']}",
    access_key=os.environ["S3_ACCESS_KEY"],
    secret_key=os.environ["S3_SECRET_KEY"],
    secure=False,
)
BUCKET = os.environ["S3_BUCKET"]
MODEL_NAME = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
POLL_S = float(os.environ.get("WORKER_POLL_S", "2"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
VISION_MODEL = os.environ.get("VISION_MODEL", "qwen2.5vl:7b")
USER_ID = os.environ.get("MEMENTO_USER_ID", "00000000-0000-0000-0000-000000000001")

CONCEPT_KINDS = {"person", "place", "project", "idea", "theme", "emotion", "other"}

_running = True


def _stop(*_):
    global _running
    _running = False


signal.signal(signal.SIGINT, _stop)
signal.signal(signal.SIGTERM, _stop)


def load_model():
    from faster_whisper import WhisperModel

    tried = []
    for device, compute in ([(DEVICE, COMPUTE)] if DEVICE != "auto"
                            else [("cuda", "float16"), ("cpu", "int8")]):
        try:
            model = WhisperModel(MODEL_NAME, device=device, compute_type=compute)
            print(f"[worker] model={MODEL_NAME} device={device} compute={compute}", flush=True)
            return model
        except Exception as e:  # noqa: BLE001 — fall through to next device
            tried.append(f"{device}/{compute}: {e}")
    raise RuntimeError("no usable whisper backend: " + " | ".join(tried))


def claim_entry(conn):
    row = conn.execute(
        """
        UPDATE entries SET status = 'transcribing'
        WHERE id = (
          SELECT id FROM entries
          WHERE status = 'uploaded' AND deleted_at IS NULL
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING id, media_uri, kind
        """
    ).fetchone()
    conn.commit()
    return row


def extract_audio(src: Path, dst: Path):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(dst)],
        check=True, capture_output=True,
    )


def media_duration(src: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_format", str(src)],
            check=True, capture_output=True, text=True,
        ).stdout
        return float(json.loads(out)["format"]["duration"])
    except Exception:
        return None


def analyze_vision(conn, entry_id, media: Path, duration: float | None, tmpdir: str):
    """Visual log: a VLM looks at three frames and notes scene, appearance,
    and energy. Opt-out via users.settings.vision_enabled=false. Best-effort."""
    import base64
    import urllib.request

    enabled = conn.execute(
        "SELECT coalesce(settings->>'vision_enabled', 'true') FROM users WHERE id = %s",
        (USER_ID,),
    ).fetchone()[0]
    if enabled == "false":
        return

    dur = duration or 10
    frames = []
    for i, frac in enumerate((0.2, 0.5, 0.8)):
        fp = Path(tmpdir) / f"frame{i}.jpg"
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-ss", str(dur * frac), "-i", str(media),
                 "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", str(fp)],
                check=True, capture_output=True,
            )
            if fp.exists() and fp.stat().st_size > 0:
                frames.append(base64.b64encode(fp.read_bytes()).decode())
        except Exception:  # noqa: BLE001
            continue
    if not frames:
        return

    prompt = (
        "These are frames from one personal video-journal entry, in time order. "
        "Return JSON:\n"
        '  "scene": where this was recorded and time-of-day feel (one short sentence).\n'
        '  "appearance": the journaler\'s look — clothing, notable details (one short sentence; null if no person visible).\n'
        '  "energy": one lowercase word for their visible energy (e.g. rested, tired, animated, flat; null if no person).\n'
        '  "notes": anything else visually notable (short; null if nothing).\n'
        "If the frames are blank, black, or featureless, say exactly that — "
        "do NOT guess or invent what might be there."
    )
    try:
        body = json.dumps({
            "model": VISION_MODEL,
            "messages": [{"role": "user", "content": prompt, "images": frames}],
            "format": "json", "stream": False,
            "options": {"temperature": 0.2},
        }).encode()
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/chat", data=body,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            vision = json.loads(json.loads(resp.read())["message"]["content"])
        clean = {k: (str(v).strip()[:300] if v else None)
                 for k, v in vision.items()
                 if k in ("scene", "appearance", "energy", "notes")}
        conn.execute(
            "UPDATE entries SET vision = %s WHERE id = %s",
            (json.dumps(clean), entry_id),
        )
        conn.commit()
        print(f"[worker] vision {entry_id}: {clean.get('scene', '')[:60]}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[worker] vision skipped for {entry_id}: {e}", flush=True)


def make_thumbnail(media: Path, duration: float | None, tmpdir: str) -> Path | None:
    """Grab a frame a little way in (frame 0 is often black or mid-blink)."""
    seek = min(2.0, (duration or 0) / 2) if duration else 0
    thumb = Path(tmpdir) / "thumb.jpg"
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-ss", str(seek), "-i", str(media),
             "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(thumb)],
            check=True, capture_output=True,
        )
        return thumb if thumb.exists() and thumb.stat().st_size > 0 else None
    except Exception:
        return None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Embed a batch of texts with Ollama. Best-effort: None on failure."""
    import urllib.request

    if not texts:
        return []
    out: list[list[float]] = []
    try:
        for i in range(0, len(texts), 64):
            body = json.dumps({"model": EMBED_MODEL, "input": texts[i:i + 64]}).encode()
            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/embed", data=body,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                out.extend(json.loads(resp.read())["embeddings"])
        return out
    except Exception as e:  # noqa: BLE001 — search degrades to FTS without these
        print(f"[worker] embeddings skipped: {e}", flush=True)
        return None


def save_concepts(conn, entry_id, concepts: list[dict]):
    conn.execute("DELETE FROM entry_concepts WHERE entry_id = %s", (entry_id,))
    for i, c in enumerate(concepts):
        name = str(c.get("name", "")).strip()[:80]
        kind = str(c.get("kind", "idea")).strip().lower()
        if not name or kind not in CONCEPT_KINDS:
            continue
        row = conn.execute(
            """INSERT INTO concepts (user_id, name, kind) VALUES (%s, %s, %s)
               ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = concepts.name
               RETURNING id""",
            (USER_ID, name, kind),
        ).fetchone()
        conn.execute(
            """INSERT INTO entry_concepts (entry_id, concept_id, salience)
               VALUES (%s, %s, %s) ON CONFLICT DO NOTHING""",
            (entry_id, row[0], max(0.3, 1.0 - 0.08 * i)),
        )


import datetime as _dt
import re as _re

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday",
             "saturday", "sunday"]


def resolve_due(phrase: str | None, today: _dt.date) -> str | None:
    """Deterministic relative-date resolution — LLMs extract the phrase,
    code does the calendar math."""
    if not phrase:
        return None
    p = phrase.lower()
    m = _re.search(r"\d{4}-\d{2}-\d{2}", p)
    if m:
        return m.group(0)
    if "today" in p or "tonight" in p or "this evening" in p:
        return today.isoformat()
    if "tomorrow" in p:
        return (today + _dt.timedelta(days=1)).isoformat()
    if "next week" in p:
        return (today + _dt.timedelta(days=(7 - today.weekday()) or 7)).isoformat()
    if "weekend" in p:
        ahead = (5 - today.weekday()) % 7  # next Saturday (or today if Sat)
        return (today + _dt.timedelta(days=ahead)).isoformat()
    m = _re.search(r"in (\d{1,2}) days?", p)
    if m:
        return (today + _dt.timedelta(days=int(m.group(1)))).isoformat()
    for i, day in enumerate(_WEEKDAYS):
        if day in p:
            ahead = (i - today.weekday()) % 7 or 7  # next occurrence, not today
            if "next" in p and ahead <= 7:
                pass  # "next Monday" ≈ upcoming Monday; good enough
            return (today + _dt.timedelta(days=ahead)).isoformat()
    return None


def reflect_entry(conn, entry_id, transcript: str):
    """Rapport pass (plan §5): after indexing, update open threads and the
    profile from what was said. Best-effort; every output is user-editable."""
    import urllib.request

    if len(transcript.split()) < 10:
        return
    open_threads = conn.execute(
        """SELECT id, title, coalesce(detail,'') FROM threads
           WHERE user_id = %s AND status = 'open' AND deleted_at IS NULL
           ORDER BY updated_at DESC LIMIT 15""",
        (USER_ID,),
    ).fetchall()
    facts = conn.execute(
        """SELECT category, fact FROM profile_facts
           WHERE user_id = %s AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 40""",
        (USER_ID,),
    ).fetchall()

    story_topics = conn.execute(
        """SELECT id, chapter, prompt FROM story_topics
           WHERE user_id = %s AND status = 'pending' ORDER BY ord LIMIT 5""",
        (USER_ID,),
    ).fetchall()
    story_lines = "\n".join(
        f"S{i}: [{t[1]}] {t[2]}" for i, t in enumerate(story_topics)) or "none"
    thread_lines = "\n".join(
        f"T{i}: {t[1]} — {t[2]}" for i, t in enumerate(open_threads)) or "none"
    fact_lines = "\n".join(f"- [{c}] {f}" for c, f in facts) or "none"
    today = conn.execute(
        "SELECT current_date::text, to_char(current_date, 'Day')"
    ).fetchone()
    week = conn.execute(
        """SELECT string_agg(to_char(d, 'Day FMYYYY-MM-DD'), ', ')
           FROM generate_series(current_date, current_date + 10, '1 day') d"""
    ).fetchone()[0]

    prompt = (
        "You maintain continuity for a personal journal's companion agent. "
        f"Today is {today[0]} ({today[1].strip()}). Upcoming dates for "
        f"resolving relative day names: {week}. "
        "Given a new journal entry transcript, the currently OPEN THREADS "
        "(unresolved loops worth following up), and the KNOWN PROFILE, return JSON:\n"
        '  "resolve": array of thread ids (e.g. ["T0"]) that this entry clearly '
        "resolves or makes obsolete. Empty if none.\n"
        '  "open": up to 2 NEW objects {"title" (max 8 words), "detail" (one '
        "sentence)} — only genuine open loops: stated intentions, pending "
        "decisions, awaited events. Not routine activities. Empty if none.\n"
        '  "facts": up to 3 NEW objects {"category", "fact"} — durable things '
        "about the journaler worth remembering across months (category one of: "
        "value, goal, person, preference, sensitivity, context). One short "
        "sentence each. NEVER repeat or rephrase a known fact. Empty if none.\n"
        '  "pins": up to 2 objects {"kind", "text", "due_phrase"} — ONLY things '
        "the journaler explicitly asked to remember, pin, note down, or do by "
        'a time ("remind me…", "don\'t forget…", "I need to X by Friday"). '
        'kind: "reminder" if time-bound else "note". due_phrase: the EXACT '
        'time words they used, verbatim (e.g. "on Monday", "tomorrow", '
        '"this weekend"), or null if no time was given. Do NOT invent pins '
        "from mere topics. Empty if none.\n"
        '  "story_covered": array of story-topic ids (e.g. ["S0"]) that this '
        "entry SUBSTANTIALLY tells — several sentences of genuine storytelling "
        "on that topic, not a passing mention. Empty if none.\n\n"
        f"PENDING STORY TOPICS:\n{story_lines}\n\n"
        f"OPEN THREADS:\n{thread_lines}\n\nKNOWN PROFILE:\n{fact_lines}\n\n"
        f"NEW ENTRY:\n{transcript[:10000]}"
    )
    try:
        body = json.dumps({
            "model": OLLAMA_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "format": "json", "stream": False,
            "options": {"temperature": 0.2},
        }).encode()
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/chat", data=body,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=180) as resp:
            out = json.loads(json.loads(resp.read())["message"]["content"])
    except Exception as e:  # noqa: BLE001
        print(f"[worker] reflection skipped for {entry_id}: {e}", flush=True)
        return

    resolved = 0
    for ref in out.get("resolve") or []:
        try:
            idx = int(str(ref).strip().lstrip("Tt"))
            tid = open_threads[idx][0]
        except (ValueError, IndexError):
            continue
        conn.execute(
            """UPDATE threads SET status='resolved', updated_at=now()
               WHERE id = %s AND status = 'open'""",
            (tid,),
        )
        resolved += 1

    opened = 0
    for t in (out.get("open") or [])[:2]:
        title = str(t.get("title", "")).strip()[:120]
        if not title:
            continue
        dup = conn.execute(
            """SELECT 1 FROM threads WHERE user_id=%s AND status='open'
               AND deleted_at IS NULL AND lower(title) = lower(%s)""",
            (USER_ID, title),
        ).fetchone()
        if dup:
            continue
        conn.execute(
            """INSERT INTO threads (user_id, title, detail, source_entry_id)
               VALUES (%s, %s, %s, %s)""",
            (USER_ID, title, str(t.get("detail", "")).strip()[:500] or None,
             entry_id),
        )
        opened += 1

    added = 0
    for f in (out.get("facts") or [])[:3]:
        fact = str(f.get("fact", "")).strip()[:300]
        cat = str(f.get("category", "context")).strip().lower()
        if not fact or cat not in (
                "value", "goal", "person", "preference", "sensitivity", "context"):
            continue
        # semantic dedup: LLMs rephrase known facts despite instructions
        emb = embed_texts([fact])
        vec = json.dumps(emb[0]) if emb else None
        if vec:
            dup = conn.execute(
                """SELECT 1 FROM profile_facts
                   WHERE user_id=%s AND deleted_at IS NULL AND embedding IS NOT NULL
                     AND embedding <=> %s::vector < 0.35 LIMIT 1""",
                (USER_ID, vec),
            ).fetchone()
        else:
            dup = conn.execute(
                """SELECT 1 FROM profile_facts WHERE user_id=%s AND deleted_at IS NULL
                   AND lower(fact) = lower(%s)""",
                (USER_ID, fact),
            ).fetchone()
        if dup:
            continue
        conn.execute(
            """INSERT INTO profile_facts
                 (user_id, category, fact, source_entry_id, embedding)
               VALUES (%s, %s, %s, %s, %s::vector)""",
            (USER_ID, cat, fact, entry_id, vec),
        )
        added += 1

    pinned = 0
    today_date = _dt.date.fromisoformat(today[0])
    for p in (out.get("pins") or [])[:2]:
        text = str(p.get("text", "")).strip()[:200]
        if not text:
            continue
        due = resolve_due(str(p.get("due_phrase") or ""), today_date)
        kind = "reminder" if (due or str(p.get("kind")) == "reminder") else "note"
        dup = conn.execute(
            """SELECT 1 FROM pins WHERE user_id=%s AND deleted_at IS NULL
               AND status='active' AND lower(text) = lower(%s)""",
            (USER_ID, text),
        ).fetchone()
        if dup:
            continue
        conn.execute(
            """INSERT INTO pins (user_id, kind, text, due_on, source_entry_id)
               VALUES (%s, %s, %s, %s, %s)""",
            (USER_ID, kind, text, due, entry_id),
        )
        pinned += 1

    stories = 0
    for ref in out.get("story_covered") or []:
        try:
            idx = int(str(ref).strip().lstrip("Ss"))
            sid = story_topics[idx][0]
        except (ValueError, IndexError):
            continue
        conn.execute(
            """UPDATE story_topics SET status='done', entry_id=%s, completed_at=now()
               WHERE id = %s AND status = 'pending'""",
            (entry_id, sid),
        )
        stories += 1

    conn.commit()
    if resolved or opened or added or pinned or stories:
        print(f"[worker] reflection {entry_id}: +{opened} threads, "
              f"{resolved} resolved, +{added} facts, +{pinned} pins, "
              f"+{stories} story topics", flush=True)


def unseal_due_capsules(conn):
    """Time capsules whose delivery date has arrived enter the normal
    pipeline — they get transcribed, indexed, and appear in the timeline."""
    rows = conn.execute(
        """UPDATE entries SET status = 'uploaded'
           WHERE status = 'sealed' AND deliver_on <= current_date
             AND deleted_at IS NULL
           RETURNING id, sol""",
    ).fetchall()
    conn.commit()
    for eid, sol in rows:
        print(f"[worker] time capsule from SOL {sol} unsealed: {eid}", flush=True)


def compile_daily_summaries(conn):
    """End-of-day reports: for every completed day whose entry set changed
    since the last compile, ask the LLM for a day summary. Days that lost all
    entries lose their summary."""
    import urllib.request

    conn.execute(
        """DELETE FROM daily_summaries s
           WHERE s.user_id = %s AND NOT EXISTS (
             SELECT 1 FROM entries e
             WHERE e.user_id = s.user_id AND e.deleted_at IS NULL
               AND e.status = 'indexed' AND e.recorded_at::date = s.day)""",
        (USER_ID,),
    )
    conn.commit()

    due = conn.execute(
        """SELECT d.day, d.cnt FROM (
             SELECT recorded_at::date AS day, count(*) AS cnt
             FROM entries
             WHERE user_id = %s AND deleted_at IS NULL AND status = 'indexed'
             GROUP BY 1) d
           LEFT JOIN daily_summaries s ON s.user_id = %s AND s.day = d.day
           WHERE d.day < current_date
             AND (s.day IS NULL OR s.entry_count <> d.cnt)
           ORDER BY d.day""",
        (USER_ID, USER_ID),
    ).fetchall()

    for day, cnt in due:
        rows = conn.execute(
            """SELECT to_char(e.recorded_at, 'HH24:MI'), e.kind, e.title,
                      e.summary, e.mood,
                      (SELECT string_agg(a.label, '; ')
                       FROM annotations a
                       WHERE a.entry_id = e.id AND a.deleted_at IS NULL),
                      e.vision->>'scene', e.vision->>'energy'
               FROM entries e
               WHERE e.user_id = %s AND e.deleted_at IS NULL
                 AND e.status = 'indexed' AND e.recorded_at::date = %s
               ORDER BY e.recorded_at""",
            (USER_ID, day),
        ).fetchall()
        lines = "\n".join(
            f"- {t} [{k}] {title or 'untitled'} — {summ or 'no summary'}"
            f"{f' (mood: {mood})' if mood else ''}"
            f"{f' | flags: {flags}' if flags else ''}"
            f"{f' | seen: {scene}' if scene else ''}"
            f"{f', looked {energy}' if energy else ''}"
            for t, k, title, summ, mood, flags, scene, energy in rows
        )
        prompt = (
            "You compile the end-of-day report for a personal video journal. "
            f"Below are the journal entries logged on {day}. Return JSON with:\n"
            '  "summary": 2-4 sentences narrating the day in neutral log style '
            "(what happened, what was on the journaler's mind). No preamble.\n"
            '  "highlights": up to 4 short strings, the most notable moments/decisions.\n'
            '  "mood": one lowercase word for the day overall.\n\n'
            f"Entries:\n{lines[:8000]}"
        )
        meta = None
        try:
            body = json.dumps({
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "format": "json", "stream": False,
                "options": {"temperature": 0.3},
            }).encode()
            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/chat", data=body,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                meta = json.loads(json.loads(resp.read())["message"]["content"])
        except Exception as e:  # noqa: BLE001 — retried on next pass
            print(f"[worker] day summary {day} skipped: {e}", flush=True)
            continue
        highlights = meta.get("highlights")
        conn.execute(
            """INSERT INTO daily_summaries
                 (user_id, day, summary, highlights, mood, entry_count, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (user_id, day) DO UPDATE SET
                 summary = EXCLUDED.summary, highlights = EXCLUDED.highlights,
                 mood = EXCLUDED.mood, entry_count = EXCLUDED.entry_count,
                 updated_at = now()""",
            (USER_ID, day, str(meta.get("summary", "")).strip()[:2000] or None,
             json.dumps(highlights if isinstance(highlights, list) else []),
             str(meta.get("mood", "")).strip().lower()[:24] or None, cnt),
        )
        conn.commit()
        print(f"[worker] day report compiled for {day} ({cnt} entries)", flush=True)


FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"


def _norm_clip(src: Path, start: float, dur: float, out: Path) -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-ss", str(max(0, start)), "-t", str(dur),
             "-i", str(src),
             "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,"
                    "pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
             "-c:a", "aac", "-ar", "44100", "-ac", "2", str(out)],
            check=True, capture_output=True, timeout=180,
        )
        return out.exists() and out.stat().st_size > 1000
    except Exception:  # noqa: BLE001
        return False


def _tts(text: str, out: Path) -> bool:
    """Voiceover via OpenAI TTS; recap ships silent-narration if unavailable."""
    import urllib.request
    key = os.environ.get("OPENAI_API_KEY")
    if not key or not text:
        return False
    try:
        body = json.dumps({
            "model": os.environ.get("TTS_MODEL", "gpt-4o-mini-tts"),
            "voice": os.environ.get("TTS_VOICE", "ash"),
            "input": text[:2000],
        }).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/audio/speech", data=body,
            headers={"Authorization": f"Bearer {key}",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            out.write_bytes(resp.read())
        return out.stat().st_size > 1000
    except Exception as e:  # noqa: BLE001
        print(f"[worker] recap voiceover skipped: {e}", flush=True)
        return False


def generate_weekly_recap(conn, week_start, summary: str, mood: str | None):
    """'Previously on…' — cut the week's flagged moments into a narrated video."""
    mission_week = conn.execute(
        """SELECT ((%s::date - date_trunc('week', journal_started_on)::date) / 7 + 1)
           FROM users WHERE id = %s""",
        (week_start, USER_ID),
    ).fetchone()[0]

    clips = conn.execute(
        """SELECT e.id, e.media_uri, a.t_start, coalesce(a.t_end, a.t_start + 5)
           FROM annotations a
           JOIN entries e ON e.id = a.entry_id
           WHERE e.user_id = %s AND e.deleted_at IS NULL AND e.status = 'indexed'
             AND e.media_mime LIKE 'video%%' AND a.deleted_at IS NULL
             AND a.t_start IS NOT NULL
             AND date_trunc('week', e.recorded_at)::date = %s
           ORDER BY e.recorded_at, a.t_start LIMIT 6""",
        (USER_ID, week_start),
    ).fetchall()
    if len(clips) < 2:
        clips = conn.execute(
            """SELECT e.id, e.media_uri, s.t_start, s.t_start + 6
               FROM entries e
               JOIN segments s ON s.entry_id = e.id AND s.idx = 0
               WHERE e.user_id = %s AND e.deleted_at IS NULL AND e.status='indexed'
                 AND e.media_mime LIKE 'video%%'
                 AND date_trunc('week', e.recorded_at)::date = %s
               ORDER BY e.recorded_at LIMIT 5""",
            (USER_ID, week_start),
        ).fetchall()
    if not clips:
        return

    with tempfile.TemporaryDirectory(prefix="memento-recap-") as td:
        tdp = Path(td)
        # intro card
        intro = tdp / "00-intro.mp4"
        title = f"MISSION WEEK {int(mission_week):02d}"
        sub = f"{week_start} - MEMENTO TERMINAL"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y",
             "-f", "lavfi", "-i", "color=c=0x07090d:s=1280x720:r=30:d=2.6",
             "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
             "-vf",
             f"drawtext=fontfile={FONT}:text='{title}':fontcolor=0xFFB454:"
             "fontsize=64:x=(w-text_w)/2:y=(h-text_h)/2-30,"
             f"drawtext=fontfile={FONT}:text='{sub}':fontcolor=0x647080:"
             "fontsize=24:x=(w-text_w)/2:y=(h)/2+50",
             "-t", "2.6", "-c:v", "libx264", "-preset", "veryfast",
             "-c:a", "aac", "-shortest", str(intro)],
            check=True, capture_output=True, timeout=120,
        )
        parts = [intro]

        media_cache: dict[str, Path] = {}
        for i, (eid, media_uri, t0, t1) in enumerate(clips):
            if media_uri not in media_cache:
                mp = tdp / f"src-{len(media_cache)}"
                S3.fget_object(BUCKET, media_uri, str(mp))
                media_cache[media_uri] = mp
            dur = min(8.0, max(3.0, float(t1) - float(t0) + 1.0))
            out = tdp / f"{i + 1:02d}-clip.mp4"
            if _norm_clip(media_cache[media_uri], float(t0) - 0.5, dur, out):
                parts.append(out)
        if len(parts) < 2:
            return

        concat_list = tdp / "list.txt"
        concat_list.write_text("".join(f"file '{p}'\n" for p in parts))
        base = tdp / "base.mp4"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-f", "concat", "-safe", "0",
             "-i", str(concat_list), "-c", "copy", str(base)],
            check=True, capture_output=True, timeout=180,
        )

        final = tdp / "recap.mp4"
        vo = tdp / "vo.mp3"
        script = f"Mission week {int(mission_week)}. {summary}"
        if mood:
            script += f" Overall mood: {mood}."
        if _tts(script, vo):
            subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-i", str(base), "-i", str(vo),
                 "-filter_complex",
                 "[0:a]volume=0.3[a0];[a0][1:a]amix=inputs=2:duration=first:"
                 "dropout_transition=3[a]",
                 "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac",
                 str(final)],
                check=True, capture_output=True, timeout=180,
            )
        else:
            final = base

        recap_uri = f"{USER_ID}/recaps/week-{week_start}.mp4"
        S3.fput_object(BUCKET, recap_uri, str(final), content_type="video/mp4")
        conn.execute(
            """UPDATE weekly_summaries SET recap_uri = %s
               WHERE user_id = %s AND week_start = %s""",
            (recap_uri, USER_ID, week_start),
        )
        conn.commit()
        print(f"[worker] recap video generated for week of {week_start} "
              f"({len(parts) - 1} clips)", flush=True)


def compile_weekly_summaries(conn, include_week: str | None = None):
    """Mission Week debriefs: for each completed week whose entry set changed,
    synthesize the week from its day reports + entry titles. include_week
    (YYYY-MM-DD Monday) forces one week regardless of completion — test hook."""
    import urllib.request

    due = conn.execute(
        """SELECT w.week_start, w.cnt FROM (
             SELECT date_trunc('week', recorded_at)::date AS week_start,
                    count(*) AS cnt
             FROM entries
             WHERE user_id = %s AND deleted_at IS NULL AND status = 'indexed'
             GROUP BY 1) w
           LEFT JOIN weekly_summaries s
             ON s.user_id = %s AND s.week_start = w.week_start
           WHERE (w.week_start + 7 <= current_date OR w.week_start = %s)
             AND (s.week_start IS NULL OR s.entry_count <> w.cnt)
           ORDER BY w.week_start""",
        (USER_ID, USER_ID, include_week),
    ).fetchall()

    for week_start, cnt in due:
        days = conn.execute(
            """SELECT day::text, mood, summary FROM daily_summaries
               WHERE user_id = %s AND day >= %s AND day < %s + 7
               ORDER BY day""",
            (USER_ID, week_start, week_start),
        ).fetchall()
        titles = conn.execute(
            """SELECT to_char(recorded_at, 'Dy'), title, mood FROM entries
               WHERE user_id = %s AND deleted_at IS NULL AND status='indexed'
                 AND date_trunc('week', recorded_at)::date = %s
               ORDER BY recorded_at""",
            (USER_ID, week_start),
        ).fetchall()
        day_lines = "\n".join(
            f"- {d} ({m or '-'}): {s}" for d, m, s in days) or "no day reports"
        title_lines = "\n".join(
            f"- {dy}: {t or 'untitled'}{f' [{m}]' if m else ''}"
            for dy, t, m in titles)

        prompt = (
            "You write the weekly debrief for a personal video journal. "
            f"Week starting {week_start} (Monday). Synthesize ACROSS the days — "
            "arcs, repeats, changes — don't just list them. Return JSON:\n"
            '  "summary": 3-5 sentences, the week\'s story in neutral log voice.\n'
            '  "highlights": up to 5 short strings — the moments that mattered.\n'
            '  "patterns": 1-2 sentences on recurring themes, moods, or habits '
            "worth the journaler's attention.\n"
            '  "mood": one lowercase word for the week.\n\n'
            f"DAY REPORTS:\n{day_lines}\n\nENTRIES:\n{title_lines[:4000]}"
        )
        try:
            body = json.dumps({
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "format": "json", "stream": False,
                "options": {"temperature": 0.3},
            }).encode()
            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/chat", data=body,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=240) as resp:
                meta = json.loads(json.loads(resp.read())["message"]["content"])
        except Exception as e:  # noqa: BLE001 — retried next pass
            print(f"[worker] weekly debrief {week_start} skipped: {e}", flush=True)
            continue
        highlights = meta.get("highlights")
        conn.execute(
            """INSERT INTO weekly_summaries
                 (user_id, week_start, summary, highlights, patterns, mood,
                  entry_count, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, now())
               ON CONFLICT (user_id, week_start) DO UPDATE SET
                 summary = EXCLUDED.summary, highlights = EXCLUDED.highlights,
                 patterns = EXCLUDED.patterns, mood = EXCLUDED.mood,
                 entry_count = EXCLUDED.entry_count, updated_at = now()""",
            (USER_ID, week_start,
             str(meta.get("summary", "")).strip()[:3000] or None,
             json.dumps(highlights if isinstance(highlights, list) else []),
             str(meta.get("patterns", "")).strip()[:1000] or None,
             str(meta.get("mood", "")).strip().lower()[:24] or None, cnt),
        )
        conn.commit()
        print(f"[worker] weekly debrief compiled for week of {week_start} "
              f"({cnt} entries)", flush=True)
        try:
            generate_weekly_recap(
                conn, week_start,
                str(meta.get("summary", "")).strip(),
                str(meta.get("mood", "")).strip() or None,
            )
        except Exception as e:  # noqa: BLE001 — recap is a bonus, never blocks
            conn.rollback()
            print(f"[worker] recap generation failed for {week_start}: {e}",
                  flush=True)


def save_agent_flags(conn, entry_id, flags: list[dict]):
    """Store LLM-proposed action items / insights as agent annotations,
    anchored to the segment containing the supporting quote when findable."""
    conn.execute(
        "DELETE FROM annotations WHERE entry_id = %s AND source = 'agent'",
        (entry_id,),
    )
    for f in flags[:6]:
        ftype = str(f.get("type", "")).strip()
        label = str(f.get("label", "")).strip()[:120]
        quote = str(f.get("quote", "")).strip()[:200]
        if ftype not in ("action_item", "insight") or not label:
            continue
        seg = None
        if quote:
            seg = conn.execute(
                """SELECT id, t_start, t_end FROM segments
                   WHERE entry_id = %s AND position(lower(%s) in lower(text)) > 0
                   ORDER BY idx LIMIT 1""",
                (entry_id, quote[:80]),
            ).fetchone()
        conn.execute(
            """INSERT INTO annotations
               (entry_id, segment_id, t_start, t_end, type, source, label, note)
               VALUES (%s, %s, %s, %s, %s, 'agent', %s, %s)""",
            (entry_id, seg[0] if seg else None,
             seg[1] if seg else None, seg[2] if seg else None,
             ftype, label, quote or None),
        )


def llm_metadata(transcript: str) -> dict | None:
    """Ask the local LLM for title/summary/mood. Best-effort: None on any failure."""
    import urllib.request

    if len(transcript.split()) < 5:
        return None
    prompt = (
        "You title entries in a personal video journal. Read the transcript and "
        "return JSON with exactly these keys:\n"
        '  "title": max 9 words. Concrete and specific to THIS entry, in the '
        "journaler's own terms. No quotes, no clickbait, no generic phrases like "
        "'Daily Reflections'.\n"
        '  "summary": one sentence, max 25 words, third person not used — write '
        "as neutral notes (e.g. 'Rough day at work; considering the job offer').\n"
        '  "mood": one lowercase word for the emotional tone (e.g. upbeat, tired, '
        "anxious, focused, mixed).\n"
        '  "concepts": up to 8 objects {"name", "kind"} for the specific people, '
        "places, projects, ideas, themes or emotions that this entry is actually "
        "about — things worth finding this entry by later. kind must be one of: "
        "person, place, project, idea, theme, emotion, other. Use the exact names "
        "the journaler used. Order by importance. Skip generic filler like "
        "'daily life'.\n"
        '  "flags": up to 4 objects {"type", "label", "quote"}. type is '
        '"action_item" (something the journaler said they will, must, or should '
        'do) or "insight" (a realization or conclusion worth resurfacing later). '
        "label: max 8 words. quote: a short EXACT phrase copied verbatim from the "
        "transcript that supports it. Empty array if none — do not invent.\n\n"
        f"Transcript:\n{transcript[:12000]}"
    )
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.3},
    }).encode()
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/chat", data=body,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        meta = json.loads(data["message"]["content"])
        title = str(meta.get("title", "")).strip()[:120]
        concepts = meta.get("concepts")
        flags = meta.get("flags")
        return {
            "title": title or None,
            "summary": str(meta.get("summary", "")).strip()[:300] or None,
            "mood": str(meta.get("mood", "")).strip().lower()[:24] or None,
            "concepts": concepts if isinstance(concepts, list) else [],
            "flags": flags if isinstance(flags, list) else [],
        }
    except Exception as e:  # noqa: BLE001 — metadata is best-effort
        print(f"[worker] llm metadata skipped: {e}", flush=True)
        return None


def process_live_session(conn, entry_id, media_uri):
    """Live sessions arrive with speaker-attributed segments already present
    (from the Realtime API) — never re-transcribe. Embed + metadata, and if a
    session recording was uploaded, add its thumbnail and true duration."""
    seg = conn.execute(
        """SELECT idx, t_start, t_end, text FROM segments
           WHERE entry_id = %s ORDER BY idx""",
        (entry_id,),
    ).fetchall()
    texts = [s[3] for s in seg]
    embeddings = embed_texts(texts)
    full_text = " ".join(texts)
    fallback_title = " ".join(full_text.split()[:8]) + (
        "…" if len(full_text.split()) > 8 else "")
    meta = llm_metadata(full_text) or {}
    duration = seg[-1][2] if seg else None

    thumb_uri = None
    if media_uri:
        mime = conn.execute(
            "SELECT media_mime FROM entries WHERE id = %s", (entry_id,)
        ).fetchone()[0] or ""
        with tempfile.TemporaryDirectory(prefix="memento-") as td:
            media = Path(td) / "media"
            S3.fget_object(BUCKET, media_uri, str(media))
            duration = media_duration(media) or duration
            if mime.startswith("video"):
                thumb = make_thumbnail(media, duration, td)
                if thumb:
                    thumb_uri = media_uri.rsplit("/", 1)[0] + "/thumb.jpg"
                    S3.fput_object(BUCKET, thumb_uri, str(thumb),
                                   content_type="image/jpeg")
                analyze_vision(conn, entry_id, media, duration, td)

    with conn.cursor() as cur:
        if embeddings:
            cur.executemany(
                """UPDATE segments SET embedding = %s::vector
                   WHERE entry_id = %s AND idx = %s""",
                [(json.dumps(v), entry_id, s[0])
                 for v, s in zip(embeddings, seg)],
            )
        cur.execute(
            """UPDATE entries
               SET status = 'indexed',
                   duration_s = %s,
                   title = COALESCE(%s, NULLIF(%s, ''), title),
                   summary = COALESCE(%s, summary),
                   mood = COALESCE(%s, mood),
                   thumb_uri = COALESCE(%s, thumb_uri),
                   error = NULL
               WHERE id = %s""",
            (duration, meta.get("title"), fallback_title,
             meta.get("summary"), meta.get("mood"), thumb_uri, entry_id),
        )
    save_concepts(conn, entry_id, meta.get("concepts") or [])
    save_agent_flags(conn, entry_id, meta.get("flags") or [])
    conn.commit()
    reflect_entry(conn, entry_id, full_text)
    print(f"[worker] indexed live session {entry_id}: {len(seg)} turns, "
          f"media={'yes' if media_uri else 'no'}, "
          f"emb={'yes' if embeddings else 'no'}", flush=True)


def process(conn, model, entry_id, media_uri, kind):
    if kind == "live_session" or media_uri is None:
        process_live_session(conn, entry_id, media_uri)
        return
    with tempfile.TemporaryDirectory(prefix="memento-") as td:
        media = Path(td) / "media"
        wav = Path(td) / "audio.wav"
        S3.fget_object(BUCKET, media_uri, str(media))
        duration = media_duration(media)
        extract_audio(media, wav)

        seg_iter, _info = model.transcribe(
            str(wav), word_timestamps=True, vad_filter=True
        )

        rows = []
        for i, seg in enumerate(seg_iter):
            words = [
                {"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3)}
                for w in (seg.words or [])
            ]
            rows.append((entry_id, i, seg.start, seg.end, seg.text.strip(),
                         json.dumps(words)))

        # Thumbnail (video entries only) — derived data, stored next to the original
        thumb_uri = None
        kind = conn.execute(
            "SELECT kind FROM entries WHERE id = %s", (entry_id,)
        ).fetchone()[0]
        if kind == "video_log":
            thumb = make_thumbnail(media, duration, td)
            if thumb:
                thumb_uri = media_uri.rsplit("/", 1)[0] + "/thumb.jpg"
                S3.fput_object(BUCKET, thumb_uri, str(thumb),
                               content_type="image/jpeg")
            analyze_vision(conn, entry_id, media, duration, td)

        full_text = " ".join(r[4] for r in rows)
        fallback_title = " ".join(full_text.split()[:8]) + (
            "…" if len(full_text.split()) > 8 else "")
        meta = llm_metadata(full_text) or {}

        embeddings = embed_texts([r[4] for r in rows])

        with conn.cursor() as cur:
            cur.execute("DELETE FROM segments WHERE entry_id = %s", (entry_id,))
            cur.executemany(
                """INSERT INTO segments (entry_id, idx, t_start, t_end, text, words)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                rows,
            )
            if embeddings:
                cur.executemany(
                    """UPDATE segments SET embedding = %s::vector
                       WHERE entry_id = %s AND idx = %s""",
                    [(json.dumps(v), entry_id, r[1])
                     for v, r in zip(embeddings, rows)],
                )
            cur.execute(
                """UPDATE entries
                   SET status = 'indexed', duration_s = %s,
                       title = COALESCE(%s, NULLIF(%s, ''), title),
                       summary = COALESCE(%s, summary),
                       mood = COALESCE(%s, mood),
                       thumb_uri = COALESCE(%s, thumb_uri),
                       error = NULL
                   WHERE id = %s""",
                (duration, meta.get("title"), fallback_title,
                 meta.get("summary"), meta.get("mood"), thumb_uri, entry_id),
            )
        save_concepts(conn, entry_id, meta.get("concepts") or [])
        save_agent_flags(conn, entry_id, meta.get("flags") or [])
        conn.commit()
        reflect_entry(conn, entry_id, full_text)
        print(f"[worker] indexed {entry_id}: {len(rows)} segments, "
              f"{duration and round(duration, 1)}s, "
              f"title={'llm' if meta.get('title') else 'fallback'}, "
              f"thumb={'yes' if thumb_uri else 'no'}, "
              f"emb={'yes' if embeddings else 'no'}, "
              f"concepts={len(meta.get('concepts') or [])}", flush=True)


SUMMARY_CHECK_S = float(os.environ.get("SUMMARY_CHECK_S", "300"))


def main():
    model = load_model()
    print("[worker] polling for uploaded entries…", flush=True)
    last_summary_check = 0.0
    while _running:
        try:
            with psycopg.connect(DB_URL) as conn:
                while _running:
                    if time.monotonic() - last_summary_check > SUMMARY_CHECK_S:
                        last_summary_check = time.monotonic()
                        try:
                            unseal_due_capsules(conn)
                            compile_daily_summaries(conn)
                            compile_weekly_summaries(conn)
                        except Exception as e:  # noqa: BLE001
                            conn.rollback()
                            print(f"[worker] summary pass failed: {e}",
                                  file=sys.stderr, flush=True)
                    row = claim_entry(conn)
                    if row is None:
                        time.sleep(POLL_S)
                        continue
                    entry_id, media_uri, kind = row
                    try:
                        process(conn, model, entry_id, media_uri, kind)
                    except Exception as e:  # noqa: BLE001 — record and move on
                        conn.rollback()
                        conn.execute(
                            "UPDATE entries SET status='error', error=%s WHERE id=%s",
                            (str(e)[:2000], entry_id),
                        )
                        conn.commit()
                        print(f"[worker] ERROR {entry_id}: {e}", file=sys.stderr, flush=True)
        except Exception as e:  # noqa: BLE001 — db connection lost; retry
            print(f"[worker] db reconnect after: {e}", file=sys.stderr, flush=True)
            time.sleep(3)


if __name__ == "__main__":
    main()
