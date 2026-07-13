import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

export const runtime = "nodejs";

// Per-user overrides live in users.settings; .env values are the fallback.
async function voiceConfig() {
  const { rows } = await db.query(
    `SELECT settings->>'openai_key' AS key,
            settings->>'voice' AS voice,
            settings->>'realtime_model' AS model
     FROM users WHERE id = $1`,
    [USER_ID]
  );
  const s = rows[0] ?? {};
  return {
    key: s.key || process.env.OPENAI_API_KEY || null,
    voice: s.voice || process.env.REALTIME_VOICE || "marin",
    model: s.model || process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",
  };
}

// $ per 1M tokens — override in .env if pricing changes
const RATES = {
  audioIn: Number(process.env.RATE_AUDIO_IN ?? 32),
  audioOut: Number(process.env.RATE_AUDIO_OUT ?? 64),
  textIn: Number(process.env.RATE_TEXT_IN ?? 4),
  textOut: Number(process.env.RATE_TEXT_OUT ?? 16),
};

async function buildInstructions(): Promise<string> {
  const [recent, concepts, solRow, threads, profile, duePins, story] = await Promise.all([
    db.query(
      `SELECT sol, title, summary, mood, recorded_at::date AS day
       FROM entries
       WHERE user_id = $1 AND deleted_at IS NULL AND status = 'indexed'
       ORDER BY recorded_at DESC LIMIT 7`,
      [USER_ID]
    ),
    db.query(
      `SELECT c.name, c.kind, count(*)::int AS n
       FROM concepts c JOIN entry_concepts ec ON ec.concept_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id ORDER BY count(*) DESC LIMIT 12`,
      [USER_ID]
    ),
    db.query(
      `SELECT (current_date - journal_started_on) + 1 AS sol
       FROM users WHERE id = $1`,
      [USER_ID]
    ),
    db.query(
      `SELECT title, detail, (current_date - created_at::date) AS age_days
       FROM threads
       WHERE user_id = $1 AND status = 'open' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 8`,
      [USER_ID]
    ),
    db.query(
      `SELECT category, fact FROM profile_facts
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY category, created_at DESC LIMIT 40`,
      [USER_ID]
    ),
    db.query(
      `SELECT text, due_on::text, (due_on < current_date) AS overdue
       FROM pins
       WHERE user_id = $1 AND deleted_at IS NULL AND status = 'active'
         AND due_on IS NOT NULL AND due_on <= current_date + 1
       ORDER BY due_on LIMIT 8`,
      [USER_ID]
    ),
    db.query(
      `SELECT chapter, prompt,
              (SELECT count(*)::int FROM story_topics
               WHERE user_id = $1 AND status = 'done') AS done,
              (SELECT count(*)::int FROM story_topics WHERE user_id = $1) AS total
       FROM story_topics
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY ord LIMIT 1`,
      [USER_ID]
    ),
  ]);

  const recentLines = recent.rows
    .map(
      (e) =>
        `- SOL ${e.sol} (${e.day}): "${e.title ?? "untitled"}" — ${e.summary ?? "no summary"}${e.mood ? ` [mood: ${e.mood}]` : ""}`
    )
    .join("\n");
  const conceptLines = concepts.rows
    .map((c) => `${c.name} (${c.kind}, x${c.n})`)
    .join(", ");
  const threadLines = threads.rows
    .map(
      (t) =>
        `- ${t.title}${t.detail ? ` — ${t.detail}` : ""} (open ${t.age_days}d)`
    )
    .join("\n");
  const profileLines = profile.rows
    .map((f) => `- [${f.category}] ${f.fact}`)
    .join("\n");
  const pinLines = duePins.rows
    .map(
      (p) =>
        `- ${p.text} (${p.overdue ? "OVERDUE, was due" : "due"} ${p.due_on})`
    )
    .join("\n");

  return `You are Memento, a voice journaling companion. Today is SOL ${solRow.rows[0]?.sol ?? "?"} of the journal (${new Date().toISOString().slice(0, 10)}). You are having a spoken conversation — keep responses SHORT (one to three sentences), warm, and natural. You listen far more than you speak.

YOUR PURPOSE: help the journaler produce an honest, rich record of their life, and reflect on it. This session's transcript becomes a journal entry.

QUESTION LADDER — escalate depth only when they engage (long answers, disclosure, explicit invitation); de-escalate immediately on short or deflecting answers:
- L0 check-in: how the day went, what's on their mind.
- L1 concrete: facts and events ("What happened with X?").
- L2 reflective: patterns and feelings ("That's the third time you've mentioned Y — what's going on there?").
- L3 depth: values, meaning, identity. Only after real rapport this session.

RULES:
- One question at a time. Never interrogate. Silence is fine.
- Use search_journal to check the past BEFORE claiming anything about it. Never invent memories. When you reference a past entry, mention its SOL day naturally ("back on SOL 12 you said…").
- Follow up on open threads from recent entries when relevant, gently.
- You are a journaling companion, not a therapist. If crisis or self-harm topics arise, warmly suggest professional support (988 in the US) and stay grounded.
- Open the session with a brief L0 check-in; if a recent entry has an obvious open loop, weave it in naturally.

RECENT ENTRIES:
${recentLines || "- none yet; this is one of the first sessions."}

REMINDERS DUE NOW OR TOMORROW (mention briefly near the start if any exist —
this is a service the journaler relies on):
${pinLines || "- none"}

When the journaler says "remind me", "pin that", "note that down", or gives a
task with a date, call create_pin immediately — do not just acknowledge.

OPEN THREADS (unresolved loops — weave in AT MOST one or two, naturally, only
when relevant; never run down the list):
${threadLines || "- none"}

WHAT YOU KNOW ABOUT THE JOURNALER (they can see and edit this profile; treat
sensitivities with care):
${profileLines || "- nothing yet — you are still getting to know them"}

RECURRING CONCEPTS: ${conceptLines || "none yet"}

LIFE STORY PROGRAM (${story.rows[0]?.done ?? 0}/${story.rows[0]?.total ?? 0} topics recorded — a long-form interview building their autobiography): if the journaler invites it ("story time", "let's do a story session") or a longer session reaches a natural lull, offer the next topic conversationally — never as an assignment:
${story.rows[0] ? `NEXT TOPIC [${story.rows[0].chapter}]: "${story.rows[0].prompt}"` : "All topics recorded."}
One story topic per session at most. When they take it, go deep: follow-ups, sensory details, names, how it felt.`;
}

