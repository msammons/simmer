import { describe, expect, it, vi } from "vitest";
import { addItem, addItems, addStaple, checkItem, loadList, removeItem } from "./groceries";
import { addFrozen, changePlanned, removeRecipeFromPlan, clearPlanned, setCount, loadFreezer, loadPlan, markMade, removePlanned, savePlan, switchOn, tidyStock } from "./plan";
import { addDays, todayIn } from "./time";
import type { LunchOption } from "./week";

/** That many lunches for one boy, from his first option for each part (Simmer no longer plans lunches; Nov 14). */
const lunchesFor = (kid: string, count: number, options: LunchOption[]) => Array.from({ length: count }, () => {
  const part = (p: string) => options.find((o) => o.kid === kid && o.part === p)?.item ?? "";
  return { kid, main: part("main"), fruit: part("fruit"), side: part("side"), treat: part("treat"), snack: part("snack") };
});

const counts = { quick: 1, regular: 1, kids: 0, dessert: 0, side: 0, breakfast: 0, lunchmeal: 0, lunches: { Theo: 2, Leo: 0 } };

describe("planning by number", () => {
  it("never puts tap water on a list", async () => {
    const { fromDraft, saveRecipe } = await import("./recipes");
    const r = await saveRecipe(fromDraft({ name: "water-test punch", effort: "quick", minutes: null, serves: null, protein: "", ingredients: ["1 cup water", "1/2 cup warm  water", "1 cup sparkling water", "1 cup coconut water"], steps: [], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "" }));
    await setCount(r.id, "quick", 1, "Sam");
    const names = (await loadList()).items.filter((i) => i.for === "water-test punch").map((i) => i.item).sort();
    expect(names).toEqual(["coconut water", "sparkling water"]);
    await setCount(r.id, "quick", 0, "Sam");
  });

  it("saves what's planned, puts everything it needs on the list at once, and remembers the numbers", async () => {
    const first = await loadPlan();
    expect(first.dishes).toEqual([]);
    expect(first.counts).toMatchObject({ quick: 2, regular: 3, lunches: { Theo: 5, Leo: 5 } }); // a usual week, the first time
    expect(first.lunchOptions.length).toBeGreaterThan(5);
    const lunches = lunchesFor("Theo", 2, first.lunchOptions);
    const saved = await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }, { kind: "quick", recipe: "Dinner with G&G", pinned: true }], lunches, counts, "Robin");
    expect(saved.added).toBeGreaterThan(5);
    const { items } = await loadList();
    const turkey = items.find((i) => i.item === "ground turkey")!;
    expect(turkey).toMatchObject({ section: "fresh", check: true, for: "turkey chili" }); // waits on Stock, fresh too (Nov 14)
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
    await changePlanned(d.id, { recipe: "salmon-1", pinned: false }, "Robin");
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
    await savePlan([], lunchesFor("Leo", 1, (await loadPlan()).lunchOptions), null, "Sam");
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
  it("New plan starts everything fresh: every dinner off, logged as made, and every list emptied (Nov 11)", async () => {
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }], [], null, "Sam");
    await addItem("new-plan-test bread", "Robin"); // added by hand: goes too
    const { removed } = await clearPlanned();
    const p = await loadPlan();
    expect(p.dishes).toEqual([]);
    expect(p.lastMade["turkey-chili-1"]).toBe(todayIn());
    expect(removed).toBeGreaterThan(0);
    expect((await loadList()).items).toEqual([]);
  });

  it("the same dinner twice doubles its groceries; one fewer cuts them back and keeps them", async () => {
    await clearPlanned();
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }], [], null, "Sam");
    const turkey = () => loadList().then((l) => l.items.find((i) => i.item === "ground turkey" && !i.checked));
    const once = (await turkey())!.quantity;
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }], [], null, "Sam");
    const twice = (await turkey())!.quantity;
    expect(twice).not.toBe(once);
    const [one] = (await loadPlan()).dishes.filter((d) => d.recipe === "turkey-chili-1");
    await removePlanned(one.id);
    expect((await turkey())?.quantity).toBe(once);
    expect((await turkey())?.for).toContain("turkey chili");
  });

  it("sets how many of one dinner in one change, groceries following", async () => {
    await clearPlanned();
    const turkey = () => loadList().then((l) => l.items.find((i) => i.item === "ground turkey" && !i.checked));
    const chili = () => loadPlan().then((p) => p.dishes.filter((d) => d.recipe === "turkey-chili-1").length);
    await setCount("turkey-chili-1", "regular", 1, "Sam");
    const one = (await turkey())!.quantity;
    expect(await chili()).toBe(1);
    await setCount("turkey-chili-1", "regular", 3, "Sam");
    expect(await chili()).toBe(3);
    expect((await turkey())!.quantity).not.toBe(one);
    await setCount("turkey-chili-1", "regular", 1, "Sam");
    expect(await chili()).toBe(1);
    expect((await turkey())!.quantity).toBe(one);
    const off = await setCount("turkey-chili-1", "regular", 0, "Sam");
    expect(await chili()).toBe(0);
    expect(off.removed).toBeGreaterThan(0);
  });
});


