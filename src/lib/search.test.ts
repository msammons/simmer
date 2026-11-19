import { describe, expect, it } from "vitest";
import type { Recipe } from "./recipes";
import { searchRecipes } from "./search";

const r = (name: string, more: Partial<Recipe> = {}): Recipe => ({
  id: name, name, effort: "regular", minutes: null, serves: null, protein: "", ingredients: [], steps: [], store: "", season: [], for: "everyone",
  kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "", active: true, addedAt: "", ...more,
});
const all = [r("Tacos", { effort: "quick", kidOk: "yes" }), r("Roast chicken"), r("Pasta", { effort: "quick" })];
const names = (q: string) => searchRecipes(all, q).map((x) => x.name);

describe("search filter words (Nov 19)", () => {
  it("takes every filter word, however many times it's typed", () => {
    expect(names("quick easy")).toEqual(["Pasta", "Tacos"]);
    expect(names("quick easy dinner")).toEqual(["Pasta", "Tacos"]);
    expect(names("kids kids")).toEqual(["Tacos"]);
    expect(names("fast")).toEqual(["Pasta", "Tacos"]);
    expect(names("quick kids tacos")).toEqual(["Tacos"]);
  });
});
