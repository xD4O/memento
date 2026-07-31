import { db, USER_ID } from "@/lib/db";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

/** Cosine-distance ceiling on semantic neighbours used for *retrieval*.
 *
 *  /search shows literal matches only. This ceiling exists for the consumers
 *  that still need recall from a natural-language question — Ask and the live
 *  agent's search_journal tool — so they are not handed unrelated moments.
 *
 *  Without a ceiling the nearest-neighbour query returns its full LIMIT
 *  however far away the rows are. The safe value depends on corpus size: the
 *  more segments there are, the closer some unrelated one happens to land.
 *  Measured with nomic-embed-text, nearest distance for pure gibberish was
 *  ~0.47 on a 90-segment corpus but ~0.34 on a 600-segment one, so 0.33 sits
 *  under the larger corpus's noise floor.
 *
 *  Note: segment embeddings are written without nomic's "search_document: "
 *  task prefix, and queries without "search_query: ". Adding both roughly
 *  tripled the signal-to-noise gap in testing, but requires re-embedding every
 *  segment, so it remains a separate change. */
const SEMANTIC_MAX_DIST = Number(process.env.SEARCH_SEMANTIC_MAX_DIST ?? 0.33);

export type Hit = {
  entry_id: string;
  idx: number;
  t_start: number;
  text: string;
  title: string | null;
  sol: number;
  kind: string;
  recorded_at: string;
  /** Lexical rank — present on `matches`. */
  score?: number;
  /** Cosine distance from the query — present on semantic-only entries of `hits`. */
  distance?: number;
};

export type SearchResult = {
  /** Matches plus semantic neighbours: the retrieval view, for Ask and the agent tool. */
  hits: Hit[];
  /** Segments that actually contain the search terms — this is what /search shows. */
  matches: Hit[];
  /** True when the embedding model was unreachable. */
  degraded: boolean;
};

const EMPTY: SearchResult = { hits: [], matches: [], degraded: false };

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

/** Search the log.
 *
 *  `matches` is authoritative and literal: the segment contains the terms.
 *  Fusing semantic guesses into that list (the original behaviour) let a
 *  top-ranked guess outscore a real word match, so an exact term could be
 *  pushed under moments that never used it. Semantic neighbours are kept out
 *  of `matches` entirely and only widen `hits` for the retrieval consumers. */
export async function hybridSearch(q: string): Promise<SearchResult> {
  const query = q.trim();
  if (query.length < 2) return EMPTY;

  const vec = await embedQuery(query);

  const [lexRows, vecRows] = await Promise.all([
    db
      .query<Hit>(
        `SELECT s.entry_id, s.idx, s.t_start, s.text,
                e.title, e.sol, e.kind, e.recorded_at,
                ts_rank(s.ts, websearch_to_tsquery('english', $2)) AS score
         FROM segments s
         JOIN entries e ON e.id = s.entry_id
         WHERE e.user_id = $1 AND e.deleted_at IS NULL
           AND s.ts @@ websearch_to_tsquery('english', $2)
         ORDER BY score DESC, s.t_start ASC
         LIMIT 20`,
        [USER_ID, query]
      )
      .then((r) => r.rows),
    vec
      ? db
          .query<Hit>(
            `SELECT s.entry_id, s.idx, s.t_start, s.text,
                    e.title, e.sol, e.kind, e.recorded_at,
                    (s.embedding <=> $2::vector) AS distance
             FROM segments s
             JOIN entries e ON e.id = s.entry_id
             WHERE e.user_id = $1 AND e.deleted_at IS NULL
               AND s.embedding IS NOT NULL
               AND (s.embedding <=> $2::vector) <= $3
             ORDER BY s.embedding <=> $2::vector
             LIMIT 20`,
            [USER_ID, JSON.stringify(vec), SEMANTIC_MAX_DIST]
          )
          .then((r) => r.rows)
      : Promise.resolve([] as Hit[]),
  ]);

  const matches = lexRows.map((h) => ({
    ...h,
    score: Number(Number(h.score ?? 0).toFixed(5)),
  }));

  const seen = new Set(matches.map((h) => `${h.entry_id}:${h.idx}`));
  const semantic = vecRows
    .filter((h) => !seen.has(`${h.entry_id}:${h.idx}`))
    .map((h) => ({ ...h, distance: Number(Number(h.distance).toFixed(3)) }));

  return {
    hits: [...matches, ...semantic].slice(0, 20),
    matches,
    degraded: !vec,
  };
}
