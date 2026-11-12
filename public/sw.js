// Simmer service worker: keeps the app shell available offline, and keeps pictures from other sites once seen.
const CACHE = "simmer-v1";
const PICTURES = "pictures"; // pictures from other sites, kept across versions (Nov 11)
const KEEP = 200;
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PICTURES).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  // Pictures from other sites (Matt, Nov 11: they appeared late on each open): kept once seen, served from here after.
  if (request.method === "GET" && request.destination === "image" && url.origin !== location.origin) {
    e.respondWith(caches.open(PICTURES).then(async (c) => {
      const hit = await c.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === "opaque") c.put(request, res.clone()).then(() => trim(c)).catch(() => {});
      return res;
    }));
    return;
  }
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Built assets are content-hashed: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })),
    );
    return;
  }

  // Pages and everything else: network first, fall back to cache.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request.mode === "navigate" ? "/" : request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request.mode === "navigate" ? "/" : request).then((hit) => hit || Response.error())),
  );
});

// Oldest pictures go first once there are more than KEEP (no timers: runs when one is added).
async function trim(c) { const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) await c.delete(k); }
