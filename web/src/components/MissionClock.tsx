"use client";

import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** Mission-elapsed time since the journal started, plus the wall clock.
 *  Both render empty on the server pass so the markup can't mismatch. */
export default function MissionClock({ startedOn }: { startedOn: string }) {
  const [met, setMet] = useState("");
  const [wall, setWall] = useState("");

  useEffect(() => {
    const start = new Date(startedOn + "T00:00:00").getTime();
    const tick = () => {
      const now = new Date();
      const secs = Math.max(0, Math.floor((now.getTime() - start) / 1000));
      const d = Math.floor(secs / 86400);
      setMet(
        `${String(d).padStart(3, "0")}:${pad(Math.floor((secs % 86400) / 3600))}:` +
          `${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`
      );
      setWall(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedOn]);

  return (
    <>
      <span className="readout">
        <span className="v">{met || "—"}</span>
        <span className="k">Mission elapsed</span>
      </span>
      <span className="readout">
        <span className="v">{wall || "—"}</span>
        <span className="k">Local</span>
      </span>
    </>
  );
}
