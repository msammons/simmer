import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { addFrozen, loadKitchen, takeFrozen } from "@/lib/plan";

const clean = (s: unknown, max = 60) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** GET: what's in the freezer (oldest first), and the store trips (last one, and whether one's due). */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json(await loadKitchen(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}

/** POST { op: "add", text } ("2 salmon") or { op: "use", id } (one taken out). Answers like GET. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    if (b?.op === "add") await addFrozen(clean(b.text));
    else if (b?.op === "use") await takeFrozen(clean(b.id, 40));
    else return Response.json({ error: "Unknown change." }, { status: 400 });
    return Response.json(await loadKitchen(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
