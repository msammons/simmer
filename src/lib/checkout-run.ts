// Test runs (docs/CHECKOUT.md, phase 2, "Dry runs: every step for real on the account, stopping one press short"; Nov
// 13). Getting ready (a time tapped on the sheet): the helper goes through Safeway's checkout, chooses the pickup time
// she picked and reads the final page; Simmer checks it against every rule. Test run: Face ID approves exactly those figures, then the helper goes the
// same way again with that one pickup time, reads the final page, and Simmer checks it against the approval as it would
// before a real press. Placing for real (phase 3, Nov 14) is at the end: the one press is the helper's, made only on
// what Face ID approved.
//
// In its own file rather than checkout.ts because it needs Face ID (passkeys.ts, which itself records through
// checkout.ts) and the helper's jobs; checkout.ts keeps the rules, and every figure here goes through them.
import { NS } from "./store";
import { recordTrip } from "./plan";
import { print as CHECKOUT_PRINT } from "./checkout-print.json";
import { randomBytes } from "node:crypto";
import {
  APPROVAL_MS, cartKey, loadSettings, saveSettings, serverOn, pickupOf, readFinal, record, stoppedWords, stops, unusual, windowOf, windowWords,
  type Approval, type CheckoutSettings, type Final,
} from "./checkout";
import { AppError } from "./errors";
import { HELPER_VERSION, cartChanging, helperStatus, queueJob, waitForJob, type Job } from "./jobs";
import { doneShopping } from "./groceries";
import { clearCart, loadCart, type CartLine } from "./safeway";
import { json, kv, secs, swap } from "./kv";
import { passkeyCount, verifyCheck } from "./passkeys";
import { wakeHelper } from "./push";
import { cartTotal, priceOf } from "./shop";
import { TIMES_RAN_OUT } from "./checkout-sheet";

/** What the helper sends back from getting ready or a test run (jobs.ts trims it). */
type Reading = { stopped: string; chosen: { id: string; words: string } | null; final: { url: string; text: string; buttons: string[] } | null; bagsOwn: boolean | null };
/** Kept from getting ready, for the approval: the figures as read, the window chosen, and the cart as it was. */
type Prepared = { at: number; final: Final; chosen: { id: string; words: string }; cartKey: string; why: string[]; bagsOwn?: boolean | null };
/** An approval, with the window it's for and the Face ID check that made it. */
type Approved = Approval & { windowId: string; windowWords: string; faceId: string; itemsCents?: number | null; bagsOwn?: boolean | null };

/** What the sheet shows after getting ready. */
export type ReadyView = {
  store: string; window: string; card: string; items: number | null; totalCents: number | null;
  stops: string[]; highlights: string[];
  /** Safeway's bags switch on the final page (Nov 16): true, she brings her own; false, Safeway's bags; null, unread. */
  bagsOwn?: boolean | null;
  /** Safeway's taxes and fees in the total ("Est. taxes and fees"), shown as their own row; null when unread. */
  feesCents?: number | null;
  /** Placing for real is open (phase 3): the server allows it and this helper has passed a test run; else why not. */
  canOrder: boolean; orderWhy: string;
  /**
   * A test run is needed (Sam, Nov 24: "We only need the test run button if it's required"): the helper's checkout
   * fingerprint hasn't passed one on this account. The sheet offers Test run only then; the server's checks are unchanged.
   */
  needsTest: boolean;
  /** Safeway no longer offers the pickup time or day picked (the helper said so): the sheet shows the times again. */
  timeGone?: boolean;
  /** The day itself is gone (not only the time): the times are read again from Safeway's first day. */
  dayGone?: boolean;
  /** The helper on the computer isn't the one Simmer ships: a test run wouldn't count, so the sheet doesn't offer one. */
  helperOutdated?: boolean;
  /**
   * This reading's own id (Nov 19), sent back with the Face ID approval: it approves exactly these figures, never another
   * reading made meanwhile. Empty when there's nothing to approve.
   */
  preparedId: string;
};
/** What placing came to: ordered (with Safeway's order number when it shows one), refused before any press, or unsure. */
export type OrderResult = { ok: true; ordered: string; number: string } | { ok: false; reasons: string[]; unsure?: boolean };
/**
 * Still going: the job to follow, and the step the helper is at (Nov 23: shown in words while it goes), with when it was
 * reached, sent back as `since` so the next wait answers at the next step.
 */
export type Waiting = { waiting: string; step?: string; stepAt?: string };
/**
 * To pick the pickup time, as on Safeway's site (Sam, Nov 14: "let me pick", then "picking a day first"): the days
 * Safeway offers, the one showing, and that day's free times.
 */
export type TimesView = { days: { key: string; label: string }[]; day: string; times: { id: string; time: string; price: string; flash: boolean }[] };
export type RunResult = { ok: true; would: string } | { ok: false; reasons: string[] };

