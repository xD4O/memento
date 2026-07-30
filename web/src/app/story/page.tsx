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
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Life Story</h1>
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
        <div className="q-row next-up mb-8" style={{ padding: "15px 18px" }}>
          <span className="box" style={{ color: "var(--cyan)" }}>▸</span>
          <div>
            <span className="label" style={{ color: "var(--cyan)", display: "block", marginBottom: 5 }}>
              Next up · {next.chapter}
            </span>
            <span className="qt">{next.prompt}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {[...chapters.entries()].map(([chapter, topics]) => (
          <section key={chapter}>
            <h2 className="label mb-2" style={{ color: "var(--amber)" }}>
              {chapter} · {topics.filter((t) => t.status === "done").length}/{topics.length}
            </h2>
            <div className="flex flex-col gap-1">
              {topics.map((t) => (
                <div
                  key={t.id}
                  className={`q-row${t.status === "done" ? " done" : ""}`}
                  style={{ opacity: t.status === "done" ? 1 : 0.75 }}
                >
                  <span
                    className="box"
                    style={{ color: t.status === "done" ? "var(--amber)" : "var(--dim)" }}
                  >
                    {t.status === "done" ? "▣" : "▢"}
                  </span>
                  <span className="qt flex-1">
                    {t.prompt}
                  </span>
                  {t.entry_id && (
                    <Link href={`/entry/${t.entry_id}`} className="when">
                      ▶ {t.completed_at}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
