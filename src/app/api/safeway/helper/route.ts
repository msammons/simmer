import { loadList } from "@/lib/groceries";
import { loadPicks } from "@/lib/safeway";
import { choose, helperStart } from "@/lib/safeway-helper.mjs";
import { api, body, clean, noStore, refuse } from "@/lib/ops/route";

/**
 * GET: what the Safeway helper needs to start a run: how to read Safeway's pages, how to go about it, and the list's
 * Safeway items ready to fill (see lib/safeway-helper.mjs). The helper asks again at the start of every run.
 */
export const GET = api(async () => {
  const [list, picks] = await Promise.all([loadList(), loadPicks()]);
  return Response.json(helperStart(list, picks), noStore);
});

/**
 * POST { item: { item, usual, picked }, query, products: { id, name, ... }[] }: which product to add, { pick, why },
 * which to ask about, { ask: products, likeliest first }, or { none } when nothing came up.
 */
export const POST = api(async (req) => {
  const b = await body(req);
  if (!b?.item || !Array.isArray(b.products)) return refuse("What was found?");
  const picked = b.item.picked && typeof b.item.picked.id === "string" ? { id: clean(b.item.picked.id, 20), name: clean(b.item.picked.name, 160) } : null;
  // Products go back as they came (the helper needs their place on the page), so only the fields used here are checked.
  const products = (b.products as unknown[]).slice(0, 60).filter((p): p is { id: string; name: string } =>
    !!p && typeof (p as { id?: unknown }).id === "string" && typeof (p as { name?: unknown }).name === "string");
  return Response.json(choose(products, { picked, usual: clean(b.item.usual, 160), item: clean(b.query, 160) || clean(b.item.item, 160) }), noStore);
});
