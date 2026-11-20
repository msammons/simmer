import { loadPicks, savePick } from "@/lib/safeway";
import { api, body, clean, noStore, refuse } from "@/lib/ops/route";

/** GET: the Safeway helper's picks, { picks: { item, id, name }[] }. */
export const GET = api(async () => Response.json({ picks: await loadPicks() }, noStore));

/** POST { item, id, name }: the product picked for an item. Answers with all the picks. */
export const POST = api(async (req) => {
  const b = await body(req);
  const item = clean(b?.item), id = clean(b?.id, 20), name = clean(b?.name, 160);
  if (!item || !/^\d+$/.test(id)) return refuse("Which product?");
  await savePick({ item, id, name });
  return Response.json({ picks: await loadPicks() }, noStore);
});