/** Each reading under its own id (Nov 19: one shared key let a second reading swap the figures Face ID approved). */
const PREPARED_KEY = `${NS}:checkout-prepared:`;
/** The pickup times just offered: a set, each added in one step, kept 10 minutes from the last listing. */
const TIMES_KEY = `${NS}:checkout-times-offered`;
const TIMES_MS = 10 * 60_000;
const APPROVAL_KEY = `${NS}:checkout-approval:`;
const RUN_KEY = `${NS}:checkout-run:`;
/** The cart as it was when getting ready was queued, by its job (review, Nov 24): a change while it ran stops the reading. */
const PREP_CART_KEY = `${NS}:checkout-prepare-cart:`;
/** An order started, by its approval's id: what was approved, kept for working out what happened (Nov 19). */
const ORDER_KEY = `${NS}:checkout-order:`;
/** What an order came to, by its approval's id, worked out once when the helper reports (Nov 19). */
const OUTCOME_KEY = `${NS}:checkout-outcome:`;
/** A placing job pressing for this long with no report: the phone stops following and says to check Safeway. */
const PRESS_FOLLOW_MS = 3 * 60_000;
/** An order on its way and not reported yet: while it's there, no other order starts (outside review, Nov 14). */
const GOING_KEY = `${NS}:checkout-order-going`;
const GOING_MS = 30 * 60_000;
/** The helper versions that have passed a test run on the account (docs/CHECKOUT.md: an update needs a new one). */
const DRY_KEY = `${NS}:checkout-dry-passed`;
/** How long the server waits on the helper per request; the sheet asks again while it's still going (no timers). */
export const WAIT_MS = 20_000;

/**
 * A test run needs ordering set up and on: a limit above $0 and a phone with Face ID. The store and card come from
 * Safeway the first time (Sam, Nov 14), remembered once that approval is made with Face ID; after that any other store
 * or card stops it. It
 * ignores only the server's switch (CHECKOUT_ENABLED), which governs real orders, so test runs can happen before real
 * orders are allowed; stops() is always asked with the server switch counted as on here.
 */
async function ready(): Promise<CheckoutSettings> {
  const s = await loadSettings();
  if (!s.on) throw new AppError("Turn on ordering first.");
  if (!s.limitCents) throw new AppError("Set a limit per order first.");
  if (!(await passkeyCount())) throw new AppError("Set up Face ID first.");
  return s;
}

/**
 * A job for the helper, and a push to wake it (Nov 14: these were queued without one, so a sleeping helper never took
 * them and the phone said "The computer with Safeway isn't answering" while it was right there).
 */
async function queueAndWake(...a: Parameters<typeof queueJob>): Promise<Job> {
  const job = await queueJob(...a);
  await wakeHelper().catch((e) => console.error("couldn't wake the helper", e));
  return job;
}

/**
 * What Safeway's figures are checked against: the store and card remembered, or, before any are (the first approval,
 * Sam, Nov 14), the ones Safeway shows, when they can be read. An unreadable store or card is still a stop.
 */
export function expected(s: CheckoutSettings, f: Pick<Final, "store" | "card">): CheckoutSettings {
  return { ...s, store: s.store || f.store, card: s.card || (/^\d{4}$/.test(f.card) ? f.card : "") };
}

/** Still going: a job nobody has taken yet gets another wake-up as the phone follows it (a push can arrive late). */
async function stillGoing(job: Job): Promise<Waiting> {
  if (job.status === "waiting") await wakeHelper().catch((e) => console.error("couldn't wake the helper", e));
  return { waiting: job.id, ...(job.step && { step: job.step, stepAt: job.stepAt ?? "" }) };
}

const cartNow = async () => cartKey(await loadCart());
const ID = /^[A-Za-z0-9_-]{16}$/;
const readingOf = (j: Job): Reading => {
  const r = (j.result ?? {}) as Partial<Reading>;
  return { stopped: typeof r.stopped === "string" ? r.stopped : "", chosen: r.chosen ?? null, final: r.final ?? null, bagsOwn: typeof r.bagsOwn === "boolean" ? r.bagsOwn : null };
};
/** A job that didn't finish: in words. */
function failedWords(j: Job | null): string {
  const e = String(j?.result?.error ?? "");
  return e === "not-answering" || e === "stuck" ? "The computer with Safeway isn't answering." : "The computer with Safeway didn't finish. Try again.";
}

/**
 * Safeway's final page as the helper read it, with the pickup time from the window it chose, and what stops it
 * (beyond stops(), which the callers add): a stop short of the final page, or a pickup time that can't be read.
 */
function finalOf(r: Reading): { final: Final; why: string[] } {
  if (r.stopped !== "ready" || !r.final) return { final: readFinal("", []), why: [stoppedWords(r.stopped)] };
  return pickupOf(readFinal(r.final.text, r.final.buttons), r.final.text, r.chosen);
}
/** stops(), less the line a clearer one already says ("No pickup time is chosen" beside "couldn't be read"). */
const allStops = (why: string[], more: string[]) => [...why, ...more.filter((m) => !(why.length && m === "No pickup time is chosen."))];

/**
 * The highlights for the confirm sheet, from Simmer's cart (docs/CHECKOUT.md: 5 or more, over $30, 15% above the
 * estimate). The total is compared with Simmer's estimate without Safeway's taxes and fees (Sam, Nov 14: a $3.95
 * small-order fee on a $10.99 cart was flagged as "more than Simmer expected"); the fees show as their own row.
 */
function highlights(lines: CartLine[], totalCents: number | null, feesCents: number | null): string[] {
  if (totalCents === null) return [];
  const { total } = cartTotal(lines);
  const goods = feesCents !== null && feesCents <= totalCents ? totalCents - feesCents : totalCents;
  return unusual(lines.map((l) => ({ name: l.name, qty: l.qty, priceCents: priceOf(l.price) === null ? null : Math.round(priceOf(l.price)! * 100) })), total ? Math.round(total * 100) : null, goods);
}

// ---- the pickup times, to pick from

