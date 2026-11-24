import { describe, expect, it, vi } from "vitest";
import { addItem, addItems, addUp, takeAway, takeOffFor, addStaple, checkItem, dropHighlightsNotFor, doneShopping, file, loadList, moveStaple, norm, parseEntry, removeItems, removeStaple, renameGroup } from "./groceries";

describe("the grocery list", () => {
  it("reads what's typed", () => {
    expect(parseEntry("2 lemons")).toEqual({ quantity: "2", item: "lemons" });
    expect(parseEntry("lemons x3")).toEqual({ quantity: "3", item: "lemons" });
    expect(parseEntry("a dozen eggs")).toEqual({ quantity: "dozen", item: "eggs" });
    expect(parseEntry("TP")).toEqual({ quantity: "", item: "TP" });
    expect(parseEntry("2 lb ground beef")).toEqual({ quantity: "2 lb", item: "ground beef" });
    expect(parseEntry("1/2 gallon milk")).toEqual({ quantity: "1/2 gallon", item: "milk" });
    expect(parseEntry("2 garlic")).toEqual({ quantity: "2", item: "garlic" });
    expect(parseEntry("1 1/2 lb ground beef")).toEqual({ quantity: "1 1/2 lb", item: "ground beef" });
    expect(norm("Lemons")).toBe(norm("lemon"));
  });
  it("counts every row it changed, waiting on Stock or on a list (the screens read the list again)", async () => {
    const n = await addItems([
      { item: "count-test ricotta", quantity: "1", for: "Friday's lasagna" },
      { item: "count-test oregano", quantity: "1 tsp", for: "Friday's lasagna", check: true },
    ], "Robin");
    expect(n).toBe(2);
    await removeItems((await loadList()).items.filter((x) => x.item.startsWith("count-test")).map((x) => x.id));
  });
  it("a dinner's thing waiting on Have or Need, typed in by hand, becomes Need (Nov 24: \"eggs\" showed a moment and went)", async () => {
    await addItems([{ item: "need-test eggs", quantity: "2", for: "Friday's frittata", check: true }], "Robin");
    const added = await addItem("need-test eggs", "Sam");
    expect(added).toMatchObject({ check: false, have: false });
    const row = (await loadList()).items.find((x) => x.item === "need-test eggs")!;
    expect(row).toMatchObject({ check: false, have: false, checked: false });
    await removeItems([row.id]);
  });
  it("files common things without asking", async () => {
    expect(await file("bananas")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("toilet paper")).toEqual({ store: "costco", section: "household" });
    expect(await file("Grapes")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("apples")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("goldfish crackers")).toEqual({ store: "safeway", section: "pantry" });
    // Phrases stay whole (Nov 3): cream isn't freezer, milk and butter aren't pantry.
    expect(await file("heavy whipping cream")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("milk")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("butter")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("peanut butter")).toEqual({ store: "safeway", section: "pantry" });
    expect(await file("graham crackers")).toEqual({ store: "safeway", section: "pantry" });
    expect(await file("vanilla ice cream")).toEqual({ store: "safeway", section: "freezer" });
  });
  it("merges the same thing, checks it off, and clears a store's checked items when the trip is done", async () => {
    const a = await addItem("2 lemons", "Robin");
    const b = await addItem("lemon x1", "Sam");
    expect(b.id).toBe(a.id);
    expect(b.quantity).toBe("3");
    const tp = await addItem("toilet paper", "Sam");
    await checkItem(a.id, true);
    expect(await doneShopping("safeway")).toBe(1);
    const { items, staples } = await loadList();
    expect(items.map((i) => i.id)).toEqual([tp.id]);
    expect(staples.length).toBeGreaterThan(0);
  });
});

