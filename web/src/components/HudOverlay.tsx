"use client";

/**
 * Martian-style mission HUD, composited over video at display time.
 * Raw media stays clean (R-01); this is presentation only.
 */
export default function HudOverlay({
  sol,
  entryNo,
  time,
  userName = "USER",
  bottomOffset = "0.75rem",
}: {
  sol: number;
  entryNo: number;
  time: string;
  userName?: string;
  bottomOffset?: string;
}) {
  const solStr = String(sol).padStart(2, "0");
  const entryStr = String(entryNo).padStart(2, "0");
  const line = "rgba(255,255,255,.55)";
  const ink = "rgba(255,255,255,.88)";

  return (
    <div
      aria-hidden
      className="mono pointer-events-none absolute inset-0 select-none"
      style={{ color: ink, textShadow: "0 0 6px rgba(0,0,0,.55)" }}
    >
      {/* corner brackets */}
      <div
        className="absolute left-[2%] top-[4%] h-[16%] w-[3%]"
        style={{ borderLeft: `1px solid ${line}`, borderTop: `1px solid ${line}` }}
      />
      <div
        className="absolute left-[2%] h-[14%] w-[3%]"
        style={{
          bottom: bottomOffset,
          borderLeft: `1px solid ${line}`,
          borderBottom: `1px solid ${line}`,
        }}
      />
      {/* left mid ticks */}
      <div
        className="absolute left-[2%] top-[28%] h-[38%] w-px"
        style={{
          background: `repeating-linear-gradient(${line} 0 2px, transparent 2px 14px)`,
          opacity: 0.7,
        }}
      />

      {/* right ruler */}
      <div className="absolute right-[2.2%] top-[4%]" style={{ bottom: `calc(${bottomOffset} + 4%)` }}>
        <div
          className="h-full w-px"
          style={{
            background: `repeating-linear-gradient(${line} 0 10px, transparent 10px 22px)`,
          }}
        />
        <div
          className="absolute -left-1.5 top-0 h-3 w-px -rotate-45"
          style={{ background: line }}
        />
        <div className="absolute -left-2 -bottom-4 text-[0.6em]" style={{ color: line }}>
          ≡
        </div>
      </div>

      {/* top-left: mission day / SOL */}
      <div className="absolute left-[4.5%] top-[5.5%]">
        <div className="text-[0.62em]" style={{ letterSpacing: ".34em" }}>
          MISSION DAY
        </div>
        <div
          className="mt-1 inline-block px-3 py-0.5 text-[1.5em] font-bold"
          style={{ border: `1px solid ${ink}`, letterSpacing: ".22em", lineHeight: 1.3 }}
        >
          SOL {solStr}
        </div>
        <div
          className="mt-1 h-1 w-16"
          style={{
            background: `repeating-linear-gradient(-45deg, ${line} 0 3px, transparent 3px 7px)`,
          }}
        />
      </div>

      {/* top-right: time / log entry */}
      <div className="absolute right-[5%] top-[5.5%] text-right">
        <div className="text-[0.78em]" style={{ letterSpacing: ".3em" }}>
          TIME {time}
        </div>
        <div className="mt-1 text-[0.66em]" style={{ letterSpacing: ".22em", color: line }}>
          LOG ENTRY &gt; {userName.toUpperCase()} #&lt;{entryStr}&gt;
        </div>
      </div>

      {/* bottom-left: terminal wordmark */}
      <div className="absolute left-[4.5%]" style={{ bottom: `calc(${bottomOffset} + 2.5%)` }}>
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-[1em] w-[0.35em]"
            style={{
              background: `repeating-linear-gradient(${ink} 0 3px, transparent 3px 5px)`,
            }}
          />
          <span className="text-[1.35em]" style={{ letterSpacing: ".38em" }}>
            MEMENTO TERMINAL
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="h-1 w-10"
            style={{
              background: `repeating-linear-gradient(-45deg, ${line} 0 3px, transparent 3px 7px)`,
            }}
          />
          <span className="h-px flex-1" style={{ background: line, minWidth: "14em" }} />
          <span className="h-1.5 w-px" style={{ background: line }} />
          <span className="h-px w-8" style={{ background: line }} />
        </div>
      </div>
    </div>
  );
}
