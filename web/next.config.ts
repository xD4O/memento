import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Origins allowed to reach the dev server (HMR websocket included):
  // comma-separated DEV_ORIGINS in .env — e.g. tailnet hostname, LAN IP.
  // Production builds ignore this.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").filter(Boolean),
};

export default nextConfig;