describe("a deleted recipe (Nov 14)", () => {
  it("comes off the plan every time it's on it, with its groceries", async () => {
    await clearPlanned();
    await setCount("turkey-chili-1", "regular", 2, "Sam");
    expect((await loadPlan()).dishes.filter((d) => d.recipe === "turkey-chili-1")).toHaveLength(2);
    const { removed } = await removeRecipeFromPlan("turkey-chili-1");
    expect((await loadPlan()).dishes.filter((d) => d.recipe === "turkey-chili-1")).toHaveLength(0);
    expect(removed).toBeGreaterThan(0);
  });
});

describe("meals by day (Nov 16)", () => {
  it("keeps the day a meal is planned for, even when the tab had no day column", async () => {
    await clearPlanned();
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true, day: "2026-11-20" }], [], null, "Robin");
    expect((await loadPlan()).dishes.find((d) => d.recipe === "turkey-chili-1")).toMatchObject({ day: "2026-11-20" });
  });
});

describe("review fixes (Nov 19)", () => {
  it("Something else on one of two helpings keeps the other helping's groceries", async () => {
    await clearPlanned();
    await setCount("turkey-chili-1", "regular", 1, "Sam");
    const turkey = () => loadList().then((l) => l.items.find((i) => i.item === "ground turkey" && !i.checked));
    const once = (await turkey())!.quantity;
    await setCount("turkey-chili-1", "regular", 2, "Sam");
    const [one] = (await loadPlan()).dishes.filter((d) => d.recipe === "turkey-chili-1");
    await changePlanned(one.id, { recipe: "salmon-1", pinned: false }, "Sam");
    expect(await turkey()).toMatchObject({ quantity: once, for: "turkey chili" });
  });

  it("a cart that can't be read stops a New plan, a removal or a swap rather than taking cart things off the list", async () => {
    await clearPlanned();
    await setCount("turkey-chili-1", "regular", 1, "Sam");
    const safeway = await import("./safeway");
    const spy = vi.spyOn(safeway, "loadCart").mockRejectedValue(new Error("redis down"));
    const before = (await loadList()).items.length;
    await expect(clearPlanned()).rejects.toThrow();
    await expect(setCount("turkey-chili-1", "regular", 0, "Sam")).rejects.toThrow();
    expect((await loadList()).items.length).toBe(before);
    spy.mockRestore();
  });

  it("a deleted recipe planned twice takes off both helpings' amounts of what it shared", async () => {
    await clearPlanned();
    await setCount("turkey-chili-1", "regular", 2, "Sam");
    await addItems([{ item: "ground turkey", quantity: "1 lb", for: "share-test burgers", check: false }], "Sam");
    await removeRecipeFromPlan("turkey-chili-1");
    expect((await loadList()).items.find((i) => i.item === "ground turkey" && !i.checked)).toMatchObject({ quantity: "1 lb", for: "share-test burgers" });
  });
});

