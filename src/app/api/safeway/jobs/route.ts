import { after } from "next/server";
import { cancelJob, finishJob, returnJob, helperPush, helperStatus, jobStatus, noteStep, pressJob, waitForJob, JOB_KINDS, queueJob, recentJobs, savePush, takeJob, type Job, type JobKind, HELPER_VERSION } from "@/lib/jobs";
import { loadSettings, record } from "@/lib/checkout";
import { pushKey, wakeHelper } from "@/lib/push";
import { PAGE, SETTINGS } from "@/lib/safeway-helper.mjs";
import { api, body, clean, noStore, refuse } from "@/lib/ops/route";
import { loadAccount } from "@/lib/safeway-signin";

// A job's status can wait for the job to finish (?wait=1, about 20 seconds at most).
export const maxDuration = 60;

const text = (s: unknown, max = 160) => clean(s, max);
/** Chrome's push service (the helper runs in Chrome), so Simmer only ever sends its wake-ups there. */
const pushService = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)(googleapis|google)\.com$/.test(x.hostname); } catch { return false; } };
/**
 * `answering` is always true (Nov 11: no timer keeps a check-in fresh, so Simmer never guesses from it; a job nobody
 * takes says so, and `away` from helperStatus). Kept in the answers for the screens that still read it.
 */
const ANSWERING = { answering: true };
/**
 * A placing job as handed to the helper, with the time left until its approval runs out by Simmer's clock (Nov 19): the
 * helper holds to whichever comes first, that or the deadline by its own clock.
 */
const handOff = (job: Job) => {
  const e = job.kind === "checkoutPlace" && job.args.expect && typeof job.args.expect === "object" ? job.args.expect as { deadline?: unknown } : null;
  return e ? { ...job, args: { ...job.args, expect: { ...e, left: Math.max(0, Number(e.deadline) - Date.now()) || 0 } } } : job;
};

/** What a job may carry: only these fields, checked and trimmed. */
function argsFor(kind: JobKind, b: Record<string, unknown>): Record<string, unknown> | null {
  const query = text(b.query, 120);
  if (kind === "search") return query ? { query } : null;
  if (kind === "setQty") {
    const productId = text(b.productId, 20), qty = Number(b.qty);
    if (!/^\d+$/.test(productId) || !Number.isFinite(qty)) return null;
    return {
      productId, qty: Math.max(0, Math.min(SETTINGS.mostOfOne * 2, Math.round(qty))), query: query || text(b.name, 120),
      name: text(b.name), price: text(b.price, 40), image: /^https:\/\//.test(text(b.image, 500)) ? text(b.image, 500) : "",
      itemId: text(b.itemId, 40), item: text(b.item, 80),
      // Other words to search when the first don't bring it up, and where to change it first (Safeway's cart page).
      alt: text(b.alt, 120), ...(b.on === "cart" && { on: "cart" }),
    };
  }
  if (kind === "cart" || kind === "checkoutLook") return {};
  // Getting ready and test runs are asked for by Simmer's own checkout steps (src/lib/checkout.ts), never from here.
  if (kind === "checkoutPrepare" || kind === "checkoutDry" || kind === "checkoutPlace") return null;
  if (kind === "snapshot") return query && /^\d+$/.test(text(b.productId, 20)) ? { query, productId: text(b.productId, 20) } : null;
  // A sample of a search page, or of the cart page (`on: "cart"`, helper 1.2 on), to learn how Safeway builds it.
  return { query: query || "milk", ...(b.on === "cart" && { on: "cart" }) };
}

/**
 * GET ?id=…: how a job stands, and whether the helper is answering (&wait=1: once it's finished, its step changes from
 * &since=…, or after ~20 s). GET ?recent=1: the panel's activity log. GET with
 * neither: just whether it's answering.
 */
export const GET = api(async (req) => {
  const params = new URL(req.url).searchParams;
  if (params.get("recent")) return Response.json({ jobs: await recentJobs(), ...(await helperStatus()), ...ANSWERING }, noStore);
  const id = text(params.get("id"), 40);
  if (!id) return Response.json({ ...(await helperStatus()), ...ANSWERING }, noStore);
  // `since` (Nov 23): the step time the asker already has, so the wait answers as soon as the helper's step changes.
  const since = params.has("since") ? text(params.get("since"), 40) : undefined;
  return Response.json({ job: params.get("wait") ? await waitForJob(id, undefined, since) : await jobStatus(id), ...ANSWERING }, noStore);
});

/**
 * POST { op, ... }. From Simmer: queue { kind, from, ...args } → { job, answering }, cancel { id }. From the helper: next
 * { version, panel, helper, pending } → { job (with Simmer's page details and settings) | null, push: { key, have } }, done { id, result },
 * failed { id, error }, again { id } (handing back a job as it reloads), press { id } (may it press Place Order, Nov 19),
 * step { id, step, at } (where it is in a job, Nov 23),
 * push { key, subscription } (1.3: how to wake it when a job is queued).
 */
