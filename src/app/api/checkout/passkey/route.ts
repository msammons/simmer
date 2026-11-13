import { AppError } from "@/lib/errors";
import { authorized, unauthorized } from "@/lib/auth";
import { friendly } from "@/lib/friendly";
import { answerOf, approveOptions, askToAdd, checkOptions, passkeyCount, registrationOptions, verifyApprove, verifyCheck, verifyRegistration } from "@/lib/passkeys";

const noStore = { headers: { "cache-control": "no-store" } };

const token = (t: unknown) => (typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : undefined);

/**
 * POST { op, response? } (docs/CHECKOUT.md, Face ID, Nov 12). register-options and check-options start one (answering
 * with what the phone needs); register sets up Face ID here (answering with how many are set up); check answers
 * { ok, credentialId?, why? }. Each challenge is good once, for 2 minutes. Nothing here approves or places an order.
 *
 * Adding a phone once one has Face ID (Sam, Nov 12): the new phone sends add (answering { token, code }; the token goes
 * only to it), a phone with Face ID sends approve-options (answering the code it's for) then approve, and the new phone
 * sends its token with register-options. Requests run out after 5 minutes.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    switch (b?.op) {
      case "register-options":
        return Response.json({ options: await registrationOptions(req, token(b.token)) }, noStore);
      case "check-options":
        return Response.json({ options: await checkOptions(req) }, noStore);
      case "register": {
        const r = await verifyRegistration(req, answerOf(b.response));
        if (!r.ok) return Response.json({ error: r.why ?? "Face ID couldn't be set up." }, { status: 400, ...noStore });
        return Response.json({ ok: true, count: await passkeyCount() }, noStore);
      }
      case "add":
        return Response.json(await askToAdd(), noStore);
      case "approve-options":
        return Response.json(await approveOptions(req), noStore);
      case "approve": {
        const r = await verifyApprove(req, answerOf(b.response));
        if (!r.ok) return Response.json({ error: r.why ?? "The new phone wasn't approved." }, { status: 400, ...noStore });
        return Response.json({ ok: true }, noStore);
      }
      case "check": {
        const r = await verifyCheck(req, answerOf(b.response));
        return Response.json({ ok: r.ok, ...(r.ok ? { credentialId: r.credentialId } : { why: r.why }) }, noStore);
      }
      default:
        return Response.json({ error: "That didn't go through." }, { status: 400, ...noStore });
    }
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502, ...noStore });
  }
}
