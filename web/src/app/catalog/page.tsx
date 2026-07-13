import Link from "next/link";
import { db, USER_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

const KIND_ORDER = ["person", "place", "project", "idea", "theme", "emotion", "other"];
const KIND_LABEL: Record<string, string> = {
  person: "People",
  place: "Places",
  project: "Projects",
  idea: "Ideas",
  theme: "Themes",
  emotion: "Emotions",
  other: "Other",
};

type Row = { id: string; name: string; kind: string; entry_count: number };

export default async function CatalogPage() {
  const { rows } = await db.query<Row>(
    `SELECT c.id, c.name, c.kind, count(ec.entry_id)::int AS entry_count
     FROM concepts c
     JOIN entry_concepts ec ON ec.concept_id = c.id
     JOIN entries e ON e.id = ec.entry_id AND e.deleted_at IS NULL
     WHERE c.user_id = $1
     GROUP BY c.id
     ORDER BY count(ec.entry_id) DESC, c.name`,
    [USER_ID]
  );

  const byKind = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }

  return (
    <main className="mx-auto max-w-4xl px-5 pb-24 pt-10">
      <div className="mb-8 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          Concept Catalog
        </span>
        <span className="label">
          {rows.length} concepts flagged across the log
        </span>
      </div>

      {rows.length === 0 && (
        <p style={{ color: "var(--dim)", maxWidth: "48ch" }}>
          Nothing cataloged yet. Concepts appear here automatically as entries
          are indexed — the people, projects, and ideas your log keeps
          returning to.
        </p>
      )}

      <div className="flex flex-col gap-8">
        {KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => (
          <section key={kind}>
            <h2 className="label mb-3" style={{ color: "var(--cyan)" }}>
              {KIND_LABEL[kind]} · {byKind.get(kind)!.length}
            </h2>
            <div className="flex flex-wrap gap-2">
              {byKind.get(kind)!.map((c) => (
                <Link
                  key={c.id}
                  href={`/catalog/${c.id}`}
                  className="panel px-3 py-1.5 text-sm transition-colors hover:border-[var(--line)]"
                  style={{ color: "var(--text-bright)" }}
                >
                  {c.name}
                  <span className="mono ml-2 text-xs" style={{ color: "var(--dim)" }}>
                    {c.entry_count}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
