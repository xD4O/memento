"use client";

import { useEffect, useRef } from "react";

/** Parallax starfield behind the console.
 *
 *  Three layers of points at different depths drift and respond to the
 *  pointer, so the background has real parallax rather than a flat texture.
 *  Deliberately cheap and deliberately quiet: it must never compete with the
 *  content sitting on top of it.
 *
 *  Guards: skipped entirely under prefers-reduced-motion or when WebGL is
 *  unavailable, and the loop is suspended while the tab is hidden.
 */
export default function VoidField({ mode }: { mode: "stars" | "deep" }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      } catch {
        return; // no WebGL — the CSS ground stands on its own
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.domElement.style.display = "block";
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        1200
      );
      camera.position.z = 8;

      // accent-tinted, read once from the live design tokens
      const css = getComputedStyle(document.documentElement);
      const accent = new THREE.Color(css.getPropertyValue("--ice").trim() || "#7fd4e8");
      const warm = new THREE.Color(css.getPropertyValue("--oxide").trim() || "#c2542a");

      // deterministic layout — no Math.random, so the sky is stable per reload
      let seed = 20260726;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };

      const layers: {
        points: InstanceType<typeof THREE.Points>;
        depth: number;
        spin: number;
      }[] = [];

      const specs =
        mode === "deep"
          ? [
              { count: 1400, spread: 60, size: 0.05, depth: 0.25, opacity: 0.5 },
              { count: 700, spread: 34, size: 0.08, depth: 0.55, opacity: 0.38 },
              { count: 260, spread: 18, size: 0.13, depth: 1.0, opacity: 0.28 },
            ]
          : [
              { count: 900, spread: 60, size: 0.045, depth: 0.25, opacity: 0.4 },
              { count: 420, spread: 34, size: 0.07, depth: 0.6, opacity: 0.28 },
            ];

      for (const spec of specs) {
        const pos = new Float32Array(spec.count * 3);
        const col = new Float32Array(spec.count * 3);
        for (let i = 0; i < spec.count; i++) {
          pos[i * 3] = (rand() - 0.5) * spec.spread;
          pos[i * 3 + 1] = (rand() - 0.5) * spec.spread;
          pos[i * 3 + 2] = -rand() * spec.spread * 0.6 - 2;
          // a few embers among the cold stars
          const c = rand() > 0.92 ? warm : accent;
          const shade = 0.55 + rand() * 0.45;
          col[i * 3] = c.r * shade;
          col[i * 3 + 1] = c.g * shade;
          col[i * 3 + 2] = c.b * shade;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const mat = new THREE.PointsMaterial({
          size: spec.size,
          vertexColors: true,
          transparent: true,
          opacity: spec.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        });
        const points = new THREE.Points(geo, mat);
        scene.add(points);
        layers.push({ points, depth: spec.depth, spin: 0.00004 * spec.depth });
      }

      // pointer parallax, heavily damped
      const target = { x: 0, y: 0 };
      const eased = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        target.x = (e.clientX / window.innerWidth - 0.5) * 2;
        target.y = (e.clientY / window.innerHeight - 0.5) * 2;
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener("resize", onResize);

      let raf = 0;
      let t = 0;
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;
        t += 1;
        eased.x += (target.x - eased.x) * 0.02;
        eased.y += (target.y - eased.y) * 0.02;
        for (const l of layers) {
          l.points.rotation.z += l.spin;
          l.points.position.x = -eased.x * l.depth * 1.4;
          l.points.position.y = eased.y * l.depth * 1.4;
          // a slow tidal drift so it never looks frozen
          l.points.position.z = Math.sin(t * 0.0008 * l.depth) * 0.6;
        }
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("resize", onResize);
        for (const l of layers) {
          l.points.geometry.dispose();
          (l.points.material as InstanceType<typeof THREE.PointsMaterial>).dispose();
        }
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [mode]);

  return <div ref={hostRef} className="voidfield" aria-hidden="true" />;
}
