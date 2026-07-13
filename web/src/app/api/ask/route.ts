import { NextRequest, NextResponse } from "next/server";
import { hybridSearch } from "@/lib/search";
import { db, USER_ID } from "@/lib/db";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (question.length < 3)
    return NextResponse.json({ error: "ask something" }, { status: 400 });

  const [{ hits }, recent] = await Promise.all([
    hybridSearch(question),
    db.query(
      `SELECT sol, title, summary, recorded_at::date::text AS day
       FROM entries WHERE user_id = $1 AND deleted_at IS NULL
         AND status = 'indexed'
       ORDER BY recorded_at DESC LIMIT 5`,
      [USER_ID]
    ),
  ]);

  const sources = hits.slice(0, 8).map((h, i) => ({
    n: i + 1,
    sol: h.sol,
    title: h.title,
    entry_id: h.entry_id,
    t: Math.floor(h.t_start),
    text: h.text,
    when: String(h.recorded_at).slice(0, 10),
  }));

  const context = sources
    .map((s) => `[${s.n}] SOL ${s.sol} (${s.when}) "${s.title}": ${s.text}`)
    .join("\n");
  const recentLines = recent.rows
    .map((e) => `- SOL ${e.sol} (${e.day}): ${e.title} — ${e.summary ?? ""}`)
    .join("\n");

  const prompt = `You answer questions about the journaler's own life using ONLY their journal excerpts below. Answer in 1-4 sentences, direct and specific. Cite sources inline as [1], [2] etc. If the journal doesn't contain the answer, say so plainly — never invent memories.

QUESTION: ${question}

JOURNAL EXCERPTS:
${context || "(no matching excerpts)"}

RECENT ENTRIES (context only):
${recentLines}`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const data = await res.json();
    return NextResponse.json({
      answer: data.message?.content ?? "",
      sources,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `The journal brain is unreachable: ${e instanceof Error ? e.message : e}` },
      { status: 503 }
    );
  }
}