describe("adding amounts up (Nov 9)", () => {
  it("adds amounts that share a unit, fractions included, and writes them back nicely", () => {
    expect(addUp("1 lb", "1 lb")).toBe("2 lb");
    expect(addUp("1", "1")).toBe("2");
    expect(addUp("1½ lb", "1/2 lb")).toBe("2 lb");
    expect(addUp("1 1/2 lb", "1 lb")).toBe("2½ lb");
    expect(addUp("1/2", "1/2")).toBe("1");
    expect(addUp("1/2 lb", "1 lb")).toBe("1½ lb");
    expect(addUp("1/2 lb", "1/4 lb")).toBe("¾ lb");
    expect(addUp("1 lbs", "1 pound")).toBe("2 lb");
    expect(addUp("2 pounds", "1/2 lbs")).toBe("2½ lb");
    expect(addUp("8 oz", "8 ounces")).toBe("16 oz");
    expect(addUp("1 can", "1 can")).toBe("2 cans");
    expect(addUp("1 head", "2 heads")).toBe("3 heads");
    expect(addUp("1 bunch", "1 bunch")).toBe("2 bunches");
  });
  it("keeps both when the units differ (Nov 10), and the newer when an amount isn't one number", () => {
    expect(addUp("1 lb", "2")).toBe("1 lb + 2"); // both kept since Nov 10
    expect(addUp("1 lb", "8 oz")).toBe("1 lb + 8 oz");
    expect(addUp("", "1 lb")).toBe("1 lb");
    expect(addUp("1 lb", "")).toBe("1 lb");
    expect(addUp("1 medium", "1 medium")).toBe("1 medium");
    expect(addUp("dozen", "6")).toBe("6");
  });
  it("adds up pounds when a second recipe needs the same thing", async () => {
    await addItems([{ item: "sum-test ground turkey", quantity: "1 lb", for: "turkey chili" }], "Robin");
    await addItems([{ item: "sum-test ground turkey", quantity: "1 1/2 lb", for: "tacos" }], "Robin");
    const rows = (await loadList()).items.filter((x) => x.item === "sum-test ground turkey");
    expect(rows.map((x) => x.quantity)).toEqual(["2½ lb"]);
    await removeItems(rows.map((x) => x.id));
  });
});

describe("groups on List (Nov 16)", () => {
  it("renames a group with everything in it, and removing it keeps its things on their own", async () => {
    await addStaple("smoke brie", undefined, { group: "Cheese" });
    await addStaple("smoke gouda", undefined, { group: "cheese" });
    await addStaple("smoke oats", undefined, { group: "Breakfast" });
    await renameGroup("CHEESE", "Fancy cheese");
    const group = async (n: string) => (await loadList()).staples.find((s) => s.item === n)?.group;
    expect([await group("smoke brie"), await group("smoke gouda"), await group("smoke oats")]).toEqual(["Fancy cheese", "Fancy cheese", "Breakfast"]);
    await renameGroup("fancy cheese", "");
    expect([await group("smoke brie"), await group("smoke gouda")]).toEqual(["", ""]);
    for (const n of ["smoke brie", "smoke gouda", "smoke oats"]) await removeStaple(n);
  });
});

describe("Stock, and several off at once", () => {
  it("adds, moves and removes a kept thing, and several items come off at once", async () => {
    await addStaple("frozen waffles");
    expect((await loadList()).staples.find((s) => s.item === "frozen waffles")).toMatchObject({ section: "freezer" });
    await moveStaple("Frozen Waffles", "pantry");
    expect((await loadList()).staples.find((s) => s.item === "frozen waffles")?.section).toBe("pantry");
    await removeStaple("frozen waffles");
    expect((await loadList()).staples.some((s) => s.item === "frozen waffles")).toBe(false);
    const a = await addItem("paper towels", "Robin"), b = await addItem("2 lemons", "Robin");
    const gone = await removeItems([a.id, b.id]);
    expect(gone.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await loadList()).items.some((x) => x.id === a.id || x.id === b.id)).toBe(false);
  });
});

