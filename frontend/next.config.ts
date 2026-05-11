import type { NextConfig } from "next";

/** API proxy lives in `app/api/[...path]/route.ts` (more reliable than rewrites alone). */

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/workbench/hoq", destination: "/workbench", permanent: true }];
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**", pathname: "/**" }],
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: "canvas" }];
    return config;
  },
};

export default nextConfig;
