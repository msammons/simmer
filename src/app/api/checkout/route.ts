import { authorized, unauthorized } from "@/lib/auth";
import { friendly } from "@/lib/friendly";
import { loadSettings, serverOn } from "@/lib/checkout";
import { addWaiting, answerOf, changeSettings, passkeyCount } from "@/lib/passkeys";
import { approve, followOrder, followTestRun, lookUp, pickupTimes, placeOrder, prepare, testRun } from "@/lib/checkout-run";
import { AppError } from "@/lib/errors";

// Getting ready and test runs wait on the helper up to 20 s per request (the sheet asks again while it's going).
export const maxDuration = 60;

const noStore = { headers: { "cache-control": "no-store" } };
const text = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * GET: ordering's settings (docs/CHECKOUT.md), whether the server allows ordering at all, and how many phones have Face
 * ID set up for it (Nov 12), and the code of a new phone waiting to be approved, so Settings → Ordering loads in one go.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const [settings, faceId, adding] = await Promise.all([loadSettings(), passkeyCount(), addWaiting()]);
    return Response.json({ settings, server: serverOn(), faceId, adding }, noStore);
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}


/**
 * POST { on, limitCents, store, card, faceId? }: ordering's settings. Anything unreadable is saved as off / $0. Turning
 * on, raising the limit, or changing the store or card needs `faceId`, a Face ID check's answer (Sam, Nov 13); without
 * a good one the change is refused and nothing is saved.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  if (b?.op === "prepare" || b?.op === "approve" || b?.op === "test-run" || b?.op === "look" || b?.op === "times" || b?.op === "place") return run(req, b);
  try {
    const r = await changeSettings(req, {
      on: b?.on === true,
      limitCents: Number.isInteger(b?.limitCents) ? b.limitCents : 0,
      store: text(b?.store, 120),
      card: /^\d{4}$/.test(b?.card ?? "") ? b.card : "",
    }, answerOf(b?.faceId));
    if (!r.ok) return Response.json({ error: r.why }, { status: 400, ...noStore });
    return Response.json({ settings: r.settings, server: serverOn() }, noStore);
  } catch (e) {
    console.error("couldn't save ordering's settings", e);
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}

/** A pickup window's id as Safeway builds it ("9999SAT20261114REGULARDUG18001900-2026-11-14"). */
const windowId = (s: unknown) => (typeof s === "string" && /^[A-Za-z0-9:-]{10,120}$/.test(s) ? s : "");
const id = (s: unknown) => (typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : "");

/**
 * Test runs (docs/CHECKOUT.md phase 2, Nov 13). prepare { jobId? }: get ready (or follow it) → the figures and what
 * stops them (with its preparedId), or { waiting: jobId }. approve { faceId, preparedId }: Face ID approves exactly that
 * reading's figures → { ok, approvalId } or
 * { ok: false, reasons }. test-run { approvalId } or { jobId } (following): → { ok, would } or { ok: false, reasons }, or
 * { waiting: jobId }. look { jobId? }: the store and card Safeway's checkout shows, to pick (Nov 14) → { store, card } or
 * { waiting: jobId }. place { approvalId, totalCents, window } (what the phone showed, Nov 19) or { jobId } (following):
 * placing for real, only as approved.
 */
async function run(req: Request, b: Record<string, unknown>) {
  try {
    const out = b.op === "look" ? await lookUp(id(b.jobId) || undefined)
      : b.op === "times" ? await pickupTimes(id(b.jobId) || undefined, text(b.day, 80) || undefined)
      : b.op === "prepare" ? await prepare(id(b.jobId) || undefined, windowId(b.windowId) || undefined, undefined, typeof b.bagsOwn === "boolean" ? b.bagsOwn : undefined)
      : b.op === "approve" ? await approve(req, answerOf(b.faceId), id(b.preparedId))
      // Placing for real (phase 3): only with an approval made with Face ID, or following the one started.
      : b.op === "place" ? (id(b.jobId) ? await followOrder(id(b.jobId)) : await placeOrder(id(b.approvalId), { totalCents: Number.isInteger(b.totalCents) ? b.totalCents as number : null, window: text(b.window, 80) }))
      : id(b.jobId) ? await followTestRun(id(b.jobId)) : await testRun(id(b.approvalId));
    return Response.json(out, noStore);
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502, ...noStore });
  }
}
