import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// The release as YY.M.D (Pacific), with .1, .2 for later releases the same day: counted from today's commits on main.
function version() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const base = `${now.getFullYear() % 100}.${now.getMonth() + 1}.${now.getDate()}`;
  try {
    const n = Number(execSync("git rev-list --count --first-parent --since=midnight HEAD", { env: { ...process.env, TZ: "America/Los_Angeles" } }).toString().trim());
    return n > 1 ? `${base}.${n - 1}` : base;
  } catch { return base; }
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Baked into both the app and the server at build time; the app compares them to notice a newer version (see App.tsx).
  env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`, NEXT_PUBLIC_VERSION: version() },
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
