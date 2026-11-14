// Test runs (docs/CHECKOUT.md, phase 2, "Dry runs: every step for real on the account, stopping one press short"; Nov
// 13). Get ready: the helper goes through Safeway's checkout, chooses the earliest free pickup time and reads the final
// page; Simmer checks it against every rule. Test run: Face ID approves exactly those figures, then the helper goes the
// same way again with that one pickup time, reads the final page, and Simmer checks it against the approval as it would
// before a real press. Nothing here, and nothing in the helper, presses Place Order or asks for it.
//
// In its own file rather than checkout.ts because it needs Face ID (passkeys.ts, which itself records through
// checkout.ts) and the helper's jobs; checkout.ts keeps the rules, and every figure here goes through them.
import { randomBytes } from "node:crypto";
import {
  APPROVAL_MS, cartKey, loadSettings, pickupOf, readFinal, record, stoppedWords, stops, unusual, windowOf, windowWords,
  type Approval, type CheckoutSettings, type Final,
} from "./checkout";
import { AppError } from "./errors";
import { queueJob, waitForJob, type Job } from "./jobs";
import { json, kv, secs } from "./kv";
import { passkeyCount, verifyCheck } from "./passkeys";
import { wakeHelper } from "./push";
import { loadCart } from "./safeway";
import { cartTotal, priceOf } from "./shop";

/** What the helper sends back from getting ready or a test run (jobs.ts trims it). */
type Reading = { stopped: string; chosen: { id: string; words: string } | null; final: { url: string; text: string; buttons: string[] } | null };
/** Kept from getting ready, for the approval: the figures as read, the window chosen, and the cart as it was. */
type Prepared = { at: number; final: Final; chosen: { id: string; words: string }; cartKey: string; why: string[] };
/** An approval, with the window it's for and the Face ID check that made it. */
type Approved = Approval & { windowId: string; windowWords: string; faceId: string };

/** What the sheet shows after getting ready. */
export type ReadyView = {
  store: string; window: string; card: string; items: number | null; totalCents: number | null;
  stops: string[]; highlights: string[];
};
export type Waiting = { waiting: string };
export type RunResult = { ok: true; would: string } | { ok: false; reasons: string[] };

const PREPARED_KEY = "simmer:checkout-prepared";
const APPROVAL_KEY = "simmer:checkout-approval:";
const RUN_KEY = "simmer:checkout-run:";
/** How long the server waits on the helper per request; the sheet asks again while it's still going (no timers). */
export const WAIT_MS = 20_000;

/**
 * A test run needs ordering set up and on: a limit above $0, the store and card set, and a phone with Face ID. It
 * ignores only the server's switch (CHECKOUT_ENABLED), which governs real orders, so test runs can happen before real
 * orders are allowed; stops() is always asked with the server switch counted as on here.
 */
