// Searching the collection: plain code, run on the phone as she types (and in tests).
import type { Recipe } from "./recipes";
import { norm } from "./words";

/** "Something with salmon" → salmon. Words that say nothing about which recipe. */
const FILLER = new Set(["something", "with", "a", "an", "the", "and", "or", "for", "of", "recipe", "recipes", "dinner", "dinners", "meal", "meals", "some", "my", "our", "made", "make"]);

/**
 * The collection's recipes that match every word of a search, best first: a word can match the name, a tag, an
 * ingredient or the protein, or say how long ("quick"), which store ("trader joe's") or who it's for ("kids").
 */
export function searchRecipes(all: Recipe[], q: string): Recipe[] {
  let text = ` ${q.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]/g, " ")} `;
  const filters: ((r: Recipe) => boolean)[] = [];
  const take = (re: RegExp, f: (r: Recipe) => boolean) => { if (re.test(text)) { filters.push(f); text = text.replace(re, " "); } };
  take(/ (quick|fast|easy) /, (r) => r.effort === "quick");
  take(/ regular /, (r) => r.effort === "regular");
  take(/ (trader joes|trader joe|tjs) /, (r) => r.store === "trader-joes");
  take(/ costco /, (r) => r.store === "costco");
  take(/ (kids|kid|boys) /, (r) => r.for === "kids" || r.kidOk === "yes");
  take(/ make ahead /, (r) => r.makeAhead);
  take(/ (favorites|favourites|favorite|favourite) /, (r) => (r.rating ?? 0) >= 3);
  take(/ not suggested /, (r) => !r.active);
  const terms = text.split(" ").filter((w) => w && !FILLER.has(w)).map(norm).filter(Boolean);
  const scored = all.flatMap((r) => {
    if (!filters.every((f) => f(r))) return [];
    let score = 0;
    for (const t of terms) {
      const s = (norm(r.name).includes(t) ? 4 : 0) + (r.tags.some((x) => norm(x).includes(t)) ? 3 : 0)
        + (norm(r.protein).includes(t) ? 2 : 0) + (r.ingredients.some((i) => norm(i.item).includes(t)) ? 1 : 0) + (norm(r.notes).includes(t) ? 0.5 : 0);
      if (!s) return [];
      score += s;
    }
    return [{ r, score: score + (r.rating ?? 0) * 0.1 }];
  });
  return scored.sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name)).map((x) => x.r);
}

