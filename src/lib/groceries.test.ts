import { describe, expect, it } from "vitest";
import { addItem, addItems, addStaple, checkItem, dropHighlightsBefore, doneShopping, file, loadList, moveStaple, norm, parseEntry, putBack, removeItems, removeStaple } from "./groceries";

describe("the grocery list", () => {
  it("reads what's typed", () => {
    expect(parseEntry("2 lemons")).toEqual({ quantity: "2", item: "lemons" });
    expect(parseEntry("lemons x3")).toEqual({ quantity: "3", item: "lemons" });
    expect(parseEntry("a dozen eggs")).toEqual({ quantity: "dozen", item: "eggs" });
    expect(parseEntry("TP")).toEqual({ quantity: "", item: "TP" });
    expect(parseEntry("2 lb ground beef")).toEqual({ quantity: "2 lb", item: "ground beef" });
    expect(parseEntry("1/2 gallon milk")).toEqual({ quantity: "1/2 gallon", item: "milk" });
    expect(parseEntry("2 garlic")).toEqual({ quantity: "2", item: "garlic" });
    expect(norm("Lemons")).toBe(norm("lemon"));
  });
  it("files common things without asking", async () => {
    expect(await file("bananas")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("toilet paper")).toEqual({ store: "costco", section: "household" });
    expect(await file("Grapes")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("apples")).toEqual({ store: "safeway", section: "fresh" });
    expect(await file("goldfish crackers")).toEqual({ store: "safeway", section: "pantry" });
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
  it("an earlier week's highlights go when a new week's groceries come; this week's stay", async () => {
    await addStaple("cinnamon");
    await addItems([{ item: "cinnamon", quantity: "2 tsp", for: "Sunday's pie" }], "Robin");
    const it = (await loadList()).items.find((x) => x.item === "cinnamon")!;
    expect(it.check).toBe(true);
    await dropHighlightsBefore(it.addedAt.slice(0, 10)); // added that day: stays
    expect((await loadList()).items.some((x) => x.id === it.id)).toBe(true);
    await dropHighlightsBefore("9999-01-01"); // a later week: it goes
    expect((await loadList()).items.some((x) => x.id === it.id)).toBe(false);
  });
});
