import { authorized, unauthorized } from "@/lib/auth";
import { friendly } from "@/lib/friendly";
import { loadSettings, saveSettings, serverOn } from "@/lib/checkout";

const noStore = { headers: { "cache-control": "no-store" } };
const text = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** GET: ordering's settings (docs/CHECKOUT.md), and whether the server allows ordering at all. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json({ settings: await loadSettings(), server: serverOn() }, noStore);
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}

/** POST { on, limitCents, store, card }: ordering's settings. Anything unreadable is saved as off / $0. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    const settings = await saveSettings({
      on: b?.on === true,
      limitCents: Number.isInteger(b?.limitCents) ? b.limitCents : 0,
      store: text(b?.store, 120),
      card: /^\d{4}$/.test(b?.card ?? "") ? b.card : "",
    });
    return Response.json({ settings, server: serverOn() }, noStore);
  } catch (e) {
    console.error("couldn't save ordering's settings", e);
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
