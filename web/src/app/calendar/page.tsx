"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type DayCell = {
  day: string;
  entry_count: number;
  kinds: string[];
  mood: string | null;
  has_summary: boolean;
};

type PinDay = { day: string; pin_count: number; has_overdue: boolean };
type DayPin = {
  id: string;
  kind: string;
  text: string;
  status: string;
  overdue: boolean;
};

type DayEntry = {
  id: string;
  kind: string;
  status: string;
  sol: number;
  title: string | null;
  summary: string | null;
  mood: string | null;
  thumb_uri: string | null;
  at: string;
};

type DayReport = {
  summary: string | null;
  highlights: string[] | null;
  mood: string | null;
  updated_at: string;
} | null;

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function monthStr(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

const KIND_GLYPH: Record<string, { glyph: string; color: string }> = {
  video_log: { glyph: "▮", color: "var(--amber)" },
  audio_log: { glyph: "◉", color: "var(--cyan)" },
  live_session: { glyph: "◈", color: "var(--cyan)" },
};

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [cells, setCells] = useState<Map<string, DayCell>>(new Map());
  const [pinDays, setPinDays] = useState<Map<string, PinDay>>(new Map());
  const [dayPins, setDayPins] = useState<DayPin[]>([]);
  const [today, setToday] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
  const [report, setReport] = useState<DayReport>(null);
  const [daySol, setDaySol] = useState<number | null>(null);
  const [pendingSummary, setPendingSummary] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/calendar?month=${monthStr(year, month)}`);
      const data = await res.json();
      setCells(new Map((data.days as DayCell[]).map((d) => [d.day, d])));
      setPinDays(new Map((data.pinDays as PinDay[]).map((d) => [d.day, d])));
      setToday(data.today ?? "");
    })();
  }, [year, month]);

  const openDay = useCallback(async (date: string) => {
    setSelected(date);
    setLoadingDay(true);
    try {
      const res = await fetch(`/api/day/${date}`);
      const data = await res.json();
      setDayEntries(data.entries);
      setDayPins(data.pins ?? []);
      setReport(data.report);
      setDaySol(data.sol);
      setPendingSummary(data.pendingSummary);
    } finally {
      setLoadingDay(false);
    }
  }, []);

  const nav = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(null);
  };

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      `${monthStr(year, month)}-${String(i + 1).padStart(2, "0")}`
    ),
  ];

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Mission Calendar</h1>
        <span className="ml-auto flex items-center gap-4">
          <button className="btn" style={{ padding: ".25em .8em" }} onClick={() => nav(-1)}>
            ‹
          </button>
          <span className="mono text-sm" style={{ color: "var(--text-bright)", letterSpacing: ".22em" }}>
            {MONTHS[month]} {year}
          </span>
          <button className="btn" style={{ padding: ".25em .8em" }} onClick={() => nav(1)}>
            ›
          </button>
        </span>
      </div>

      <div className="split wide">
        <div>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-dow">
                {w}
              </div>
            ))}
          </div>
          <div className="cal-grid">
            {grid.map((date, i) => {
              if (!date) return <div key={`x${i}`} className="day void" aria-hidden="true" />;
              const cell = cells.get(date);
              const pd = pinDays.get(date);
              const isToday = date === today;
              const isSel = date === selected;
              return (
                <button
                  key={date}
                  onClick={() => openDay(date)}
                  className={
                    "day" +
                    (cell ? "" : " empty") +
                    (isToday ? " today" : "") +
                    (isSel ? " sel" : "") +
                    (cell?.mood ? " m-pos" : "")
                  }
                  style={{ cursor: "pointer" }}
                >
                  <span className="day-top">
                    <span className="dnum">
                      {String(Number(date.slice(-2))).padStart(2, "0")}
                    </span>
                    {pd && (
                      <span
                        className="due-flag"
                        style={{ color: pd.has_overdue ? "var(--crit)" : "var(--cyan)" }}
                        title={`${pd.pin_count} reminder(s) due`}
                      >
                        ◪{pd.pin_count > 1 ? pd.pin_count : ""}
                      </span>
                    )}
                  </span>
                  {cell && (
                    <>
                      <span className="day-marks">
                        {cell.kinds.slice(0, 3).map((k) => (
                          <i key={k} className={`mk-${k}`} title={k.replace("_", " ")} />
                        ))}
                        <span className="ct">×{cell.entry_count}</span>
                      </span>
                      {cell.mood && <span className="day-mood">{cell.mood}</span>}
                      {cell.has_summary && (
                        <span
                          className="report-dot"
                          title="day report compiled"
                        />
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            <span><i className="mk-video_log" style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block" }} /><span className="label">video</span></span>
            <span><i className="mk-audio_log" style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block" }} /><span className="label">audio</span></span>
            <span><i className="mk-live_session" style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block" }} /><span className="label">live session</span></span>
            <span><i style={{ width: 4, height: 4, background: "var(--ok)", boxShadow: "0 0 8px var(--ok)", display: "inline-block" }} /><span className="label">day report</span></span>
            <span><span className="label" style={{ color: "var(--crit)" }}>◪</span><span className="label">reminder due</span></span>
          </div>
        </div>

        <div className="panel flex min-h-80 flex-col self-start">
          <div
            className="label flex items-baseline gap-3 px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--line-dim)", color: "var(--amber)" }}
          >
            Day Report
            {selected && (
              <span style={{ color: "var(--dim)" }}>
                {daySol != null && daySol > 0 ? `SOL ${String(daySol).padStart(3, "0")} · ` : ""}
                {selected}
              </span>
            )}
          </div>
          <div className="flex-1 px-4 py-3">
            {!selected && (
              <p className="label">Select a day to open its report.</p>
            )}
            {selected && loadingDay && <p className="label pulse">Retrieving…</p>}
            {selected && !loadingDay && dayPins.length > 0 && (
              <div className="mb-3 border-b pb-2" style={{ borderColor: "var(--line-dim)" }}>
                {dayPins.map((p) => (
                  <p key={p.id} className="my-1 text-sm">
                    <span
                      className="mono mr-2 text-xs"
                      style={{
                        color:
                          p.status !== "active"
                            ? "var(--dim)"
                            : p.overdue
                              ? "var(--red)"
                              : "var(--amber)",
                      }}
                    >
                      ◪
                    </span>
                    <span
                      style={{
                        color: p.status !== "active" ? "var(--dim)" : "var(--text-bright)",
                        textDecoration: p.status !== "active" ? "line-through" : "none",
                      }}
                    >
                      {p.text}
                    </span>
                  </p>
                ))}
              </div>
            )}
            {selected && !loadingDay && dayEntries.length === 0 && dayPins.length === 0 && (
              <p className="label">No entries logged this day.</p>
            )}
            {selected && !loadingDay && dayEntries.length === 0 && dayPins.length > 0 && (
              <p className="label">No entries logged this day.</p>
            )}
            {selected && !loadingDay && dayEntries.length > 0 && (
              <>
                {report?.summary ? (
                  <>
                    {report.mood && <span className="chip cyan mb-2">{report.mood}</span>}
                    <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>
                      {report.summary}
                    </p>
                    {!!report.highlights?.length && (
                      <ul className="mt-3 flex flex-col gap-1">
                        {report.highlights.map((h, i) => (
                          <li key={i} className="text-sm" style={{ color: "var(--text-bright)" }}>
                            <span className="mono mr-2" style={{ color: "var(--amber)" }}>▸</span>
                            {h}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="label mt-3" style={{ fontSize: ".58rem" }}>
                      compiled {report.updated_at}
                    </p>
                  </>
                ) : (
                  <p className="label" style={{ color: "var(--amber-dim, rgba(255,180,84,.55))" }}>
                    {pendingSummary
                      ? "Day in progress — the report compiles after the day ends."
                      : "Report not compiled yet — the worker runs it within a few minutes."}
                  </p>
                )}

                <div className="mt-4 flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: "var(--line-dim)" }}>
                  {dayEntries.map((e) => (
                    <Link
                      key={e.id}
                      href={`/entry/${e.id}`}
                      className="flex items-center gap-3 px-1 py-1 text-sm transition-colors hover:bg-[var(--panel-2)]"
                    >
                      <span className="mono text-xs" style={{ color: "var(--dim)" }}>
                        {e.at}
                      </span>
                      <span style={{ color: KIND_GLYPH[e.kind]?.color }}>
                        {KIND_GLYPH[e.kind]?.glyph}
                      </span>
                      <span className="truncate" style={{ color: "var(--text-bright)" }}>
                        {e.title ?? "Untitled entry"}
                      </span>
                      {e.mood && <span className="label ml-auto">{e.mood}</span>}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