describe("meal highlights", () => {
  it("highlights for something no longer planned go when planning again; the rest stay", async () => {
    await addStaple("cinnamon");
    await addStaple("nutmeg");
    await addItems([{ item: "cinnamon", quantity: "2 tsp", for: "pumpkin pie" }, { item: "nutmeg", quantity: "1 tsp", for: "apple crisp" }], "Robin");
    const { items } = await loadList();
    const cinnamon = items.find((x) => x.item === "cinnamon")!, nutmeg = items.find((x) => x.item === "nutmeg")!;
    expect(cinnamon.check).toBe(true);
    await dropHighlightsNotFor(["pumpkin pie", "lunches"]); // the pie's still planned; the crisp isn't
    const after = (await loadList()).items;
    expect(after.some((x) => x.id === cinnamon.id)).toBe(true);
    expect(after.some((x) => x.id === nutmeg.id)).toBe(false);
  });
});

describe("bought history", () => {
  it("writes down what comes off the list when a trip is done", async () => {
    const a = await addItem("bought-test pears", "Robin", "Friday's salad", { store: "costco", section: "fresh" });
    await checkItem(a.id, true);
    expect(await doneShopping("costco")).toBe(1); // written down as bought: rows-redis.test.ts
    expect((await loadList()).items.some((x) => x.id === a.id)).toBe(false);
  });

  it("nothing comes back on a list by itself after a shop (Nov 10: no Every week)", async () => {
    await addStaple("tortillas");
    const t = (await loadList()).staples.find((x) => x.item === "tortillas")!;
    const a = await addItem("tortillas", "Robin");
    await checkItem(a.id, true);
    await doneShopping(t.store);
    expect((await loadList()).items.some((i) => i.item === "tortillas")).toBe(false);
  });
});

describe("taking a dinner's groceries off (Nov 10)", () => {
  it("takes away amounts in the same unit", () => {
    expect(takeAway("2½ lb", "1 lb")).toBe("1½ lb");
    expect(takeAway("2 lb", "2 lb")).toBe("");
    expect(takeAway("3", "1")).toBe("2");
    expect(takeAway("1 lb", "8 oz")).toBeNull();
  });
  it("removes what only that dinner needed, cuts back what's shared, and leaves hand-added and held things", async () => {
    await addItems([
      { item: "off-test tortillas", quantity: "1", for: "off-tacos" },
      { item: "off-test ground beef", quantity: "1 lb", for: "off-tacos" },
      { item: "off-test cilantro", quantity: "1 bunch", for: "off-tacos" },
    ], "Robin");
    await addItems([{ item: "off-test ground beef", quantity: "1 lb", for: "off-chili" }], "Robin");
    await addItem("off-test salsa", "Robin"); // added by hand: for no dinner
    const before = (await loadList()).items;
    const cilantro = before.find((x) => x.item === "off-test cilantro")!; // in the Safeway cart
    const n = await takeOffFor([
      { item: "off-test tortillas", quantity: "1", for: "off-tacos" },
      { item: "off-test ground beef", quantity: "1 lb", for: "off-tacos" },
      { item: "off-test cilantro", quantity: "1 bunch", for: "off-tacos" },
      { item: "off-test salsa", quantity: "", for: "off-tacos" },
    ], new Set([cilantro.id]));
    const after = (await loadList()).items;
    expect(after.some((x) => x.item === "off-test tortillas")).toBe(false);
    const beef = after.find((x) => x.item === "off-test ground beef")!;
    expect(beef.quantity).toBe("1 lb");
    expect(beef.for).toBe("off-chili");
    expect(after.some((x) => x.id === cilantro.id)).toBe(true);
    expect(after.some((x) => x.item === "off-test salsa")).toBe(true);
    expect(n).toBe(1);
  });
  it("never takes off something ticked off", async () => {
    await addItems([{ item: "off-test lemons", quantity: "2", for: "off-fish" }], "Robin");
    const it0 = (await loadList()).items.find((x) => x.item === "off-test lemons")!;
    await checkItem(it0.id, true);
    expect(await takeOffFor([{ item: "off-test lemons", quantity: "2", for: "off-fish" }])).toBe(0);
    expect((await loadList()).items.some((x) => x.id === it0.id)).toBe(true);
  });
});

