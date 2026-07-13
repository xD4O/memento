import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { db, USER_ID } from "@/lib/db";
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
  themeColor: "#07090d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await db
    .query(`SELECT settings->>'theme' AS t FROM users WHERE id = $1`, [USER_ID])
    .then((r) => r.rows[0]?.t as string | null)
    .catch(() => null);
  return (
    <html
      lang="en"
      data-theme={theme && theme !== "amber" ? theme : undefined}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject
          attributes into <body> before React hydrates */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <header
          className="sticky-hud sticky top-0 z-50 flex items-center gap-4 px-5 py-2.5 backdrop-blur"
          style={{
            background: "rgba(7,9,13,.92)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <Link
            href="/"
            className="mono font-bold"
            style={{ color: "var(--amber)", letterSpacing: ".28em", fontSize: ".78rem" }}
          >
            MEMENTO
          </Link>
          <span className="label" style={{ opacity: 0.5 }}>
            //
          </span>
          <span className="label hidden sm:inline">Personal Log</span>
          <nav className="ml-auto flex flex-wrap items-center gap-4">
            <Link className="label" href="/">
              Timeline
            </Link>
            <Link className="label" href="/search">
              Search
            </Link>
            <Link className="label" href="/catalog">
              Catalog
            </Link>
            <Link className="label" href="/calendar">
              Calendar
            </Link>
            <Link className="label" href="/pins">
              Pins
            </Link>
            <Link className="label" href="/debriefs">
              Debriefs
            </Link>
            <Link className="label" href="/stats">
              Stats
            </Link>
            <Link className="label" href="/starmap">
              Starmap
            </Link>
            <Link className="label" href="/story">
              Story
            </Link>
            <Link className="label" href="/profile">
              Profile
            </Link>
            <Link className="chip cyan" href="/live">
              ◉ Live
            </Link>
            <Link className="chip" href="/record">
              ● New Entry
            </Link>
            <Link className="label" href="/settings" title="Terminal settings">
              ⚙
            </Link>
            <Link className="label" href="/login?lock=1" title="Lock the terminal">
              ⎋
            </Link>
          </nav>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
