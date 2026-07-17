# MEMENTO

A live journal you talk to. Video/voice log entries and full-duplex agent
sessions, transcribed, indexed, and remembered: search & Ask, concept catalog,
mission calendar with day reports, weekly debriefs with narrated recap videos,
pins & time capsules, threads & rapport profile, Life Story program, visual
log, stats & starmap, morning briefings. Vision doc: [PLAN.md](PLAN.md);
this file is the operational reference.

## Screenshots

Every shot below is from a demo instance seeded with fictional data
(`memento_demo` — a telescope restoration, a trail-race block, and a sourdough
starter named Kepler). Nothing here is a real journal.

**Mission timeline** — the home feed: every log indexed, transcribed, and summarized.

![Mission timeline](assets/screenshots/home.png)

**Live console** — full-duplex voice sessions with the agent (idle, ring presence).

![Live console](assets/screenshots/live.png)

**Mission calendar** — day reports, moods, and reminders at a glance.

![Mission calendar](assets/screenshots/calendar.png)

**Stats** — streaks, logged time, mood strip, and what the log keeps returning to.

![Stats](assets/screenshots/stats.png)

**Memory starmap** — every concept a star; shared entries draw the filaments.

![Memory starmap](assets/screenshots/starmap.png)

**Operator profile** — open threads and the rapport model, fully user-editable.

![Operator profile](assets/screenshots/profile.png)

**Life Story program** — a long-form interview conducted over weeks.

![Life Story](assets/screenshots/story.png)

## Stack

- `web/` — Next.js 16 (port **8742**), Mission Log UI, API routes
- `worker/` — Python pipeline (polls Postgres): whisper transcription,
  embeddings, LLM extraction/reflection, vision pass, day/week reports,
  capsule delivery, recap videos
- `db/schema.sql` — Postgres 17 + pgvector (port **5433**)
- MinIO (S3) for raw media (API **9400**, console **9401**)
- `.env` — single shared config (web reads it via the `web/.env.local` symlink)

## Run

**Production (how it runs now):** everything is persistent — Docker services
restart themselves, and the web app + worker are systemd user services
(lingering enabled, so they start at boot and auto-restart on crash):

```bash
systemctl --user status memento-web memento-worker
journalctl --user -u memento-worker -f        # worker logs
# after changing web code: (cd web && npm run build) && systemctl --user restart memento-web
# after changing worker code: systemctl --user restart memento-worker
```

**Development:**

```bash
systemctl --user stop memento-web             # free port 8742 first
bash scripts/dev.sh                           # docker + migrate + worker + next dev
```

Open http://localhost:8742 — camera capture requires localhost or HTTPS
(over Tailscale, use `tailscale serve` for HTTPS or browse from the DGX itself).

**Install on your phone (PWA):** open the Tailscale HTTPS URL → Android
Chrome: ⋮ → *Install app*; iOS Safari: Share → *Add to Home Screen*. Launches
standalone (no browser chrome), Mission-Log icon, notch-safe layout.

First worker run downloads the whisper model (`WHISPER_MODEL` in `.env`,
default `small`; use `medium` for better accuracy, `base` for speed).

## How it flows

record console (or **Import Media File** for existing recordings) →
`POST /api/entries` → `PUT /api/entries/:id/media` (streamed to MinIO) →
status `uploaded` → worker claims via `FOR UPDATE SKIP LOCKED` → ffmpeg 16k
mono → faster-whisper (word timestamps, VAD) → `segments` rows → thumbnail
frame to MinIO (video entries) → title/summary/mood from local Ollama
(`OLLAMA_MODEL`, default qwen2.5:7b; falls back to first-words title if
Ollama is down) → status `indexed`.

The entry page polls until indexed and renders the click-to-seek synced
transcript. Deletes are soft (`deleted_at`); raw media is never touched.
Everything downstream of the media is derived data — regenerate any entry
(transcript, metadata, vision, reflection) by resetting it:
`UPDATE entries SET status='uploaded' WHERE id='…';`

## Search, catalog, backups (Phase 1b)

- **/search** — hybrid semantic (nomic-embed-text via Ollama, pgvector HNSW)
  + keyword (Postgres FTS) with reciprocal-rank fusion; results deep-link to
  the exact second (`/entry/:id?t=`). Degrades to keyword-only if Ollama is down.
- **/catalog** — concepts (people, places, projects, ideas, themes) extracted
  per entry by the LLM; each concept page lists its entries.
- **Backups** — `scripts/backup.sh` runs nightly at 03:10 via cron:
  pg_dump (14-day retention) + additive media mirror to `~/memento-backups/`
  (`MEMENTO_BACKUP_DIR` to override) + encrypted offsite staging (see Security).

## Flags & export (Phase 1c)

- Hover any transcript line → **⚑** to flag a moment (stored as a `user`
  annotation). The indexing LLM also proposes `action_item` / `insight` flags
  from the transcript ("Flagged Moments" panel on each entry; ✕ to dismiss).