describe("a line added by hand that a dinner joins (Nov 10)", () => {
  it("keeps both amounts when the units differ", () => {
    expect(addUp("1 dozen", "1")).toBe("1 dozen + 1");
    expect(addUp("1 lb", "8 oz")).toBe("1 lb + 8 oz");
    expect(addUp("1 lb", "1 lb")).toBe("2 lb");
  });
  it("stays added by hand, so taking the dinner off leaves it", async () => {
    await addItem("hand-test eggs", "Robin", "", undefined, "1 dozen");
    await addItems([{ item: "hand-test eggs", quantity: "1", for: "hand-lasagna" }], "Robin");
    let eggs = (await loadList()).items.find((x) => x.item === "hand-test eggs")!;
    expect(eggs.for).toBe("added by hand, hand-lasagna");
    expect(eggs.quantity).toBe("1 dozen + 1");
    await takeOffFor([{ item: "hand-test eggs", quantity: "1", for: "hand-lasagna" }]);
    eggs = (await loadList()).items.find((x) => x.item === "hand-test eggs")!;
    expect(eggs.for).toBe("added by hand");
  });
  it("a hand add onto a dinner's line marks it too", async () => {
    await addItems([{ item: "hand-test lemons", quantity: "2", for: "hand-fish" }], "Robin");
    await addItem("hand-test lemons", "Robin");
    const lemons = (await loadList()).items.find((x) => x.item === "hand-test lemons")!;
    expect(lemons.for).toBe("added by hand, hand-fish");
  });
  it("matches dinners by their whole name, not part of one", async () => {
    await addItems([{ item: "hand-test crust", quantity: "1", for: "tuesday's pie" }], "Robin");
    await addItems([{ item: "hand-test crust", quantity: "1", for: "pie" }], "Robin");
    expect((await loadList()).items.find((x) => x.item === "hand-test crust")!.for).toBe("tuesday's pie, pie");
  });
});

describe("taking away from a combined amount (Nov 10)", () => {
  it("takes it from the part in the same unit", () => {
    expect(takeAway("1 dozen + 1", "1")).toBe("1 dozen");
    expect(takeAway("1 lb + 8 oz", "8 oz")).toBe("1 lb");
    expect(takeAway("1 lb + 8 oz", "1 cup")).toBeNull();
  });
});


describe("leftovers on Stock (Nov 14)", () => {
  it("drops a dinner's waiting rows for a dinner no longer planned, never a kept thing's answer or a hand-added row", async () => {
    await addItems([{ item: "stuck-test cheese", quantity: "1 cup", for: "chicken tacos", check: true }], "Robin");
    const hand = await addItem("stuck-test bread", "Robin");
    const { items } = await loadList();
    const have = items.find((x) => x.item === "stuck-test cheese")!;
    await dropHighlightsNotFor(["lasagna"]);
    const after = (await loadList()).items.map((x) => x.item);
    expect(after).not.toContain("stuck-test cheese");
    expect(after).toContain("stuck-test bread");
    expect(have.for).toBe("chicken tacos");
    await removeItems([hand.id]);
  });
});