/** A day tile's words ("select slots for SUNDAY Nov, 15 Sun Nov 15") as "Sun, Nov 15". */
const dayLabel = (tile: string) => { const m = tile.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) (\d{1,2})$/); return m ? `${m[1]}, ${m[2]} ${m[3]}` : tile; };
/**
 * Safeway's day tile, as the helper reads it: "select slots for SUNDAY Nov, 15 Sun Nov 15", or for the day showing
 * "SelectedSATURDAY Nov, 14 Sat Nov 14" (Nov 14: that one was left out, so today couldn't be picked).
 */
export const isDayTile = (s: string) => /^(?:select slots for |Selected)[A-Z]+DAY [A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}$/.test(s);

/** A cart change still on its way to Safeway stops every checkout step (Nov 16, Sam). */
const CHANGING = "The cart is still changing on Safeway. Wait for it to finish, then check out.";

/**
 * The days Safeway offers and one day's free times (or follows the reading started): the helper goes to Safeway's
 * checkout and reads the day showing, or presses the day asked for and reads it; it chooses no time. Only free times
 * are offered, Regular or Express, plus Flash with its price (Nov 16; never another paid time), and each one offered is
 * remembered for 10 minutes: getting ready takes only one of them.
 */
export async function pickupTimes(jobId?: string, day?: string, ms = WAIT_MS, since?: string): Promise<TimesView | Waiting> {
  await ready();
  if (!jobId && (await cartChanging())) throw new AppError(CHANGING);
  const id = jobId ?? (await queueAndWake("checkoutPrepare", { list: true, ...(day && isDayTile(day) && { day }) })).id;
  const job = await waitForJob(id, ms, jobId ? since : undefined);
  if (!job || job.kind !== "checkoutPrepare") throw new AppError("That didn't go through. Try again.");
  if (job.status === "waiting" || job.status === "working") return stillGoing(job);
  if (job.status !== "done") throw new AppError(failedWords(job));
  const r = (job.result ?? {}) as { stopped?: string; days?: { label: string }[]; day?: string; times?: { id: string; words: string }[] };
  if (r.stopped && r.stopped !== "times") throw new AppError(stoppedWords(r.stopped));
  // Free times, and Flash with its price (Nov 16); other paid times aren't offered.
  const free = (Array.isArray(r.times) ? r.times : []).map((t, i) => windowOf(t.id, t.words, i)).filter((w) => w.date && (w.priceCents === 0 || (w.kind === "FLASH" && w.priceCents !== null)));
  if (free.length) { await kv().sadd(TIMES_KEY, ...free.map((w) => w.id)); await kv().expire(TIMES_KEY, secs(TIMES_MS)); }
  await record("test times", { jobId: job.id, day: r.day ?? "", times: free.map((w) => w.id) });
  return {
    days: (r.days ?? []).filter((d) => isDayTile(d.label)).map((d) => ({ key: d.label, label: dayLabel(d.label) })),
    day: r.day ?? "",
    times: free.map((w) => ({
      id: w.id, flash: w.kind === "FLASH",
      time: w.kind === "FLASH" ? `Ready by ${w.words.match(/Ready by (\d{1,2}(?::\d\d)? ?[AP]M)/i)?.[1] ?? ""}`.trim() : windowWords({ id: w.id, words: w.words }).replace(/^\S+\s/, ""),
      price: w.priceCents ? `$${(w.priceCents / 100).toFixed(2)}` : "Free",
    })),
  };
}

// ---- getting ready

/**
 * Gets ready with the pickup time picked (or follows it): only one of the times just offered. The helper chooses it on
 * Safeway's checkout and reads the final page: the helper's reading, checked, or still going.
 */
export async function prepare(jobId?: string, windowId?: string, ms = WAIT_MS, bagsOwn?: boolean, since?: string): Promise<ReadyView | Waiting> {
  const s = await ready();
  let id = jobId;
  if (!id) {
    // Only a time just offered; the list lapses 10 minutes after the last reading (the sheet then reads the times again).
    if (!windowId || !Number(await kv().sismember(TIMES_KEY, windowId))) throw new AppError(TIMES_RAN_OUT);
    if (await cartChanging()) throw new AppError(CHANGING);
    // The cart as it is now, before the helper starts (review, Nov 24): compared again when the reading comes back.
    const before = await cartNow();
    // The bags she picked for this order (Nov 16): the helper sets Safeway's switch to match before reading the total.
    id = (await queueAndWake("checkoutPrepare", { windowId, ...(typeof bagsOwn === "boolean" && { bagsOwn }) })).id;
    await kv().set(PREP_CART_KEY + id, before, { ex: secs(15 * 60_000) });
  }
  const job = await waitForJob(id, ms, jobId ? since : undefined);
  if (!job || job.kind !== "checkoutPrepare") throw new AppError("That didn't go through. Try again.");
  if (job.status === "waiting" || job.status === "working") return stillGoing(job);
  if (job.status !== "done") throw new AppError(failedWords(job));
  const r = readingOf(job);
  const { final, why } = finalOf(r);
  const picked = typeof job.args?.windowId === "string" ? job.args.windowId : "";
  if (r.stopped === "ready" && (!picked || r.chosen?.id !== picked)) why.push("Safeway's pickup time isn't the one picked.");
  const bagsPicked = typeof job.args?.bagsOwn === "boolean" ? job.args.bagsOwn : null;
  if (r.stopped === "ready" && bagsPicked !== null && r.bagsOwn !== bagsPicked) why.push("Safeway's bags aren't the ones picked.");
  // The cart read once, for its key and the highlights (Nov 19: it was read twice), beside whether ordering's open, and
  // the cart as it was when this was queued (review, Nov 24): the reading is of that cart, so any change since stops it.
  const [lines, open, before] = await Promise.all([loadCart(), orderOpen(), kv().get(PREP_CART_KEY + job.id)]);
  const cart = cartKey(lines);
  if (r.stopped === "ready" && (typeof before !== "string" || before !== cart)) why.push("The cart changed while Safeway was read. Try again.");
  const reasons = allStops(why, r.stopped === "ready" ? stops(expected(s, final), final, null, Date.now(), cart, true) : []);
  let preparedId = "";
  if (r.chosen && r.stopped === "ready") {
    preparedId = randomBytes(12).toString("base64url");
    await kv().set(PREPARED_KEY + preparedId, JSON.stringify({ at: Date.now(), final, chosen: r.chosen, cartKey: cart, why: reasons, bagsOwn: r.bagsOwn } satisfies Prepared), { ex: secs(APPROVAL_MS) });
  }
  const view: ReadyView = {
    store: final.store, window: r.chosen ? windowWords(r.chosen) : "", card: final.card, items: final.items, totalCents: final.totalCents,
    stops: reasons, highlights: highlights(lines, final.totalCents, final.feesCents), feesCents: final.feesCents, bagsOwn: r.bagsOwn,
    ...open, preparedId, timeGone: r.stopped === "pickup time gone" || r.stopped === "pickup day gone", dayGone: r.stopped === "pickup day gone",
  };
  await record("test ready", { jobId: job.id, stopped: r.stopped, chosen: r.chosen, ...view, url: r.final?.url ?? "" });
  return view;
}

