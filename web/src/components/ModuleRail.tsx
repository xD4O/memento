"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Mod = { href: string; gx: string; label: string; hot?: boolean };

const GROUPS: { title: string; mods: Mod[] }[] = [
  {
    title: "Capture",
    mods: [
      { href: "/live", gx: "◉", label: "Live", hot: true },
      { href: "/record", gx: "●", label: "Record", hot: true },
    ],
  },
  {
    title: "Archive",
    mods: [
      { href: "/", gx: "≡", label: "Timeline" },
      { href: "/search", gx: "⌕", label: "Search" },
      { href: "/catalog", gx: "▦", label: "Catalog" },
      { href: "/calendar", gx: "▤", label: "Calendar" },
      { href: "/pins", gx: "✦", label: "Pins" },
      { href: "/vault", gx: "⛁", label: "Vault" },
    ],
  },
  {
    title: "Analysis",
    mods: [
      { href: "/debriefs", gx: "◈", label: "Debriefs" },
      { href: "/stats", gx: "▲", label: "Telemetry" },
      { href: "/starmap", gx: "✧", label: "Starmap" },
      { href: "/story", gx: "❯", label: "Story" },
    ],
  },
  {
    title: "System",
    mods: [
      { href: "/profile", gx: "◎", label: "Profile" },
      { href: "/settings", gx: "⚙", label: "Settings" },
      { href: "/login?lock=1", gx: "⎋", label: "Lock" },
    ],
  },
];

export default function ModuleRail() {
  const pathname = usePathname();

  const isCurrent = (href: string) => {
    const path = href.split("?")[0];
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(path + "/");
  };

  return (
    <nav className="rail" aria-label="Console modules">
      {GROUPS.map((g) => (
        <div key={g.title} className="contents">
          <span className="label group-lbl">{g.title}</span>
          {g.mods.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className={m.hot ? "mod hot" : "mod"}
              aria-current={isCurrent(m.href) ? "page" : undefined}
            >
              <span className="gx" aria-hidden="true">
                {m.gx}
              </span>
              {m.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
