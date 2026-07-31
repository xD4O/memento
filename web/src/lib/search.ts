import { db, USER_ID } from "@/lib/db";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

/** Cosine-distance ceiling for a segment to count as a *related* topic.
 *
 *  Without a ceiling the nearest-neighbour query always returns its LIMIT
 *  worth of rows however far away they are, so searching a word the log has
 *  never heard returned a screenful of strangers.
 *
 *  The safe value depends on corpus size: the more segments there are, the
 *  closer some unrelated one happens to land. Measured with nomic-embed-text,
 *  nearest distance for pure gibberish was ~0.47 on a 90-segment corpus but
 *  ~0.34 on a 600-segment one. 0.33 sits under the larger corpus's noise
 *  floor, which is the conservative choice: a missing "similar topic" is a
 *  small loss, a confidently wrong one is the bug we are fixing.
 *
 *  Tune with SEARCH_RELATED_MAX_DIST — raise it for a small journal, lower it
 *  if unrelated moments start appearing. Note that segment embeddings are
 *  currently written without nomic's "search_document: " task prefix; adding
 *  that (and "search_query: " here) roughly tripled the signal-to-noise gap in
 *  testing, but needs every segment re-embedded, so it is a separate change. */
const RELATED_MAX_DIST = Number(process.env.SEARCH_RELATED_MAX_DIST ?? 0.33);
const RELATED_LIMIT = 8;

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
  /** Cosine distance from the query — present on `related`. */
  distance?: number;
};

export type SearchResult = {
  /** matches followed by related: the retrieval view, for Ask and the agent tool. */
  hits: Hit[];
  /** Segments that actually contain the search terms. */
  matches: Hit[];
  /** Semantically near segments that do *not* contain the terms, one per entry. */
  related: Hit[];
  /** True when the embedding model was unreachable — `related` will be empty. */
  degraded: boolean;
};

const EMPTY: SearchResult = {
  hits: [],
  matches: [],
  related: [],
  degraded: false,
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

/** Search the log, keeping literal matches and semantic neighbours apart.
 *
 *  Fusing the two lists (the previous behaviour) let a top-ranked semantic
 *  guess outscore a real word match, so an exact term could be pushed under
 *  moments that never used it. Lexical hits are authoritative and come first;
 *  everything merely *near* the query is reported separately as related. */
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
             LIMIT 40`,
            [USER_ID, JSON.stringify(vec), RELATED_MAX_DIST]
          )
          .then((r) => r.rows)
      : Promise.resolve([] as Hit[]),
  ]);

  const matches = lexRows.map((h) => ({
    ...h,
    score: Number(Number(h.score ?? 0).toFixed(5)),
  }));

  // A segment already shown as a match, or any other moment from an entry
  // that is already on screen, would just be noise under "related".
  const matchedSegments = new Set(matches.map((h) => `${h.entry_id}:${h.idx}`));
  const shownEntries = new Set(matches.map((h) => h.entry_id));

  const related: Hit[] = [];
  for (const h of vecRows) {
    if (related.length >= RELATED_LIMIT) break;
    if (matchedSegments.has(`${h.entry_id}:${h.idx}`)) continue;
    if (shownEntries.has(h.entry_id)) continue;
    shownEntries.add(h.entry_id);
    related.push({ ...h, distance: Number(Number(h.distance).toFixed(3)) });
  }

  return {
    hits: [...matches, ...related].slice(0, 20),
    matches,
    related,
    degraded: !vec,
  };
}
