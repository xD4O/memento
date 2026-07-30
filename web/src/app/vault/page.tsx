"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  id: string;
  sol: number;
  kind: string;
  status: string;
  title: string | null;
  summary: string | null;
  recorded_at: string;
  duration_s: number | null;
  deleted_at?: string;
  archived_at?: string;
};

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

function daysAgo(iso?: string) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
}

export default function VaultPage() {
  const [trash, setTrash] = useState<Row[]>([]);
  const [archive, setArchive] = useState<Row[]>([]);
  const [tab, setTab] = useState<"trash" | "archive">("trash");
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/vault", { cache: "no-store" });
    const d = await res.json();
    setTrash(d.trash ?? []);
    setArchive(d.archive ?? []);
    setSel(new Set());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: string, label: string) => {
    setBusy(id);
    setNote(null);
    try {
      const res = await fetch(`/api/entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      setNote(res.ok ? label : (d.error ?? "That didn't work."));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const purge = async () => {
    const ids = [...sel];
    if (ids.length === 0) return;
    const ok = window.confirm(
      `Permanently delete ${ids.length} ${ids.length === 1 ? "entry" : "entries"}?\n\n` +
        "This removes the transcript, the video or audio file, and the entry " +
        "itself. It cannot be undone."
    );
    if (!ok) return;
    setPurging(true);
    setNote(null);
    try {
      const res = await fetch("/api/vault/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const d = await res.json().catch(() => ({}));
      setNote(
        res.ok
          ? `Permanently deleted ${d.purged} ${d.purged === 1 ? "entry" : "entries"}` +
            (d.objects ? ` and ${d.objects} media file${d.objects === 1 ? "" : "s"}.` : ".")
          : (d.error ?? "Purge failed.")
      );
      await load();
    } finally {
      setPurging(false);
    }
  };

  const rows = tab === "trash" ? trash : archive;
  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Vault</h1>
        <span className="sub">Off the timeline · still on disk</span>
        <span className="spacer" />
        <button
          className={tab === "trash" ? "chip" : "chip dim"}
          onClick={() => setTab("trash")}
        >
          Trash · {trash.length}
        </button>
        <button
          className={tab === "archive" ? "chip" : "chip dim"}
          onClick={() => setTab("archive")}
        >
          Archive · {archive.length}
        </button>
      </div>

      <p className="prose" style={{ marginBottom: 16, fontSize: ".9rem" }}>
        {tab === "trash"
          ? "Deleted entries are kept, not destroyed — restoring one puts it straight back on the timeline. The media file was never removed from storage."
          : "Archived entries stay in the log and stay searchable; they just don't crowd the timeline. Send one back whenever you want."}
      </p>

      {tab === "trash" && rows.length > 0 && (
        <div
          className="panel mb-3"
          style={{ padding: "9px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
              }
              style={{ accentColor: "var(--amber)" }}
            />
            <span className="label">{allSelected ? "Clear all" : "Select all"}</span>
          </label>
          <span className="label">{sel.size} selected</span>
          <span className="spacer" />
          {sel.size > 0 && (
            <button className="chip ok" onClick={() => setSel(new Set())}>
              Cancel
            </button>
          )}
          <button
            className="btn danger"
            style={{ padding: ".35em .9em" }}
            disabled={sel.size === 0 || purging}
            onClick={purge}
          >
            {purging ? "Deleting…" : `✕ Delete forever${sel.size ? ` (${sel.size})` : ""}`}
          </button>
        </div>
      )}

      {note && (
        <p className="label" style={{ color: "var(--ok)", marginBottom: 12 }}>
          {note}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="panel" style={{ padding: "48px 24px", textAlign: "center" }}>
          <p className="mono" style={{ color: "var(--text-bright)", letterSpacing: ".1em" }}>
            {tab === "trash" ? "TRASH IS EMPTY" : "NOTHING ARCHIVED"}
          </p>
          <p style={{ color: "var(--dim)", maxWidth: "46ch", margin: "12px auto 0" }}>
            {tab === "trash"
              ? "Nothing has been deleted. Anything you delete lands here and can be put back."
              : "Archive an entry from its page to move it off the timeline without deleting it."}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: "4px 16px 6px" }}>
          {rows.map((e) => (
            <div
              key={e.id}
              className="rec"
              style={sel.has(e.id) ? { background: "rgba(255,90,95,.07)" } : undefined}
            >
              <span className="rec-tick">
                {tab === "trash" ? (
                  <input
                    type="checkbox"
                    checked={sel.has(e.id)}
                    onChange={() => toggle(e.id)}
                    aria-label={`Select ${e.title ?? "untitled entry"}`}
                    style={{ accentColor: "var(--amber)", flex: "0 0 auto" }}
                  />
                ) : (
                  <span className="bar" />
                )}
                <span className="rec-sol">{String(e.sol).padStart(3, "0")}</span>
              </span>

              <span className={`plate k-${e.kind}`}>
                <span className="glyph">{GLYPH[e.kind] ?? "▛"}</span>
              </span>

              <span className="rec-body">
                <span className="rec-title">{e.title ?? "Untitled entry"}</span>
                <span className="rec-snip">
                  {e.summary ??
                    `${tab === "trash" ? "Deleted" : "Archived"} ${daysAgo(
                      tab === "trash" ? e.deleted_at : e.archived_at
                    )}`}
                </span>
              </span>

              <span className="rec-meta">
                <span className="stamp">
                  {new Date(e.recorded_at).toISOString().slice(0, 10)}
                </span>
                <span className="stamp dur">{fmtDuration(e.duration_s)}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  {tab === "trash" ? (
                    <button
                      className="chip ok"
                      disabled={busy === e.id}
                      onClick={() => act(e.id, "restore", "Restored to the timeline.")}
                    >
                      ↩ Restore
                    </button>
                  ) : (
                    <>
                      <Link className="chip dim" href={`/entry/${e.id}`}>
                        Open
                      </Link>
                      <button
                        className="chip ok"
                        disabled={busy === e.id}
                        onClick={() =>
                          act(e.id, "unarchive", "Back on the timeline.")
                        }
                      >
                        ↩ Unarchive
                      </button>
                    </>
                  )}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
