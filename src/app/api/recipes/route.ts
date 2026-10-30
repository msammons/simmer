import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { fromDraft, loadRecipes, saveRecipe, sameName, updateRecipe, type Draft } from "@/lib/recipes";

const clean = (s: unknown, max = 60) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** GET: the whole collection (it's small: a family's recipes). */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json({ recipes: await loadRecipes() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}

/**
 * POST { op, ... }: save { recipes: Draft[], duplicates?: "skip" | "replace" } (new ones, or edits by id; a new one
 * whose name is already in the collection is kept as well unless duplicates says otherwise), effort { id, effort },
 * active { id, active }. Answers with the collection as it is after the change, and what was saved.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    let saved: string[] = [];
    switch (b?.op) {
      case "save": {
        const drafts: Draft[] = (Array.isArray(b.recipes) ? b.recipes.slice(0, 300) : []).filter((d: unknown) => d !== null && typeof d === "object");
        if (!drafts.length) throw new AppError("Nothing to save.");
        const all = await loadRecipes();
        for (const d of drafts) {
          const byId = d.id ? all.find((r) => r.id === d.id) : undefined;
          const twin = byId ? undefined : sameName(all, String(d.name ?? ""));
          if (twin && b.duplicates === "skip") continue;
          const existing = byId ?? (twin && b.duplicates === "replace" ? twin : undefined);
          const r = fromDraft({ ...d, id: existing?.id }, existing);
          await saveRecipe(r);
          all.push(r);
          saved.push(r.id);
        }
        break;
      }
      case "effort": saved = [(await updateRecipe(clean(b.id), (r) => ({ ...r, effort: b.effort === "quick" ? "quick" : "regular" }))).id]; break;
      case "active": saved = [(await updateRecipe(clean(b.id), (r) => ({ ...r, active: Boolean(b.active) }))).id]; break;
      default: return Response.json({ error: "Unknown change." }, { status: 400 });
    }
    return Response.json({ recipes: await loadRecipes(), saved }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
