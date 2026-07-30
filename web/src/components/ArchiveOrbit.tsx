"use client";

import { useEffect, useRef } from "react";

/** Wireframe planet with one marker per record on the orbital track.
 *  The newest record leads, reticled in signal amber. */
export default function ArchiveOrbit({ records }: { records: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = Math.max(1, Math.min(records, 240));
    let phase = 0;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        raf = requestAnimationFrame(draw);
        return;
      }
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2 - 4;
      const R = Math.min(w, h) * 0.32;

      // planet body — the one warm surface in the palette
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, "rgba(194,84,42,.34)");
      g.addColorStop(0.7, "rgba(120,48,26,.16)");
      g.addColorStop(1, "rgba(60,24,14,.04)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,157,61,.34)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      // latitude rings
      ctx.strokeStyle = "rgba(255,157,61,.16)";
      for (let i = -3; i <= 3; i++) {
        const y = cy + (R * i) / 4;
        const rx = R * Math.sqrt(Math.max(0, 1 - (i / 4) * (i / 4)));
        ctx.beginPath();
        ctx.ellipse(cx, y, rx, rx * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // longitude arcs, rotating
      for (let j = 0; j < 6; j++) {
        const a = phase + (j * Math.PI) / 6;
        ctx.globalAlpha = 0.1 + 0.24 * Math.abs(Math.cos(a));
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(R * Math.cos(a)), R, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // orbital track
      const OR = R * 1.62;
      ctx.strokeStyle = "rgba(127,212,232,.30)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, OR, OR * 0.34, -0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // one marker per record
      const rot = -0.28;
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + phase * 0.6;
        const px = cx + Math.cos(t) * OR;
        const py = cy + Math.sin(t) * OR * 0.34;
        const rx = cx + (px - cx) * Math.cos(rot) - (py - cy) * Math.sin(rot);
        const ry = cy + (px - cx) * Math.sin(rot) + (py - cy) * Math.cos(rot);
        const lead = k === n - 1;
        ctx.fillStyle = lead ? "#ff9d3d" : "rgba(127,212,232,.72)";
        ctx.beginPath();
        ctx.arc(rx, ry, lead ? 3.4 : 1.6, 0, Math.PI * 2);
        ctx.fill();
        if (lead) {
          ctx.strokeStyle = "rgba(255,157,61,.5)";
          ctx.beginPath();
          ctx.arc(rx, ry, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // reticle
      ctx.strokeStyle = "rgba(127,212,232,.18)";
      ctx.beginPath();
      ctx.moveTo(cx - R * 1.9, cy);
      ctx.lineTo(cx - R * 1.15, cy);
      ctx.moveTo(cx + R * 1.15, cy);
      ctx.lineTo(cx + R * 1.9, cy);
      ctx.stroke();

      if (!reduce) {
        phase += 0.004;
        raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [records]);

  return (
    <div className="orbit-wrap">
      <canvas
        ref={ref}
        width={540}
        height={420}
        aria-label={`Orbital plot of the archive, one marker per record, ${records} total`}
      />
    </div>
  );
}
