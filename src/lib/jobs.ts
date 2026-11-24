// Small jobs for the Safeway helper (extension-working/), queued by Simmer and done by the helper in Chrome on a computer:
// search Safeway, set a product's quantity in the cart, read the cart, or go through checkout. Simmer queues a job and
// pushes the helper a wake-up (push.ts); the helper asks for the oldest waiting job, does it, and reports back, until
// none are left. The phone and the panel at the computer use the same path, so they behave the same.
//
// Kept in Redis, one key per job (Nov 19): they were one value read and written back whole, addressed by row numbers
// from a copy a couple of seconds old, so two changes at once could undo each other. Now each job is its own key
// (simmer:job:<id>, dropped by Redis a day after its last change), every status change is made only from the status
// read, in one step (kv.ts swap), and two sorted sets index them: every job by when it was queued (the panel's log),
// and the ones still open (the queue).
import { NS } from "./store";
import manifest from "../../extension-working/manifest.json";
import { clearCart, loadCart, matchCart, savePick, setCartLine, setCartLines } from "./safeway";
import { imageFor, orderSince } from "./safeway-helper.mjs";
import { doneShopping } from "./groceries";
import { recordTrip } from "./plan";
import { todayIn } from "./time";
import { json, kv, resetKv, swap } from "./kv";

