import { describe, expect, it } from "vitest";
import { addItems, addStaple, loadList, removeItem } from "./groceries";
import { addFrozen, changePlanned, clearPlanned, fromTheTap, loadFreezer, loadPlan, markMade, removePlanned, savePlan } from "./plan";
import { todayIn } from "./time";
import { planLunches } from "./week";

const counts = { quick: 1, regular: 1, kids: 0, dessert: 0, side: 0, breakfast: 0, lunches: { Theo: 2, Leo: 0 } };

describe("planning by number", () => {
  it("never puts tap water on a list", () => {
    expect(fromTheTap("water")).toBe(true);
    expect(fromTheTap("warm  water")).toBe(true);
    expect(fromTheTap("sparkling water")).toBe(false);
    expect(fromTheTap("coconut water")).toBe(false);
  });

  it("saves what's planned, puts everything it needs on the list at once, and remembers the numbers", async () => {
    const first = await loadPlan();
    expect(first.dishes).toEqual([]);
    expect(first.counts).toMatchObject({ quick: 2, regular: 3, lunches: { Theo: 5, Leo: 5 } }); // a usual week, the first time
    expect(first.lunchOptions.length).toBeGreaterThan(5);
    const lunches = planLunches([{ name: "Theo", count: 2 }], first.lunchOptions).map(({ kid, main, fruit, side, treat, snack }) => ({ kid, main, fruit, side, treat, snack }));
    const saved = await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }, { kind: "quick", recipe: "Dinner with G&G", pinned: true }], lunches, counts, "Robin");
    expect(saved.added).toBeGreaterThan(5);
    const { items } = await loadList();
    const turkey = items.find((i) => i.item === "ground turkey")!;
    expect(turkey).toMatchObject({ section: "fresh", check: false, for: "turkey chili" });
    expect(items.find((i) => i.item === "chili powder")).toMatchObject({ section: "pantry", check: true });
    expect(items.some((i) => i.item === "refried beans" && i.for === "lunches")).toBe(true);

    const p = await loadPlan();
    expect(p.dishes.map((d) => [d.kind, d.recipe, d.pinned])).toEqual([["regular", "turkey-chili-1", true], ["quick", "Dinner with G&G", true]]);
    expect(p.lunches.filter((l) => l.kid === "Theo")).toHaveLength(2);
    expect(p.counts).toMatchObject(counts); // last time's numbers
    // Looking again adds nothing; nothing waits to be added later.
    const before = (await loadList()).items.length;
    await loadPlan();
    expect((await loadList()).items.length).toBe(before);
  });

  it("keeps what's still to make when planning again, adding the new on top", async () => {
    const before = await loadPlan();
    await savePlan([{ kind: "quick", recipe: "tacos-1", pinned: false }], [], null, "Sam");
    const after = await loadPlan();
    expect(after.dishes.map((d) => d.recipe)).toEqual([...before.dishes.map((d) => d.recipe), "tacos-1"]);
    expect(after.lunches).toEqual(before.lunches);
  });

  it("made comes off, is remembered for picking, and leaves the list alone", async () => {
    const { dishes } = await loadPlan();
    const chili = dishes.find((d) => d.recipe === "turkey-chili-1")!;
    const list = (await loadList()).items.length;
    await markMade(chili.id);
    const p = await loadPlan();
    expect(p.dishes.some((d) => d.id === chili.id)).toBe(false);
    expect(p.lastMade["turkey-chili-1"]).toBe(todayIn());
    expect((await loadList()).items.length).toBe(list);
  });

  it("packed lunches come off; removed dinners too", async () => {
    const p = await loadPlan();
    await markMade(p.lunches[0].id);
    const tacos = p.dishes.find((d) => d.recipe === "tacos-1")!;
    await removePlanned(tacos.id);
    const q = await loadPlan();
    expect(q.lunches).toHaveLength(p.lunches.length - 1);
    expect(q.dishes.some((d) => d.id === tacos.id)).toBe(false);
    expect(q.lastMade["tacos-1"]).toBeUndefined(); // removed isn't made
  });

  it("a dinner taken off takes what only it needed off the list (Nov 10)", async () => {
    await savePlan([{ kind: "quick", recipe: "tacos-1", pinned: false }], [], null, "Sam");
    const forTacos = () => loadList().then((l) => l.items.filter((i) => i.for.split(",").map((x) => x.trim()).includes("tacos") && !i.checked));
    const before = await forTacos();
    expect(before.length).toBeGreaterThan(0);
    const tacos = (await loadPlan()).dishes.find((d) => d.recipe === "tacos-1")!;
    const { removed } = await removePlanned(tacos.id);
    expect(removed).toBeGreaterThan(0);
    // Only things shared with another dinner are left, and they no longer say tacos.
    expect(await forTacos()).toEqual([]);
  });

  it("Something else changes the recipe and puts what the new one needs on the list", async () => {
    const [d] = (await loadPlan()).dishes;
    const { added } = await changePlanned(d.id, { recipe: "salmon-1", pinned: false }, "Robin");
    expect(added).toBeGreaterThan(0);
    expect((await loadPlan()).dishes.find((x) => x.id === d.id)).toMatchObject({ recipe: "salmon-1", pinned: false });
    expect((await loadList()).items.find((i) => i.item === "broccoli")?.for).toMatch(/salmon and broccoli/);
  });

  it("drops Stock highlights for what's no longer planned when planning again", async () => {
    await addStaple("nutmeg");
    await addItems([{ item: "nutmeg", quantity: "1 tsp", for: "eggnog", check: true }], "Robin");
    expect((await loadList()).items.some((i) => i.item === "nutmeg" && i.check)).toBe(true);
    await savePlan([], [], null, "Robin");
    expect((await loadList()).items.some((i) => i.item === "nutmeg")).toBe(false);
  });

  it("uses the freezer instead of buying, and counts it down when made", async () => {
    await addFrozen("1 salmon");
    await addFrozen("1 salmon");
    expect((await loadFreezer()).find((f) => f.item === "salmon")?.amount).toBe("2");
    for (const it of (await loadList()).items.filter((i) => i.item === "salmon")) await removeItem(it.id); // from Something else, above
    await savePlan([{ kind: "quick", recipe: "salmon-1", pinned: false }], [], null, "Sam");
    expect((await loadList()).items.some((i) => i.item === "salmon" && !i.checked)).toBe(false);
    const d = (await loadPlan()).dishes.filter((x) => x.recipe === "salmon-1").pop()!;
    await markMade(d.id);
    expect((await loadFreezer()).find((f) => f.item === "salmon")?.amount).toBe("1");
  });

  it("planning the next shop closes this week: its dinners count as made the day they were planned, lunches go", async () => {
    await savePlan([], planLunches([{ name: "Leo", count: 1 }], (await loadPlan()).lunchOptions).map(({ kid, main, fruit, side, treat, snack }) => ({ kid, main, fruit, side, treat, snack })), null, "Sam");
    const before = await loadPlan();
    expect(before.dishes.length).toBeGreaterThan(0);
    expect(before.lunches.length).toBeGreaterThan(0);
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: false }], [], counts, "Sam");
    const after = await loadPlan();
    expect(after.dishes.map((d) => d.recipe)).toEqual(["turkey-chili-1"]);
    expect(after.lunches).toEqual([]);
    for (const d of before.dishes) expect(after.lastMade[d.recipe]).toBe(todayIn());
  });
});

describe("a new plan (Nov 10)", () => {
  it("New plan takes every dinner off, logs them as made, and leaves the list alone (Nov 10)", async () => {
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }], [], null, "Sam");
    const list = (await loadList()).items.length;
    await clearPlanned();
    const p = await loadPlan();
    expect(p.dishes).toEqual([]);
    expect(p.lastMade["turkey-chili-1"]).toBe(todayIn());
    expect((await loadList()).items.length).toBe(list);
  });
});