describe("amounts in every unit a recipe uses (review, Nov 19)", () => {
  it("adds into the part with the same unit, or adds a part", () => {
    expect(addUp("1 dozen + 1", "1")).toBe("1 dozen + 2");
    expect(addUp("1 dozen + 1", "8 oz")).toBe("1 dozen + 1 + 8 oz");
    expect(addUp("1 lb + 8 oz", "8 oz")).toBe("1 lb + 16 oz");
  });
  it("knows every unit an ingredient line can have", () => {
    expect(addUp("100 g", "50 g")).toBe("150 g");
    expect(addUp("2 slices", "1 slice")).toBe("3 slices");
    expect(addUp("1 qt", "1 quart")).toBe("2 quarts");
    expect(addUp("1 pinch", "1 pinch")).toBe("2 pinches");
    expect(addUp("1 container", "1 containers")).toBe("2 containers");
    expect(addUp("1 T", "1 tbsp")).toBe("2 tbsp");
    expect(addUp("250 ml", "250 ml")).toBe("500 ml");
    expect(takeAway("3 sprigs", "1 sprig")).toBe("2 sprigs");
  });
  it("takes off what a dinner added to a line that was there already, and only that", async () => {
    await addItem("3 sym-test lemons", "Robin");
    await addItems([{ item: "sym-test lemons", quantity: "2", for: "sym-fish", check: true }], "Robin");
    let lemons = (await loadList()).items.find((x) => x.item === "sym-test lemons")!;
    expect(lemons).toMatchObject({ quantity: "5", for: "added by hand, sym-fish" });
    await takeOffFor([{ item: "sym-test lemons", quantity: "2", for: "sym-fish" }]);
    lemons = (await loadList()).items.find((x) => x.item === "sym-test lemons")!;
    expect(lemons).toMatchObject({ quantity: "3", for: "added by hand" });
    await removeItems([lemons.id]);
  });
  it("takes off every helping of a dinner planned more than once", async () => {
    await addItems([{ item: "twice-test beef", quantity: "1 lb", for: "twice-a" }, { item: "twice-test beef", quantity: "1 lb", for: "twice-a" }, { item: "twice-test beef", quantity: "1 lb", for: "twice-b" }], "Robin");
    expect((await loadList()).items.find((x) => x.item === "twice-test beef")!.quantity).toBe("3 lb");
    await takeOffFor([{ item: "twice-test beef", quantity: "1 lb", for: "twice-a" }, { item: "twice-test beef", quantity: "1 lb", for: "twice-a" }]);
    const beef = (await loadList()).items.find((x) => x.item === "twice-test beef")!;
    expect(beef).toMatchObject({ quantity: "1 lb", for: "twice-b" });
    await removeItems([beef.id]);
  });
});

describe("what a line is for (review, Nov 19)", () => {
  it("keeps every dinner's name whole, however many", async () => {
    const dinners = Array.from({ length: 8 }, (_, i) => `a rather long dinner name number ${i}`);
    await addItems(dinners.map((d) => ({ item: "for-test rice", quantity: "1 cup", for: d })), "Robin");
    await takeOffFor(dinners.slice(0, 7).map((d) => ({ item: "for-test rice", quantity: "1 cup", for: d })));
    const rice = (await loadList()).items.find((x) => x.item === "for-test rice")!;
    expect(rice).toMatchObject({ quantity: "1 cup", for: dinners[7] });
    await removeItems([rice.id]);
  });
  it("a dinner's waiting rows stay only for a dinner of that very name", async () => {
    await addItems([{ item: "name-test stock", quantity: "1", for: "chicken soup", check: true }], "Robin");
    await dropHighlightsNotFor(["soup"]);
    expect((await loadList()).items.some((x) => x.item === "name-test stock")).toBe(false);
  });
});

describe("filing new things (review, Nov 19)", () => {
  it("asks once for everything the rules don't know, and never again", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const gemini = await import("./gemini");
    const spy = vi.spyOn(gemini, "generateJson").mockImplementation((async () => ({
      data: { items: [{ name: "zzq widget", store: "costco", section: "household" }, { name: "zzq gadget", store: "safeway", section: "pantry" }] }, model: "m", sources: [],
    })) as never);
    await addItems([{ item: "zzq widget", quantity: "", for: "" }, { item: "zzq gadget", quantity: "", for: "" }, { item: "bananas", quantity: "", for: "" }], "Robin");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("zzq widget");
    expect(String(spy.mock.calls[0][0])).not.toContain("bananas");
    const items = (await loadList()).items;
    expect(items.find((x) => x.item === "zzq widget")).toMatchObject({ store: "costco", section: "household" });
    expect(items.find((x) => x.item === "zzq gadget")).toMatchObject({ store: "safeway", section: "pantry" });
    await removeItems(items.filter((x) => x.item.startsWith("zzq") || x.item === "bananas").map((x) => x.id));
    await addItem("zzq widget", "Robin");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await file("zzq gadget")).toEqual({ store: "safeway", section: "pantry" });
    spy.mockRestore();
    delete process.env.GEMINI_API_KEY;
  });
});
