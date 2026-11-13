import { authorized, unauthorized } from "@/lib/auth";
import { friendly } from "@/lib/friendly";
import { loadSettings, serverOn } from "@/lib/checkout";
import { addWaiting, answerOf, changeSettings, passkeyCount } from "@/lib/passkeys";

const noStore = { headers: { "cache-control": "no-store" } };
const text = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * GET: ordering's settings (docs/CHECKOUT.md), whether the server allows ordering at all, and how many phones have Face
 * ID set up for it (Nov 12), and the code of a new phone waiting to be approved, so Settings → Ordering loads in one go.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const [settings, faceId, adding] = await Promise.all([loadSettings(), passkeyCount(), addWaiting()]);
    return Response.json({ settings, server: serverOn(), faceId, adding }, noStore);
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}


/**
 * POST { on, limitCents, store, card, faceId? }: ordering's settings. Anything unreadable is saved as off / $0. Turning
 * on, raising the limit, or changing the store or card needs `faceId`, a Face ID check's answer (Sam, Nov 13); without
 * a good one the change is refused and nothing is saved.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    const r = await changeSettings(req, {
      on: b?.on === true,
      limitCents: Number.isInteger(b?.limitCents) ? b.limitCents : 0,
      store: text(b?.store, 120),
      card: /^\d{4}$/.test(b?.card ?? "") ? b.card : "",
    }, answerOf(b?.faceId));
    if (!r.ok) return Response.json({ error: r.why }, { status: 400, ...noStore });
    return Response.json({ settings: r.settings, server: serverOn() }, noStore);
  } catch (e) {
    console.error("couldn't save ordering's settings", e);
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