/** `cart`: show Safeway's cart page in the Safeway tab (and read it), for Cart in the panel (helper 1.2 on). */
export const JOB_KINDS = ["search", "setQty", "cart", "sample", "snapshot", "checkoutLook", "checkoutPrepare", "checkoutDry", "checkoutPlace"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
/** `pressing` (Nov 19): a placing job whose helper Simmer has just let press Place Order; it's never given up on. */
export type JobStatus = "waiting" | "working" | "pressing" | "done" | "failed";
export type Job = {
  id: string; kind: JobKind; status: JobStatus; args: Record<string, unknown>; result: Record<string, unknown> | null; created: string; updated: string;
  /** When Simmer let the helper press Place Order (Nov 19, review): kept after the report, so a lost press is never "nothing ordered". */
  pressedAt?: string;
  /** When a report started being worked through (Nov 19, review): a second copy arriving meanwhile does nothing. */
  reporting?: string;
};
/** A browser push subscription (its JSON), and the public key it was made with. */
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type Helper = { seen: string; version: string; panel: boolean };
/** Where a job was asked for: Simmer in the helper's panel, or anywhere else (the phone, mostly). */
export type JobFrom = "panel" | "app";
/** A job as the panel's activity log tells it. */
export type Activity = { id: string; kind: "search" | "setQty"; status: JobStatus; from: JobFrom; what: string; qty: number | null; error: string; signedIn: boolean; noPickup?: boolean; created: string; updated: string };

/**
 * The limits left (Nov 23, Sam: "don't timers fail consistently?"). What decides is what happened: the helper asking for
 * jobs or reporting one (its check-in), and a job it's working on. While it works on one, everything behind it waits.
 * - `pickup`: how long a new job waits for the helper's first sign after it was queued (its wake-up is a push, answered
 *   in a second or two when the computer's awake). Only when nothing at all has come from the helper since the job was
 *   queued, and it isn't working on anything, is the job "not answering": silence can only be seen by waiting for it. A
 *   minute for checkout's (Nov 14: a wake-up came late, and the phone wakes it again as it follows).
 * - `stuck`: a backstop for a job taken and never reported (the computer slept mid-job, or a page never loaded; the
 *   helper's own steps each have a limit, so a helper that's running always reports). Five minutes: longer than the
 *   longest job runs. A placing job counts from its approval's deadline instead, below.
 * - `unclaimed`: a backstop for a job the helper has seen but doesn't take (an older helper doesn't take test runs).
 * - `keep`: how long Redis keeps a job after its last change.
 */
export const JOB_TIMES = { pickup: 20_000, checkoutPickup: 60_000, stuck: 5 * 60_000, unclaimed: 3 * 60_000, keep: 24 * 3600_000 };
/**
 * A placing job taken by the helper is stuck only a minute after its approval ran out (Nov 19): the press may come right
 * at the deadline, and Safeway's confirmation can take ~45 s after it. Once the helper has asked to press (`pressing`)
 * it's never stuck: only its own report, or Safeway, says what happened.
 */
const PLACE_AFTER_DEADLINE = 60_000;

const JOB = (id: string) => `${NS}:job:${id}`;
/** Every job by when it was queued, for the panel's log; trimmed to a day as jobs are queued. */
const INDEX = `${NS}:jobs`;
/** The jobs still waiting or being done (the queue); one that finished leaves it. */
const OPEN = `${NS}:jobs-open`;
const HELPER_KEY = `${NS}:helper`;
const KEEP_S = JOB_TIMES.keep / 1000;

// An id sorts as it was made: the time, then a count within this server (two jobs queued in the same millisecond keep
// their order), then a little randomness.
let made = 0;
const newId = () => `${Date.now().toString(36)}${(made++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 4)}`;
const now = () => new Date().toISOString();
const age = (iso: string) => Date.now() - Date.parse(iso || "1970-01-01");
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const going = (s: JobStatus) => s === "waiting" || s === "working" || s === "pressing";

/** A job as kept, or null (never kept, or dropped after a day). */
export const getJob = async (id: string): Promise<Job | null> => (/^[a-z0-9]{1,40}$/.test(id) ? json<Job>(await kv().get(JOB(id))) : null);

/** Several jobs in one read, with what each was read as (for changing it only from that). */
async function readJobs(ids: string[]): Promise<{ job: Job; raw: string }[]> {
  if (!ids.length) return [];
  const raws = await kv().mget(...ids.map(JOB));
  return raws.flatMap((raw) => { const job = json<Job>(raw); return job && raw ? [{ job, raw }] : []; });
}

/** The open jobs, oldest first; ids whose job finished or is gone are taken out of the queue as they're seen. */
async function openJobs(): Promise<{ job: Job; raw: string }[]> {
  const ids = await kv().zrange(OPEN, 0, -1);
  const found = await readJobs(ids);
  const stale = ids.filter((id) => !found.some((f) => f.job.id === id && going(f.job.status)));
  if (stale.length) await kv().zrem(OPEN, ...stale);
  return found.filter((f) => going(f.job.status));
}

/** A new job, kept and queued. */
async function add(j: Job): Promise<Job> {
  const at = Date.parse(j.created) || Date.now();
  await kv().set(JOB(j.id), JSON.stringify(j), { ex: KEEP_S });
  await Promise.all([kv().zadd(INDEX, { score: at, member: j.id }), kv().zadd(OPEN, { score: at, member: j.id })]);
  return j;
}

/**
 * Changes a job only from what it was when read, in one step: `next` says what it becomes (null: leave it). If it changed
 * meanwhile, it's read again and `next` asked again, so a change is always made from the job as it really is.
 * Answers the job as it ends up (null when there's none).
 */
async function change(id: string, next: (j: Job) => Job | null, read?: { job: Job; raw: string }): Promise<Job | null> {
  for (let i = 0; i < 8; i++) {
    let cur = read;
    read = undefined;
    if (!cur) { const raw = await kv().get(JOB(id)); const job = json<Job>(raw); if (!job || !raw) return null; cur = { job, raw }; }
    const n = next(cur.job);
    if (!n) return cur.job;
    const after: Job = { ...n, updated: now() };
    if (await swap(JOB(id), cur.raw, JSON.stringify(after), KEEP_S)) {
      if (!going(after.status)) await kv().zrem(OPEN, id);
      else if (!going(cur.job.status)) await kv().zadd(OPEN, { score: Date.parse(after.created) || Date.now(), member: id });
      if (after.kind === "checkoutPlace" && !going(after.status)) await settlePlacing(after);
      return after;
    }
  }
  throw new Error("A Safeway job kept changing.");
}

/**
 * Every way a placing job finishes (reported, handed back, given up, lost in a reload) has what it came to worked out and
 * recorded at once (Nov 19, review: a reload or a give-up left no outcome in the record). Imported when needed:
 * checkout-run.ts imports this file.
 */
async function settlePlacing(j: Job): Promise<void> {
  try { await (await import("./checkout-run")).settleOrder(j); } catch (e) { console.error("couldn't settle the order", e); }
}

/** How long a job may wait to be taken. */
const pickupFor = (j: Job) => (j.kind.startsWith("checkout") ? JOB_TIMES.checkoutPickup : JOB_TIMES.pickup);
/** When a taken job counts as stuck: two minutes after it was taken, and for placing not before a minute past the approval's deadline. */
const stuckAt = (j: Job) => {
  const taken = Date.parse(j.updated || "1970-01-01") + JOB_TIMES.stuck;
  const deadline = Number((j.args.expect as { deadline?: unknown } | undefined)?.deadline);
  return j.kind === "checkoutPlace" && Number.isFinite(deadline) ? Math.max(taken, deadline + PLACE_AFTER_DEADLINE) : taken;
};
/**
 * Where the helper stands, for judging a waiting job (Nov 23: a search queued while the helper read the cart for 33 s
 * was given up "not answering" at 20 s). `busy`: it's working on a job (taken, not past its backstop). `seen`: when
 * anything last came from it (asking for jobs, or a report).
 */
export type Queue = { busy: boolean; seen: number };
const stuck = (j: Job) => j.status === "working" && Date.now() > stuckAt(j);
const queueOf = (open: Job[], helper: Helper | null): Queue => ({
  busy: open.some((j) => j.status === "pressing" || (j.status === "working" && !stuck(j))),
  seen: Date.parse(helper?.seen || "1970-01-01") || 0,
});
async function queueNow(open?: Job[]): Promise<Queue> {
  const [jobs, helper] = await Promise.all([open ? Promise.resolve(open) : openJobs().then((o) => o.map((x) => x.job)), loadHelper()]);
  return queueOf(jobs, helper);
}
/**
 * Jobs left too long, judged from what happened. Waiting: given up only when the helper is working on nothing and nothing
 * has come from it since the job was queued (past the pickup window); one it has seen since is given up only past the
 * `unclaimed` backstop. Taken: past its backstop. Never one that's pressing.
 */
export const overdue = (j: Job, q: Queue) => {
  if (j.status === "working") return stuck(j);
  if (j.status !== "waiting" || age(j.created) <= pickupFor(j) || q.busy) return false;
  return q.seen > Date.parse(j.created) ? age(j.created) > JOB_TIMES.unclaimed : true;
};
const lateError = (j: Job) => (j.status === "waiting" ? "not-answering" : "stuck");
/**
 * Whether the computer looks away (Nov 19, for Shop's plain checklist): set when a job is given up as not answering or
 * stuck, and cleared when a job is next done, so it says the latest job failed that way and none has worked since.
 */
const AWAY_KEY = `${NS}:helper-away`;
/** An overdue job, given up: failed, with why (only if it's still as it was read). */
async function giveUp(id: string, q: Queue, read?: { job: Job; raw: string }): Promise<Job | null> {
  const j = await change(id, (x) => (overdue(x, q) ? { ...x, status: "failed", result: { error: lateError(x) } } : null), read);
  if (j?.status === "failed" && (j.result?.error === "not-answering" || j.result?.error === "stuck")) await kv().set(AWAY_KEY, now(), { ex: 30 * 24 * 3600 });
  return j;
}

/**
 * Whether a cart change is still on its way to Safeway (Nov 16, Sam: no checking out while things are in progress):
 * a quantity change waiting for the helper or being made. One left too long doesn't count.
 */
export async function cartChanging(): Promise<boolean> {
  const open = (await openJobs()).map((o) => o.job);
  const q = await queueNow(open);
  return open.some((j) => j.kind === "setQty" && !overdue(j, q));
}

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

/**
 * Whether Safeway was last seen signed out on the computer (Nov 16, Sam: Shop showed the cart while Safeway was signed
 * out, and it may not be right). Set by a cart read or search that sees Safeway signed out, and by a checkout step
 * that stopped "signed out"; only a cart read that sees Safeway signed in clears it (and puts the cart right). Kept under its own key, so a check-in never writes over it.
 */
const SIGNED_OUT_KEY = `${NS}:safeway-signed-out`;
/**
 * Signed in with Pickup not chosen on Safeway (Nov 23: after signing in again Safeway had forgotten Pickup and sent every
 * page home, the cart too, and Simmer said signed out while Sam was signed in). Set by a cart read, search, Add or
 * checkout step that saw it; like signed out, only a cart read that sees Safeway's cart clears it. Its own key too.
 */
const NO_PICKUP_KEY = `${NS}:safeway-no-pickup`;
/** How Safeway was last seen on the computer: signed in, signed out, or signed in with Pickup not chosen. */
export type SafewaySeen = "in" | "out" | "no-pickup";
async function noteSafeway(seen: SafewaySeen): Promise<void> {
  const keep = { ex: 30 * 24 * 3600 };
  if (seen === "in") await Promise.all([kv().del(SIGNED_OUT_KEY), kv().del(NO_PICKUP_KEY)]);
  else if (seen === "out") await Promise.all([kv().set(SIGNED_OUT_KEY, now(), keep), kv().del(NO_PICKUP_KEY)]);
  else await Promise.all([kv().set(NO_PICKUP_KEY, now(), keep), kv().del(SIGNED_OUT_KEY)]);
}
const noteSignedIn = (signedIn: boolean) => noteSafeway(signedIn ? "in" : "out");
export const safewaySignedOut = async (): Promise<boolean> => Boolean(await kv().get(SIGNED_OUT_KEY));
/** Whether Safeway was last seen signed in with Pickup not chosen. */
export const safewayNoPickup = async (): Promise<boolean> => Boolean(await kv().get(NO_PICKUP_KEY));

const loadHelper = async (): Promise<Helper | null> => json<Helper>(await kv().get(HELPER_KEY));
/**
 * When the helper last checked in and whether it needs updating. No timer keeps a check-in fresh (Nov 11), so an old
 * check-in alone never says the computer's away: a job nobody takes says so (`overdue`).
 */
export async function helperStatus(): Promise<{ seen: string; outdated: boolean; away: boolean }> {
  const [helper, away] = await Promise.all([loadHelper(), kv().get(AWAY_KEY)]);
  return { seen: helper?.seen ?? "", outdated: helperOutdated(helper), away: Boolean(away) };
}

/**
 * Simmer: queue a job. A quantity change for a product that's still waiting replaces the waiting one, so a few quick
 * taps on + become one trip to Safeway.
 */
export async function queueJob(kind: JobKind, args: Record<string, unknown>): Promise<Job> {
  if (kind === "setQty" || kind === "cart") {
    const open = await openJobs();
    const q = await queueNow(open.map((o) => o.job));
    if (kind === "setQty") {
      const same = open.find(({ job: j }) => j.kind === "setQty" && j.status === "waiting" && j.args.productId === args.productId && !overdue(j, q));
      // Only while it's still waiting: one taken meanwhile stays as it is, and this one is queued after it.
      const merged = same && (await change(same.job.id, (j) => (j.status === "waiting" ? { ...j, args: { ...j.args, ...args } } : null), same));
      if (merged && merged.status === "waiting" && merged.args.qty === args.qty) return merged;
    }
    // Showing the cart: one waiting is enough. While Simmer's copy has something in it, an empty Safeway cart also means
    // reading the Purchases page, to see whether the order went through (Nov 3).
    if (kind === "cart") {
      const same = open.find(({ job: j }) => j.kind === "cart" && j.status === "waiting" && !overdue(j, q));
      if (same) return same.job;
      args = { ...args, orders: (await loadCart()).length > 0 };
    }
  }
  await kv().zremrangebyscore(INDEX, 0, Date.now() - JOB_TIMES.keep);
  return add({ id: newId(), kind, status: "waiting", args, result: null, created: now(), updated: now() });
}

/**
 * Simmer: how a job stands (one read). One the helper isn't going to do is given up, so the app can say so instead of
 * waiting on. Where the helper stands is read only once the job could be overdue at all (past its pickup window, or taken).
 */
export async function jobStatus(id: string): Promise<Job | null> {
  const raw = /^[a-z0-9]{1,40}$/.test(id) ? await kv().get(JOB(id)) : null;
  const j = json<Job>(raw);
  if (!j || !raw) return j;
  const could = j.status === "working" ? stuck(j) : j.status === "waiting" && age(j.created) > pickupFor(j);
  if (!could) return j;
  const q = await queueNow();
  return overdue(j, q) ? giveUp(id, q, { job: j, raw }) : j;
}

/**
 * Simmer: how a job stands, answered once it's finished or after `ms` (Nov 11: the app has no timers, so it doesn't keep
 * asking; the server waits here, and the app asks again only when an answer says it's still going). Redis over Upstash's
 * web API has no way to wait for a key to change (no blocking reads, no notifications), so this is one bounded loop of
 * single-key reads, a second apart (Nov 19: it used to read every job each time).
 */
export async function waitForJob(id: string, ms = 20_000): Promise<Job | null> {
  const end = Date.now() + ms;
  for (;;) {
    const j = await jobStatus(id);
    if (!j || !going(j.status) || Date.now() >= end) return j;
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(0, end - Date.now()))));
  }
}

