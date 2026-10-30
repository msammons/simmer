import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { helperStatus } from "@/lib/jobs";
import { loadCart, loadPicks } from "@/lib/safeway";

/**
 * GET: the Safeway cart as Simmer knows it (what was added through Simmer), the picks (each item's usual product, with
 * its picture), and whether the helper on the computer is answering. Changes to the cart go through jobs
 * (/api/safeway/jobs, setQty), so they happen in the real Safeway cart first.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    const [cart, picks, helper] = await Promise.all([loadCart(), loadPicks(), helperStatus()]);
    return Response.json({ cart, picks, answering: helper.answering }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
