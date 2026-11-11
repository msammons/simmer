import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { helperStatus } from "@/lib/jobs";
import { loadCart, loadPicks } from "@/lib/safeway";
import { forViewing } from "@/lib/google/sheets";

/**
 * GET: the Safeway cart as Simmer knows it (what was added through Simmer), the picks (each item's usual product, with
 * its picture), whether the helper on the computer is answering (and when it last checked in, and whether that's long
 * enough ago that Lists greys the cart),
 * and whether it's older than the one this Simmer ships. Changes to the cart go through jobs
 * (/api/safeway/jobs, setQty), so they happen in the real Safeway cart first.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const [cart, picks, helper] = await forViewing(() => Promise.all([loadCart(), loadPicks(), helperStatus()]));
    return Response.json({ cart, picks, answering: helper.answering, away: helper.away, seen: helper.seen, outdated: helper.outdated }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
