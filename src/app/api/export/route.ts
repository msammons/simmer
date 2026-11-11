import { authorized, unauthorized } from "@/lib/auth";
import { friendly } from "@/lib/friendly";
import { exportToSheet } from "@/lib/google/sheets";

/** POST: Settings → Copy to Google Sheet. Every tab, as the app keeps it, written over the Sheet's (Nov 11). */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json({ tabs: await exportToSheet() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("export failed", e);
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