export const POST = api(async (req) => {
  const b = await body(req);
  switch (b?.op) {
    case "queue": {
      if (!(JOB_KINDS as readonly string[]).includes(b.kind)) return refuse("Unknown job.");
      const args = argsFor(b.kind, b);
      if (!args) return refuse("What should it look for?");
      const job = await queueJob(b.kind, { ...args, from: b.from === "panel" ? "panel" : "app" });
      // Wakes the helper so it starts at once (Nov 3; it has no timers since 26.11.11).
      after(() => wakeHelper().catch((e) => console.error("couldn't wake the helper", e)));
      return Response.json({ job, ...ANSWERING }, noStore);
    }
    case "cancel": await cancelJob(text(b.id, 40)); return Response.json({ ok: true }, noStore);
    // A placing job's outcome is worked out as it finishes, however it finishes (jobs.ts settlePlacing, Nov 19).
    case "again": await returnJob(text(b.id, 40)); return Response.json({ ok: true }, noStore);
    // Where the helper is in a job (Nov 23): a step's key and the helper's time, kept on the job for the phone's words and
    // for timing. Read-only for Safeway; it never changes a job's status. Answered at once, kept or not.
    case "step": return Response.json({ ok: await noteStep(text(b.id, 40), text(b.step, 24), Number(b.at)) }, noStore);
    // "May I press?" (Nov 19): asked by the helper right before Place Order; only yes moves the job to pressing.
    case "press": return Response.json({ ok: await pressJob(text(b.id, 40)) }, noStore);
    case "next": {
      // `helper` and `pending` (26.11.23.2): which helper is asking, and the jobs it still has reports for, so a job it
      // took and dropped (Chrome stopped it mid-job) is said at once. An older helper sends neither.
      const pending = Array.isArray(b.pending) ? b.pending.slice(0, 50).map((x: unknown) => text(x, 40)) : null;
      const job = await takeJob(text(b.version, 20), b.panel === true, { helper: text(b.helper, 60), pending });
      // The key to subscribe with, and whether Simmer already has a subscription made with it (none without keys).
      // `at`: where Simmer would send the push, so a helper whose subscription Chrome dropped (a reload drops it, Nov 12) makes a new one.
      const key = pushKey(), saved = key ? await helperPush() : null, have = saved?.key === key;
      // `version`: the helper this Simmer ships, so a helper whose newer files are already on its computer reloads itself (26.11.11).
      // `store`: the household's pickup store (learned from checkout), so the helper can switch Safeway to Pickup there
      // (Sam, Nov 23: "i want this process to be automated"). Never for placing, which doesn't switch (docs/CHECKOUT.md).
      const store = job && job.kind !== "checkoutPlace" ? (await loadSettings()).store : "";
      // `google`: the Google account the helper signs in to Safeway with when it finds Safeway signed out (Sam, Nov 24:
      // "Yes build it", then "i want the email to be set in settings"; docs/CHECKOUT.md). Set in Settings (src/lib/
      // safeway-signin.ts), never in this public code; sent with searches, cart reads and Adds only, never checkout. None
      // set: the helper never tries.
      const google = job && ["search", "cart", "setQty"].includes(job.kind) ? (await loadAccount()).account : "";
      return Response.json({ job: job && { ...handOff(job), page: PAGE, settings: SETTINGS, store, ...(google && { google }) }, settings: SETTINGS, version: HELPER_VERSION, ...(key && { push: { key, have, at: have ? saved?.sub.endpoint ?? "" : "" } }) }, noStore);
    }
    case "push": {
      const s = b.subscription, key = text(b.key, 200);
      const endpoint = text(s?.endpoint, 1000), p256dh = text(s?.keys?.p256dh, 200), auth = text(s?.keys?.auth, 100);
      if (!key || key !== pushKey() || !pushService(endpoint) || !p256dh || !auth) {
        console.error("helper's wake-up subscription turned down", { sameKey: key === pushKey(), host: (() => { try { return new URL(endpoint).hostname; } catch { return ""; } })(), keys: Boolean(p256dh && auth) });
        return refuse("Unknown change.");
      }
      await savePush({ key, sub: { endpoint, keys: { p256dh, auth } } });
      return Response.json({ ok: true }, noStore);
    }
    case "done": case "failed": {
      // A failure keeps the helper's reason (Nov 14: a Get ready came back only "failed"), for reading back.
      const result = b.result && typeof b.result === "object" ? b.result : { error: text(b.error, 40), ...(text(b.why, 300) && { why: text(b.why, 300) }) };
      const job = await finishJob(text(b.id, 40), b.op === "done", result);
      // A placing report for a job Simmer doesn't have (Nov 19, review: one from before a release) still goes in the
      // checkout record, so it says what the helper saw.
      if (!job && result && typeof result === "object" && "pressed" in result) {
        const r = result as Record<string, unknown>;
        await record("order report for an unknown job", { jobId: text(b.id, 40), stopped: text(r.stopped, 60), pressed: r.pressed === true ? true : r.pressed === false ? false : "unknown", why: text(r.why, 80), landed: text(r.landed, 300) }).catch((e) => console.error("couldn't record the report", e));
      }
      return Response.json({ job }, noStore);
    }
    // Something the helper wants seen in Simmer's logs (Nov 12: why it can't be woken).
    case "note": console.error("helper:", text(b.what, 300)); return Response.json({ ok: true }, noStore);
    default: return refuse("Unknown change.");
  }
});
