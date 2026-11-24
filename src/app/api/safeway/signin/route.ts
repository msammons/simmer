import { cleanAccount, loadAccount, saveAccount } from "@/lib/safeway-signin";
import { api, body, noStore, refuse } from "@/lib/ops/route";

/** GET: the Google account the helper signs in to Safeway with ("" for none). */
export const GET = api(async () => Response.json({ account: (await loadAccount()).account }, noStore));

/** POST { account }: sets it; "" turns signing in off. Something that isn't an email address is refused, nothing saved. */
export const POST = api(async (req) => {
  const b = await body(req);
  const raw = typeof b?.account === "string" ? b.account.trim() : "";
  if (raw && !cleanAccount(raw)) return refuse("That isn't an email address.");
  return Response.json({ account: await saveAccount(raw) }, noStore);
});
