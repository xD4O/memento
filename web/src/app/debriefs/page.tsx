import { db, USER_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

type Debrief = {
  week_start: string;
  week_end: string;
  summary: string | null;
  highlights: string[] | null;
  patterns: string | null;
  mood: string | null;
  entry_count: number;
  mission_week: number;
  recap_uri: string | null;
  spend: number;
};

export default async function DebriefsPage() {
  const { rows } = await db.query<Debrief>(
    `SELECT w.week_start::text, (w.week_start + 6)::text AS week_end,
            w.summary, w.highlights, w.patterns, w.mood, w.entry_count, w.recap_uri,
            (SELECT coalesce(round(sum(e.cost_usd)::numeric, 2), 0)::float
             FROM entries e
             WHERE e.user_id = w.user_id AND e.deleted_at IS NULL
               AND date_trunc('week', e.recorded_at)::date = w.week_start) AS spend,
            ((w.week_start - date_trunc('week', u.journal_started_on)::date) / 7 + 1)::int
              AS mission_week
     FROM weekly_summaries w
     JOIN users u ON u.id = w.user_id
     WHERE w.user_id = $1
     ORDER BY w.week_start DESC
     LIMIT 52`,
    [USER_ID]
  );

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24 pt-10">
      <div className="mb-8 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          Mission Debriefs
        </span>
        <span className="label">one report per completed week</span>
      </div>

      {rows.length === 0 && (
        <div className="panel px-6 py-12 text-center">
          <p className="mono" style={{ color: "var(--text-bright)", letterSpacing: ".1em" }}>
            NO COMPLETED WEEKS ON RECORD
          </p>
          <p className="mt-3" style={{ color: "var(--dim)", maxWidth: "48ch", margin: "0 auto" }}>
            The first debrief compiles automatically once your first full
            mission week (Monday–Sunday) is behind you.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {rows.map((w) => (
          <article key={w.week_start} className="panel px-5 py-4">
            <header className="flex flex-wrap items-baseline gap-4 border-b pb-2" style={{ borderColor: "var(--line-dim)" }}>
              <span className="mono text-sm" style={{ color: "var(--amber)", letterSpacing: ".18em" }}>
                MISSION WEEK {String(w.mission_week).padStart(2, "0")}
              </span>
              <span className="label">
                {w.week_start} → {w.week_end} · {w.entry_count} entries
                {w.spend > 0 && ` · ≈$${w.spend.toFixed(2)} agent time`}
              </span>
              {w.mood && <span className="chip cyan ml-auto">{w.mood}</span>}
            </header>
            {w.recap_uri && (
              <div className="mt-3 overflow-hidden" style={{ border: "1px solid var(--line-dim)" }}>
                <video
                  src={`/api/recaps/${w.week_start}`}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full"
                  style={{ maxHeight: 360, background: "#000" }}
                />
              </div>
            )}
            {w.summary && (
              <p className="mt-3" style={{ color: "var(--text)", maxWidth: "68ch" }}>
                {w.summary}
              </p>
            )}
            {!!w.highlights?.length && (
              <ul className="mt-3 flex flex-col gap-1">
                {w.highlights.map((h, i) => (
                  <li key={i} className="text-sm" style={{ color: "var(--text-bright)" }}>
                    <span className="mono mr-2" style={{ color: "var(--amber)" }}>▸</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
            {w.patterns && (
              <p className="mt-3 border-l-2 pl-3 text-sm" style={{ borderColor: "var(--cyan)", color: "var(--dim)" }}>
                <span className="label mr-2" style={{ color: "var(--cyan)" }}>
                  Patterns
                </span>
                {w.patterns}
              </p>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