/** Simmer: a job no longer wanted (only while nobody's taken it). */
export async function cancelJob(id: string): Promise<void> {
  if (await getJob(id)) await change(id, (j) => (j.status === "waiting" ? { ...j, status: "failed", result: { error: "cancelled" } } : null));
}

/** A placing job the helper had taken: never handed out again (it may have pressed), so it's marked unsure. */
const unsure = (j: Job): Job => ({ ...j, status: "failed", result: { error: "unsure" } });

/**
 * The helper handing back a job it took just as it reloads for a newer version (Nov 12: the checkout look was lost that
 * way): waiting again, its pickup time starting over, for the reloaded helper to take.
 */
export async function returnJob(id: string): Promise<Job | null> {
  if (!(await getJob(id))) return null;
  return change(id, (j) => {
    if (j.kind === "checkoutPlace" && (j.status === "working" || j.status === "pressing")) return unsure(j);
    return j.status === "working" ? { ...j, status: "waiting", created: now() } : null;
  });
}

/**
 * "May I press?" (Nov 19): the helper asks right before pressing Place Order. Only a placing job it's working on, within
 * its approval's deadline by Simmer's own clock, moves to `pressing`, in one step; from then on nothing marks it failed
 * or not answering, so Simmer can never say "nothing was ordered" about an order that may have been placed. Anything else:
 * no, and the helper doesn't press.
 */
