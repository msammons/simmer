// The writers against stored rows (review, Nov 19): rows without an id, columns in any order, and blank cells.
import { AsyncResource } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabStore, type TabStore } from "./store";

// next/server's after(), as Next runs it: later, in the async context it was called in (that of the change's transaction).
const later: (() => unknown)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => { later.push(AsyncResource.bind(fn)); } }));

const data = new Map<string, string>();
const store: TabStore = {
  get: async (k) => data.get(k) ?? null,
  set: async (k, v) => { data.set(k, v); return "OK"; },
  mget: async (...ks) => ks.map((k) => data.get(k) ?? null),
  keys: async (p) => [...data.keys()].filter((k) => k.startsWith(p.replace(/\*$/, ""))),
};
const put = (tab: string, rows: string[][]) => data.set(`simmer:tab:${tab}`, JSON.stringify(rows));
const tab = (tab: string): string[][] => JSON.parse(data.get(`simmer:tab:${tab}`) ?? "[]");
beforeEach(() => { data.clear(); useTabStore(store); });

describe("rows without an id", () => {
  it("a recipe is edited in place and deleted by the id it's shown with", async () => {
    const { deleteRecipe, loadRecipes, saveRecipe } = await import("./recipes");
    put("Recipes", [["id", "name", "ingredients"], ["", "Old soup", "1.5 lb chicken\n- 2 carrots"], ["x-1", "Other", ""]]);
    const [soup] = await loadRecipes();
    expect(soup.ingredients.map((i) => [i.quantity, i.item])).toEqual([["1.5", "chicken"], ["2", "carrots"]]);
    expect((await loadRecipes())[0].id).toBe(soup.id); // the same each time
    await saveRecipe({ ...soup, notes: "good" });
    expect(tab("Recipes")).toHaveLength(3);
    expect((await loadRecipes()).find((r) => r.id === soup.id)?.notes).toBe("good");
    expect(await deleteRecipe(soup.id)).toBe(true);
    expect((await loadRecipes()).map((r) => r.name)).toEqual(["Other"]);
  });
  it("a frozen thing without an id counts down and goes", async () => {
    const { loadFreezer, takeFrozen } = await import("./plan");
    put("Freezer", [["id", "item", "amount", "added", "store"], ["", "salmon", "2", "2026-11-01", ""]]);
    const [salmon] = await loadFreezer();
    await takeFrozen(salmon.id);
    expect(await loadFreezer()).toMatchObject([{ id: salmon.id, item: "salmon", amount: "1" }]);
    expect(tab("Freezer")).toHaveLength(2);
    await takeFrozen(salmon.id);
    expect(await loadFreezer()).toEqual([]);
  });
});

describe("columns by their headers", () => {
  it("remembers where a thing goes in the Ingredients tab's own column order", async () => {
    const { addItem, file, moveItem } = await import("./groceries");
    put("Ingredients", [["store", "name", "section"], ["safeway", "zzq thing", "fresh"]]);
    const it0 = await addItem("zzq thing", "Robin");
    await moveItem(it0.id, { store: "costco", section: "household" });
    expect(tab("Ingredients")).toEqual([["store", "name", "section"], ["costco", "zzq thing", "household"]]);
    expect(await file("zzq thing")).toEqual({ store: "costco", section: "household" });
  });
  it("a new plan keeps each dinner's day when Planned had no day column", async () => {
    const { loadPlan, savePlan } = await import("./plan");
    put("Planned", [["id", "kind", "recipe", "added", "made"]]);
    await savePlan([{ kind: "regular", recipe: "r1", pinned: false, day: "2026-11-21" }], [], { quick: 1, regular: 1, kids: 0, dessert: 0, side: 0, breakfast: 0, lunchmeal: 0, lunches: {} }, "Robin");
    expect((await loadPlan()).dishes).toMatchObject([{ recipe: "r1", day: "2026-11-21" }]);
  });
  it("a blank count reads as the usual number, not none", async () => {
    const { loadPlan } = await import("./plan");
    put("Plan counts", [["what", "count"], ["quick", ""], ["regular", "4"]]);
    expect((await loadPlan()).counts).toMatchObject({ quick: 2, regular: 4 });
  });
  it("what's ticked is written down as bought at a New plan", async () => {
    const { addItem, checkItem, emptyLists } = await import("./groceries");
    const a = await addItem("2 pears", "Robin");
    await checkItem(a.id, true);
    await emptyLists();
    expect(tab("Bought")).toEqual([["item", "quantity", "store", "date_bought", "for"], ["pears", "2", "safeway", new Date().toISOString().slice(0, 10), ""]]);
    expect(tab("List").slice(1)).toEqual([]);
  });
});

describe("guesses made after the answer (review, Nov 19)", () => {
  it("are written even though after() runs in the add's own context, and a name is asked once", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const gemini = await import("./gemini");
    const spy = vi.spyOn(gemini, "generateJson").mockImplementation((async () => ({
      data: { items: [{ name: "zzq sprocket", store: "costco", section: "household" }] }, model: "m", sources: [],
    })) as never);
    try {
      const { addItem, file, loadList } = await import("./groceries");
      later.length = 0;
      await addItem("zzq sprocket", "Robin");
      expect(later).toHaveLength(1);
      await Promise.all(later.splice(0).map((f) => f()));
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await file("zzq sprocket")).toEqual({ store: "costco", section: "household" });
      expect((await loadList()).items.find((x) => x.item === "zzq sprocket")).toMatchObject({ store: "costco", section: "household" });
      await addItem("zzq sprocket", "Sam");
      await Promise.all(later.splice(0).map((f) => f()));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      delete process.env.GEMINI_API_KEY;
    }
  });
});
