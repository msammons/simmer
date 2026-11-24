// Where the Safeway helper stands, read-only, for a round's check-up (Nov 23: done by hand every round till now):
//   vercel env pull /tmp/simmer.env --environment=production && node scripts/helper-status.mjs /tmp/simmer.env [last N jobs, default 15]
// The helper's check-in (version, when, panel open), the open jobs, the last N jobs with a short result each, how long
// each kind of job takes (the job-times list src/lib/jobs.ts keeps), and whether this checkout's fingerprint has passed a test run. Reads
// only; the env file is deleted as soon as it's read (scripts/ops-env.mjs), and nothing secret, no product names and
// no addresses are printed.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const here = (p) => new URL(`../${p}`, import.meta.url);
const short = (v, max = 40) => (typeof v === "string" ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : "");
const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
/** "3 min ago", "2 h ago", "4 d ago". */
export const ago = (iso, now = Date.now()) => {
  const t = Date.parse(iso || "");
  if (!t) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const time = (iso) => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, "Z") : "-");

/** A job's result in a few words: errors, a stop, signed in or not, Pickup, how many products. */
export function resultOf(j) {
  const r = j.result ?? {};
  const bits = [];
  if (j.kind === "search" && j.args?.query) bits.push(`"${short(String(j.args.query), 24)}"`);
  if (j.kind === "setQty" && j.args?.qty !== undefined) bits.push(`qty ${j.args.qty}`);
  if (r.error) bits.push(`error ${short(r.error)}`);
  if (r.why) bits.push(`why ${short(r.why, 60)}`);
  if (r.stopped) bits.push(`stopped ${short(r.stopped, 60)}`);
  if (r.signedIn === false) bits.push("signed out");
  if (r.signedIn === true) bits.push("signed in");
  if (r.noPickup) bits.push("no Pickup");
  if (Array.isArray(r.products)) bits.push(`${r.products.length} products`);
  if (typeof r.qty === "number" && j.kind === "setQty") bits.push(`now ${r.qty}`);
  if (r.ok === false && !r.error) bits.push("not ok");
  return bits.join(", ");
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** How long each kind of job takes, from the job-times list: count, median and max seconds, failures by reason. */
export function timesByKind(rows) {
  const by = new Map();
  for (const t of rows) {
    if (!t || typeof t.s !== "number") continue;
    const k = by.get(t.kind) ?? { n: 0, s: [], fails: new Map() };
    k.n++; k.s.push(t.s);
    if (!t.ok) k.fails.set(t.why || "failed", (k.fails.get(t.why || "failed") ?? 0) + 1);
    by.set(t.kind, k);
  }
  return [...by].sort((a, b) => b[1].n - a[1].n).map(([kind, k]) => ({ kind, n: k.n, median: median(k.s), max: Math.max(...k.s), fails: [...k.fails].sort((a, b) => b[1] - a[1]) }));
}

/** Every line of the report. `redis(...cmd)` is one Redis command, as in scripts/ops-env.mjs. */
export async function report(redis, ns, { last = 15, now = Date.now(), print, ships } = {}) {
  const lines = [];
  const out = (s = "") => lines.push(s);
  const jobsOf = async (ids) => (ids?.length ? (await redis("MGET", ...ids.map((id) => `${ns}:job:${id}`))).map(parse).filter(Boolean) : []);
  const [helperRaw, openIds, lastIds, timesRaw, passedRaw] = await Promise.all([
    redis("GET", `${ns}:helper`), redis("ZRANGE", `${ns}:jobs-open`, 0, -1), redis("ZRANGE", `${ns}:jobs`, -last, -1),
    redis("LRANGE", `${ns}:job-times`, 0, -1), redis("GET", `${ns}:checkout-dry-passed`),
  ]);

  const h = parse(helperRaw);
  out("Helper");
  if (!h) out("  never checked in");
  else out(`  version ${h.version || "?"}${ships && h.version !== ships ? ` (Simmer ships ${ships})` : ""}, last seen ${time(h.seen)} (${ago(h.seen, now)}), panel ${h.panel ? "open" : "closed"}`);

  const open = await jobsOf(openIds);
  out(""); out(`Open jobs (${open.length})`);
  for (const j of open) out(`  ${j.id}  ${j.kind.padEnd(15)} ${j.status.padEnd(8)} queued ${time(j.created)} (${ago(j.created, now)})`);

  const recent = (await jobsOf(lastIds)).reverse();
  out(""); out(`Last ${recent.length} jobs, newest first`);
  for (const j of recent) {
    const took = j.status === "done" || j.status === "failed" ? Date.parse(j.updated) - Date.parse(j.created) : NaN;
    out(`  ${time(j.created)}  ${j.kind.padEnd(15)} ${j.status.padEnd(8)} ${(Number.isFinite(took) ? `${(took / 1000).toFixed(1)} s` : "").padStart(8)}  ${resultOf(j)}`.trimEnd());
  }

  const times = timesByKind((timesRaw ?? []).map(parse));
  out(""); out(`How long jobs take (${(timesRaw ?? []).length} kept)`);
  for (const t of times) out(`  ${t.kind.padEnd(15)} ${String(t.n).padStart(4)} jobs, median ${t.median.toFixed(1)} s, max ${t.max.toFixed(1)} s${t.fails.length ? `; failed: ${t.fails.map(([why, n]) => `${why} ×${n}`).join(", ")}` : ""}`);

  const passed = parse(passedRaw) ?? [];
  out(""); out("Checkout test run");
  out(print ? `  this checkout (${print}) ${passed.includes(print) ? "has passed a test run" : "has NOT passed a test run yet"}; ${passed.length} passed in all` : "  no fingerprint to compare");
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { fromEnvFile } = await import("./ops-env.mjs");
  const { redis, ns } = fromEnvFile(process.argv[2]);
  const last = Math.max(1, Math.min(100, Number(process.argv[3]) || 15));
  const print = parse(readFileSync(here("src/lib/checkout-print.json"), "utf8"))?.print;
  const ships = parse(readFileSync(here("extension-working/manifest.json"), "utf8"))?.version;
  console.log((await report(redis, ns, { last, print, ships })).join("\n"));
}