const LISTEN_INSTRUCTIONS = `You are Memento in LISTEN MODE — a silent companion in the room.

RULES:
- Stay COMPLETELY silent. Do not comment, acknowledge, or react to what you hear. The journaler is living their life; you are the log, not a participant.
- Respond ONLY when directly addressed by name ("Memento", "hey Memento"). Then answer briefly and helpfully, and return to silence.
- When addressed with "remind me", "pin that", or "note that down", call create_pin, confirm in one short sentence, and go quiet again.
- Use search_journal before referencing the past, as always.
- Everything you hear is being transcribed into a journal entry; you do not need to summarize unless asked.`;

export async function POST(req: NextRequest) {
  const { key, voice, model } = await voiceConfig();
  if (!key)
    return NextResponse.json(
      {
        error: "missing_key",
        message:
          "No OpenAI API key configured. Add one in Settings (Voice Agent) or set OPENAI_API_KEY in memento/.env.",
      },
      { status: 501 }
    );

  const body = await req.json().catch(() => ({}));
  const listen = body.mode === "listen";
  const instructions = listen
    ? LISTEN_INSTRUCTIONS
    : await buildInstructions();
  const tools = [
    {
      type: "function",
      name: "search_journal",
      description:
        "Search the journaler's past entries (semantic + keyword). Returns matching transcript moments with SOL day, entry title, and timestamp. Use before referencing the past.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "what to look for" },
        },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "create_pin",
      description:
        "Pin a reminder or note for the journaler. Use whenever they ask to remember, note, or be reminded of something. Confirm aloud after pinning.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "what to pin, in their words" },
          due: {
            type: "string",
            description:
              "due date YYYY-MM-DD if time-bound, resolved from today; omit for undated notes",
          },
        },
        required: ["text"],
      },
    },
  ];

  // Current (GA) Realtime API: mint an ephemeral client secret
  const gaRes = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model,
        instructions,
        tools,
        audio: {
          input: {
            transcription: { model: "whisper-1" },
            // listen mode: VAD still segments/transcribes speech, but the
            // model only responds when the client explicitly asks (wake word)
            turn_detection: listen
              ? { type: "server_vad", create_response: false, interrupt_response: false }
              : { type: "server_vad" },
          },
          output: { voice },
        },
      },
    }),
  });
  if (gaRes.ok) {
    const session = await gaRes.json();
    return NextResponse.json({
      clientSecret: session.value ?? session.client_secret?.value,
      model,
      sdpBase: "https://api.openai.com/v1/realtime/calls",
      api: "ga",
      rates: RATES,
    });
  }
  const gaDetail = await gaRes.text();

  // Fallback: beta Realtime API
  const betaRes = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "realtime=v1",
    },
    body: JSON.stringify({
      model,
      voice,
      instructions,
      input_audio_transcription: { model: "whisper-1" },
      turn_detection: listen
        ? { type: "server_vad", create_response: false }
        : { type: "server_vad" },
      tools,
    }),
  });
  if (betaRes.ok) {
    const session = await betaRes.json();
    return NextResponse.json({
      clientSecret: session.client_secret?.value,
      model,
      sdpBase: "https://api.openai.com/v1/realtime",
      api: "beta",
      rates: RATES,
    });
  }
  const betaDetail = await betaRes.text();
  return NextResponse.json(
    {
      error: "openai_error",
      detail: `GA: ${gaDetail.slice(0, 300)} | beta: ${betaDetail.slice(0, 300)}`,
    },
    { status: 502 }
  );
}
