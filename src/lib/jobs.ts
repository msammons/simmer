// Small jobs for the Safeway helper (extension/), queued by Simmer and done by the helper in Chrome on a computer:
// search Safeway, set a product's quantity in the cart, or read a page to learn how Safeway builds it. Simmer queues a
// job; the helper's background checks for jobs (every half minute, every couple of seconds once there's activity),
// does the oldest, and reports back. The phone and the panel at the computer use the same path, so they behave the
// same. Kept in the "Safeway jobs" tab (in memory without the Sheet), pruned as it goes. The helper's last check-in is a
// row of the same tab (id "helper"), so Simmer can say plainly when the computer isn't answering.
import { ensureTab, appendRows, readTab, replaceTab, sheetsConfigured, updateRange } from "./google/sheets";
import { records } from "./parse";
import { loadCart, savePick, setCartLine } from "./safeway";

export const JOB_KINDS = ["search", "setQty", "sample", "snapshot"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "waiting" | "working" | "done" | "failed";
export type Job = { id: string; kind: JobKind; status: JobStatus; args: Record<string, unknown>; result: Record<string, unknown> | null; created: string; updated: string };
export type Helper = { seen: string; version: string; panel: boolean };

/**
 * How long things take. `alive`: the helper counts as answering if it checked in this recently (its slowest check is
 * every half minute, so two missed checks). `pickup`: a job nobody's taken by then is given up. `stuck`: a job taken but not reported by then
 * failed. `keep`: finished jobs are kept this long. `seenEvery`: how often a check-in is written down.
 */
export const JOB_TIMES = { alive: 65_000, pickup: 35_000, stuck: 120_000, keep: 15 * 60_000, seenEvery: 20_000, cache: 1_200 };

const TAB = "Safeway jobs";
const HEADERS = ["id", "kind", "status", "args", "result", "created", "updated"];
const HELPER = "helper";

type Row = Job & { row: number };
let memory: { jobs: Job[]; helper: Helper | null } = { jobs: [], helper: null };
// A copy of the tab for a moment, so the helper's and the app's frequent checks don't each read the Sheet.
let cache: { at: number; jobs: Row[]; helper: Helper | null; rows: number } | null = null;

const json = <T>(s: string, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const age = (iso: string) => Date.now() - Date.parse(iso || "1970-01-01");
const cells = (j: Job) => [j.id, j.kind, j.status, JSON.stringify(j.args), j.result ? JSON.stringify(j.result) : "", j.created, j.updated];

async function read(): Promise<{ jobs: Row[]; helper: Helper | null; rows: number }> {
  if (!sheetsConfigured()) return { jobs: memory.jobs.map((j, i) => ({ ...j, row: i })), helper: memory.helper, rows: memory.jobs.length };
  if (cache && Date.now() - cache.at < JOB_TIMES.cache) return cache;
  const rows = await readTab(TAB).catch(() => [] as string[][]);
  let helper: Helper | null = null;
  const jobs: Row[] = [];
  for (const r of records(rows)) {
    if (r.get("id") === HELPER) { helper = { seen: r.get("updated"), ...json(r.get("result"), { version: "", panel: false }) }; continue; }
    if (!r.get("id") || !(JOB_KINDS as readonly string[]).includes(r.get("kind"))) continue;
    jobs.push({ id: r.get("id"), kind: r.get("kind") as JobKind, status: (r.get("status") || "waiting") as JobStatus, args: json(r.get("args"), {}), result: json(r.get("result"), null), created: r.get("created"), updated: r.get("updated"), row: r.rowNumber });
  }
  cache = { at: Date.now(), jobs, helper, rows: rows.length };
  return cache;
}

/** Writes one job (new or changed), and keeps the moment's copy in step. */
async function write(j: Job, row?: number): Promise<Job> {
  j = { ...j, updated: now() };
  if (!sheetsConfigured()) {
    const i = memory.jobs.findIndex((x) => x.id === j.id);
    if (i >= 0) memory.jobs[i] = j; else memory.jobs.push(j);
    return j;
  }
  if (row) {
    await updateRange(`${TAB}!A${row}:G${row}`, [cells(j)]);
    if (cache) cache.jobs = cache.jobs.map((x) => (x.id === j.id ? { ...j, row } : x));
  } else {
    const { rows } = await read();
    if (!rows) { await ensureTab(TAB); await appendRows(TAB, [HEADERS, cells(j)]); }
    else await appendRows(TAB, [cells(j)]);
    cache = null;
  }
  return j;
}

/** Drops finished jobs older than a few minutes, and jobs nobody took or finished in time. */
async function prune(jobs: Row[]) {
  const old = (j: Job) => (j.status === "done" || j.status === "failed") && age(j.updated) > JOB_TIMES.keep;
  if (jobs.filter(old).length < 10) return;
  const keep = jobs.filter((j) => !old(j));
  if (!sheetsConfigured()) { memory.jobs = keep; return; }
  const h = (await read()).helper;
  await replaceTab(TAB, [HEADERS, ...(h ? [[HELPER, "check-in", "", "", JSON.stringify({ version: h.version, panel: h.panel }), "", h.seen]] : []), ...keep.map(cells)]);
  cache = null;
}

/** Jobs left too long: waiting with nobody taking them, or taken and never reported. */
const overdue = (j: Job) => (j.status === "waiting" && age(j.created) > JOB_TIMES.pickup) || (j.status === "working" && age(j.updated) > JOB_TIMES.stuck);

export const helperAnswering = (h: Helper | null) => Boolean(h && age(h.seen) < JOB_TIMES.alive);

export async function helperStatus(): Promise<{ answering: boolean; seen: string }> {
  const { helper } = await read();
  return { answering: helperAnswering(helper), seen: helper?.seen ?? "" };
}

/**
 * Simmer: queue a job. A quantity change for a product that's still waiting replaces the waiting one, so a few quick
 * taps on + become one trip to Safeway.
 */
export async function queueJob(kind: JobKind, args: Record<string, unknown>): Promise<Job> {
  const { jobs } = await read();
  if (kind === "setQty") {
    const same = jobs.find((j) => j.kind === "setQty" && j.status === "waiting" && j.args.productId === args.productId && !overdue(j));
    if (same) return write({ ...same, args: { ...same.args, ...args } }, same.row);
  }
  await prune(jobs).catch((e) => console.error("couldn't prune the jobs", e));
  return write({ id: newId(), kind, status: "waiting", args, result: null, created: now(), updated: now() });
}

/** Simmer: how a job stands. One left waiting too long is given up, so the app can say so instead of waiting on. */
export async function jobStatus(id: string): Promise<{ job: Job | null; answering: boolean }> {
  const { jobs, helper } = await read();
  const j = jobs.find((x) => x.id === id) ?? null;
  if (j && overdue(j)) return { job: await write({ ...j, status: "failed", result: { error: j.status === "waiting" ? "not-answering" : "stuck" } }, j.row), answering: helperAnswering(helper) };
  return { job: j, answering: helperAnswering(helper) };
}

/** Simmer: a job no longer wanted (only while nobody's taken it). */
export async function cancelJob(id: string): Promise<void> {
  const { jobs } = await read();
  const j = jobs.find((x) => x.id === id);
  if (j?.status === "waiting") await write({ ...j, status: "failed", result: { error: "cancelled" } }, j.row);
}

/** The helper: note that it's there (written down at most every 20 seconds, or when the panel opens or closes). */
async function checkIn(version: string, panel: boolean) {
  const { helper } = await read();
  if (helper && age(helper.seen) < JOB_TIMES.seenEvery && helper.panel === panel && helper.version === version) return;
  const h: Helper = { seen: now(), version, panel };
  if (!sheetsConfigured()) { memory.helper = h; return; }
  const rows = await readTab(TAB).catch(() => [] as string[][]);
  const at = records(rows).find((r) => r.get("id") === HELPER);
  const row = [HELPER, "check-in", "", "", JSON.stringify({ version, panel }), "", h.seen];
  if (at) await updateRange(`${TAB}!A${at.rowNumber}:G${at.rowNumber}`, [row]);
  else { if (!rows.length) await ensureTab(TAB); await appendRows(TAB, [...(rows.length ? [] : [HEADERS]), row]); }
  if (cache) cache.helper = h;
}

/** The helper: check in, and take the oldest waiting job (null when there's none). */
export async function takeJob(version: string, panel: boolean): Promise<Job | null> {
  await checkIn(version, panel).catch((e) => console.error("couldn't note the helper", e));
  const { jobs } = await read();
  const j = jobs.filter((x) => x.status === "waiting" && !overdue(x)).sort((a, b) => a.created.localeCompare(b.created))[0];
  if (!j) return null;
  return write({ ...j, status: "working" }, j.row);
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const productsOf = (r: Record<string, unknown>) => (Array.isArray(r.products) ? r.products : []).slice(0, 40).flatMap((p) => {
  const id = str(p?.id, 20);
  return /^\d+$/.test(id) && str(p?.name) ? [{ id, name: str(p.name, 160), price: str(p.price, 40), image: /^https:\/\//.test(str(p.image, 500)) ? str(p.image, 500) : "", inCart: p.inCart === true, qty: Math.max(0, Math.min(99, Math.round(Number(p.qty) || 0))) }] : [];
});

/**
 * The helper: a job's outcome. A quantity set on Safeway goes into Simmer's cart, and a product added for an item
 * becomes that item's pick. What a search shows about products already in Simmer's cart keeps the cart in step.
 */
export async function finishJob(id: string, ok: boolean, raw: Record<string, unknown>): Promise<Job | null> {
  const { jobs } = await read();
  const j = jobs.find((x) => x.id === id);
  if (!j || j.status === "done" || j.status === "failed") return j ?? null;
  let result: Record<string, unknown> = ok ? {} : { error: str(raw.error, 40) || "failed" };
  if (ok && j.kind === "search") {
    result = { products: productsOf(raw), signedIn: raw.signedIn !== false, noResults: raw.noResults === true };
    if (result.signedIn) {
      const cart = await loadCart();
      for (const p of result.products as ReturnType<typeof productsOf>) {
        const line = cart.find((l) => l.productId === p.id);
        const qty = p.inCart ? p.qty || 1 : 0;
        if (line && line.qty !== qty) await setCartLine({ productId: p.id, qty });
      }
    }
  }
  if (ok && j.kind === "setQty") {
    const a = j.args;
    const qty = Math.max(0, Math.min(99, Math.round(Number(raw.qty) || 0)));
    result = { qty, reached: raw.ok !== false && qty === Number(a.qty) };
    const name = str(raw.name, 160) || str(a.name, 160), image = str(raw.image, 500) || str(a.image, 500);
    await setCartLine({ productId: str(a.productId, 20), qty, name, price: str(raw.price, 40) || str(a.price, 40), image, itemId: str(a.itemId, 40), item: str(a.item, 80) });
    if (qty > 0 && str(a.item, 80)) await savePick({ item: str(a.item, 80), id: str(a.productId, 20), name, image }).catch((e) => console.error("couldn't keep the pick", e));
  }
  if (ok && (j.kind === "sample" || j.kind === "snapshot")) result = { text: str(raw.text, 8000) };
  return write({ ...j, status: ok ? "done" : "failed", result }, (j as Row).row);
}

/** For tests. */
export const resetJobs = () => { memory = { jobs: [], helper: null }; cache = null; };
