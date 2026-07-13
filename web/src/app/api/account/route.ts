import { NextRequest, NextResponse } from "next/server";
import { db, USER_ID } from "@/lib/db";

const THEMES = ["amber", "cryo", "botanic", "nebula"];
const VOICES = [
  "marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage",
  "shimmer", "verse",
];

export async function GET() {
  const { rows } = await db.query(
    `SELECT settings->>'display_name' AS name,
            coalesce(settings->>'vision_enabled', 'true') <> 'false' AS vision,
            coalesce(settings->>'theme', 'amber') AS theme,
            settings->>'voice' AS voice,
            settings->>'realtime_model' AS realtime_model,
            settings->>'openai_key' IS NOT NULL AS has_key_override,
            right(settings->>'openai_key', 4) AS key_tail,
            journal_started_on::text AS started
     FROM users WHERE id = $1`,
    [USER_ID]
  );
  const r = rows[0] ?? {};
  return NextResponse.json({
    ...r,
    voice: r.voice ?? process.env.REALTIME_VOICE ?? "marin",
    realtime_model:
      r.realtime_model ?? process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime",
    env_key_present: !!process.env.OPENAI_API_KEY,
    voices: VOICES,
    themes: THEMES,
  });
}

async function setSetting(key: string, value: string | null) {
  if (value === null) {
    await db.query(
      `UPDATE users SET settings = settings - $1 WHERE id = $2`,
      [key, USER_ID]
    );
  } else {
    await db.query(
      `UPDATE users SET settings = jsonb_set(settings, ARRAY[$1], to_jsonb($2::text))
       WHERE id = $3`,
      [key, value, USER_ID]
    );
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (typeof body.visionEnabled === "boolean") {
    await setSetting("vision_enabled", String(body.visionEnabled));
    return NextResponse.json({ ok: true });
  }
  if (typeof body.theme === "string") {
    if (!THEMES.includes(body.theme))
      return NextResponse.json({ error: "unknown theme" }, { status: 400 });
    await setSetting("theme", body.theme);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.voice === "string") {
    if (!VOICES.includes(body.voice))
      return NextResponse.json({ error: "unknown voice" }, { status: 400 });
    await setSetting("voice", body.voice);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.realtimeModel === "string") {
    const m = body.realtimeModel.trim().slice(0, 60);
    await setSetting("realtime_model", m || null);
    return NextResponse.json({ ok: true });
  }
  if (typeof body.openaiKey === "string") {
    const k = body.openaiKey.trim();
    if (k === "") {
      await setSetting("openai_key", null); // fall back to .env
      return NextResponse.json({ ok: true, cleared: true });
    }
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(k))
      return NextResponse.json(
        { error: "That doesn't look like an OpenAI key (sk-…)." },
        { status: 400 }
      );
    await setSetting("openai_key", k);
    return NextResponse.json({ ok: true });
  }

  const name = String(body.displayName ?? "").trim().slice(0, 40);
  if (!name)
    return NextResponse.json({ error: "name required" }, { status: 400 });
  await setSetting("display_name", name);
  return NextResponse.json({ ok: true });
}
