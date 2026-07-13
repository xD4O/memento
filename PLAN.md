# MEMENTO — Master Plan

*A live voice/video journal with a full-duplex conversational agent.*
*Inspired by: Avatar (video log entries), The Martian (mission logs), Interstellar & Moon (UI language).*

Created 2026-07-11 · Status: **BUILT & OPERATIONAL** (through Phase 3, ring presence) · Build target: **Hybrid** (variants documented in §8)

> **Implementation status (2026-07-12):** Phases 0–2.5 fully shipped, plus: Martian HUD
> overlay, mission calendar + day reports, weekly debriefs with narrated recap videos,
> pins/reminders, threads + rapport profile, morning briefings (ntfy), stats dashboard,
> memory starmap, time capsules, Listen Mode, Ask-your-journal, Life Story program,
> visual log (local VLM), PWA install, passphrase auth + account management, encrypted
> backups, systemd productionization. Phase 3 presence = the ring (photoreal avatar
> deliberately deferred until Wan-Streamer-class weights exist — see §6 Phase 4).
> Living docs: README.md is the operational reference; this plan remains the vision.

---

## 1. North star

The user records video/voice journal entries — or simply *talks* to a live agent that
listens, responds in real time (full-duplex, interruptible), asks progressively deeper
questions, and remembers everything. Every entry is transcribed, indexed, and cataloged.
Concepts, people, ideas, and important moments are auto-flagged by the agent or manually
marked by the user. In the final iteration the agent is embodied as a photoreal,
natural-looking human avatar streaming at conversational latency.

**The product IS the memory + the conversation.** The avatar is presentation.

## 2. Design principles (the Type 1 decisions)

1. **Raw media is the source of truth.** Original video/audio files are immutable and
   sacred. Transcripts, embeddings, flags, summaries are *derived data* — always
   rebuildable from raw media. This makes almost every other technical choice reversible.
2. **Provider-as-driver.** The live voice agent and the avatar renderer sit behind
   adapters (a session gateway). Cloud APIs today, local models tomorrow, end-to-end
   AV foundation models eventually — without touching the journal core.
3. **Single-user first, multi-tenant-shaped.** Every table has `user_id`, every storage
   path is user-prefixed, auth is an interface (static token now, real auth later).
   No multi-tenant *features*, but no single-user *assumptions* baked into data.
4. **Privacy gradient.** Transcripts, embeddings, index, and media never leave the DGX.
   Only the live voice stream transits the cloud provider (zero-retention mode enabled).
   The full-local variant (§8.1) is the permanent escape hatch.
5. **Habit before technology.** Each phase must end with something used daily.

## 3. Architecture (Hybrid build)

```
┌─────────────────────────── CLIENT (web now, mobile later) ───────────────────────────┐
│  Next.js PWA · Record console (MediaRecorder) · Library/timeline · Live session UI    │
│  WebRTC ⇄ voice · Avatar surface (swappable: waveform → 3D → photoreal → E2E model)  │
└──────────────┬──────────────────────────────┬─────────────────────────────────────────┘
               │ HTTPS (uploads, search, CRUD) │ WebRTC/WS (live sessions)
┌──────────────▼──────────────┐  ┌─────────────▼──────────────────────────────────────┐
│  CORE API (Next.js routes / │  │  SESSION GATEWAY (owns the conversation)           │
│  tRPC) — entries, search,   │  │  · Provider drivers: OpenAI Realtime | Gemini Live │
│  flags, catalog, auth       │  │    | (later) local S2S driver                      │
└──────────────┬──────────────┘  │  · Tool calls → journal retrieval (RAG)            │
               │                 │  · Prompting engine (question ladder, rapport)     │
               │                 │  · Session transcript → becomes a journal entry    │
               │                 └─────────────┬──────────────────────────────────────┘
┌──────────────▼───────────────────────────────▼──────────────────────────────────────┐
│                            DGX SPARK (local, private)                                │
│  Postgres + pgvector (entries, segments, annotations, concepts, profile, FTS)        │
│  MinIO (S3 API) — raw media, immutable, user-prefixed paths                          │
│  PIPELINE WORKER (Python/FastAPI, queue = Postgres SKIP LOCKED):                     │
│    ingest → faster-whisper transcribe (+ word timestamps) → segment → embed          │
│    → local LLM extraction (Ollama): concepts, people, emotions, action items,        │
│      auto-flags, entry summary → rapport-profile update                              │
│  RETRIEVAL SERVICE — hybrid search (vector + FTS + recency/thread boost)             │
│  (Phase 3+) AVATAR RENDERER — MuseTalk / AVTR-1 → later Wan-Streamer-class E2E      │
└──────────────────────────────────────────────────────────────────────────────────────┘
         Cloud touchpoint (hybrid only): realtime voice API, zero-retention mode
```