- **⬇ Export Archive** on the timeline streams a zip: `memento-export.json`
  (full metadata), plus per-entry transcripts and original media.

## Live agent (Phase 2)

`/live` is a full-duplex voice session with Memento (OpenAI Realtime over
WebRTC, browser connects directly; the server only mints ephemeral session
tokens and serves the `search_journal` tool). The agent gets a prompting-engine
brief per session: question ladder (L0 check-in → L3 depth, escalate only on
engagement), recent entry summaries, recurring concepts, no-fabrication rule
(it must call `search_journal` before referencing the past), and
companion-not-therapist guardrails. Ended sessions are saved as
`live_session` entries — transcribed both sides, then indexed/embedded/flagged
by the worker like any other entry.

Sessions are **recorded by default** (`rec: video ⇄` chip to cycle
video/audio/off before starting): your camera + your mic mixed with the
agent's voice, uploaded on session end. The recording and the transcript share
the session clock, so transcript lines seek the video. The worker never
re-transcribes session recordings (the Realtime transcript keeps correct
you-vs-agent attribution); it only adds the thumbnail and true duration.

**Presence (Phase 3):** the audio-reactive **ring** — amber when Memento
speaks, cyan when you do. A 3D-avatar surface exists behind the same renderer
boundary but is shelved by operator decision (`AVATAR_ENABLED=false` in
`LiveConsole.tsx`; needs a GLB at `web/public/avatar.glb` to re-enable) —
the ring holds until a Wan-Streamer-class photoreal surface is achievable.

**To enable:** put your key in `.env` (`OPENAI_API_KEY=sk-…`), restart the web
server. Model/voice: `OPENAI_REALTIME_MODEL` (default `gpt-realtime`),
`REALTIME_VOICE` (default `marin`). Costs are per-minute; without a key the
page explains itself and everything else keeps working.

## Threads, profile & cost (Phase 2.5)

- **/profile** — the agent's model of you, fully visible and editable: open
  **threads** (unresolved loops it follows up across sessions; resolve ✓ /
  drop ✕ / add your own) and the **rapport profile** (goals, values, people,
  preferences, sensitivities, context — delete anything, add anything).
- After every indexed entry the worker runs a **reflection pass**: opens new
  threads, resolves ones the entry settles, and adds genuinely new profile
  facts. Live sessions read open threads + profile in their instructions and
  weave in at most one or two, naturally.
