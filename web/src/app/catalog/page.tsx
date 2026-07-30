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
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Concept Catalog</h1>
        <span className="sub">
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
          <section key={kind} className="panel" style={{ padding: "14px 16px 16px" }}>
            <div className="panel-hd">
              <span className="label">{KIND_LABEL[kind]}</span>
              <span className="spacer" />
              <span className="label">{byKind.get(kind)!.length}</span>
            </div>
            <div className="tag-cloud">
              {byKind.get(kind)!.map((c) => (
                <Link
                  key={c.id}
                  href={`/catalog/${c.id}`}
                  className={`tag k-${c.kind}`}
                >
                  {c.name}
                  <span className="n">{c.entry_count}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
