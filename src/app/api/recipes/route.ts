import { AppError } from "@/lib/errors";
import { deleteRecipe, fromDraft, loadRecipes, saveRecipes, sameName, updateRecipe, type Draft, type Recipe } from "@/lib/recipes";
import { removeRecipeFromPlan } from "@/lib/plan";
import { fileSection } from "@/lib/groceries";
import { api, body, clean, refuse } from "@/lib/ops/route";
import { freshChange, freshRead, RECIPES, withEtag } from "@/lib/ops/fresh";

/** GET: the whole collection (it's small: a family's recipes). */
export const GET = api((req) => freshRead(req, RECIPES, async () => ({ recipes: await loadRecipes() })));

/**
 * POST { op, ... }: save { recipes: Draft[], duplicates?: "skip" | "replace" } (new ones, or edits by id; a new one
 * whose name is already in the collection is kept as well unless duplicates says otherwise), effort { id, effort },
 * active { id, active }. Answers with the collection as it is after the change, and what was saved. The change and the
 * answer are one transaction (Nov 19), so a change made at the same moment elsewhere isn't lost.
 */
export const POST = api(async (req) => {
  const b = await body(req);
  // A draft that can't be saved is answered as a problem after the ones read before it are kept (so it isn't thrown
  // inside the transaction, which would keep nothing).
  const { out, etag } = await freshChange(RECIPES, async () => {
    let saved: string[] = [], problem: unknown = null;
    switch (b?.op) {
      case "save": {
        const drafts: Draft[] = (Array.isArray(b.recipes) ? b.recipes.slice(0, 300) : []).filter((d: unknown) => d !== null && typeof d === "object");
        if (!drafts.length) throw new AppError("Nothing to save.");
        const all = await loadRecipes();
        // Saved together, in one read and one write (one save each ran past the Sheet's limit on a big import).
        const ready: Recipe[] = [];
        try {
          for (const d of drafts) {
            const byId = d.id ? all.find((r) => r.id === d.id) : undefined;
            const twin = byId ? undefined : sameName(all, String(d.name ?? ""));
            if (twin && b.duplicates === "skip") continue;
            const existing = byId ?? (twin && b.duplicates === "replace" ? twin : undefined);
            const r = fromDraft({ ...d, id: existing?.id }, existing);
            ready.push(r);
            all.push(r);
            saved.push(r.id);
          }
        } catch (e) { problem = e; }
        await saveRecipes(ready);
        break;
      }
      case "effort": saved = [(await updateRecipe(clean(b.id, 60), (r) => ({ ...r, effort: b.effort === "quick" ? "quick" : "regular" }))).id]; break;
      case "active": saved = [(await updateRecipe(clean(b.id, 60), (r) => ({ ...r, active: Boolean(b.active) }))).id]; break;
      // An ingredient moved between Fresh, Freezer and Pantry (Nov 16-17): remembered for every recipe and the list.
      case "section": {
        if (b.section !== "fresh" && b.section !== "pantry" && b.section !== "freezer") throw new AppError("Fresh, freezer or pantry?");
        const item = clean(b.item, 80);
        if (!item) throw new AppError("Which ingredient?");
        await fileSection(item, b.section);
        break;
      }
      // Deleting (Nov 14): off the collection, and off the plan with what only it needed on the list.
      case "delete": {
        const id = clean(b.id, 60);
        if (!(await deleteRecipe(id))) throw new AppError("That recipe isn't in the collection anymore.");
        await removeRecipeFromPlan(id);
        break;
      }
      default: return null;
    }
    return { recipes: await loadRecipes(), saved, problem };
  });
  if (!out) return refuse("Unknown change.");
  if (out.problem) throw out.problem;
  return withEtag({ recipes: out.recipes, saved: out.saved }, etag);
});
