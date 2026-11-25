import { addStatus, answerOf, approveOptions, askToAdd, checkOptions, passkeyCount, registrationOptions, verifyApprove, verifyCheck, verifyRegistration } from "@/lib/passkeys";
import { api, body, noStore, refuse } from "@/lib/ops/route";

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
export const POST = api(async (req) => {
  const b = await body(req);
  switch (b?.op) {
    case "register-options":
      return Response.json({ options: await registrationOptions(req, token(b.token)) }, noStore);
    case "check-options":
      return Response.json({ options: await checkOptions(req) }, noStore);
    case "register": {
      const r = await verifyRegistration(req, answerOf(b.response));
      if (!r.ok) return refuse(r.why ?? "Face ID couldn't be set up.");
      return Response.json({ ok: true, count: await passkeyCount() }, noStore);
    }
    case "add":
      return Response.json(await askToAdd(), noStore);
    case "add-status":
      return Response.json({ status: await addStatus(typeof b?.token === "string" ? b.token : "") }, noStore);
    case "approve-options":
      return Response.json(await approveOptions(req), noStore);
    case "approve": {
      const r = await verifyApprove(req, answerOf(b.response));
      if (!r.ok) return refuse(r.why ?? "The new device wasn't approved.");
      return Response.json({ ok: true }, noStore);
    }
    case "check": {
      const r = await verifyCheck(req, answerOf(b.response));
      return Response.json({ ok: r.ok, ...(r.ok ? { credentialId: r.credentialId } : { why: r.why }) }, noStore);
    }
    default:
      return refuse("That didn't go through.");
  }
});
