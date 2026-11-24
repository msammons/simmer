// The newest feedback from the long press on Settings (src/lib/ops/feedback.ts), newest first. Read-only.
//   vercel env pull /tmp/simmer.env --environment=production && node scripts/feedback.mjs /tmp/simmer.env [how many, default 10]
// (production's Redis keys). The env file is deleted as soon as it's read, so pull a fresh one each time; nothing secret
// is printed.
import { pathToFileURL } from "node:url";
import { fromEnvFile } from "./ops-env.mjs";

/** One entry as a few readable lines. */
export function describe(e) {
  const out = [`${e.at} · ${e.release || "?"}${e.server?.live && e.server.live !== e.release ? ` (live ${e.server.live})` : ""} · ${e.tab || "?"}${e.screens?.length ? " › " + e.screens.join(" › ") : ""}`];
  for (const line of String(e.text ?? "").split("\n")) out.push(`  “ ${line}`);
  for (const s of e.sheets ?? []) out.push(`  open: ${s.name}${s.detail ? ` — ${s.detail}` : ""}`);
  for (const [k, v] of Object.entries(e.state ?? {})) out.push(`  ${k}: ${v}`);
  if (e.server) out.push(`  helper: ${e.server.helper}${e.server.helperSeen ? ` (seen ${e.server.helperSeen})` : ""} · ordering ${e.server.ordering}`);
  if (e.alerts?.length) out.push(`  recent alerts: ${e.alerts.join(" | ")}`);
  out.push(`  ${e.online === false ? "offline" : "online"} · ${e.theme} · ${e.viewport} · ${e.userAgent}`);
  return out.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { redis, ns } = fromEnvFile(process.argv[2]);
  const n = Math.max(1, Math.min(500, Number(process.argv[3]) || 10));
  const rows = await redis("LRANGE", `${ns}:feedback`, 0, n - 1);
  if (!rows?.length) console.log("No feedback yet.");
  for (const raw of rows ?? []) {
    try { console.log(describe(JSON.parse(raw)) + "\n"); } catch { console.log(raw + "\n"); }
  }
}
