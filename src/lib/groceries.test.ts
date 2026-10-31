import { describe, expect, it } from "vitest";
import { addItem, checkItem, doneShopping, file, loadList, norm, parseEntry } from "./groceries";

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
