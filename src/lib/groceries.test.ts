import { describe, expect, it } from "vitest";
import { addItem, addItems, addStaple, checkItem, dropHighlightsNotFor, doneShopping, file, loadBought, loadList, moveStaple, norm, parseEntry, putBack, removeItems, removeStaple } from "./groceries";

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
  it("counts only what went on a list, not the pantry highlighted in Stock", async () => {
    const n = await addItems([
      { item: "count-test ricotta", quantity: "1", for: "Friday's lasagna" },
      { item: "count-test oregano", quantity: "1 tsp", for: "Friday's lasagna", check: true },
    ], "Robin");
    expect(n).toBe(1);
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
});
