import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { loadPicks, savePick } from "@/lib/safeway";

const clean = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** GET: the Safeway helper's picks, { picks: { item, id, name }[] }. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json({ picks: await loadPicks() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}

/** POST { item, id, name }: the product picked for an item. Answers with all the picks. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  const item = clean(b?.item), id = clean(b?.id, 20), name = clean(b?.name, 160);
  if (!item || !/^\d+$/.test(id)) return Response.json({ error: "Which product?" }, { status: 400 });
  try {
    await savePick({ item, id, name });
    return Response.json({ picks: await loadPicks() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
