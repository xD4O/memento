"use client";

import { useState } from "react";
import { VALENCE_COLOR, valence } from "@/lib/mood";

type Tip = { x: number; y: number; lines: string[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      className="mono pointer-events-none absolute z-10 px-2.5 py-1.5 text-xs"
      style={{
        left: tip.x,
        top: tip.y,
        transform: "translate(-50%, -110%)",
        background: "rgba(7,9,13,.95)",
        border: "1px solid var(--line)",
        color: "var(--text-bright)",
        whiteSpace: "nowrap",
      }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} style={i > 0 ? { color: "var(--dim)" } : undefined}>{l}</div>
      ))}
    </div>
  );
}

export function DayBars({
  data,
  color,
  unit,
}: {
  data: { day: string; value: number }[];
  color: string;
  unit: string;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const maxIdx = data.findIndex((d) => d.value === max);

  return (
    <div className="relative">
      <Tooltip tip={tip} />
      <div
        className="flex h-28 items-end gap-[2px] border-b pb-px"
        style={{ borderColor: "var(--line-dim)" }}
        onMouseLeave={() => setTip(null)}
      >
        {data.map((d, i) => (
          <div
            key={d.day}
            className="relative flex-1"
            style={{ height: "100%", display: "flex", alignItems: "flex-end" }}
            onMouseMove={(e) => {
              const r = e.currentTarget.parentElement!.getBoundingClientRect();
              setTip({
                x: e.clientX - r.left,
                y: e.clientY - r.top,
                lines: [`${d.value} ${unit}`, d.day],
              });
            }}
          >
            <div
              className="w-full"
              style={{
                height: `${(d.value / max) * 100}%`,
                minHeight: d.value > 0 ? 3 : 0,
                background: color,
                borderRadius: "4px 4px 0 0",
              }}
            />
            {i === maxIdx && d.value > 0 && (
              <span
                className="mono absolute -top-4 left-1/2 -translate-x-1/2 text-[0.6rem]"
                style={{ color: "var(--dim)" }}
              >
                {d.value}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="label mt-1 flex justify-between" style={{ fontSize: ".58rem" }}>
        <span>{data[0]?.day.slice(5)}</span>
        <span>{data[data.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

export function MoodStrip({
  data,
}: {
  data: { day: string; mood: string | null; provisional?: boolean }[];
}) {
  const [tip, setTip] = useState<Tip>(null);
  return (
    <div className="relative">
      <Tooltip tip={tip} />
      <div className="flex items-center gap-[3px]" onMouseLeave={() => setTip(null)}>
        {data.map((d) => (
          <span
            key={d.day}
            className="h-3.5 flex-1"
            style={{
              background: d.mood ? VALENCE_COLOR[valence(d.mood)] : "transparent",
              border: d.mood ? "none" : "1px solid var(--line-dim)",
              borderRadius: 2,
              opacity: d.provisional ? 0.55 : 1,
              minWidth: 6,
            }}
            onMouseMove={(e) => {
              const r = e.currentTarget.parentElement!.getBoundingClientRect();
              setTip({
                x: e.clientX - r.left,
                y: e.clientY - r.top - 6,
                lines: [
                  d.mood ? d.mood + (d.provisional ? " (so far)" : "") : "no entry",
                  d.day,
                ],
              });
            }}
          />
        ))}
      </div>
      <div className="label mt-2 flex gap-4" style={{ fontSize: ".58rem" }}>
        <span><span style={{ color: VALENCE_COLOR.positive }}>■</span> positive</span>
        <span><span style={{ color: VALENCE_COLOR.neutral }}>■</span> neutral / reflective</span>
        <span><span style={{ color: VALENCE_COLOR.negative }}>■</span> heavy</span>
        <span>hover for the word</span>
      </div>
    </div>
  );
}

export function HBars({
  data,
  color,
  onClickHref,
}: {
  data: { label: string; value: number; href?: string }[];
  color: string;
  onClickHref?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((d) => (
        <a
          key={d.label}
          href={onClickHref ? d.href : undefined}
          className="group flex items-center gap-3"
          style={{ textDecoration: "none", border: "none" }}
        >
          <span
            className="w-36 truncate text-right text-sm"
            style={{ color: "var(--text)" }}
          >
            {d.label}
          </span>
          <span className="relative h-3.5 flex-1">
            <span
              className="absolute left-0 top-0 h-full group-hover:opacity-80"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: color,
                borderRadius: "0 4px 4px 0",
                minWidth: 3,
              }}
            />
          </span>
          <span className="mono w-6 text-xs" style={{ color: "var(--dim)" }}>
            {d.value}
          </span>
        </a>
      ))}
    </div>
  );
}