async function ready(): Promise<CheckoutSettings> {
  const s = await loadSettings();
  if (!s.on) throw new AppError("Turn on ordering first.");
  if (!s.limitCents) throw new AppError("Set a limit per order first.");
  if (!s.store || !s.card) throw new AppError("Set the pickup store and card first.");
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

const cartNow = async () => cartKey(await loadCart());
const readingOf = (j: Job): Reading => {
  const r = (j.result ?? {}) as Partial<Reading>;
  return { stopped: typeof r.stopped === "string" ? r.stopped : "", chosen: r.chosen ?? null, final: r.final ?? null };
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

/** The highlights for the confirm sheet, from Simmer's cart (docs/CHECKOUT.md: 5 or more, over $30, 15% above the estimate). */
async function highlights(totalCents: number | null): Promise<string[]> {
  if (totalCents === null) return [];
  const lines = await loadCart();
  const { total } = cartTotal(lines);
  return unusual(lines.map((l) => ({ name: l.name, qty: l.qty, priceCents: priceOf(l.price) === null ? null : Math.round(priceOf(l.price)! * 100) })), total ? Math.round(total * 100) : null, totalCents);
}

// ---- getting ready

/** Starts getting ready (or follows the one started): the helper's reading, checked, or still going. */
export async function prepare(jobId?: string, ms = WAIT_MS): Promise<ReadyView | Waiting> {
  const s = await ready();
  const id = jobId ?? (await queueAndWake("checkoutPrepare", {})).id;
  const { job } = await waitForJob(id, ms);
  if (!job || job.kind !== "checkoutPrepare") throw new AppError("That didn't go through. Try again.");
  if (job.status === "waiting" || job.status === "working") return { waiting: job.id };
  if (job.status !== "done") throw new AppError(failedWords(job));
  const r = readingOf(job);
  const { final, why } = finalOf(r);
  const cart = await cartNow();
  const reasons = allStops(why, r.stopped === "ready" ? stops(s, final, null, Date.now(), cart, true) : []);
  if (r.chosen && r.stopped === "ready") {
    await kv().set(PREPARED_KEY, JSON.stringify({ at: Date.now(), final, chosen: r.chosen, cartKey: cart, why: reasons } satisfies Prepared), { ex: secs(APPROVAL_MS) });
  } else await kv().del(PREPARED_KEY);
  const view: ReadyView = {
    store: final.store, window: r.chosen ? windowWords(r.chosen) : "", card: final.card, items: final.items, totalCents: final.totalCents,
    stops: reasons, highlights: await highlights(final.totalCents),
  };
  await record("test ready", { jobId: job.id, stopped: r.stopped, chosen: r.chosen, ...view, url: r.final?.url ?? "" });
  return view;
}

// ---- the approval, with Face ID

/**
 * Face ID approves what getting ready read: fixed at the tap (docs/CHECKOUT.md). The Face ID check is used first, so
 * it's used up whatever follows, and so is what getting ready read (one approval from each). Refused when anything
 * stops it, when getting ready was more than 2 minutes ago, or when the cart changed since.
 */
export async function approve(req: Request, faceId: unknown): Promise<{ ok: true; approvalId: string; totalCents: number; window: string } | { ok: false; reasons: string[] }> {
  const s = await ready();
  const check = await verifyCheck(req, faceId);
  const p = json<Prepared>(await kv().getdel(PREPARED_KEY));
  const now = Date.now();
  const reasons: string[] = [];
  if (!check.ok) reasons.push(check.why ?? "Face ID didn't match.");
  if (!p) reasons.push("Get ready again first.");
  else {
    if (now - p.at > APPROVAL_MS) reasons.push("That was more than 2 minutes ago. Get ready again.");
    const cart = await cartNow();
    if (cart !== p.cartKey) reasons.push("The cart changed since. Get ready again.");
    const w = windowOf(p.chosen.id, p.chosen.words, 0);
    if (!w.regular || w.priceCents !== 0) reasons.push("Safeway's pickup time isn't a free one.");
    reasons.push(...p.why.filter((x) => !reasons.includes(x)), ...stops(s, p.final, null, now, cart, true).filter((x) => !reasons.includes(x) && !p.why.includes(x)));
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
    windowId: p.chosen.id, windowWords: windowWords(p.chosen), faceId: check.credentialId ?? "",
  };
  await kv().set(APPROVAL_KEY + a.id, JSON.stringify(a), { ex: secs(APPROVAL_MS) });
  await record("test approval", { ok: true, ...a });
  return { ok: true, approvalId: a.id, totalCents: a.totalCents, window: a.windowWords };
}

// ---- the test run

/**
 * Starts the test run for an approval, once: the approval is taken out before anything else (in one step, so two
 * taps can't both start one), then the helper is asked to go the same way with exactly the approved pickup time and
 * read the final page. It never presses Place Order. Then it's followed with `followTestRun`.
 */
export async function testRun(approvalId: string, ms = WAIT_MS): Promise<RunResult | Waiting> {
  const a = /^[A-Za-z0-9_-]{16}$/.test(approvalId) ? json<Approved>(await kv().getdel(APPROVAL_KEY + approvalId)) : null;
  const refuse = async (reasons: string[]) => { await record("test run", { ok: false, approvalId, reasons }); return { ok: false as const, reasons }; };
  if (!a) return refuse(["That approval was already used or ran out. Get ready again."]);
  if (Date.now() - a.at > APPROVAL_MS) return refuse(["The approval ran out. Get ready again."]);
  const s = await loadSettings();
  if (!s.on) return refuse(["Ordering is off in Settings."]);
  if ((await cartNow()) !== a.cartKey) return refuse(["The cart changed after the approval."]);
  const job = await queueAndWake("checkoutDry", { approvalId: a.id, windowId: a.windowId });
  await kv().set(RUN_KEY + job.id, JSON.stringify({ ...a, used: true }), { ex: secs(15 * 60_000) });
  await record("test run started", { approvalId: a.id, jobId: job.id, windowId: a.windowId, faceId: a.faceId });
  return followTestRun(job.id, ms);
}

/** How the test run stands: still going, or what Safeway's final page said against the approval (reported once). */
export async function followTestRun(jobId: string, ms = WAIT_MS): Promise<RunResult | Waiting> {
  const pending = json<Approved>(await kv().get(RUN_KEY + jobId));
  if (!pending) throw new AppError("That test run was already reported. Get ready again for another.");
  const { job } = await waitForJob(jobId, ms);
  if (job && job.kind === "checkoutDry" && (job.status === "waiting" || job.status === "working")) return { waiting: job.id };
  const a = json<Approved>(await kv().getdel(RUN_KEY + jobId));
  if (!a) throw new AppError("That test run was already reported. Get ready again for another.");
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
      // Checked as at the moment the helper read the final page, which is when a real press would happen.
      const at = Date.parse(job.updated) || Date.now();
      reasons.push(...stops(await loadSettings(), final, { ...a, used: false }, at, await cartNow(), true).filter((x) => !reasons.includes(x)));
    }
    const all = allStops(why, reasons.slice(why.length));
    result = all.length ? { ok: false, reasons: all } : { ok: true, would: `Would place $${(a.totalCents / 100).toFixed(2)} · ${a.windowWords}` };
  }
  await record("test run", { ...result, approvalId: a.id, jobId, faceId: a.faceId, stopped: reading?.stopped ?? "", chosen: reading?.chosen ?? null, url: reading?.final?.url ?? "" });
  return result;
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
export async function lookUp(jobId?: string, ms = WAIT_MS): Promise<Choices | Waiting> {
  const id = jobId ?? (await queueAndWake("checkoutLook", {})).id;
  const { job } = await waitForJob(id, ms);
  if (!job || job.kind !== "checkoutLook") throw new AppError("That didn't go through. Try again.");
  if (job.status === "waiting" || job.status === "working") return { waiting: job.id };
  if (job.status !== "done") throw new AppError(failedWords(job));
  const pages = Array.isArray(job.result?.pages) ? (job.result.pages as { text?: unknown; buttons?: unknown }[]) : [];
  const found = choicesOf(pages);
  await record("store and card read", { jobId: job.id, ...found, stopped: String(job.result?.stopped ?? "") });
  return found;
}
