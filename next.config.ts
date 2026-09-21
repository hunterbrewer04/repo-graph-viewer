import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully client-side, so it ships as static files (out/) and is
  // hosted on Cloudflare Pages. No route here may need a server.
  output: "export",
};

export default nextConfig;
