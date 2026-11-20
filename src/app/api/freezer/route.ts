import { addFrozen, loadKitchen, takeFrozen } from "@/lib/plan";
import { api, body, clean, refuse } from "@/lib/ops/route";
import { freshChange, freshRead, KITCHEN, withEtag } from "@/lib/ops/fresh";

/** GET: what's in the freezer (oldest first). */
export const GET = api((req) => freshRead(req, KITCHEN, loadKitchen));

/** POST { op: "add", text } ("2 salmon") or { op: "use", id } (one taken out). Answers like GET. */
export const POST = api(async (req) => {
  const b = await body(req);
  if (b?.op !== "add" && b?.op !== "use") return refuse("Unknown change.");
  // The change and the freezer answered, as one transaction (Nov 19).
  const { out, etag } = await freshChange(KITCHEN, async () => {
    if (b.op === "add") await addFrozen(clean(b.text, 60));
    else await takeFrozen(clean(b.id, 40));
    return loadKitchen();
  });
  return withEtag(out, etag);
});
