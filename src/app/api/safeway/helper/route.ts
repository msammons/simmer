import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { loadList } from "@/lib/groceries";
import { loadPicks } from "@/lib/safeway";
import { choose, helperStart } from "@/lib/safeway-helper.mjs";

const clean = (s: unknown, max = 160) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * GET: what the Safeway helper needs to start a run: how to read Safeway's pages, how to go about it, and the list's
 * Safeway items ready to fill (see lib/safeway-helper.mjs). The helper asks again at the start of every run.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const [list, picks] = await Promise.all([loadList(), loadPicks()]);
    return Response.json(helperStart(list, picks), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}

/**
 * POST { item: { item, usual, picked }, query, products: { id, name, ... }[] }: which product to add, { pick, why },
 * which to ask about, { ask: products, likeliest first }, or { none } when nothing came up.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  if (!b?.item || !Array.isArray(b.products)) return Response.json({ error: "What was found?" }, { status: 400 });
  const picked = b.item.picked && typeof b.item.picked.id === "string" ? { id: clean(b.item.picked.id, 20), name: clean(b.item.picked.name) } : null;
  // Products go back as they came (the helper needs their place on the page), so only the fields used here are checked.
  const products = (b.products as unknown[]).slice(0, 60).filter((p): p is { id: string; name: string } =>
    !!p && typeof (p as { id?: unknown }).id === "string" && typeof (p as { name?: unknown }).name === "string");
  return Response.json(choose(products, { picked, usual: clean(b.item.usual), item: clean(b.query) || clean(b.item.item) }), { headers: { "cache-control": "no-store" } });
}
