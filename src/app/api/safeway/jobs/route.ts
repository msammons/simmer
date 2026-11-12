import { after } from "next/server";
import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { cancelJob, finishJob, returnJob, helperPush, helperStatus, jobStatus, waitForJob, JOB_KINDS, queueJob, recentJobs, savePush, takeJob, type JobKind, HELPER_VERSION } from "@/lib/jobs";
import { pushKey, wakeHelper } from "@/lib/push";
import { PAGE, SETTINGS } from "@/lib/safeway-helper.mjs";

// A job's status can wait for the job to finish (?wait=1, about 20 seconds at most).
export const maxDuration = 60;

const text = (s: unknown, max = 160) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Chrome's push service (the helper runs in Chrome), so Simmer only ever sends its wake-ups there. */
const pushService = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)(googleapis|google)\.com$/.test(x.hostname); } catch { return false; } };
const noStore = { headers: { "cache-control": "no-store" } };
const failed = (e: unknown) => Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });

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
  if (kind === "snapshot") return query && /^\d+$/.test(text(b.productId, 20)) ? { query, productId: text(b.productId, 20) } : null;
  // A sample of a search page, or of the cart page (`on: "cart"`, helper 1.2 on), to learn how Safeway builds it.
  return { query: query || "milk", ...(b.on === "cart" && { on: "cart" }) };
}

/**
 * GET ?id=…: how a job stands, and whether the helper is answering (&wait=1: once it's finished, or after ~20 s). GET ?recent=1: the panel's activity log. GET with
 * neither: just whether it's answering.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const params = new URL(req.url).searchParams;
    if (params.get("recent")) return Response.json({ jobs: await recentJobs(), ...(await helperStatus()) }, noStore);
    const id = text(params.get("id"), 40);
    if (!id) return Response.json(await helperStatus(), noStore);
    return Response.json(params.get("wait") ? await waitForJob(id) : await jobStatus(id), noStore);
  } catch (e) { return failed(e); }
}

/**
 * POST { op, ... }. From Simmer: queue { kind, from, ...args } → { job, answering }, cancel { id }. From the helper: next
 * { version, panel } → { job (with Simmer's page details and settings) | null, push: { key, have } }, done { id, result },
 * failed { id, error }, push { key, subscription } (1.3: how to wake it when a job is queued).
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    switch (b?.op) {
      case "queue": {
        if (!(JOB_KINDS as readonly string[]).includes(b.kind)) return Response.json({ error: "Unknown job." }, { status: 400 });
        const args = argsFor(b.kind, b);
        if (!args) return Response.json({ error: "What should it look for?" }, { status: 400 });
        const { answering } = await helperStatus();
        const job = await queueJob(b.kind, { ...args, from: b.from === "panel" ? "panel" : "app" });
        // Wakes the helper so it starts in a second rather than at its next half-minute check (Nov 3).
        after(() => wakeHelper().catch((e) => console.error("couldn't wake the helper", e)));
        return Response.json({ job, answering }, noStore);
      }
      case "cancel": await cancelJob(text(b.id, 40)); return Response.json({ ok: true }, noStore);
      case "again": await returnJob(text(b.id, 40)); return Response.json({ ok: true }, noStore);
      case "next": {
        const job = await takeJob(text(b.version, 20), b.panel === true);
        // The key to subscribe with, and whether Simmer already has a subscription made with it (none without keys).
        // `at`: where Simmer would send the push, so a helper whose subscription Chrome dropped (a reload drops it, Nov 12) makes a new one.
        const key = pushKey(), saved = key ? await helperPush() : null, have = saved?.key === key;
        // `version`: the helper this Simmer ships, so a helper whose newer files are already on its computer reloads itself (26.11.11).
        return Response.json({ job: job && { ...job, page: PAGE, settings: SETTINGS }, settings: SETTINGS, version: HELPER_VERSION, ...(key && { push: { key, have, at: have ? saved?.sub.endpoint ?? "" : "" } }) }, noStore);
      }
      case "push": {
        const s = b.subscription, key = text(b.key, 200);
        const endpoint = text(s?.endpoint, 1000), p256dh = text(s?.keys?.p256dh, 200), auth = text(s?.keys?.auth, 100);
        if (!key || key !== pushKey() || !pushService(endpoint) || !p256dh || !auth) {
          console.error("helper's wake-up subscription turned down", { sameKey: key === pushKey(), host: (() => { try { return new URL(endpoint).hostname; } catch { return ""; } })(), keys: Boolean(p256dh && auth) });
          return Response.json({ error: "Unknown change." }, { status: 400 });
        }
        await savePush({ key, sub: { endpoint, keys: { p256dh, auth } } });
        return Response.json({ ok: true }, noStore);
      }
      case "done": case "failed": {
        const result = b.result && typeof b.result === "object" ? b.result : { error: text(b.error, 40) };
        return Response.json({ job: await finishJob(text(b.id, 40), b.op === "done", result) }, noStore);
      }
      // Something the helper wants seen in Simmer's logs (Nov 12: why it can't be woken).
      case "note": console.error("helper:", text(b.what, 300)); return Response.json({ ok: true }, noStore);
      default: return Response.json({ error: "Unknown change." }, { status: 400 });
    }
  } catch (e) { return failed(e); }
}
