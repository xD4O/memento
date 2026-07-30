import Link from "next/link";
import { db, USER_ID } from "@/lib/db";
import ArchiveOrbit from "@/components/ArchiveOrbit";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  kind: string;
  status: string;
  recorded_at: Date;
  sol: number;
  duration_s: number | null;
  title: string | null;
  summary: string | null;
  thumb_uri: string | null;
};

type Stats = {
  records: number;
  sol: number | null;
  min_sol: number | null;
  max_sol: number | null;
  logged_days: number;
  pending: number;
  errored: number;
  media_objects: number;
  spend: number;
  capsules: number;
  open_threads: number;
};

type Thread = { id: string; title: string; detail: string | null; age: number };
type Concept = { id: string; name: string; n: number };

const GLYPH: Record<string, string> = {
  video_log: "▛",
  audio_log: "◉",
  live_session: "◈",
};

function fmtDuration(s: number | null) {
  if (s == null) return "--:--";
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(
    Math.floor(s % 60)
  ).padStart(2, "0")}`;
}

function fmtWhen(d: Date) {
  return d.toISOString().slice(0, 16).replace("T", " · ") + "Z";
}

function StatusChip({ status }: { status: string }) {
  if (status === "indexed") return <span className="chip dim">indexed</span>;
  if (status === "error") return <span className="chip red">error</span>;
  if (status === "created") return <span className="chip dim">awaiting upload</span>;
  return <span className="chip pulse">{status}</span>;
}

export default async function Timeline() {
  const [entries, statsQ, threadsQ, conceptsQ] = await Promise.all([
    db.query<Row>(
      `SELECT e.id, e.kind, e.status, e.recorded_at, e.sol, e.duration_s,
              e.title, e.summary, e.thumb_uri
         FROM entries e
        WHERE e.user_id = $1 AND e.deleted_at IS NULL AND e.archived_at IS NULL
          AND e.status <> 'sealed'
        ORDER BY e.recorded_at DESC
        LIMIT 200`,
      [USER_ID]
    ),
    db.query<Stats>(
      `SELECT (SELECT count(*)::int FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
                  AND status <> 'sealed') AS records,
              (SELECT (current_date - journal_started_on) + 1 FROM users WHERE id = $1) AS sol,
              (SELECT min(sol) FROM entries WHERE user_id = $1 AND deleted_at IS NULL) AS min_sol,
              (SELECT max(sol) FROM entries WHERE user_id = $1 AND deleted_at IS NULL) AS max_sol,
              (SELECT count(DISTINCT recorded_at::date)::int FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL) AS logged_days,
              (SELECT count(*)::int FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL
                  AND status IN ('created', 'uploaded', 'transcribing')) AS pending,
              (SELECT count(*)::int FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL AND status = 'error') AS errored,
              (SELECT count(*)::int FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL AND media_uri IS NOT NULL) AS media_objects,
              (SELECT COALESCE(round(sum(cost_usd)::numeric, 2), 0)::float FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL) AS spend,
              (SELECT count(*)::int FROM entries
                WHERE user_id = $1 AND deleted_at IS NULL AND status = 'sealed') AS capsules,
              (SELECT count(*)::int FROM threads
                WHERE user_id = $1 AND deleted_at IS NULL AND status = 'open') AS open_threads`,
      [USER_ID]
    ),
    db.query<Thread>(
      `SELECT id, title, detail, (current_date - updated_at::date) AS age
         FROM threads
        WHERE user_id = $1 AND deleted_at IS NULL AND status = 'open'
        ORDER BY updated_at DESC LIMIT 4`,
      [USER_ID]
    ),
    db.query<Concept>(
      `SELECT c.id, c.name, count(*)::int AS n
         FROM concepts c
         JOIN entry_concepts ec ON ec.concept_id = c.id
         JOIN entries e ON e.id = ec.entry_id AND e.deleted_at IS NULL
        WHERE c.user_id = $1
        GROUP BY c.id, c.name
        ORDER BY n DESC, c.name
        LIMIT 5`,
      [USER_ID]
    ),
  ]);

  const rows = entries.rows;
  const s = statsQ.rows[0];
  const threads = threadsQ.rows;
  const concepts = conceptsQ.rows;
  const topN = concepts[0]?.n ?? 1;
  const coverage = s?.sol ? Math.round((s.logged_days / s.sol) * 100) : 0;

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Mission Timeline</h1>
        <span className="sub">
          {s?.records ?? 0} record{s?.records === 1 ? "" : "s"} on file
          {s?.min_sol != null && s?.max_sol != null && (
            <> · Sol {String(s.min_sol).padStart(3, "0")} → Sol {String(s.max_sol).padStart(3, "0")}</>
          )}
        </span>
        <span className="spacer" />
        {!!s?.capsules && (
          <span className="chip cyan">
            ◍ {s.capsules} capsule{s.capsules > 1 ? "s" : ""} in transit
          </span>
        )}
        <a className="btn" href="/api/export">
          ↓ Export archive
        </a>
      </div>

      <div className="split">
        {rows.length === 0 ? (
          <div className="panel flex flex-col items-center gap-5 px-6 py-16 text-center">
            <p className="mono" style={{ color: "var(--text-bright)", letterSpacing: ".1em" }}>
              NO ENTRIES ON RECORD
            </p>
            <p style={{ color: "var(--dim)", maxWidth: "42ch" }}>
              The log is empty. Record your first entry — one honest minute is
              enough to start the mission.
            </p>
            <Link className="btn" href="/record">
              ● Begin Entry 001
            </Link>
          </div>
        ) : (
          <div className="panel" style={{ padding: "4px 16px 6px" }}>
            {rows.map((e) => (
              <Link key={e.id} href={`/entry/${e.id}`} className="rec">
                <span className="rec-tick">
                  <span className="bar" />
                  <span className="rec-sol">{String(e.sol).padStart(3, "0")}</span>
                </span>

                <span className={`plate k-${e.kind}`}>
                  {e.thumb_uri ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/entries/${e.id}/thumb`} alt="" />
                  ) : (
                    <span className="glyph">{GLYPH[e.kind] ?? "▛"}</span>
                  )}
                </span>

                <span className="rec-body">
                  <span className="rec-title">{e.title ?? "Untitled entry"}</span>
                  {e.summary && <span className="rec-snip">{e.summary}</span>}
                </span>

                <span className="rec-meta">
                  <span className="stamp">{fmtWhen(new Date(e.recorded_at))}</span>
                  <span className="stamp dur">{fmtDuration(e.duration_s)}</span>
                  <StatusChip status={e.status} />
                </span>
              </Link>
            ))}
          </div>
        )}

        <aside className="tel">
          <section className="panel warm" style={{ padding: "14px 16px 16px" }}>
            <div className="panel-hd warm">
              <span className="label">Archive orbit</span>
              <span className="spacer" />
              <span className="label" style={{ color: "var(--cyan)" }}>
                {s?.records ?? 0} rec
              </span>
            </div>
            <ArchiveOrbit records={s?.records ?? 0} />
            <div className="kv">
              <span className="label">Period covered</span>
              <span className="v">{s?.sol ?? 0}d</span>
            </div>
            <div className="kv">
              <span className="label">Coverage</span>
              <span className="v ice">{coverage}%</span>
            </div>
            <div className="meter" style={{ marginTop: 6 }}>
              <i style={{ width: `${Math.min(100, coverage)}%` }} />
            </div>
          </section>

          <section className="panel" style={{ padding: "14px 16px 16px" }}>
            <div className="panel-hd">
              <span className="label">Systems</span>
            </div>
            <div className="kv">
              <span className="label">Transcription</span>
              {s?.errored ? (
                <span className="v crit">{s.errored} failed</span>
              ) : (
                <span className="v ok">Nominal</span>
              )}
            </div>
            <div className="kv">
              <span className="label">Indexing queue</span>
              {s?.pending ? (
                <span className="v sig">{s.pending} pending</span>
              ) : (
                <span className="v">Clear</span>
              )}
            </div>
            <div className="kv">
              <span className="label">Media objects</span>
              <span className="v">{s?.media_objects ?? 0}</span>
            </div>
            <div className="kv">
              <span className="label">Agent spend</span>
              <span className="v">${(s?.spend ?? 0).toFixed(2)}</span>
            </div>
          </section>

          <section className="panel" style={{ padding: "14px 16px 16px" }}>
            <div className="panel-hd">
              <span className="label">Open threads</span>
              <span className="spacer" />
              <span className="label">{s?.open_threads ?? 0} active</span>
            </div>

            {threads.length === 0 && (
              <p className="label" style={{ whiteSpace: "normal", paddingBottom: 8 }}>
                No open loops. The agent opens one when you leave something unfinished.
              </p>
            )}
            {threads.map((t) => (
              <Link key={t.id} href="/profile" className="thread">
                <span className="top">
                  <span className="nm">{t.title}</span>
                  <span className="ct">{t.age}d</span>
                </span>
                {t.detail && <span className="why">{t.detail}</span>}
              </Link>
            ))}

            {concepts.length > 0 && (
              <>
                <div
                  className="label"
                  style={{ paddingTop: 12, marginTop: 4, borderTop: "1px solid var(--hair)" }}
                >
                  Recurring
                </div>
                {concepts.map((c) => (
                  <Link key={c.id} href={`/catalog/${c.id}`} className="thread">
                    <span className="top">
                      <span className="nm">{c.name}</span>
                      <span className="ct">{c.n}</span>
                    </span>
                    <span className="meter">
                      <i style={{ width: `${Math.round((c.n / topN) * 100)}%` }} />
                    </span>
                  </Link>
                ))}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