**Identified bottleneck:** the retrieval-augmented live loop — the agent must pull
journal context mid-conversation inside a natural-speech latency budget. Addressed by:
(a) pre-session context assembly (profile + open threads + last N summaries loaded
*before* the call starts), (b) async tool-calls during conversation for deep lookups,
(c) all retrieval local on DGX (no network hop).

## 4. Data model (v1)

- **users** — id, settings (multi-tenant-shaped from day one)
- **entries** — id, user_id, kind (`video_log` | `audio_log` | `live_session`), recorded_at,
  duration, media_uri, status (uploaded → transcribing → indexed), sol_number (day counter
  since journal start — The Martian), mood, title (auto), summary (auto)
- **segments** — entry_id, t_start/t_end, speaker (`user` | `agent`), text, embedding (pgvector)
- **annotations** — entry_id, segment_id?, t_start/t_end?, type (`flag` | `highlight` |
  `action_item` | `insight`), source (`user` | `agent`), label, note
- **concepts** — user_id, name, kind (`person` | `place` | `project` | `idea` | `theme` |
  `emotion`), embedding; **entry_concepts** join with salience score
- **threads** — agent-tracked follow-ups across sessions ("you said you'd decide X by Friday"),
  status open/resolved — this powers rapport continuity
- **profile** — the rapport model: values, goals, people map, communication preferences,
  sensitivities; versioned, user-viewable and user-editable (trust requirement)
- **sessions** — live-agent session metadata, provider, cost, latency stats

Derived-data rule: everything except `users`, `entries.media_uri` metadata, and
user-authored annotations can be wiped and rebuilt from raw media.

## 5. The prompting engine (core differentiator — BUILD)

A question ladder with rapport state, not a static prompt:

- **L0 Check-in** — "How was the day? What's on your mind?" (always safe)
- **L1 Concrete** — facts, events, decisions ("What happened with the demo?")
- **L2 Reflective** — patterns and feelings ("Third time this month you've mentioned
  feeling stretched — what's driving that?")
- **L3 Depth** — values, meaning, identity (earned; only after rapport signals)
- **Threads** — open loops from prior entries surfaced naturally, never as an interrogation

Rules: agent escalates depth only on engagement signals (answer length, disclosure,
explicit invitation); always de-escalates on deflection; never fabricates memories —
every reference to the past carries a retrievable citation (entry + timestamp) the UI
can jump to. Session end → agent writes summary + updates threads + proposes flags
(user confirms or edits).

Guardrail: this is a journaling companion, not a therapist. System prompt includes
scope limits and crisis-resource deflection. Profile and threads fully user-inspectable.

## 6. Phased roadmap

**Phase 0 — Foundation (the spine)** · rough 1–2 weeks of focused work
Scaffold Next.js + Postgres/pgvector + MinIO on DGX. Record console (webcam +
MediaRecorder), upload, faster-whisper transcription, basic timeline with playback +
synced transcript. *Exit: you record a real entry daily and can reread it.*

**Phase 1 — The Log & Catalog (Martian mode)** · rough 2–4 weeks
Embeddings + hybrid search; local-LLM extraction (concepts, auto-flags, summaries,
titles); manual flagging on the timeline scrubber; concept/catalog browse pages
("everything about *Project X*", "every mention of *Mom*"); SOL day counter; export
(zip of media + transcripts) and nightly backup job. Tailscale-only exposure.
*Exit: search "that idea about the agent memory" and land on the exact video second.*

**Phase 2 — The Live Agent** · rough 3–5 weeks
Session gateway + OpenAI Realtime driver (Gemini Live as driver #2 to prove the
abstraction). WebRTC audio in browser, barge-in, tool-calling into local retrieval,
prompting engine + threads + profile. Live sessions saved as first-class entries
(both sides transcribed). Cost meter per session. STRIDE pass on the gateway + auth
before any non-Tailscale exposure.
*Exit: a nightly 10-minute conversation that references last week accurately.*

**Phase 3 — Presence (embodiment v1)** · rough 3–6 weeks, parallelizable
Avatar surface v1: audio-reactive ring/waveform (Interstellar-TARS energy). v2: 3D
lip-synced head (met4citizen/TalkingHead, driven by agent audio). v3: photoreal
talking head on DGX — MuseTalk or AVTR-1 (open weights, real-time full-duplex) behind
the same renderer interface.
*Exit: you talk to a face, and it feels present, at <1s visual latency.*

**Phase 4 — The Human + Mobile** · horizon
End-to-end full-duplex audio+video model (Wan-Streamer-class, paper 2606.25041) when
open weights or a serviceable API exist — currently ~550ms total latency at 192p on
2 GPUs, no public release yet. Watch: Wan-Streamer releases, AVTR-1 successors,
FacePlex, Hallo-Live, commercial interactive-avatar APIs (Tavus/HeyGen) as stopgaps.
Mobile: Expo/React Native app reusing the same API + gateway (PWA covers mobile-web
until then).
*Exit: a natural human presence you journal with, on your phone.*

## 7. UI direction — "Mission Log"

Cinematic references mapped to concrete language:

- **The Martian** → utilitarian log console: `SOL 142 · ENTRY 087 · 21:44 UTC` stamps,
  REC indicator, mission-elapsed-time, checklist-style flags. The recorder screen *is*
  a spacecraft comms panel.
- **Interstellar / TARS** → restraint: near-black space background, thin luminous
  rules, sparse monospace data readouts (Space Grotesk / JetBrains Mono), the agent as
  a minimal geometric presence before it has a face.
- **Moon / GERTY** → warmth inside the machine: soft amber status glow, rounded CRT
  panels, an agent that feels kind, subtle scanline/grain on video playback.
- **Avatar** → the organic layer for memory visualization: the concept graph as a
  bioluminescent constellation — entries as stars, threads as glowing filaments.

System: dark-first, glass panels, one accent (amber or cyan) + one alert color, video
always front-and-center, timeline as a horizontal "mission tape" with flag pips.

## 8. Deployment variants (documented per decision)

### 8.1 Full-local (privacy-max)
Replace the cloud realtime driver with a local S2S driver on DGX: either an open
full-duplex model (Moshi-class / Qwen-Omni-class — re-evaluate at Phase 2 start) or a
cascaded pipeline (streaming VAD → faster-whisper streaming → local LLM via Ollama →
streaming TTS e.g. Kokoro/XTTS). Expect 800ms–1.5s turn latency and weaker barge-in
vs cloud. Everything else identical — that's the point of the gateway.
**When:** open S2S quality crosses "pleasant daily conversation," or privacy stance hardens.

### 8.2 Full-cloud (product/SaaS shape)
Vercel (app) + Neon/Supabase Postgres+pgvector + R2/S3 media + cloud Whisper +
realtime API + Tavus/HeyGen-class interactive avatar API. Fastest to multi-user
product, lowest ops. Costs scale per user-minute; intimate data lives with vendors →
requires real consent UX, encryption posture, retention policy. **When:** "product
later" activates. The codebase supports this by swapping adapters + connection strings,
not rewriting.

### 8.3 Hybrid (CHOSEN)
As architected in §3. Cloud only for the live voice loop (zero-retention), all
memory/media/index local.

## 9. Security & privacy checklist

- Tailscale-only until Phase 2 auth hardening; STRIDE on session gateway + API before
  any public exposure (PRAXIS security-reasoning gate).
- API keys server-side only; client gets ephemeral session tokens for WebRTC.
- Realtime API: zero-retention/no-training flags on; log the provider config in repo.
- Nightly encrypted backup of MinIO + Postgres to a second disk / offsite (raw media is
  irreplaceable — this is a P0, scheduled in Phase 1).
- Soft-delete everywhere; hard-delete is a deliberate two-step.
- Profile/threads (the agent's model of you) always user-visible and editable.

## 10. Cost envelope (hybrid, single user, rough)

Realtime voice APIs ≈ $0.06–$0.30/min depending on provider/model tier. A daily
15-min session ≈ **$30–$130/month**. Everything else is local (electricity). Cost
meter built in Phase 2; budget alarm at a user-set cap.

## 11. Open questions & watch list

1. Which realtime provider first? Default OpenAI Realtime (mature tool-calling);
   re-verify pricing/latency at Phase 2 start.
2. DGX Spark concurrent load: whisper + embeddings + Ollama extraction + (Phase 3)
   avatar rendering share the box with KAIZEN/Hermes — benchmark in Phase 1, schedule
   heavy jobs off-hours if needed.
3. iOS Safari MediaRecorder quirks (codec, background recording) — test early; PWA
   may push the Expo app earlier than planned.
4. Wan-Streamer open release — watch HF/arXiv; also FacePlex, Hallo-Live, DyStream.
5. Name check: "Memento" has trademark collisions in software (note for "product later").

## 12. Confidence

**MEDIUM-HIGH (~85%).** Sound path verified against current tech (avatar research
checked 2026-07-11). Assumptions that would change the plan: (a) open full-duplex S2S
quality jumping early → skip cloud voice entirely; (b) DGX contention forcing pipeline
to different hardware; (c) realtime API pricing shifts changing the hybrid calculus.
