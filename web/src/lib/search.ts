import { db, USER_ID } from "@/lib/db";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

export type Hit = {
  entry_id: string;
  idx: number;
  t_start: number;
  text: string;
  title: string | null;
  sol: number;
  kind: string;
  recorded_at: string;
  score?: number;
};

async function embedQuery(q: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: q }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Hybrid semantic + keyword search with reciprocal-rank fusion. */
export async function hybridSearch(
  q: string
): Promise<{ hits: Hit[]; degraded: boolean }> {
  if (q.trim().length < 2) return { hits: [], degraded: false };
  const vec = await embedQuery(q);

  const [vecHits, ftsHits] = await Promise.all([
    vec
      ? db
          .query<Hit>(
            `SELECT s.entry_id, s.idx, s.t_start, s.text,
                    e.title, e.sol, e.kind, e.recorded_at
             FROM segments s
             JOIN entries e ON e.id = s.entry_id
             WHERE e.user_id = $1 AND e.deleted_at IS NULL
               AND s.embedding IS NOT NULL
             ORDER BY s.embedding <=> $2::vector
             LIMIT 20`,
            [USER_ID, JSON.stringify(vec)]
          )
          .then((r) => r.rows)
      : Promise.resolve([] as Hit[]),
    db
      .query<Hit>(
        `SELECT s.entry_id, s.idx, s.t_start, s.text,
                e.title, e.sol, e.kind, e.recorded_at
         FROM segments s
         JOIN entries e ON e.id = s.entry_id
         WHERE e.user_id = $1 AND e.deleted_at IS NULL
           AND s.ts @@ websearch_to_tsquery('english', $2)
         ORDER BY ts_rank(s.ts, websearch_to_tsquery('english', $2)) DESC
         LIMIT 20`,
        [USER_ID, q]
      )
      .then((r) => r.rows),
  ]);

  const scored = new Map<string, { hit: Hit; score: number }>();
  for (const list of [vecHits, ftsHits]) {
    list.forEach((hit, rank) => {
      const key = `${hit.entry_id}:${hit.idx}`;
      const prev = scored.get(key);
      scored.set(key, {
        hit,
        score: (prev?.score ?? 0) + 1 / (60 + rank),
      });
    });
  }

  const hits = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ hit, score }) => ({ ...hit, score: Number(score.toFixed(5)) }));

  return { hits, degraded: !vec };
}
