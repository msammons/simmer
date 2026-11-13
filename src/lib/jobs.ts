// Small jobs for the Safeway helper (extension-working/), queued by Simmer and done by the helper in Chrome on a computer:
// search Safeway, set a product's quantity in the cart, or read a page to learn how Safeway builds it. Simmer queues a
// job; the helper's background checks for jobs (every half minute, every couple of seconds once there's activity),
// does the oldest, and reports back. The phone and the panel at the computer use the same path, so they behave the
// same. Kept in the "Safeway jobs" tab (in memory without the Sheet), pruned as it goes. The helper's last check-in is a
// row of the same tab (id "helper"), so Simmer can say plainly when the computer isn't answering.
import { ensureTab, appendRows, readTabIfAny, replaceTab, sheetsConfigured, updateRange, updateRanges } from "./google/sheets";
import { records } from "./parse";
import manifest from "../../extension-working/manifest.json";
import { clearCart, loadCart, matchCart, savePick, setCartLine, setCartLines } from "./safeway";
import { imageFor, orderSince } from "./safeway-helper.mjs";
import { doneShopping } from "./groceries";
import { recordTrip } from "./plan";
import { todayIn } from "./time";

/** `cart`: show Safeway's cart page in the Safeway tab (and read it), for Cart in the panel (helper 1.2 on). */
export const JOB_KINDS = ["search", "setQty", "cart", "sample", "snapshot", "checkoutLook"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "waiting" | "working" | "done" | "failed";
export type Job = { id: string; kind: JobKind; status: JobStatus; args: Record<string, unknown>; result: Record<string, unknown> | null; created: string; updated: string };
/** A browser push subscription (its JSON), and the public key it was made with. */
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Helper = { seen: string; version: string; panel: boolean; push?: { key: string; sub: PushSub } | null };
/** Where a job was asked for: Simmer in the helper's panel, or anywhere else (the phone, mostly). */
export type JobFrom = "panel" | "app";
/** A job as the panel's activity log tells it. */
export type Activity = { id: string; kind: "search" | "setQty"; status: JobStatus; from: JobFrom; what: string; qty: number | null; error: string; signedIn: boolean; created: string; updated: string };

/**
 * How long things take. `alive`: the helper counts as answering if it checked in this recently (its slowest check is
 * every half minute, so two missed checks). `pickup`: a job nobody's taken by then is given up. `stuck`: a job taken but not reported by then
 * failed. `keep`: finished jobs are kept this long. `seenEvery`: how often a check-in is written down (so `alive` survives
 * a lost write or two). `cache`: how long one read of the tab answers everyone's checks. `stale`: when the Sheet can't
 * be read (it allows 60 reads a minute), the last copy answers for this long instead of the tab looking empty. `away`:
 * no check-in for this long and Shop drops its Safeway controls and makes its rows a checklist (Nov 3). The helper's
 * half-minute alarm checks in whenever Chrome runs, even with nothing to do, so that's four missed checks.
 */
export const JOB_TIMES = { alive: 90_000, away: 120_000, pickup: 20_000, stuck: 120_000, keep: 15 * 60_000, seenEvery: 20_000, cache: 2_000, stale: 60_000 };

const TAB = "Safeway jobs";
const HEADERS = ["id", "kind", "status", "args", "result", "created", "updated"];
const HELPER = "helper";

type Row = Job & { row: number };
type Tab = { at: number; jobs: Row[]; helper: Helper | null; helperRow: number; rows: number; junk: number };
let memory: { jobs: Job[]; helper: Helper | null } = { jobs: [], helper: null };
// A copy of the tab for a moment, so the helper's and the app's frequent checks don't each read the Sheet; and the last
// copy read, for when a read fails.
let cache: Tab | null = null;
let lastGood: Tab | null = null;

const json = <T>(s: string, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();
const age = (iso: string) => Date.now() - Date.parse(iso || "1970-01-01");
/** What the helper's row keeps besides when it was seen. */
const helperCell = (h: Omit<Helper, "seen">) => JSON.stringify({ version: h.version, panel: h.panel, ...(h.push && { push: h.push }) });
const cells = (j: Job) => [j.id, j.kind, j.status, JSON.stringify(j.args), j.result ? JSON.stringify(j.result) : "", j.created, j.updated];

/**
 * The tab, read at most every couple of seconds. A failed read is never taken for an empty tab (that once made every
 * check-in add another header and check-in row, and the helper looked gone while it was answering): the last copy
 * answers for a minute, then it throws.
 */
async function read(): Promise<Tab> {
  if (!sheetsConfigured()) return { at: Date.now(), jobs: memory.jobs.map((j, i) => ({ ...j, row: i })), helper: memory.helper, helperRow: 0, rows: memory.jobs.length, junk: 0 };
  if (cache && Date.now() - cache.at < JOB_TIMES.cache) return cache;
  let rows: string[][];
  try { rows = await readTabIfAny(TAB); }
  catch (e) { if (lastGood && Date.now() - lastGood.at < JOB_TIMES.stale) return lastGood; throw e; }
  cache = lastGood = parseTab(rows);
  return cache;
}

/** The tab's rows as jobs and the helper's check-in (the latest, if there's more than one), and how many rows are junk. */
export function parseTab(rows: string[][]): Tab {
  let helper: Helper | null = null, helperRow = 0, junk = 0;
  const jobs: Row[] = [];
  for (const r of records(rows)) {
    if (r.get("id") === HELPER) {
      const h: Helper = { seen: r.get("updated"), ...json<Omit<Helper, "seen">>(r.get("result"), { version: "", panel: false }) };
      if (helper) junk++;
      if (!helper || h.seen > helper.seen) { helper = h; helperRow = r.rowNumber; }
      continue;
    }
    if (!r.get("id") || !(JOB_KINDS as readonly string[]).includes(r.get("kind"))) { junk++; continue; }
    jobs.push({ id: r.get("id"), kind: r.get("kind") as JobKind, status: (r.get("status") || "waiting") as JobStatus, args: json(r.get("args"), {}), result: json(r.get("result"), null), created: r.get("created"), updated: r.get("updated"), row: r.rowNumber });
  }
  return { at: Date.now(), jobs, helper, helperRow, rows: rows.length, junk };
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
    if (lastGood) lastGood = { ...lastGood, jobs: [...lastGood.jobs, { ...j, row: lastGood.rows + 1 }], rows: lastGood.rows + 1 };
  }
  return j;
}

/** Drops finished jobs older than a few minutes, and junk rows (stray headers, extra check-ins). */
async function prune({ jobs, junk }: Tab) {
  // Waiting or working ones nobody finished count too (six searches sat "waiting" for days, Nov 3).
  const old = (j: Job) => (j.status === "done" || j.status === "failed" || overdue(j)) && age(j.updated) > JOB_TIMES.keep;
  if (jobs.filter(old).length < 10 && !junk) return;
  const keep = jobs.filter((j) => !old(j));
  if (!sheetsConfigured()) { memory.jobs = keep; return; }
  const h = (await read()).helper;
  await replaceTab(TAB, [HEADERS, ...(h ? [[HELPER, "check-in", "", "", helperCell(h), "", h.seen]] : []), ...keep.map(cells)]);
  cache = lastGood = null;
}

/** Jobs left too long: waiting with nobody taking them, or taken and never reported. */
const overdue = (j: Job) => (j.status === "waiting" && age(j.created) > JOB_TIMES.pickup) || (j.status === "working" && age(j.updated) > JOB_TIMES.stuck);

export const helperAnswering = (h: Helper | null) => Boolean(h && age(h.seen) < JOB_TIMES.alive);

/** The helper's version as this Simmer ships it (extension-working/manifest.json). */
export const HELPER_VERSION: string = manifest.version;
const parts = (v: string) => v.split(".").map((n) => Number(n) || 0);
/** Whether version `have` is older than `want`, every part compared: 26.11.10.1 (a second release that day) is newer than 26.11.10. */
export const olderVersion = (have: string, want: string) => {
  const [a, b] = [parts(have), parts(want)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};
/** Whether the helper that checked in is older than the one this Simmer ships, so it needs updating on the computer. */
export const helperOutdated = (h: Helper | null) => Boolean(h?.version) && olderVersion(h!.version, HELPER_VERSION);

/** Not checked in for a couple of minutes (or never): Safeway can't be reached from Simmer just now. */
export const helperAway = (h: Helper | null) => !h || age(h.seen) >= JOB_TIMES.away;

export async function helperStatus(): Promise<{ answering: boolean; seen: string; away: boolean; outdated: boolean }> {
  const { helper } = await read();
  // No timer keeps a check-in fresh any more (Nov 11): the helper only checks in when there's work. So Simmer doesn't
  // guess from the last check-in; a job the helper doesn't pick up says so (and Shop turns Safeway into a checklist).
  return { answering: true, seen: helper?.seen ?? "", away: false, outdated: helperOutdated(helper) };
}

/**
 * Simmer: queue a job. A quantity change for a product that's still waiting replaces the waiting one, so a few quick
 * taps on + become one trip to Safeway.
 */
export async function queueJob(kind: JobKind, args: Record<string, unknown>): Promise<Job> {
  const tab = await read();
  const { jobs } = tab;
  if (kind === "setQty") {
    const same = jobs.find((j) => j.kind === "setQty" && j.status === "waiting" && j.args.productId === args.productId && !overdue(j));
    if (same) return write({ ...same, args: { ...same.args, ...args } }, same.row);
  }
  // Showing the cart: one waiting is enough. While Simmer's copy has something in it, an empty Safeway cart also means
  // reading the Purchases page, to see whether the order went through (Nov 3).
  if (kind === "cart") {
    const same = jobs.find((j) => j.kind === "cart" && j.status === "waiting" && !overdue(j));
    if (same) return same;
    args = { ...args, orders: (await loadCart()).length > 0 };
  }
  await prune(tab).catch((e) => console.error("couldn't prune the jobs", e));
  return write({ id: newId(), kind, status: "waiting", args, result: null, created: now(), updated: now() });
}

/** Simmer: how a job stands. One left waiting too long is given up, so the app can say so instead of waiting on. */
export async function jobStatus(id: string): Promise<{ job: Job | null; answering: boolean }> {
  const { jobs } = await read();
  const j = jobs.find((x) => x.id === id) ?? null;
  if (j && overdue(j)) return { job: await write({ ...j, status: "failed", result: { error: j.status === "waiting" ? "not-answering" : "stuck" } }, j.row), answering: true /* no timer keeps check-ins fresh (Nov 11) */ };
  return { job: j, answering: true /* no timer keeps check-ins fresh (Nov 11) */ };
}

/**
 * Simmer: how a job stands, answered once it's finished or after `ms` (Nov 11: the app has no timers, so it doesn't keep
 * asking; the server waits here, between reads, and the app asks again only when an answer says it's still going).
 */
export async function waitForJob(id: string, ms = 20_000): Promise<{ job: Job | null; answering: boolean }> {
  const end = Date.now() + ms;
  for (;;) {
    const s = await jobStatus(id);
    if (!s.job || (s.job.status !== "waiting" && s.job.status !== "working") || Date.now() >= end) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Simmer: a job no longer wanted (only while nobody's taken it). */
export async function cancelJob(id: string): Promise<void> {
  const { jobs } = await read();
  const j = jobs.find((x) => x.id === id);
  if (j?.status === "waiting") await write({ ...j, status: "failed", result: { error: "cancelled" } }, j.row);
}

/**
 * The helper handing back a job it took just as it reloads for a newer version (Nov 12: the checkout look was lost that
 * way): waiting again, its pickup time starting over, for the reloaded helper to take.
 */
export async function returnJob(id: string): Promise<void> {
  const { jobs } = await read();
  const j = jobs.find((x) => x.id === id);
  if (j?.status === "working") await write({ ...j, status: "waiting", created: now(), updated: now() }, j.row);
}

/**
 * The helper's check-in to write down, or null when there's nothing new: it's written at most every 20 seconds (so
 * `alive` stays true), or when the panel opens or closes or the version changes.
 */
const checkInDue = (helper: Helper | null, version: string, panel: boolean): Helper | null =>
  helper && age(helper.seen) < JOB_TIMES.seenEvery && helper.panel === panel && helper.version === version ? null : { seen: now(), version, panel, push: helper?.push ?? null };

const helperRowCells = (h: Helper) => [HELPER, "check-in", "", "", helperCell(h), "", h.seen];

/** The helper's row, written where it's read from (the latest, when there are several), so what's written is what's read. */
async function writeHelper(h: Helper) {
  if (!sheetsConfigured()) { memory.helper = h; return; }
  const { helperRow, rows } = await read();
  const row = helperRowCells(h);
  if (helperRow) await updateRange(`${TAB}!A${helperRow}:G${helperRow}`, [row]);
  else { if (!rows) await ensureTab(TAB); await appendRows(TAB, [...(rows ? [] : [HEADERS]), row]); cache = lastGood = null; return; }
  for (const t of [cache, lastGood]) if (t) t.helper = h;
}

/**
 * Waking the helper (Nov 3): its push subscription, kept on its row with the public key it was made with (a new key
 * needs a new subscription). Null takes it off, when the push service says it's gone.
 */
export async function savePush(push: { key: string; sub: PushSub } | null): Promise<void> {
  const { helper } = await read();
  await writeHelper({ seen: helper?.seen ?? now(), version: helper?.version ?? "", panel: helper?.panel ?? false, push });
}
export const helperPush = async () => (await read()).helper?.push ?? null;

/**
 * The helper: check in, and take the oldest waiting job (null when there's none). The helper asks every few seconds, so
 * this is at most one write (Nov 10): none when there's nothing new to note and no job, and the check-in and the job
 * taken together when there's both.
 */
export async function takeJob(version: string, panel: boolean): Promise<Job | null> {
  const tab = await read();
  const h = checkInDue(tab.helper, version, panel);
  const j = tab.jobs.filter((x) => x.status === "waiting" && !overdue(x)).sort((a, b) => a.created.localeCompare(b.created))[0];
  if (h && j && tab.helperRow && sheetsConfigured()) {
    const job: Row = { ...j, status: "working", updated: now() };
    await updateRanges([{ range: `${TAB}!A${tab.helperRow}:G${tab.helperRow}`, values: [helperRowCells(h)] }, { range: `${TAB}!A${j.row}:G${j.row}`, values: [cells(job)] }]);
    for (const t of [cache, lastGood]) if (t) t.helper = h;
    if (cache) cache.jobs = cache.jobs.map((x) => (x.id === job.id ? job : x));
    return job;
  }
  if (h) await writeHelper(h).catch((e) => console.error("couldn't note the helper", e));
  if (!j) return null;
  return write({ ...j, status: "working" }, j.row);
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const productsOf = (r: Record<string, unknown>) => (Array.isArray(r.products) ? r.products : []).slice(0, 40).flatMap((p) => {
  const id = str(p?.id, 20);
  // A picture Safeway hadn't loaded yet (further down its page) is Safeway's picture for that product number.
  return /^\d+$/.test(id) && str(p?.name) ? [{ id, name: str(p.name, 160), price: str(p.price, 40), image: imageFor(id, str(p.image, 500)), inCart: p.inCart === true, qty: Math.max(0, Math.min(99, Math.round(Number(p.qty) || 0))) }] : [];
});

/**
 * The helper: a job's outcome. A quantity set on Safeway goes into Simmer's cart, and a product added for an item
 * becomes that item's pick. What a search shows about products already in Simmer's cart keeps the cart in step.
 */
export async function finishJob(id: string, reported: boolean, reportedRaw: Record<string, unknown>): Promise<Job | null> {
  const { jobs } = await read();
  const j = jobs.find((x) => x.id === id);
  if (!j || j.status === "done" || j.status === "failed") return j ?? null;
  // Taking out a product Safeway no longer has is done: a second tap on the trash, or it was taken out on Safeway
  // already (Oct 31: the eggs went, a second removal a second later came back "not found").
  const gone = !reported && j.kind === "setQty" && Number(j.args.qty) === 0 && reportedRaw.error === "not-found";
  const ok = reported || gone;
  const raw: Record<string, unknown> = gone ? { ok: true, qty: 0 } : reportedRaw;
  let result: Record<string, unknown> = ok ? {} : { error: str(raw.error, 40) || "failed" };
  if (ok && j.kind === "search") {
    result = { products: productsOf(raw), signedIn: raw.signedIn !== false, noResults: raw.noResults === true };
    // Safeway's search results don't reliably show what's in the cart (a product in it came back "not in the cart",
    // Oct 31), so a search only ever brings Simmer's quantity up; the cart page (kind "cart") decides what's gone.
    // All of them in one save (one read, and one write only when a quantity went up).
    if (result.signedIn) {
      const products = result.products as ReturnType<typeof productsOf>;
      await setCartLines((cart) => products.flatMap((p) => {
        const line = cart.find((l) => l.productId === p.id);
        return line && p.inCart && p.qty > line.qty ? [{ productId: p.id, qty: p.qty }] : [];
      }));
    }
  }
  if (ok && j.kind === "setQty") {
    const a = j.args;
    const qty = Math.max(0, Math.min(99, Math.round(Number(raw.qty) || 0)));
    result = { qty, reached: raw.ok !== false && qty === Number(a.qty) };
    const name = str(raw.name, 160) || str(a.name, 160), image = imageFor(str(a.productId, 20), str(raw.image, 500) || str(a.image, 500));
    await setCartLine({ productId: str(a.productId, 20), qty, name, price: str(raw.price, 40) || str(a.price, 40), image, itemId: str(a.itemId, 40), item: str(a.item, 80) });
    if (qty > 0 && str(a.item, 80)) await savePick({ item: str(a.item, 80), id: str(a.productId, 20), name, image }).catch((e) => console.error("couldn't keep the pick", e));
  }
  if (ok && j.kind === "cart") {
    // Safeway's cart page: Simmer's cart becomes what's there (added on Safeway itself too; gone if no longer there).
    result = { products: productsOf(raw), signedIn: raw.signedIn !== false };
    if (result.signedIn && raw.empty === true) result = { ...result, ...(await emptied(raw.orders)) };
    else if (result.signedIn) await matchCart((result.products as ReturnType<typeof productsOf>).filter((p) => p.inCart));
  }
  if (ok && (j.kind === "sample" || j.kind === "snapshot")) result = { text: str(raw.text, 8000) };
  // The read-only checkout look (docs/CHECKOUT.md phase 1): each page's words, links and buttons, kept to read once.
  if (ok && j.kind === "checkoutLook") {
    const pages = (Array.isArray(raw.pages) ? raw.pages : []).slice(0, 5).map((p: Record<string, unknown>) => ({
      url: str(p?.url, 300), title: str(p?.title, 120), text: typeof p?.text === "string" ? p.text.slice(0, 12000) : "",
      links: (Array.isArray(p?.links) ? p.links : []).slice(0, 80).map((l: Record<string, unknown>) => ({ text: str(l?.text, 80), href: str(l?.href, 300) })),
      buttons: (Array.isArray(p?.buttons) ? p.buttons : []).slice(0, 80).map((b: unknown) => str(b, 80)),
    }));
    const pressed = raw.pressed && typeof raw.pressed === "object" ? raw.pressed as Record<string, unknown> : null;
    result = { pages, stopped: str(raw.stopped, 40), pressed: pressed && { pressed: pressed.pressed === true, found: Number(pressed.found) || 0, label: str(pressed.label, 80) } };
  }
  return write({ ...j, status: ok ? "done" : "failed", result }, (j as Row).row);
}

/** What the helper read on Safeway's Purchases page, checked and trimmed (the page's words kept, to learn from). */
const ordersOf = (o: unknown) => {
  if (!o || typeof o !== "object") return null;
  const x = o as Record<string, unknown>;
  return {
    online: x.online === true, none: x.none === true, signedIn: x.signedIn !== false,
    entries: (Array.isArray(x.entries) ? x.entries : []).slice(0, 10).map((e) => str(e, 400)).filter(Boolean), text: str(x.text, 2000),
  };
};

/**
 * Safeway's cart page said "Your shopping cart is empty." That alone only means the cart is empty: on Nov 3 it read
 * that with nothing ordered (a sign-in had emptied it). So the helper also reads the Purchases page (Online, Nov 3): an
 * order there placed since Simmer's cart was last filled means it went through, so the cart's things come off the
 * Safeway list and the trip is recorded, as Done shopping does. Otherwise only Simmer's copy of the cart empties and the
 * list stays ("Ordered? Take the cart off the list" is still there for when this can't tell).
 */
async function emptied(read: unknown): Promise<{ ordered: boolean; orders?: ReturnType<typeof ordersOf> }> {
  const orders = ordersOf(read);
  const cart = await loadCart();
  const filled = cart.map((l) => l.updated).filter(Boolean).sort().at(-1);
  const ordered = Boolean(cart.length && orders?.signedIn && orderSince(orders, filled ? todayIn(new Date(filled)) : "", todayIn()));
  if (ordered) {
    await doneShopping("safeway", new Set(cart.map((l) => l.itemId).filter(Boolean)));
    await recordTrip("safeway").catch((e) => console.error("couldn't record the trip", e));
  }
  await clearCart();
  return { ordered, ...(orders && { orders }) };
}

/** The panel's activity log: recent searches and cart changes, newest first, with where each was asked for. */
export async function recentJobs(limit = 20): Promise<Activity[]> {
  const { jobs } = await read();
  return jobs.flatMap((j): Activity[] => {
    if (j.kind !== "search" && j.kind !== "setQty") return [];
    const late = overdue(j), r = j.result ?? {};
    return [{
      id: j.id, kind: j.kind, status: late ? "failed" : j.status, from: j.args.from === "panel" ? "panel" : "app",
      what: str(j.args.name, 160) || str(j.args.query, 120), qty: j.kind === "setQty" ? Number(r.qty ?? j.args.qty) || 0 : null,
      error: late ? (j.status === "waiting" ? "not-answering" : "stuck") : str(r.error, 40), signedIn: r.signedIn !== false,
      created: j.created, updated: j.updated,
    }];
  }).sort((a, b) => b.created.localeCompare(a.created)).slice(0, limit);
}

/** For tests. */
export const resetJobs = () => { memory = { jobs: [], helper: null }; cache = lastGood = null; };
