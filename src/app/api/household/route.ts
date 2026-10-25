import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { loadHousehold } from "@/lib/data";

/** GET: who's in the household (names only), plus whether the data is a fallback copy. Also how the app checks a passcode. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const hh = await loadHousehold();
    return Response.json({ people: hh.profile.people.map((p) => ({ key: p.key, name: p.name })), stale: hh.stale });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