// ---- the approval, with Face ID

/**
 * Face ID approves what getting ready read: fixed at the tap (docs/CHECKOUT.md). The Face ID check is used first, so
 * it's used up whatever follows, and so is what getting ready read (one approval from each). Refused when anything
 * stops it, when getting ready was more than 2 minutes ago, or when the cart changed since. `preparedId` names the
 * reading the phone showed (Nov 19): only that one is approved, and it's taken out in one step.
 */
export async function approve(req: Request, faceId: unknown, preparedId: string): Promise<{ ok: true; approvalId: string; totalCents: number; window: string } | { ok: false; reasons: string[] }> {
  const s = await ready();
  const check = await verifyCheck(req, faceId);
  const p = ID.test(preparedId) ? json<Prepared>(await kv().getdel(PREPARED_KEY + preparedId)) : null;
  const now = Date.now();
  const reasons: string[] = [];
  if (!check.ok) reasons.push(check.why ?? "Face ID didn't match.");
  if (!p) reasons.push("That reading was already used or ran out. Try again.");
  else {
    if (now - p.at > APPROVAL_MS) reasons.push("That was more than 2 minutes ago. Try again.");
    const cart = await cartNow();
    if (cart !== p.cartKey) reasons.push("The cart changed since. Try again.");
    if (await cartChanging()) reasons.push(CHANGING);
    const w = windowOf(p.chosen.id, p.chosen.words, 0);
    // Free, or a paid time (Flash) whose price was read and is in the total she sees (Nov 16).
    if (w.priceCents === null) reasons.push("Safeway's pickup time price couldn't be read.");
    // The bags, as Safeway's switch showed them (Nov 16): no approval without them.
    if (typeof p.bagsOwn !== "boolean") reasons.push("Safeway's bags couldn't be read. Try again.");
    reasons.push(...p.why.filter((x) => !reasons.includes(x)), ...stops(expected(s, p.final), p.final, null, now, cart, true).filter((x) => !reasons.includes(x) && !p.why.includes(x)));
  }
  if (reasons.length || !p || p.final.items === null || p.final.totalCents === null || p.final.slot.priceCents === null) {
    const out = reasons.length ? reasons : ["Safeway's figures couldn't be read."];
    await record("test approval", { ok: false, reasons: out, faceId: check.credentialId ?? "" });
    return { ok: false, reasons: out };
  }
  const a: Approved = {
    id: randomBytes(12).toString("base64url"), at: now, used: false, cartKey: p.cartKey,
    store: p.final.store, card: p.final.card, items: p.final.items, totalCents: p.final.totalCents,
    slot: { ready: p.final.slot.ready, type: p.final.slot.type, priceCents: p.final.slot.priceCents },
    windowId: p.chosen.id, windowWords: windowWords(p.chosen), faceId: check.credentialId ?? "", itemsCents: p.final.itemsCents,
    bagsOwn: typeof p.bagsOwn === "boolean" ? p.bagsOwn : null,
  };
  await kv().set(APPROVAL_KEY + a.id, JSON.stringify(a), { ex: secs(APPROVAL_MS) });
  await record("test approval", { ok: true, ...a });
  // The first approval remembers the store and card it was made with (Face ID just approved them, shown on the sheet).
  // Read again first, so a change made meanwhile (the limit, off) isn't written over, and only what's still blank is filled.
  if (!s.store || !s.card) {
    const now2 = await loadSettings();
    if (!now2.store || !now2.card) await saveSettings(expected(now2, a), { by: "first approval", approvalId: a.id });
  }
  return { ok: true, approvalId: a.id, totalCents: a.totalCents, window: a.windowWords };
}

// ---- the test run

