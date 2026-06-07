import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Pin workspace root to this directory — silences the multiple-lockfiles warning
  // that fires when Next.js finds a stray package-lock.json in a parent directory.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**", pathname: "/**" }],
  },
  // Stagehand requires Node.js runtime for browser automation
  serverExternalPackages: ["@browserbasehq/stagehand"],
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: "canvas" }];
    return config;
  },
};

export default nextConfig;
