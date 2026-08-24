import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: allow the Tailscale IP (and the .ts.net hostname) so the app
  // hydrates when accessed from the MacBook / Camofox / preview pane.
  allowedDevOrigins: ["100.108.167.49", "micro-server.bilby-stonecat.ts.net"],
};

export default nextConfig;
