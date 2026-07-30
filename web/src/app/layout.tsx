import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import Link from "next/link";
import { db, USER_ID } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/authToken";
import ModuleRail from "@/components/ModuleRail";
import MissionClock from "@/components/MissionClock";
import VoidField from "@/components/VoidField";
import "./globals.css";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MEMENTO — Personal Log",
  description: "A live journal you talk to.",
  appleWebApp: {
    capable: true,
    title: "MEMENTO",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192" },
      { url: "/icons/icon-512.png", sizes: "512x512" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#04060a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

type Console = {
  theme: string | null;
  accent: string | null;
  signal: string | null;
  glow: string | null;
  edge: string | null;
  ground: string | null;
  grid: string | null;
  density: string | null;
  void_field: string | null;
  tempo: string | null;
  pulse: string | null;
  started_on: string | null;
  sol: number | null;
  entries: number;
  minutes: number;
  concepts: number;
  pending: number;
  capsules: number;
  streak: number;
};

const EMPTY: Console = {
  theme: null,
  accent: null,
  signal: null,
  glow: null,
  edge: null,
  ground: null,
  grid: null,
  density: null,
  void_field: null,
  tempo: null,
  pulse: null,
  started_on: null,
  sol: null,
  entries: 0,
  minutes: 0,
  concepts: 0,
  pending: 0,
  capsules: 0,
  streak: 0,
};

/** One round trip for everything the status strip and ticker show. */
async function loadConsole(): Promise<Console> {
  return db
    .query<Console>(
      `SELECT u.settings->>'theme' AS theme,
              u.settings->>'accent' AS accent,
              u.settings->>'signal' AS signal,
              u.settings->>'glow' AS glow,
              u.settings->>'edge' AS edge,
              u.settings->>'ground' AS ground,
              u.settings->>'grid' AS grid,
              u.settings->>'density' AS density,
              u.settings->>'void_field' AS void_field,
              u.settings->>'tempo' AS tempo,
              u.settings->>'pulse' AS pulse,
              u.journal_started_on::text AS started_on,
              (current_date - u.journal_started_on) + 1 AS sol,
              (SELECT count(*)::int FROM entries
                 WHERE user_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
                   AND status <> 'sealed') AS entries,
              (SELECT COALESCE(round(sum(duration_s) / 60.0)::int, 0) FROM entries
                 WHERE user_id = $1 AND deleted_at IS NULL) AS minutes,
              (SELECT count(*)::int FROM concepts WHERE user_id = $1) AS concepts,
              (SELECT count(*)::int FROM entries
                 WHERE user_id = $1 AND deleted_at IS NULL
                   AND status IN ('created', 'uploaded', 'transcribing')) AS pending,
              (SELECT count(*)::int FROM entries
                 WHERE user_id = $1 AND deleted_at IS NULL AND status = 'sealed') AS capsules,
              -- days logged since the most recent gap: the current streak
              (SELECT count(*)::int
                 FROM generate_series(current_date - 364, current_date, '1 day') g(d)
                WHERE g.d::date > (
                  SELECT COALESCE(max(x.d)::date, current_date - 365)
                    FROM generate_series(current_date - 364, current_date, '1 day') x(d)
                   WHERE NOT EXISTS (SELECT 1 FROM entries e
                                      WHERE e.user_id = $1 AND e.deleted_at IS NULL
                                        AND e.recorded_at::date = x.d::date)
                )) AS streak
       FROM users u WHERE u.id = $1`,
      [USER_ID]
    )
    .then((r) => r.rows[0] ?? EMPTY)
    .catch(() => EMPTY);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The strip and ticker publish counts from the journal, so neither they nor
  // the console query run until the session cookie checks out. Signed-out
  // visitors (login, register) get the bare page.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const authed = await verifySession(token, process.env.AUTH_SECRET ?? "");
  const c = authed ? await loadConsole() : EMPTY;

  // A custom accent overrides the preset's primary slot. Re-validated here so a
  // hand-edited settings row can never inject CSS through the style tag.
  const accent = /^#[0-9a-f]{6}$/i.test(c.accent ?? "") ? c.accent : null;
  const signal = /^#[0-9a-f]{6}$/i.test(c.signal ?? "") ? c.signal : null;
  const accentCss =
    [
      accent && `--amber:${accent};--amber-dim:${accent}8c;--line:${accent}52;`,
      signal && `--cyan:${signal};--hair-warm:${signal}38;`,
    ]
      .filter(Boolean)
      .join("") || null;

  // Memento's stock appearance. These are the shipped defaults, applied
  // whenever a preference has never been set; colours stay on the preset
  // palette unless the user picks a custom accent or signal.
  // Re-validated here too: these land in data attributes, so only known
  // values are ever stamped onto the document.
  const pick = (v: string | null, allowed: string[], fallback: string) =>
    v && allowed.includes(v) ? v : fallback;
  const glow = pick(c.glow, ["off", "subtle", "normal", "bright"], "subtle");
  const edge = pick(c.edge, ["off", "static", "on"], "on");
  const ground = pick(c.ground, ["void", "slate", "carbon", "oxide"], "void");
  const grid = pick(c.grid, ["off", "on", "bold"], "off");
  const density = pick(c.density, ["comfortable", "compact"], "comfortable");
  const voidField = pick(c.void_field, ["off", "stars", "deep"], "stars");
  const tempo = pick(c.tempo, ["calm", "normal", "quick"], "quick");
  const pulse = pick(c.pulse, ["standard", "smooth"], "standard");

  return (
    <html
      lang="en"
      data-theme={c.theme && c.theme !== "amber" ? c.theme : undefined}
      data-glow={glow}
      data-edge={edge}
      data-ground={ground}
      data-grid={grid}
      data-density={density}
      data-void={voidField}
      data-tempo={tempo}
      data-pulse={pulse}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject
          attributes into <body> before React hydrates */}
      <body className="min-h-full" suppressHydrationWarning>
        {accentCss && <style>{`:root{${accentCss}}`}</style>}
        {voidField !== "off" && (
          <VoidField mode={voidField === "deep" ? "deep" : "stars"} />
        )}
        {!authed && <div className="stage">{children}</div>}
        {authed && (
          <>
        <header className="strip">
          <Link href="/" className="wordmark">
            MEMENT<span className="dot">O</span>
          </Link>
          <span className="div" />

          <span className="readout">
            <span className="v">{String(c.sol ?? 0).padStart(3, "0")}</span>
            <span className="k">Sol</span>
          </span>
          {c.started_on && <MissionClock startedOn={c.started_on} />}

          <span className="div" />

          <span className="readout hot">
            <span className="v">{c.streak}</span>
            <span className="k">Day streak</span>
          </span>
          <span className="readout">
            <span className="v">{c.entries}</span>
            <span className="k">Entries</span>
          </span>
          <span className="readout">
            <span className="v">
              {c.minutes}
              <small>m</small>
            </span>
            <span className="k">Logged</span>
          </span>
          <span className="readout">
            <span className="v">{c.concepts}</span>
            <span className="k">Concepts</span>
          </span>

          <span className="ml-auto flex flex-none items-center gap-2 pl-4">
            <span className="beacon" aria-hidden="true" />
            <span className="label" style={{ color: "var(--ice-deep)" }}>
              Link nominal
            </span>
            {c.pending > 0 && <span className="chip cyan">{c.pending} indexing</span>}
            {c.capsules > 0 && <span className="chip dim">{c.capsules} in transit</span>}
          </span>
        </header>

        <div className="console">
          <ModuleRail />
          <div className="stage">{children}</div>
        </div>

        <footer className="ticker" aria-hidden="true">
          <span>
            <span className="on">●</span> Worker online
          </span>
          <span>Indexing queue {c.pending}</span>
          {c.capsules > 0 && (
            <span>
              <span className="wr">●</span> {c.capsules} capsule
              {c.capsules > 1 ? "s" : ""} in transit
            </span>
          )}
          <span>
            {c.entries} records · {c.minutes}m logged
          </span>
          <span>{c.concepts} concepts tracked</span>
          <span>Sol {String(c.sol ?? 0).padStart(3, "0")}</span>
        </footer>
          </>
        )}
      </body>
    </html>
  );
}