export async function pressJob(id: string): Promise<boolean> {
  if (!(await getJob(id))) return false;
  let allowed = false;
  await change(id, (j) => {
    const deadline = Number((j.args.expect as { deadline?: unknown } | undefined)?.deadline);
    allowed = j.kind === "checkoutPlace" && j.status === "working" && Number.isFinite(deadline) && Date.now() < deadline;
    // When, kept with the job (Nov 19, review): once it got here, only Safeway's page saying it didn't press is "nothing ordered".
    return allowed ? { ...j, status: "pressing", pressedAt: now() } : null;
  });
  return allowed;
}

/**
 * The helper's check-in, written each time it asks for jobs (Nov 23: it's what says the helper is answering, so it's
 * never left a few seconds old; the helper asks only when woken or after a job, never on a timer). Kept under its own
 * key, as the wake-up subscription is. Answers the check-in before this one.
 */
async function checkIn(version: string, panel: boolean): Promise<Helper | null> {
  const helper = await loadHelper();
  await kv().set(HELPER_KEY, JSON.stringify({ seen: now(), version, panel } satisfies Helper), { ex: 400 * 24 * 3600 });
  return helper;
}
/** A report from the helper counts as a check-in too (it pauses a moment before asking for the next job). */
async function seenNow(): Promise<void> {
  const helper = await loadHelper();
  if (helper) await kv().set(HELPER_KEY, JSON.stringify({ ...helper, seen: now() } satisfies Helper), { ex: 400 * 24 * 3600 });
}

