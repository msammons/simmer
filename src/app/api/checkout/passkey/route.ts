import { AppError } from "@/lib/errors";
import { authorized, unauthorized } from "@/lib/auth";
import { friendly } from "@/lib/friendly";
import { checkOptions, passkeyCount, registrationOptions, verifyCheck, verifyRegistration } from "@/lib/passkeys";

const noStore = { headers: { "cache-control": "no-store" } };

/** What a phone's Face ID answer must look like before it's looked at at all; anything else counts as no answer. */
const answer = (r: unknown) => {
  const a = r as { id?: unknown; response?: { clientDataJSON?: unknown } } | null;
  return a && typeof a.id === "string" && a.id.length <= 1024 && typeof a.response?.clientDataJSON === "string" ? a : null;
};

/**
 * POST { op, response? } (docs/CHECKOUT.md, Face ID, Nov 12). register-options and check-options start one (answering
 * with what the phone needs); register sets up Face ID here (answering with how many are set up); check answers
 * { ok, credentialId?, why? }. Each challenge is good once, for 2 minutes. Nothing here approves or places an order.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    switch (b?.op) {
      case "register-options":
        return Response.json({ options: await registrationOptions(req) }, noStore);
      case "check-options":
        return Response.json({ options: await checkOptions(req) }, noStore);
      case "register": {
        const r = await verifyRegistration(req, answer(b.response));
        if (!r.ok) return Response.json({ error: r.why ?? "Face ID couldn't be set up." }, { status: 400, ...noStore });
        return Response.json({ ok: true, count: await passkeyCount() }, noStore);
      }
      case "check": {
        const r = await verifyCheck(req, answer(b.response));
        return Response.json({ ok: r.ok, ...(r.ok ? { credentialId: r.credentialId } : { why: r.why }) }, noStore);
      }
      default:
        return Response.json({ error: "That didn't go through." }, { status: 400, ...noStore });
    }
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502, ...noStore });
  }
}