- **Cost meter**: live `≈$` estimate in the session header while talking
  (token usage × `RATE_*` env rates), saved to the entry row (`cost_usd`).
  Deliberately NOT shown on entry pages — spend surfaces only in aggregate:
  the "session spend" tile on /stats and the per-week `≈$ agent time` figure
  in each /debriefs header. Listen-mode sessions report ~$0 (input
  transcription, ~half a cent/min, isn't included in usage events).

## Pins — reminders & notes

Say "remind me…", "pin that", or "note that down" in any entry or live
session and it lands on **/pins** — reminders (date-anchored) and notes.
Sections: overdue / upcoming / notes / recently closed; ✓ done, ✕ dismiss,
manual add with optional date. Dates are resolved deterministically in code
from the journaler's phrase ("Monday", "tomorrow", "this weekend"), not by
the LLM. Due reminders appear on the calendar (◪, red when overdue) and in
that day's report panel. The live agent is briefed on reminders due
today/tomorrow and has a `create_pin` tool to pin things mid-conversation.

## Time capsules

In the recorder's review step, **◍ Seal as Time Capsule** hides the entry
until a delivery date — a message to future you. Sealed entries are invisible
everywhere (timeline, search, calendar, export, media API) and aren't even
transcribed until delivery day, when the worker unseals them into the normal
pipeline and the morning briefing announces "a message from your past."

## Listen Mode

On /live, `mode: converse ⇄ listen`. In Listen Mode Memento is a silent
companion: it transcribes everything (the session still becomes an entry) but
speaks only when addressed by name — "Memento, …". Wake-word detection is
client-side on the live transcript; VAD runs with auto-response disabled, so
silent listening costs almost nothing in output tokens.

## Ask your journal

/search has **Find ⇄ Ask**. Ask runs the question through hybrid retrieval +
the local LLM and answers in your own journal's words, citing [n] sources that
deep-link to the exact video second. Fully local — no API cost.

## Life Story program

/story — a seeded interview program (24 topics across 9 chapters). Say "story
time" in a live session and the agent offers the next topic; or just record an
entry telling one of the stories — the reflection pass recognizes substantial
tellings and checks the topic off, linking it to the entry.

## Visual log

The indexing pass shows three frames of each video entry to a local VLM
(`VISION_MODEL`, qwen2.5-VL) — scene, appearance, energy. Appears as the
"Visual Log" line on entries and feeds the day reports. Toggle in ⚙ Settings;
runs entirely on the DGX.

## Morning briefing & weekly debriefs

- **Briefing** — cron 08:00 runs `scripts/briefing.py`: SOL, due/overdue
  reminders, open threads, yesterday's report, logging streak → pushed via
  the self-hosted **ntfy** container (port 8744).
- **Evening nudge** — cron 21:00 runs `scripts/nudge.py`: fires ONLY if
  nothing was logged that day (streak warning + a hook: open thread, next
  story topic, or tomorrow's reminder). Silent on logged days. Subscribe on your phone:
  ntfy app → add server `http://<tailscale-ip>:8744` (Tailscale IP) → topic
  your `NTFY_TOPIC` from `.env`. Deterministic — no LLM in the wake-up path.
- **/debriefs** — MISSION WEEK reports compiled by the worker once a week
  completes (Mon–Sun): the week's story, highlights, a patterns observation,
  and week mood. Recompiles if a past week's entries change.
- Each debrief also gets a **recap video**: ffmpeg cuts the week's flagged
  moments (intro title card + up to 6 clips), with an agent voiceover of the
  summary via OpenAI TTS (`TTS_MODEL`/`TTS_VOICE`; ships without narration if
  no key). Plays inline on /debriefs.

## Stats & starmap

- **/stats** — stat tiles (SOL, streak, entries, minutes, concepts, spend),
  30-day entries/minutes bars with hover tooltips, a mood valence strip
  (positive/neutral/heavy, hover for the word), top concepts, and a plain
  data table. Chart mark colors are CVD-validated against the dark surface
  (`src/lib/mood.ts` CHART) — distinct from the lighter UI accent tints.
- **/starmap** — the memory constellation: concepts as glowing stars (size =
  entries touched, color = kind), co-occurrence filaments, hover to light a
  star's connections, click to open its catalog page. Layout settles
  synchronously with a cooling schedule (no live physics — cannot explode).

## Mission calendar & day reports

**/calendar** — month grid with activity pips per day (▮ video · ◉ audio ·
◈ live session), mood, and a ▣ marker once the day report exists. Clicking a
day opens its report: an LLM-compiled narrative of the day, highlights, day
mood, and that day's entries. Reports compile **after the day ends** (the
worker checks every ~5 min, so completed days appear shortly after midnight);
if a past day's entries later change (import/delete), its report recompiles —
or is removed if the day empties. Postgres runs on America/New_York
(ALTER SYSTEM) so days group by local time.

## Security

- **Auth**: passphrase login (scrypt hash stored in the users row; legacy
  `.env` `AUTH_HASH` is a fallback that auto-migrates on login) → HMAC-signed
  HttpOnly cookie (30d) → `src/proxy.ts` guards every route and API. Login is
  rate-limited (5/min/IP) with constant-time verification.
  **⚙ Settings in the nav**: change passphrase, operator name, theme
  (Terminal Amber / Cryo Cyan / Botanic / Nebula — accent presets applied
  app-wide from `users.settings.theme`), vision toggle, and the voice agent
  (voice, realtime model, and an OpenAI API key override stored in the local
  DB; blank = fall back to `.env`; the key never reaches the browser).
  Lock with ⎋.
  **/register** claims the terminal on first run only; it is closed once an
  operator exists. Forgot the passphrase? Reset from the DGX shell:
  `docker compose exec -T db psql -U memento -d memento -c "UPDATE users SET settings = settings - 'auth_hash';"`
  then remove `AUTH_HASH` from `.env`, restart memento-web, and re-claim at /register.
- **Ports**: Postgres and MinIO bind to 127.0.0.1 only; ntfy binds to
  127.0.0.1 + the Tailscale IP. Only the web app (8742) is reachable.
- **Backups**: nightly cron also stages an AES-256 encrypted copy of the
  latest dump in `~/memento-backups/offsite/` (`BACKUP_KEY` in `.env` —
  keep a copy of that key somewhere NOT on this machine). Set `OFFSITE_CMD`
  in `.env` (rclone/rsync line syncing `$HOME/memento-backups/offsite`) to
  actually ship them offsite; until then the log warns nightly.
  Decrypt: `openssl enc -d -aes-256-cbc -pbkdf2 -pass "pass:$BACKUP_KEY" -in x.enc -out x.dump`

## Known limits

- Whisper runs on CPU (aarch64 ctranslate2 wheel has no CUDA). Fine for daily
  entries; option: whisper.cpp with CUDA for the GB10.

## Remaining roadmap

- Offsite backup destination (`OFFSITE_CMD` — deferred; encrypted bundles
  stage locally meanwhile).
- Voice-only quick capture (push-to-talk memo).
- Native mobile app (Expo) when the PWA's limits chafe.
- The photoreal face — waiting on Wan-Streamer-class open weights
  (paper 2606.25041); the renderer boundary is ready.
