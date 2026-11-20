import { loadHousehold } from "@/lib/data";
import { api } from "@/lib/ops/route";

/** GET: who's in the household (names only), plus whether the data is a fallback copy. Also how the app checks a passcode. */
export const GET = api(async () => {
  const hh = await loadHousehold();
  return Response.json({ people: hh.profile.people.map((p) => ({ key: p.key, name: p.name, isAdult: p.isAdult })), stale: hh.stale });
});
