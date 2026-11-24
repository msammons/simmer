import { helperStatus, safewayNoPickup, safewaySignedOut } from "@/lib/jobs";
import { loadCart, loadPicks } from "@/lib/safeway";
import { api, noStore } from "@/lib/ops/route";

/**
 * GET: the Safeway cart as Simmer knows it (what was added through Simmer), the picks (each item's usual product, with
 * its picture), when the helper on the computer last checked in whether it looks away (the latest job wasn't
 * taken or never reported, and none has worked since; Shop then makes Safeway's rows a checklist; `answering` is always
 * true, kept for screens that read it),
 * whether it's older than the one this Simmer ships, and whether Safeway was last seen signed out on the computer (or
 * signed in with Pickup not chosen, `noPickup`, Nov 23). Changes to the cart go through jobs
 * (/api/safeway/jobs, setQty), so they happen in the real Safeway cart first.
 */
export const GET = api(async () => {
  const [cart, picks, helper, signedOut, noPickup] = await Promise.all([loadCart(), loadPicks(), helperStatus(), safewaySignedOut(), safewayNoPickup()]);
  return Response.json({ cart, picks, answering: true, away: helper.away, seen: helper.seen, outdated: helper.outdated, signedOut, noPickup }, noStore);
});