/**
 * Starts the test run for an approval, once: the approval is taken out before anything else (in one step, so two
 * taps can't both start one), then the helper is asked to go the same way with exactly the approved pickup time and
 * read the final page. It never presses Place Order. Then it's followed with `followTestRun`.
 */
export async function testRun(approvalId: string, ms = WAIT_MS): Promise<RunResult | Waiting> {
  const a = ID.test(approvalId) ? json<Approved>(await kv().getdel(APPROVAL_KEY + approvalId)) : null;
  const refuse = async (reasons: string[]) => { await record("test run", { ok: false, approvalId, reasons }); return { ok: false as const, reasons }; };
  if (!a) return refuse(["That approval was already used or ran out. Try again."]);
  if (Date.now() - a.at > APPROVAL_MS) return refuse(["The approval ran out. Try again."]);
  const s = await loadSettings();
  if (!s.on) return refuse(["Ordering is off in Settings."]);
  if ((await cartNow()) !== a.cartKey) return refuse(["The cart changed after the approval."]);
  if (await cartChanging()) return refuse([CHANGING]);
  if (typeof a.bagsOwn !== "boolean") return refuse(["Safeway's bags couldn't be read. Try again."]);
  const job = await queueAndWake("checkoutDry", { approvalId: a.id, windowId: a.windowId, ...(typeof a.bagsOwn === "boolean" && { bagsOwn: a.bagsOwn }) });
  await kv().set(RUN_KEY + job.id, JSON.stringify({ ...a, used: true }), { ex: secs(15 * 60_000) });
  await record("test run started", { approvalId: a.id, jobId: job.id, windowId: a.windowId, faceId: a.faceId });
  return followTestRun(job.id, ms);
}

/** How the test run stands: still going, or what Safeway's final page said against the approval (reported once). */
export async function followTestRun(jobId: string, ms = WAIT_MS, since?: string): Promise<RunResult | Waiting> {
  const pending = json<Approved>(await kv().get(RUN_KEY + jobId));
  if (!pending) throw new AppError("That test run was already reported. Try again.");
  const job = await waitForJob(jobId, ms, since);
  if (job && job.kind === "checkoutDry" && (job.status === "waiting" || job.status === "working")) return stillGoing(job);
  const a = json<Approved>(await kv().getdel(RUN_KEY + jobId));
  if (!a) throw new AppError("That test run was already reported. Try again.");
  let result: RunResult;
  let reading: Reading | null = null;
  if (!job || job.kind !== "checkoutDry" || job.status !== "done") result = { ok: false, reasons: [failedWords(job)] };
  else {
    reading = readingOf(job);
    const { final, why } = finalOf(reading);
    const reasons = [...why];
    if (reading.stopped === "ready") {
      // Only the approved pickup time: any other one is a difference, whatever its price.
      if (reading.chosen?.id !== a.windowId) reasons.push("Safeway's pickup time changed.");
      if (typeof a.bagsOwn === "boolean" && reading.bagsOwn !== a.bagsOwn) reasons.push("Safeway's bags changed.");
      // Checked as at the moment the helper read the final page, which is when a real press would happen.
      const at = Date.parse(job.updated) || Date.now();
      reasons.push(...stops(await loadSettings(), final, { ...a, used: false }, at, await cartNow(), true).filter((x) => !reasons.includes(x)));
    }
    const all = allStops(why, reasons.slice(why.length));
    result = all.length ? { ok: false, reasons: all } : { ok: true, would: `Would place $${(a.totalCents / 100).toFixed(2)} · ${a.windowWords}` };
    // A test run that matched: this helper version may place orders (docs/CHECKOUT.md).
    // Only when the helper that ran it is the one Simmer ships (outside review, Nov 18): an older helper's run, made
    // while the new one wasn't on the computer yet, never counts for the new code.
    if (result.ok && job?.args.by === HELPER_VERSION) await passedDryRun(CHECKOUT_PRINT);
    else if (result.ok) result = { ok: false, reasons: ["The helper on the computer isn't up to date, so this run doesn't count. Update it, then try again."] };
  }
  await record("test run", { ...result, approvalId: a.id, jobId, faceId: a.faceId, stopped: reading?.stopped ?? "", chosen: reading?.chosen ?? null, url: reading?.final?.url ?? "" });
  return result;
}

// ---- placing the order (phase 3, Sam, Nov 14: "Build it")

/**
 * What's passed a test run: the helper's checkout fingerprint (Nov 18), so a new helper needs one only when the code
 * checkout runs changed, never for a search or cart fix. (Version numbers kept from before simply no longer match.)
 */
const passedVersions = async () => json<string[]>(await kv().get(DRY_KEY)) ?? [];
async function passedDryRun(version: string) {
  const all = await passedVersions();
  if (!all.includes(version)) await kv().set(DRY_KEY, JSON.stringify([...all, version].slice(-20)), { ex: 400 * 24 * 3600 });
}

/** Another order on its way, or not known to have gone through (placeOrder refuses then): Place order isn't offered. */
const GOING_WORDS = "An order is already on its way, or the last one may not have gone through. Check Safeway.";

/**
 * Whether placing for real is open (docs/CHECKOUT.md): the server's own switch (CHECKOUT_ENABLED), and only a helper
 * version that has passed a test run on this account, with the helper on the computer up to date, and no other order
 * on its way (review, Nov 24: Place order showed and was refused only after Face ID). The helper's being out of date is
 * said first: a test run wouldn't count either (`helperOutdated`, so the sheet offers none).
 */
