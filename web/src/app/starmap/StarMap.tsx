"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CHART } from "@/lib/mood";

type Node = {
  id: string;
  name: string;
  kind: string;
  n: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};
type Edge = { a: string; b: string; w: number };

const KIND_COLOR: Record<string, string> = {
  project: CHART.amber,
  person: CHART.cyan,
  idea: CHART.violet,
  theme: CHART.violet,
  place: CHART.green,
};
const FALLBACK = "#8A93A6"; // other / emotion — de-emphasized, legend-labeled

export default function StarMap() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const hoverRef = useRef<Node | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(devicePixelRatio || 1, 2);

    const size = () => {
      const r = canvas.parentElement!.getBoundingClientRect();
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas.parentElement!);

    (async () => {
      const res = await fetch("/api/constellation");
      const data = await res.json();
      if (disposed) return;
      if (!data.nodes.length) {
        setEmpty(true);
        return;
      }
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      // deterministic spiral seed — stable layout per node set
      (window as unknown as { __stars?: React.RefObject<Node[]> }).__stars = nodesRef;
      nodesRef.current = data.nodes.map((n: Node, i: number) => {
        const a = i * 2.39996; // golden angle
        const r = 18 * Math.sqrt(i + 1);
        return {
          ...n,
          x: W / 2 + r * Math.cos(a),
          y: H / 2 + r * Math.sin(a) * 0.72,
          vx: 0,
          vy: 0,
        };
      });
      edgesRef.current = data.edges;
      settle();
    })();

    const byId = () => new Map(nodesRef.current.map((n) => [n.id, n]));

    // Synchronous force layout with a cooling schedule — no live physics, so
    // the layout can never explode. The draw loop only twinkles and drifts.
    function settle() {
      const nodes = nodesRef.current;
      const W = canvas.clientWidth || 900;
      const H = canvas.clientHeight || 600;
      const map = byId();
      const ITER = 320;
      for (let k = 0; k < ITER; k++) {
        const alpha = 1 - k / ITER;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            const d2 = dx * dx + dy * dy + 60;
            const f = Math.min(0.4, 1200 / d2) * alpha;
            dx *= f; dy *= f;
            a.vx += dx; a.vy += dy;
            b.vx -= dx; b.vy -= dy;
          }
        }
        for (const e of edgesRef.current) {
          const a = map.get(e.a), b = map.get(e.b);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const target = 120 - Math.min(50, e.w * 10);
          const f = ((d - target) / d) * 0.07 * alpha;
          a.vx += dx * f; a.vy += dy * f;
          b.vx -= dx * f; b.vy -= dy * f;
        }
        for (const n of nodes) {
          const g = Math.max(alpha, 0.35); // centering never fully cools
          n.vx += (W / 2 - n.x) * 0.022 * g;
          n.vy += (H / 2 - n.y) * 0.03 * g;
          const cap = 14 * alpha + 0.5;
          n.x += Math.max(-cap, Math.min(cap, n.vx));
          n.y += Math.max(-cap, Math.min(cap, n.vy));
          n.vx *= 0.55; n.vy *= 0.55;
          // keep labels inside the frame
          n.x = Math.max(50, Math.min(W - 50, n.x));
          n.y = Math.max(34, Math.min(H - 20, n.y));
        }
      }
    };

    const draw = (t: number) => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);
      const map = byId();

      for (const e of edgesRef.current) {
        const a = map.get(e.a), b = map.get(e.b);
        if (!a || !b) continue;
        const hover = hoverRef.current;
        const lit = hover && (hover.id === e.a || hover.id === e.b);
        ctx.globalAlpha = lit ? 0.5 : Math.min(0.28, 0.07 + e.w * 0.05);
        ctx.strokeStyle = lit ? "#FFB454" : "#59D2DE";
        ctx.lineWidth = lit ? 1.2 : 0.6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const n of nodesRef.current) {
        const color = KIND_COLOR[n.kind] ?? FALLBACK;
        const r = 3 + Math.sqrt(n.n) * 2.6;
        // ambient drift — decorative only, bounded
        n.x += Math.sin(t / 4600 + n.y * 0.13) * 0.05;
        n.y += Math.cos(t / 5200 + n.x * 0.11) * 0.04;
        const tw = 0.75 + 0.25 * Math.sin(t / 900 + n.x);
        ctx.globalAlpha = 0.16 * tw;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 3, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 7);
        ctx.fill();
        const hover = hoverRef.current;
        if ((hover && hover.id === n.id) || n.n >= 2) {
          ctx.globalAlpha = hover?.id === n.id ? 1 : 0.75;
          ctx.fillStyle = hover?.id === n.id ? "#EAF0F6" : "#8A93A6";
          ctx.font = "11px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(n.name, n.x, n.y - r - 7);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const near = (mx: number, my: number) => {
      let best: Node | null = null;
      let bd = 22;
      for (const n of nodesRef.current) {
        const d = Math.hypot(n.x - mx, n.y - my);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      hoverRef.current = near(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = hoverRef.current ? "pointer" : "default";
    };
    const onClick = () => {
      if (hoverRef.current) router.push(`/catalog/${hoverRef.current.id}`);
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [router]);

  return (
    <div className="stage-pad">
      <div className="view-hd">
        <h1>Memory Starmap</h1>
        <span className="sub">
          every concept a star · shared entries draw the filaments · click to open
        </span>
      </div>
      <div
        className="starfield relative overflow-hidden"
        style={{ height: "68vh", background: "#07090D" }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="label">The sky is empty — concepts appear as entries are indexed.</p>
          </div>
        )}
      </div>
      <div className="cal-legend mt-3">
        <span><span style={{ color: CHART.amber }}>●</span> projects</span>
        <span><span style={{ color: CHART.cyan }}>●</span> people</span>
        <span><span style={{ color: CHART.violet }}>●</span> ideas &amp; themes</span>
        <span><span style={{ color: CHART.green }}>●</span> places</span>
        <span><span style={{ color: FALLBACK }}>●</span> other</span>
        <span className="ml-auto">star size = entries touched</span>
      </div>
    </div>
  );
}
