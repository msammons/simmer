import { describe, expect, it } from "vitest";
import { addItem, addItems, addUp, forADinner, takeAway, takeOffFor, addStaple, checkItem, dropHighlightsNotFor, doneShopping, file, loadBought, loadList, moveStaple, norm, parseEntry, putBack, removeItems, removeStaple } from "./groceries";

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

describe("Stock and Clear", () => {
  it("adds, moves and removes a kept thing, and Clear takes items off with Undo putting them back", async () => {
    await addStaple("frozen waffles");
    expect((await loadList()).staples.find((s) => s.item === "frozen waffles")).toMatchObject({ section: "freezer" });
    await moveStaple("Frozen Waffles", "pantry");
    expect((await loadList()).staples.find((s) => s.item === "frozen waffles")?.section).toBe("pantry");
    await removeStaple("frozen waffles");
    expect((await loadList()).staples.some((s) => s.item === "frozen waffles")).toBe(false);
    const a = await addItem("paper towels", "Robin"), b = await addItem("2 lemons", "Robin");
    const gone = await removeItems([a.id, b.id]);
    expect(gone.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await loadList()).items.some((x) => x.id === a.id)).toBe(false);
    await putBack(gone);
    expect((await loadList()).items.find((x) => x.id === b.id)).toMatchObject({ item: "lemons", quantity: "2" });
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
    const before = (await loadBought()).length;
    expect(await doneShopping("costco")).toBe(1);
    const rows = await loadBought();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toEqual(["bought-test pears", "", "costco", new Date().toISOString().slice(0, 10), "Friday's salad"]);
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
    expect(forADinner(eggs)).toBe(false);
    await takeOffFor([{ item: "hand-test eggs", quantity: "1", for: "hand-lasagna" }]);
    eggs = (await loadList()).items.find((x) => x.item === "hand-test eggs")!;
    expect(eggs.for).toBe("added by hand");
  });
  it("a hand add onto a dinner's line marks it too", async () => {
    await addItems([{ item: "hand-test lemons", quantity: "2", for: "hand-fish" }], "Robin");
    await addItem("hand-test lemons", "Robin");
    const lemons = (await loadList()).items.find((x) => x.item === "hand-test lemons")!;
    expect(lemons.for).toBe("added by hand, hand-fish");
    expect(forADinner(lemons)).toBe(false);
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