export async function orderOpen(): Promise<{ canOrder: boolean; orderWhy: string; needsTest: boolean; helperOutdated: boolean }> {
  const [helper, passed, going] = await Promise.all([helperStatus(), passedVersions(), kv().get(GOING_KEY)]);
  // Whether this checkout's fingerprint still needs a test run (Sam, Nov 24): only then does the sheet offer one.
  const needsTest = !passed.includes(CHECKOUT_PRINT);
  const helperOutdated = Boolean(helper.outdated);
  const closed = (orderWhy: string) => ({ canOrder: false, orderWhy, needsTest, helperOutdated });
  if (helperOutdated) return closed("The helper on the computer needs updating first.");
  if (!serverOn()) return closed("Ordering is turned off for now.");
  if (needsTest) return closed("Do a test run first: the helper's checkout steps changed.");
  if (going) return closed(GOING_WORDS);
  return { canOrder: true, orderWhy: "", needsTest, helperOutdated };
}

/** Safeway's order number on the page it lands on after Place Order, when it shows one. */
export const orderNumberIn = (text: string) => text.replace(/\s+/g, " ").match(/\border\s*(?:number|no\.?|#)\s*(?:is\s*)?[:#]?\s*([A-Z0-9-]{6,})/i)?.[1] ?? "";
/** Safeway's own confirmation address, which carries the order number: /order/confirmation/198111519 (Nov 18). */
export const confirmationNumberIn = (url: string) => (/^https:\/\/www\.safeway\.com\/[a-z/]*order\/confirmation\/(\d{6,})(?:[?#/]|$)/i.exec(url)?.[1] ?? "");

/** What the phone showed when Face ID approved it: the total and the pickup time (Nov 19). */
export type Shown = { totalCents: number | null; window: string };

/**
 * Places the approved order, once (docs/CHECKOUT.md "Each order"): the approval is taken out first, in one step, so two
 * taps can't both use it; it must be within its 2 minutes, with the cart as it was, and its total and pickup time must be
 * the ones the phone showed (Nov 19). The helper then reads Safeway's cart (exactly those products and counts), goes to
 * the final page with exactly the approved time, asks Simmer once more right before pressing, and presses Place Order
 * only when that page says exactly what was approved. Never tried again. Followed with `followOrder`.
 */
export async function placeOrder(approvalId: string, shown: Shown, ms = WAIT_MS): Promise<OrderResult | Waiting> {
  const a = ID.test(approvalId) ? json<Approved>(await kv().getdel(APPROVAL_KEY + approvalId)) : null;
  const refuse = async (reasons: string[]) => { await record("order", { ok: false, approvalId, reasons }); return { ok: false as const, reasons }; };
  if (!a) return refuse(["That approval was already used or ran out. Try again."]);
  if (Date.now() - a.at > APPROVAL_MS) return refuse(["The approval ran out. Try again."]);
  if (shown.totalCents !== a.totalCents || shown.window !== a.windowWords) return refuse(["What Face ID approved isn't what was shown. Nothing was ordered. Try again."]);
  // Read together (Nov 19: these were one after another); the going mark is still set last, in one step.
  const [open, going, s, lines, changing] = await Promise.all([orderOpen(), kv().get(GOING_KEY), loadSettings(), loadCart(), cartChanging()]);
  if (!open.canOrder) return refuse([open.orderWhy]);
  if (going) return refuse([GOING_WORDS]);
  const now = Date.now(), cart = cartKey(lines);
  const why = stops(s, { ...readFinal("", []), store: a.store, card: a.card, items: a.items, totalCents: a.totalCents, slot: a.slot, placeButton: true }, null, now, cart, serverOn());
  if (cart !== a.cartKey) why.push("The cart changed after the approval.");
  if (changing) why.push(CHANGING);
  if (typeof a.bagsOwn !== "boolean") why.push("Safeway's bags couldn't be read. Try again.");
  if (why.length) return refuse(why);
  if (a.itemsCents == null) return refuse(["Safeway's figures couldn't be read. Try again."]);
  const expect = expectFor(a);
  // Marked going before the helper is asked (outside review): if anything is lost after this, no second order can start
  // until the last one is reported or half an hour has passed.
  if ((await kv().set(GOING_KEY, a.id, { ex: secs(GOING_MS), nx: true })) !== "OK") return refuse(["An order is already on its way. Check Safeway."]);
  // What was approved is kept before the helper is asked, so its report can always be worked out (Nov 19).
  await kv().set(ORDER_KEY + a.id, JSON.stringify({ ...a, used: true }), { ex: 24 * 3600 });
  const job = await queueAndWake("checkoutPlace", { approvalId: a.id, windowId: a.windowId, expect });
  await record("order started", { approvalId: a.id, jobId: job.id, windowId: a.windowId, faceId: a.faceId, expect });
  return followOrder(job.id, ms);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * What the final page must say for the press, from the approval (outside review, Nov 14): each in the place Safeway shows
 * the one chosen, not just somewhere on the page; the item count with its subtotal; and the moment the approval runs out,
 * which the helper checks itself right before pressing.
 */
export function expectFor(a: Approved) {
  const date = a.windowId.match(/(\d{4})-(\d{2})-(\d{2})/);
  const flash = a.slot.type === "FLASH";
  const day = date ? new Date(`${date[0]}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) : "";
  return {
    cart: a.cartKey,
    total: `$${(a.totalCents / 100).toFixed(2)}`,
    items: a.items,
    itemsLine: a.itemsCents != null ? `Safeway Items (${a.items}) $${(a.itemsCents / 100).toFixed(2)}` : "",
    card: a.card,
    storeLine: `Pick up your order here ${a.store}`,
    whenLine: date ? `Pickup date & time Edit ${day}, ${MONTHS[Number(date[2]) - 1]} ${Number(date[3])}${flash ? "" : `, ${a.slot.ready}`}` : "",
    // A Flash time: its slot line, with the approved ready time and price (Nov 16), as the page writes it.
    ...(flash ? { slotLine: `${a.slot.ready} Slot type FLASH price $${((a.slot.priceCents ?? 0) / 100).toFixed(2)}` } : {}),
    // The bags as approved (Nov 16): the helper sets them on the way and checks the switch right before the press.
    ...(typeof a.bagsOwn === "boolean" ? { bagsOwn: a.bagsOwn } : {}),
    deadline: a.at + APPROVAL_MS,
  };
}

/** Safeway's page after the press says the order went through: an order number, its thank-you or confirmation words, or the confirmation address the tab moved to. */
// Or Safeway's confirmation address with its order number (Nov 18: the page was read before its words filled in, so a
// placed order came back "not sure" and the cart stayed), but only when the tab moved there after the press: `landed`
// is the address Chrome reported the move to, and it must be the page read (outside review, Nov 18).
export const confirmed = (after: { url: string; text: string } | null | undefined, landed = "") =>
  Boolean(after) && (Boolean(orderNumberIn(after!.text)) || (Boolean(landed) && landed === after!.url && Boolean(confirmationNumberIn(after!.url))) || /thank you for your order|order (?:is |has been )?(?:placed|confirmed|received)/i.test(after!.text));

const UNSURE = "Not sure the order went through. Check Safeway before trying again.";
const isUnsure = (r: OrderResult) => !r.ok && r.unsure === true;
type PlaceReport = { stopped?: string; pressed?: boolean | "unknown"; why?: string; error?: string; landed?: string; after?: { url: string; text: string } | null };

/**
 * Why page.js didn't press, read on Safeway's final page before any click (extension-working/page.js placeOrder): only
 * these let a job that was allowed to press be "nothing was ordered" (Nov 19, review).
 */
const PAGE_REASONS = /^(?:not the checkout page|total|items|items subtotal|card|another card|store|pickup time|paid pickup time|bags|asks for card details|place order buttons: \d+|place order turned off|approval ran out)$/;

/** What a placing job came to, from the helper's report (or its lack). */
function outcomeOf(job: Job | null, a: Approved): OrderResult {
  const r = (job?.result ?? {}) as PlaceReport;
  const unsure: OrderResult = { ok: false, unsure: true, reasons: [UNSURE] };
  if (!job || job.kind !== "checkoutPlace" || job.status !== "done") {
    // Not taken in time: almost surely nothing happened, but the helper may have taken it in the same moment, so it's never
    // "nothing was ordered" (that would invite a second try); always check Safeway first.
    return job?.status === "failed" && r.error === "not-answering" ? { ok: false, unsure: true, reasons: [failedWords(job), "Check Safeway before trying again."] } : unsure;
  }
  // Ordered only when Safeway's page says so (outside review): a move to some other page isn't proof. Whether or not the
  // page moved (Safeway may confirm in place), as long as it says so.
  // Only for a job Simmer let press (Nov 19, review): a press reported without that is never taken as an order.
  if (r.pressed && job.pressedAt && confirmed(r.after, r.stopped === "placed" ? r.landed ?? "" : "")) {
    const number = orderNumberIn(r.after?.text ?? "") || confirmationNumberIn(r.after?.url ?? "");
    return { ok: true, ordered: `Ordered · pickup ${a.windowWords} · $${(a.totalCents / 100).toFixed(2)}`, number };
  }
  if (r.pressed !== false) return unsure;
  // Allowed to press, and not pressed: "nothing was ordered" only when Safeway's page gave page.js a reason not to,
  // before any click (Nov 19, review: a press whose answer was lost came back "no answer", and read as nothing ordered).
  if (job.pressedAt && !(r.stopped === "not pressed" && PAGE_REASONS.test(r.why ?? ""))) return unsure;
  const said = r.stopped === "not pressed" ? `Safeway's page didn't match what you approved (${r.why || "unknown"}).` : stoppedWords(r.stopped ?? "");
  return { ok: false, reasons: said.endsWith("Nothing was ordered.") ? [said] : [said, "Nothing was ordered."] };
}

/**
 * Works out what a placing job came to and keeps it (Nov 19: this happened only while a phone was following, so an
 * order placed with the phone closed never came off the list and blocked the next one for half an hour). Called when the
 * helper reports, hands a job back, and when the phone follows. The first answer is kept, except that an unsure one gives
 * way to the helper's own later report (what happened on Safeway). Whoever keeps an answer records it first, then does
 * what it means, each part on its own: an order's cart comes off the list as bought, and another order may start unless
 * Simmer isn't sure. `gaveUp`: the phone stopped following a press with no report (unsure, kept as such).
 */
export async function settleOrder(job: Job | null, gaveUp = false): Promise<OrderResult | null> {
  const approvalId = typeof job?.args.approvalId === "string" && ID.test(job.args.approvalId) ? job.args.approvalId : "";
  if (!job || job.kind !== "checkoutPlace" || !approvalId) return null;
  if (!gaveUp && (job.status === "waiting" || job.status === "working" || job.status === "pressing")) return null;
  const [pending, before] = await Promise.all([kv().get(ORDER_KEY + approvalId), kv().get(OUTCOME_KEY + approvalId)]);
  const prev = json<OrderResult>(before);
  const a = json<Approved>(pending);
  if (!a) return prev;
  const result = gaveUp ? { ok: false as const, unsure: true, reasons: [UNSURE] } : outcomeOf(job, a);
  if (prev && !(isUnsure(prev) && !isUnsure(result))) return prev;
  const text = JSON.stringify(result), keep = 24 * 3600;
  const kept = before === null ? (await kv().set(OUTCOME_KEY + approvalId, text, { ex: keep, nx: true })) === "OK" : await swap(OUTCOME_KEY + approvalId, before, text, keep);
  if (!kept) return json<OrderResult>(await kv().get(OUTCOME_KEY + approvalId)) ?? result;
  const r = (job.result ?? {}) as PlaceReport;
  await record("order", { ...result, approvalId, jobId: job.id, faceId: a.faceId, stopped: r.stopped ?? "", pressed: r.pressed === true, why: r.why ?? r.error ?? "", url: r.after?.url ?? "", ...(prev && { before: prev }) });
  const tryTo = async (what: string, f: () => Promise<unknown>) => { try { await f(); } catch (e) { console.error(`couldn't ${what}`, e); } };
  if (result.ok) {
    let lines: CartLine[] = [];
    await tryTo("read the cart", async () => { lines = await loadCart(); });
    await tryTo("take the cart off the list", () => doneShopping("safeway", new Set(lines.map((l) => l.itemId).filter(Boolean))));
    await tryTo("empty the cart", () => clearCart());
    await tryTo("record the trip", () => recordTrip("safeway")); // as an emptied cart does (Nov 18)
  }
  // Reported: another order may start (only if the going mark is still this order's), unless Simmer isn't sure (then the
  // half hour runs out, or someone checks Safeway).
  if (!isUnsure(result)) await tryTo("free the next order", () => swap(GOING_KEY, a.id, "", 60));
  return result;
}

/**
 * How placing stands: still going, or what it came to (worked out when the helper reported; see settleOrder). Ordered:
 * the cart comes off the Safeway list as bought and the cart starts empty. Pressed but no answer, or the helper lost:
 * "Simmer isn't sure", never tried again.
 */
export async function followOrder(jobId: string, ms = WAIT_MS, since?: string): Promise<OrderResult | Waiting> {
  const job = await waitForJob(jobId, ms, since);
  // A job Simmer no longer has (gone after a day, or kept the old way before Nov 19): never "already reported", which
  // isn't known; not sure, and recorded as such (Nov 19, review).
  const lost = async (why: string) => {
    await record("order", { ok: false, unsure: true, jobId, why });
    return { ok: false as const, unsure: true, reasons: [UNSURE] };
  };
  if (!job || job.kind !== "checkoutPlace") return lost("job not found");
  const approvalId = String(job.args.approvalId ?? "");
  const kept = json<OrderResult>(await kv().get(OUTCOME_KEY + approvalId));
  if (kept && !(isUnsure(kept) && job.status === "done")) return kept;
  if (job.status === "pressing" && Date.now() - Date.parse(job.updated) > PRESS_FOLLOW_MS) return (await settleOrder(job, true)) ?? { ok: false, unsure: true, reasons: [UNSURE] };
  if (job.status === "waiting" || job.status === "working" || job.status === "pressing") return stillGoing(job);
  return (await settleOrder(job)) ?? lost("order not found");
}

// ---- picking the store and card (Nov 14)

/** The pickup store and card Safeway's checkout shows, to pick from (Sam, Nov 14: "setting pickup store should let me pick"). */
export type Choices = { store: string; card: string };

/** The store and card in the look's pages: the last page that shows each (the checkout page, after Order info). */
export function choicesOf(pages: { text?: unknown; buttons?: unknown }[]): Choices {
  let store = "", card = "";
  for (const p of pages) {
    const f = readFinal(typeof p.text === "string" ? p.text : "", Array.isArray(p.buttons) ? p.buttons.map(String) : []);
    if (f.store) store = f.store;
    if (f.card) card = f.card;
  }
  return { store, card };
}

/**
 * Looks at Safeway's checkout for the store and card to pick (or follows the look started): the read-only look from
 * phase 1 (docs/CHECKOUT.md: Checkout, the suggestions page's Continue, Order info's Continue, one day; never a pickup
 * time, never Place Order). Only reads, so it needs no Face ID; picking one saves it as any other change, with Face ID.
 */
export async function lookUp(jobId?: string, ms = WAIT_MS, since?: string): Promise<Choices | Waiting> {
  const id = jobId ?? (await queueAndWake("checkoutLook", {})).id;
  const job = await waitForJob(id, ms, jobId ? since : undefined);
  if (!job || job.kind !== "checkoutLook") throw new AppError("That didn't go through. Try again.");
  if (job.status === "waiting" || job.status === "working") return stillGoing(job);
  if (job.status !== "done") throw new AppError(failedWords(job));
  const pages = Array.isArray(job.result?.pages) ? (job.result.pages as { text?: unknown; buttons?: unknown }[]) : [];
  const found = choicesOf(pages);
  await record("store and card read", { jobId: job.id, ...found, stopped: String(job.result?.stopped ?? "") });
  return found;
}
