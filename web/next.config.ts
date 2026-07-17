import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so a second instance (e.g. demo/screenshot run) can't
  // clobber the production build in .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Origins allowed to reach the dev server (HMR websocket included):
  // comma-separated DEV_ORIGINS in .env — e.g. tailnet hostname, LAN IP.
  // Production builds ignore this.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").filter(Boolean),
};

export default nextConfig;
