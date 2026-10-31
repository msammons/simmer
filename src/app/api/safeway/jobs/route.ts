import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { cancelJob, finishJob, helperStatus, jobStatus, JOB_KINDS, queueJob, recentJobs, takeJob, type JobKind } from "@/lib/jobs";
import { PAGE, SETTINGS } from "@/lib/safeway-helper.mjs";

const text = (s: unknown, max = 160) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
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
  if (kind === "cart") return {};
  if (kind === "snapshot") return query && /^\d+$/.test(text(b.productId, 20)) ? { query, productId: text(b.productId, 20) } : null;
  // A sample of a search page, or of the cart page (`on: "cart"`, helper 1.2 on), to learn how Safeway builds it.
  return { query: query || "milk", ...(b.on === "cart" && { on: "cart" }) };
}

/**
 * GET ?id=…: how a job stands, and whether the helper is answering. GET ?recent=1: the panel's activity log. GET with
 * neither: just whether it's answering.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const params = new URL(req.url).searchParams;
    if (params.get("recent")) return Response.json({ jobs: await recentJobs(), ...(await helperStatus()) }, noStore);
    const id = text(params.get("id"), 40);
    if (!id) return Response.json(await helperStatus(), noStore);
    return Response.json(await jobStatus(id), noStore);
  } catch (e) { return failed(e); }
}

/**
 * POST { op, ... }. From Simmer: queue { kind, from, ...args } → { job, answering }, cancel { id }. From the helper: next
 * { version, panel } → { job (with Simmer's page details and settings) | null }, done { id, result }, failed { id, error }.
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
        return Response.json({ job: await queueJob(b.kind, { ...args, from: b.from === "panel" ? "panel" : "app" }), answering }, noStore);
      }
      case "cancel": await cancelJob(text(b.id, 40)); return Response.json({ ok: true }, noStore);
      case "next": {
        const job = await takeJob(text(b.version, 20), b.panel === true);
        return Response.json({ job: job && { ...job, page: PAGE, settings: SETTINGS }, settings: SETTINGS }, noStore);
      }
      case "done": case "failed": {
        const result = b.result && typeof b.result === "object" ? b.result : { error: text(b.error, 40) };
        return Response.json({ job: await finishJob(text(b.id, 40), b.op === "done", result) }, noStore);
      }
      default: return Response.json({ error: "Unknown change." }, { status: 400 });
    }
  } catch (e) { return failed(e); }
}
