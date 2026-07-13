import Link from "next/link";
import { db, USER_ID } from "@/lib/db";

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
  segment_count: number;
};

function fmtDuration(s: number | null) {
  if (s == null) return "--:--";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function fmtWhen(d: Date) {
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
}

function StatusChip({ status }: { status: string }) {
  if (status === "indexed") return <span className="chip dim">indexed</span>;
  if (status === "error") return <span className="chip red">error</span>;
  if (status === "created") return <span className="chip dim">awaiting upload</span>;
  return <span className="chip pulse">{status}</span>;
}

export default async function Timeline() {
  const { rows } = await db.query<Row>(
    `SELECT e.id, e.kind, e.status, e.recorded_at, e.sol, e.duration_s, e.title,
            e.summary, e.thumb_uri,
            (SELECT count(*)::int FROM segments s WHERE s.entry_id = e.id) AS segment_count
     FROM entries e
     WHERE e.user_id = $1 AND e.deleted_at IS NULL AND e.status <> 'sealed'
     ORDER BY e.recorded_at DESC
     LIMIT 200`,
    [USER_ID]
  );
  const capsules = await db.query(
    `SELECT count(*)::int AS n, min(deliver_on)::text AS next
     FROM entries
     WHERE user_id = $1 AND deleted_at IS NULL AND status = 'sealed'`,
    [USER_ID]
  );
  const capsule = capsules.rows[0];

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24 pt-10">
      <div className="mb-8 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          Mission Timeline
        </span>
        <span className="label">
          {rows.length} {rows.length === 1 ? "entry" : "entries"} on record
        </span>
        {capsule?.n > 0 && (
          <span className="chip cyan" title={`next delivery ${capsule.next}`}>
            ◍ {capsule.n} capsule{capsule.n > 1 ? "s" : ""} in transit
          </span>
        )}
        <a className="label ml-auto" href="/api/export">
          ⬇ Export Archive
        </a>
      </div>

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
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <li key={e.id}>
              <Link
                href={`/entry/${e.id}`}
                className="panel flex items-center gap-4 px-3 py-2.5 transition-colors hover:border-[var(--line)]"
              >
                <span
                  className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden"
                  style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)" }}
                >
                  {e.thumb_uri ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/entries/${e.id}/thumb`}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="mono text-lg" style={{ color: e.kind === "live_session" ? "var(--cyan)" : "var(--dim)" }}>
                      {e.kind === "audio_log" ? "◉" : e.kind === "live_session" ? "◈" : "▛"}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                    <span className="mono text-xs" style={{ color: "var(--amber)", letterSpacing: ".15em" }}>
                      SOL {String(e.sol).padStart(3, "0")}
                    </span>
                    <span className="truncate" style={{ color: "var(--text-bright)" }}>
                      {e.title ?? "Untitled entry"}
                    </span>
                  </span>
                  {e.summary && (
                    <span className="mt-0.5 block truncate text-sm" style={{ color: "var(--dim)" }}>
                      {e.summary}
                    </span>
                  )}
                </span>
                <span className="hidden flex-col items-end gap-1 sm:flex">
                  <span className="label">{fmtWhen(new Date(e.recorded_at))}</span>
                  <span className="mono text-xs" style={{ color: "var(--dim)" }}>
                    {fmtDuration(e.duration_s)}
                  </span>
                </span>
                <StatusChip status={e.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
