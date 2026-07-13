import Link from "next/link";
import { db, USER_ID } from "@/lib/db";

export const dynamic = "force-dynamic";

type Topic = {
  id: string;
  chapter: string;
  prompt: string;
  status: string;
  entry_id: string | null;
  completed_at: string | null;
};

export default async function StoryPage() {
  const { rows } = await db.query<Topic>(
    `SELECT id, chapter, prompt, status, entry_id, completed_at::date::text AS completed_at
     FROM story_topics WHERE user_id = $1 ORDER BY ord`,
    [USER_ID]
  );
  const done = rows.filter((t) => t.status === "done").length;
  const chapters = new Map<string, Topic[]>();
  for (const t of rows) {
    if (!chapters.has(t.chapter)) chapters.set(t.chapter, []);
    chapters.get(t.chapter)!.push(t);
  }
  const next = rows.find((t) => t.status === "pending");

  return (
    <main className="mx-auto max-w-3xl px-5 pb-24 pt-10">
      <div className="mb-3 flex items-baseline gap-4 border-b pb-3" style={{ borderColor: "var(--line)" }}>
        <span className="label" style={{ color: "var(--amber)" }}>
          Life Story
        </span>
        <span className="label">
          {done}/{rows.length} chapters of your autobiography recorded
        </span>
      </div>
      <p className="mb-2 max-w-prose text-sm" style={{ color: "var(--dim)" }}>
        A long-form interview Memento conducts with you over weeks. Say
        “story time” in any live session and it will ask the next question —
        or just record a video entry telling one of these stories; the log
        recognizes it.
      </p>
      {next && (
        <div className="callout-like panel mb-8 px-4 py-3" style={{ borderColor: "var(--line)" }}>
          <span className="label" style={{ color: "var(--cyan)" }}>Next up · {next.chapter}</span>
          <p className="mt-1" style={{ color: "var(--text-bright)" }}>{next.prompt}</p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {[...chapters.entries()].map(([chapter, topics]) => (
          <section key={chapter}>
            <h2 className="label mb-2" style={{ color: "var(--cyan)" }}>
              {chapter} · {topics.filter((t) => t.status === "done").length}/{topics.length}
            </h2>
            <div className="flex flex-col gap-1">
              {topics.map((t) => (
                <div
                  key={t.id}
                  className="panel flex items-baseline gap-3 px-4 py-2.5"
                  style={{ opacity: t.status === "done" ? 1 : 0.75 }}
                >
                  <span
                    className="mono text-xs"
                    style={{ color: t.status === "done" ? "var(--amber)" : "var(--dim)" }}
                  >
                    {t.status === "done" ? "▣" : "▢"}
                  </span>
                  <span className="flex-1 text-sm" style={{ color: t.status === "done" ? "var(--text-bright)" : "var(--text)" }}>
                    {t.prompt}
                  </span>
                  {t.entry_id && (
                    <Link href={`/entry/${t.entry_id}`} className="label whitespace-nowrap">
                      ▶ {t.completed_at}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