/**
 * The helper's wake-up subscription, kept under its own key (Nov 14): kept in the helper's row, a check-in written from
 * a copy read a moment before put the old subscription back over a new one, the push service said the old one was
 * gone, and nothing could wake the helper. Its own key is written only when the helper subscribes. Null takes it off,
 * when the push service says it's gone.
 */
const PUSH_KEY = `${NS}:helper-push`;
export async function savePush(push: { key: string; sub: PushSub } | null): Promise<void> {
  if (push) await kv().set(PUSH_KEY, JSON.stringify(push), { ex: 400 * 24 * 3600 });
  else await kv().del(PUSH_KEY);
}
export const helperPush = async (): Promise<{ key: string; sub: PushSub } | null> => json<{ key: string; sub: PushSub }>(await kv().get(PUSH_KEY));

/**
 * The helper: check in, and take the oldest waiting job (null when there's none). Taking it is one step only one asker
 * can win (Nov 19, for every kind; outside review, Nov 14, for placing): it moves from waiting to working only if it's
 * still waiting, so two helpers asking at once can't both have it.
 */
/**
 * A job a helper took and dropped (26.11.23.2): when that same helper asks for the next job, it isn't doing anything (it
 * asks only between jobs), so a job it took that's still marked working, and that it holds no report for, was dropped
 * mid-way (Chrome stopped its background, Nov 23). It's said at once ("lost"), never done again (an Add may have been
 * pressed), and not taken as the computer being away. Checkout's jobs are left to their own rules (docs/CHECKOUT.md).
 */
const dropped = (j: Job, asker: { helper: string; pending: string[] | null }) =>
  j.status === "working" && !j.kind.startsWith("checkout") && Boolean(asker.helper) && j.args.took === asker.helper && Array.isArray(asker.pending) && !asker.pending.includes(j.id);