describe("old meal plans kept (Nov 24)", () => {
  const forChili = () => loadList().then((l) => l.items.filter((i) => i.for.split(",").map((x) => x.trim()).includes("turkey chili") && !i.checked));

  it("New plan keeps every dinner, dimmed, logged as made; nothing comes off Meals", async () => {
    await clearPlanned();
    const later = addDays(todayIn(), 3);
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true, day: later }], [], null, "Sam");
    const id = (await loadPlan()).dishes.find((d) => d.recipe === "turkey-chili-1")!.id;
    await clearPlanned(true);
    const p = await loadPlan();
    expect(p.dishes.some((d) => d.id === id)).toBe(false);
    expect(p.old.find((d) => d.id === id)).toMatchObject({ recipe: "turkey-chili-1", day: later });
    expect(p.lastMade["turkey-chili-1"]).toBe(todayIn()); // its day is still to come: made today
  });

  it("Keep leaves what wasn't bought on the list; ticked things and Stock's waiting things go; Clear takes the rest", async () => {
    await clearPlanned();
    await addItem("keep-test eggs", "Robin");
    await addItem("keep-test milk", "Robin");
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true }], [], null, "Sam");
    const milk = (await loadList()).items.find((i) => i.item === "keep-test milk")!;
    await checkItem(milk.id, true);
    await clearPlanned(true);
    const left = (await loadList()).items;
    expect(left.map((i) => i.item)).toEqual(["keep-test eggs"]); // the chili's things waited on Stock: gone
    await clearPlanned(false);
    expect((await loadList()).items).toEqual([]);
  });

  it("a dimmed meal switched back on is on again on its day, and its things go on the list", async () => {
    await clearPlanned();
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true, day: todayIn() }], [], null, "Sam");
    await clearPlanned();
    const old = (await loadPlan()).old.find((d) => d.recipe === "turkey-chili-1" && d.day === todayIn())!;
    expect(await forChili()).toEqual([]);
    const { added } = await switchOn(old.id, "Robin");
    expect(added).toBeGreaterThan(3);
    const p = await loadPlan();
    expect(p.dishes.find((d) => d.id === old.id)).toMatchObject({ day: todayIn() });
    expect(p.old.some((d) => d.id === old.id)).toBe(false);
    expect((await forChili()).length).toBe(added);
  });

  it("a meal's day passing dims it; switching it on keeps it on, and Stock keeps its things", async () => {
    await clearPlanned();
    const then = addDays(todayIn(), -5);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${then}T20:00:00Z`));
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true, day: then }], [], null, "Sam");
    vi.useRealTimers();
    const p = await loadPlan();
    const d = p.old.find((x) => x.recipe === "turkey-chili-1" && x.day === then)!;
    expect(d).toBeTruthy();
    expect(p.dishes.some((x) => x.id === d.id)).toBe(false);
    await tidyStock(); // a passed day's things waiting on Stock go
    expect(await forChili()).toEqual([]);
    await switchOn(d.id, "Robin");
    await tidyStock();
    expect((await loadPlan()).dishes.find((x) => x.id === d.id)).toMatchObject({ day: then });
    expect((await forChili()).length).toBeGreaterThan(3);
  });

  it("a new meal on a day that's passed goes on, with its things, and stays there", async () => {
    await clearPlanned(false);
    const then = addDays(todayIn(), -3);
    await savePlan([{ kind: "regular", recipe: "turkey-chili-1", pinned: true, day: then }], [], null, "Sam");
    await tidyStock();
    expect((await loadPlan()).dishes.find((d) => d.recipe === "turkey-chili-1")).toMatchObject({ day: then });
    expect((await forChili()).length).toBeGreaterThan(3);
  });
});
