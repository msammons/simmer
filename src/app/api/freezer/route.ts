import { addFrozen, loadKitchen, takeFrozen } from "@/lib/plan";
import { transact } from "@/lib/store";
import { api, body, clean, noStore, refuse } from "@/lib/ops/route";

/** GET: what's in the freezer (oldest first). */
export const GET = api(async () => Response.json(await loadKitchen(), noStore));

/** POST { op: "add", text } ("2 salmon") or { op: "use", id } (one taken out). Answers like GET. */
export const POST = api(async (req) => {
  const b = await body(req);
  if (b?.op !== "add" && b?.op !== "use") return refuse("Unknown change.");
  // The change and the freezer answered, as one transaction (Nov 19).
  return Response.json(await transact(async () => {
    if (b.op === "add") await addFrozen(clean(b.text, 60));
    else await takeFrozen(clean(b.id, 40));
    return loadKitchen();
  }), noStore);
});
