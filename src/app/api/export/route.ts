import { exportToSheet } from "@/lib/export/sheet";
import { api, noStore } from "@/lib/ops/route";

/** POST: Settings → Copy to Google Sheet. Every tab, as the app keeps it, written over the Sheet's (Nov 11). */
export const POST = api(async () => Response.json({ tabs: await exportToSheet() }, noStore));