export async function takeJob(version: string, panel: boolean, asker: { helper: string; pending: string[] | null } = { helper: "", pending: null }): Promise<Job | null> {
  const [before, open] = await Promise.all([checkIn(version, panel), openJobs()]);
  // A helper checking in as a new version has just reloaded, so a job the old one was in the middle of was dropped: it
  // goes back to waiting for this one (Nov 13: the hand-back the old helper sends as it reloads didn't always arrive).
  // Never an order (phase 3): a placing job the old helper had taken may already have pressed, so it's never handed out
  // again; it's marked unsure, and Simmer says to check Safeway.
  const reloaded = Boolean(before?.version && version && before.version !== version);
  // The helper is here now: nothing waiting is given up as not answering while it asks (Nov 23).
  const q: Queue = { ...queueOf(open.map((o) => o.job), null), seen: Date.now() };
  const waiting: { job: Job; raw: string }[] = [];
  for (const o of open) {
    const j = o.job;
    if (overdue(j, q)) { await giveUp(j.id, q, o); continue; }
    if (!reloaded && dropped(j, asker)) { await change(j.id, (x) => (dropped(x, asker) ? { ...x, status: "failed", result: { error: "lost" } } : null), o); continue; }
    if (reloaded && (j.status === "working" || j.status === "pressing")) {
      const back = await change(j.id, (x) => (x.status !== "working" && x.status !== "pressing" ? null : x.kind === "checkoutPlace" ? unsure(x) : { ...x, status: "waiting", created: now() }), o);
      if (back?.status === "waiting") waiting.push({ job: back, raw: JSON.stringify(back) });
      continue;
    }
    if (j.status === "waiting") waiting.push(o);
  }
  waiting.sort((a, b) => a.job.created.localeCompare(b.job.created) || a.job.id.localeCompare(b.job.id));
  for (const w of waiting) {
    // Test runs and placing only by the helper Simmer ships (Nov 19, review): an older one never asks "may I press?".
    if ((w.job.kind === "checkoutPlace" || w.job.kind === "checkoutDry") && version !== HELPER_VERSION) continue;
    // A placing job is also claimed under its own key first (outside review, Nov 14), which stays even if it's handed back.
    if (w.job.kind === "checkoutPlace" && (await kv().set(`${NS}:claimed:${w.job.id}`, "1", { ex: 24 * 3600, nx: true })) !== "OK") continue;
    let took = false;
    // Which helper took it (outside review, Nov 18): a test run counts only for the helper Simmer ships.
    // `took`: which helper (its own name, 26.11.23.2), so a job it drops can be told when it next asks.
    const job = await change(w.job.id, (j) => { took = j.status === "waiting"; return took ? { ...j, status: "working", args: { ...j.args, by: str(version, 40), ...(asker.helper && { took: str(asker.helper, 60) }) } } : null; });
    if (job && took) return job;
  }
  return null;
}

const productsOf = (r: Record<string, unknown>) => (Array.isArray(r.products) ? r.products : []).slice(0, 40).flatMap((p) => {
  const id = str(p?.id, 20);
  // A picture Safeway hadn't loaded yet (further down its page) is Safeway's picture for that product number.
  return /^\d+$/.test(id) && str(p?.name) ? [{ id, name: str(p.name, 160), price: str(p.price, 40), image: imageFor(id, str(p.image, 500)), inCart: p.inCart === true, qty: Math.max(0, Math.min(99, Math.round(Number(p.qty) || 0))) }] : [];
});

/** Whether a report counts: not for a job already finished, except a placing job's own report (it's what happened on Safeway). */
const takesReport = (j: Job, reported: boolean) => !(j.status === "done" || (j.status === "failed" && !(j.kind === "checkoutPlace" && reported)));

/** How long a report being worked through holds off a second copy of it (one whose server stopped midway is taken after). */
const REPORT_HOLD = 60_000;

/**
 * How long each Safeway job took, from asking to its report (Sam, Nov 23: "once we get some runs under our belt maybe
 * we can try and optimize"): the last 500, kept 90 days, so slow kinds and steps can be found later. Kind, seconds,
 * whether it went through and its error or stop; nothing else. Read with scripts/helper-status.mjs.
 */
const TIMES_KEY = `${NS}:job-times`;
async function noteTime(j: Job, at: string, ok: boolean, why: string) {
  try {
    const s = kv();
    await s.rpush(TIMES_KEY, JSON.stringify({ at, kind: j.kind, s: Math.round((Date.parse(at) - Date.parse(j.created)) / 100) / 10, ok, ...(why && { why }) }));
    await s.ltrim(TIMES_KEY, -500, -1);
    await s.expire(TIMES_KEY, 90 * 24 * 3600);
  } catch { /* a missed timing never stops a job's report */ }
}

/**
 * The helper: a job's outcome. A quantity set on Safeway goes into Simmer's cart, and a product added for an item
 * becomes that item's pick. What a search shows about products already in Simmer's cart keeps the cart in step. A report
 * sent twice (the helper keeps one until Simmer has it, Nov 19) counts once: it's claimed on the job in one step first
 * (Nov 19, review: two copies at once both changed the cart), and only the copy that claimed it does anything.
 */
