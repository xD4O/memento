import { db, USER_ID } from "@/lib/db";
import { DayBars, MoodStrip, HBars } from "@/components/charts";
import { CHART } from "@/lib/mood";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const [perDay, moods, todayMood, tiles, topConcepts] = await Promise.all([
    db.query(
      `SELECT g.d::date::text AS day,
              count(e.id)::int AS entries,
              COALESCE(round((sum(e.duration_s) / 60.0)::numeric, 1), 0)::float AS minutes
       FROM generate_series(current_date - 29, current_date, '1 day') g(d)
       LEFT JOIN entries e ON e.user_id = $1 AND e.deleted_at IS NULL
         AND e.status = 'indexed' AND e.recorded_at::date = g.d::date
       GROUP BY g.d ORDER BY g.d`,
      [USER_ID]
    ),
    db.query(
      `SELECT day::text, mood FROM daily_summaries
       WHERE user_id = $1 AND day >= current_date - 29`,
      [USER_ID]
    ),
    db.query(
      `SELECT mood FROM entries
       WHERE user_id = $1 AND deleted_at IS NULL AND mood IS NOT NULL
         AND recorded_at::date = current_date
       ORDER BY recorded_at DESC LIMIT 1`,
      [USER_ID]
    ),
    db.query(
      `SELECT (SELECT (current_date - journal_started_on) + 1 FROM users WHERE id = $1) AS sol,
              (SELECT count(*)::int FROM entries WHERE user_id = $1 AND deleted_at IS NULL) AS entries,
              (SELECT COALESCE(round(sum(duration_s) / 60.0)::int, 0) FROM entries
                 WHERE user_id = $1 AND deleted_at IS NULL) AS minutes,
              (SELECT count(*)::int FROM segments s JOIN entries e ON e.id = s.entry_id
                 WHERE e.user_id = $1 AND e.deleted_at IS NULL) AS segments,
              (SELECT count(*)::int FROM concepts WHERE user_id = $1) AS concepts,
              (SELECT COALESCE(round(sum(cost_usd)::numeric, 2), 0)::float FROM entries
                 WHERE user_id = $1 AND deleted_at IS NULL) AS cost`,
      [USER_ID]
    ),
    db.query(
      `SELECT c.id, c.name, count(*)::int AS n
       FROM concepts c JOIN entry_concepts ec ON ec.concept_id = c.id
       JOIN entries e ON e.id = ec.entry_id AND e.deleted_at IS NULL
       WHERE c.user_id = $1
       GROUP BY c.id ORDER BY n DESC, c.name LIMIT 8`,
      [USER_ID]
    ),
  ]);

  const moodByDay = new Map(moods.rows.map((m) => [m.day, m.mood]));
  const days = perDay.rows as { day: string; entries: number; minutes: number }[];
  const today = days[days.length - 1]?.day;
  const moodData = days.map((d) => ({
    day: d.day,
    mood:
      moodByDay.get(d.day) ??
      (d.day === today ? (todayMood.rows[0]?.mood ?? null) : null),
    provisional: d.day === today && !moodByDay.has(d.day),
  }));

  // streak: consecutive days with entries, counting back from today/yesterday
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].entries > 0) streak++;
    else if (i === days.length - 1) continue; // today can still be pending
    else break;
  }

  const t = tiles.rows[0];
  const tileData = [
    { v: `SOL ${String(t.sol).padStart(3, "0")}`, l: "mission day" },
    { v: String(streak), l: "day streak" },
    { v: String(t.entries), l: "entries" },
    { v: `${t.minutes}m`, l: "logged time" },
    { v: String(t.concepts), l: "concepts" },
    { v: `$${t.cost.toFixed(2)}`, l: "session spend" },
  ];

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Mission Stats</h1>
        <span className="label">last 30 days</span>
      </div>

      <div className="tiles">
        {tileData.map((x, i) => (
          <div key={x.l} className="panel tile">
            <div className={`v${i === 1 ? " sig" : i === 3 ? " ice" : ""}`}>{x.v}</div>
            <div className="label k">{x.l}</div>
          </div>
        ))}
      </div>

      <div className="chart-row">
        <section className="panel" style={{ padding: "14px 16px 16px" }}>
          <div className="label mb-3" style={{ color: "var(--amber)" }}>
            Entries per day
          </div>
          <DayBars
            data={days.map((d) => ({ day: d.day, value: d.entries }))}
            color={CHART.amber}
            unit="entries"
          />
        </section>

        <section className="panel" style={{ padding: "14px 16px 16px" }}>
          <div className="label mb-3" style={{ color: "var(--amber)" }}>
            Minutes logged per day
          </div>
          <DayBars
            data={days.map((d) => ({ day: d.day, value: d.minutes }))}
            color={CHART.cyan}
            unit="min"
          />
        </section>

        <section className="panel" style={{ padding: "14px 16px 16px", gridColumn: "1 / -1" }}>
          <div className="label mb-3" style={{ color: "var(--amber)" }}>
            Mood — day by day
          </div>
          <MoodStrip data={moodData} />
        </section>

        <section className="panel" style={{ padding: "14px 16px 16px", gridColumn: "1 / -1" }}>
          <div className="label mb-3" style={{ color: "var(--amber)" }}>
            What the log keeps returning to
          </div>
          <HBars
            data={topConcepts.rows.map((c) => ({
              label: c.name,
              value: c.n,
              href: `/catalog/${c.id}`,
            }))}
            color={CHART.violet}
            onClickHref
          />
        </section>
      </div>

      <details className="mt-6">
        <summary className="label" style={{ cursor: "pointer" }}>
          data table
        </summary>
        <div className="tablewrap mt-2" style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: ".82rem" }}>
            <thead>
              <tr>
                {["day", "entries", "minutes", "mood"].map((h) => (
                  <th key={h} className="label px-3 py-1 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d.day}>
                  <td className="mono px-3 py-0.5" style={{ color: "var(--dim)" }}>{d.day}</td>
                  <td className="mono px-3 py-0.5">{d.entries}</td>
                  <td className="mono px-3 py-0.5">{d.minutes}</td>
                  <td className="px-3 py-0.5" style={{ color: "var(--dim)" }}>{moodData[i].mood ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
