import Link from "next/link";
import { db, USER_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ConceptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const concept = (
    await db.query(
      `SELECT name, kind FROM concepts WHERE id = $1 AND user_id = $2`,
      [id, USER_ID]
    )
  ).rows[0];

  if (!concept)
    return (
      <main className="mx-auto max-w-4xl px-5 pt-16">
        <p className="mono" style={{ color: "var(--red)" }}>CONCEPT NOT FOUND</p>
      </main>
    );

  const { rows: entries } = await db.query(
    `SELECT e.id, e.sol, e.title, e.summary, e.recorded_at, e.thumb_uri, e.kind,
            ec.salience
     FROM entry_concepts ec
     JOIN entries e ON e.id = ec.entry_id
     WHERE ec.concept_id = $1 AND e.user_id = $2 AND e.deleted_at IS NULL
     ORDER BY e.recorded_at DESC`,
    [id, USER_ID]
  );

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24 pt-10">
      <div className="mb-8 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <Link href="/catalog" className="label">
          ← Catalog
        </Link>
        <span className="mono" style={{ color: "var(--text-bright)", letterSpacing: ".08em" }}>
          {concept.name}
        </span>
        <span className="chip cyan">{concept.kind}</span>
        <span className="label ml-auto">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id}>
            <Link
              href={`/entry/${e.id}`}
              className="panel flex items-center gap-4 px-3 py-2.5 transition-colors hover:border-[var(--line)]"
            >
              <span
                className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line-dim)" }}
              >
                {e.thumb_uri ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/entries/${e.id}/thumb`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="mono" style={{ color: "var(--dim)" }}>
                    {e.kind === "audio_log" ? "◉" : "▛"}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-3">
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
              <span className="label">
                {new Date(e.recorded_at).toISOString().slice(0, 10)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