export async function finishJob(id: string, reported: boolean, reportedRaw: Record<string, unknown>): Promise<Job | null> {
  if (!(await getJob(id))) return null;
  const at = now();
  let mine = false;
  const j = await change(id, (x) => { mine = takesReport(x, reported) && !(x.reporting && age(x.reporting) < REPORT_HOLD); return mine ? { ...x, reporting: at } : null; });
  await seenNow();
  if (!j || !mine) return j;
  // Taking out a product Safeway no longer has is done: a second tap on the trash, or it was taken out on Safeway
  // already (Oct 31: the eggs went, a second removal a second later came back "not found").
  const gone = !reported && j.kind === "setQty" && Number(j.args.qty) === 0 && reportedRaw.error === "not-found";
  const ok = reported || gone;
  await noteTime(j, at, ok, str(reportedRaw.error, 40) || str(reportedRaw.stopped, 40));
  const raw: Record<string, unknown> = gone ? { ok: true, qty: 0 } : reportedRaw;
  let result: Record<string, unknown> = ok ? {} : { error: str(raw.error, 40) || "failed", ...(str(raw.why, 300) && { why: str(raw.why, 300) }) };
  if (ok && j.kind === "search") {
    const noPickup = raw.noPickup === true;
    result = { products: noPickup ? [] : productsOf(raw), signedIn: !noPickup && raw.signedIn !== false, noResults: raw.noResults === true, ...(noPickup && { noPickup }) };
    // Signed out (or Pickup not chosen), noted; signed in leaves it to the cart page, which also puts the cart right.
    if (noPickup) await noteSafeway("no-pickup");
    else if (!result.signedIn) await noteSignedIn(false);
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
    const reached = raw.ok !== false && qty === Number(a.qty);
    // Why Safeway didn't take it (Nov 23): it said something (its words kept), nothing changed, or no Add showed.
    const why = reached ? "" : ["said", "not-added", "no-add"].find((w) => w === raw.why) ?? "";
    result = { qty, reached, ...(why && { why }), ...(why === "said" && str(raw.said, 200) && { said: str(raw.said, 200) }) };
    const name = str(raw.name, 160) || str(a.name, 160), image = imageFor(str(a.productId, 20), str(raw.image, 500) || str(a.image, 500));
    await setCartLine({ productId: str(a.productId, 20), qty, name, price: str(raw.price, 40) || str(a.price, 40), image, itemId: str(a.itemId, 40), item: str(a.item, 80) });
    if (qty > 0 && str(a.item, 80)) await savePick({ item: str(a.item, 80), id: str(a.productId, 20), name, image }).catch((e) => console.error("couldn't keep the pick", e));
  }
  if (ok && j.kind === "cart") {
    // Safeway's cart page: Simmer's cart becomes what's there (added on Safeway itself too; gone if no longer there).
    // Signed in with Pickup not chosen (Nov 23): Safeway showed no cart, so Simmer's copy stays as it is.
    const noPickup = raw.noPickup === true;
    result = { products: noPickup ? [] : productsOf(raw), signedIn: !noPickup && raw.signedIn !== false, ...(noPickup && { noPickup }) };
    await noteSafeway(noPickup ? "no-pickup" : result.signedIn === true ? "in" : "out");
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
    const presses = (Array.isArray(raw.pressed) ? raw.pressed : raw.pressed ? [raw.pressed] : []).slice(0, 3) as Record<string, unknown>[];
    result = { pages, stopped: str(raw.stopped, 40), pressed: presses.map((p) => ({ pressed: p?.pressed === true, found: Number(p?.found) || 0, label: str(p?.label, 80) })) };
  }
  // Getting ready on Safeway and test runs (docs/CHECKOUT.md, Nov 13): where it stopped, the window it chose, and the
  // final page's words and buttons, which Simmer reads itself (src/lib/checkout.ts readFinal); nothing else is kept.
  // Placing (phase 3): whether Place Order was pressed, why not, the page Safeway landed on (for the order number), and
  // the address Chrome said the tab moved to after the press.
  if (j.kind === "checkoutPlace") {
    const a = raw.after && typeof raw.after === "object" ? raw.after as Record<string, unknown> : null;
    result = ok
      // `pressed` "unknown" (Nov 19, review): Simmer said yes, and the press's own answer never came back (the click
      // may have started Safeway's next page). Never read as not pressed.
      ? { stopped: str(raw.stopped, 60), pressed: raw.pressed === true ? true : raw.pressed === "unknown" ? "unknown" : false, why: str(raw.why, 80), landed: str(raw.landed, 300), after: a ? { url: str(a.url, 300), text: typeof a.text === "string" ? a.text.slice(0, 4000) : "" } : null }
      : { error: str(raw.error, 40) || "failed", ...(str(raw.why, 300) && { why: str(raw.why, 300) }) };
  }
  if (ok && j.kind.startsWith("checkout") && raw.stopped === "signed out") await noteSignedIn(false);
  if (ok && j.kind.startsWith("checkout") && raw.stopped === "no pickup chosen") await noteSafeway("no-pickup");
  // An Add Safeway answered with its session expired (Nov 23): signed out, as a cart read seeing it would note.
  if (!ok && j.kind === "setQty" && raw.error === "signed-out") await noteSignedIn(false);
  if (!ok && j.kind === "setQty" && raw.error === "no-pickup") await noteSafeway("no-pickup");
  if (ok && (j.kind === "checkoutPrepare" || j.kind === "checkoutDry")) {
    const c = raw.chosen && typeof raw.chosen === "object" ? raw.chosen as Record<string, unknown> : null;
    const f = raw.final && typeof raw.final === "object" ? raw.final as Record<string, unknown> : null;
    result = {
      stopped: str(raw.stopped, 60),
      // Safeway's bags switch as the final page showed it (Nov 16): on is bringing her own; null when it wasn't read.
      bagsOwn: typeof raw.bagsOwn === "boolean" ? raw.bagsOwn : null,
      chosen: c && str(c.id, 120) ? { id: str(c.id, 120), words: str(c.words, 160) } : null,
      final: f ? { url: str(f.url, 300), text: typeof f.text === "string" ? f.text.slice(0, 12000) : "", buttons: (Array.isArray(f.buttons) ? f.buttons : []).slice(0, 80).map((b: unknown) => str(b, 80)) } : null,
      // The free times read for picking (Nov 14), each a window's id and words; only from the listing.
      ...(Array.isArray(raw.days) ? { days: (raw.days as Record<string, unknown>[]).slice(0, 14).map((d) => ({ label: str(d?.label, 80) })).filter((d) => d.label), day: str(raw.day, 80) } : {}),
      ...(Array.isArray(raw.times) ? { times: (raw.times as Record<string, unknown>[]).slice(0, 120).map((t) => ({ id: str(t?.id, 120), words: str(t?.words, 160) })).filter((t) => t.id) } : {}),
      // What a stop saw (Nov 14: why the pickup times couldn't be reopened), kept with the job to read back.
      ...(raw.detail && typeof raw.detail === "object" ? { detail: { found: Number((raw.detail as Record<string, unknown>).found) || 0, why: str((raw.detail as Record<string, unknown>).why, 60) } } : {}),
    };
  }
  const out = await change(id, (x) => (takesReport(x, reported) && x.reporting === at ? { ...x, status: ok ? "done" : "failed", result, reporting: undefined } : null));
  if (out?.status === "done") await kv().del(AWAY_KEY);
  return out;
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

/** How far back the panel's log reaches: every search and cart change this recent, or at least the last `limit`. */
const RECENT_MS = 15 * 60_000;
/** The panel's activity log: recent searches and cart changes, newest first, with where each was asked for. */
export async function recentJobs(limit = 20): Promise<Activity[]> {
  // The last 15 minutes of the index, every kind (Nov 19, review: the last 80 jobs could be all checkout steps and cart
  // reads), with the last 80 when that's more; read in one go, 400 at most.
  const [lately, last] = await Promise.all([kv().zrange(INDEX, Date.now() - RECENT_MS, "+inf", { byScore: true }), kv().zrange(INDEX, -80, -1)]);
  const ids = (lately.length > last.length ? lately : last).slice(-400);
  const jobs = (await readJobs(ids)).map((f) => f.job);
  const q = await queueNow(jobs.filter((j) => going(j.status)));
  return jobs.flatMap((j): Activity[] => {
    if (j.kind !== "search" && j.kind !== "setQty") return [];
    const late = overdue(j, q), r = j.result ?? {};
    return [{
      id: j.id, kind: j.kind, status: late ? "failed" : j.status, from: j.args.from === "panel" ? "panel" : "app",
      what: str(j.args.name, 160) || str(j.args.query, 120), qty: j.kind === "setQty" ? Number(r.qty ?? j.args.qty) || 0 : null,
      error: late ? lateError(j) : str(r.error, 40), signedIn: r.signedIn !== false, ...(r.noPickup === true && { noPickup: true }),
      created: j.created, updated: j.updated,
    }];
  }).sort((a, b) => b.created.localeCompare(a.created)).filter((a, i) => i < limit || age(a.created) < RECENT_MS);
}

/** For tests. */
export const resetJobs = () => { for (const p of [`${NS}:job`, `${NS}:helper`, `${NS}:claimed:`]) resetKv(p); };
