import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Baked into both the app and the server at build time; the app compares them to notice a newer version (see App.tsx).
  env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}` },
  partialPrefetching: true,
  // Simmer may be framed only by itself and by the Safeway helper's panel (a Chrome helper page), never by other sites.
  headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' chrome-extension:" }] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
