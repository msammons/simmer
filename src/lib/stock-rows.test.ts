// Stock's rows (Nov 11, Sam: checking stock means flagging what you've checked; you can't have and need a thing at once;
// everything stays in its section, a dinner's things highlighted): each row answered Have, Need or not yet.
import { describe, expect, it } from "vitest";
import type { Item, ListState } from "./client";
import { afterRemoval, cartLinesOf, fromDinner, leavingBy, linesOf, removalOf, rowsOf } from "./stock-rows";

const item = (p: Partial<Item>): Item => ({
  id: "x", item: "tomato paste", quantity: "1 can", store: "safeway", section: "pantry", for: "Turkey chili", addedBy: "Robin",
  addedAt: "", checked: false, check: true, ...p,
});
const staple = (name: string, section = "pantry", more: Partial<ListState["staples"][number]> = {}) => ({ item: name, section, store: "safeway", quantity: "", product: "", kind: "common", group: "", ...more }) as ListState["staples"][number];
const list = (items: Item[], staples: ListState["staples"] = []): ListState => ({ items, staples });
const one = (l: ListState) => rowsOf(l, null)[0];

describe("Stock rows", () => {
  it("answers a dinner's thing: to check, Have or Need, highlighted with how much, in its own section", () => {
    expect(one(list([item({})]))).toMatchObject({ name: "tomato paste", section: "pantry", answer: "check", meal: true, amount: "1 can" });
    expect(one(list([item({ have: true })])).answer).toBe("have");
    expect(one(list([item({ check: false })])).answer).toBe("need");
  });

  it("answers a kept thing the same way: unanswered with no List row, Need when on the list, Have when marked", () => {
    expect(one(list([], [staple("Rice")]))).toMatchObject({ name: "Rice", answer: "check", meal: false, item: null });
    expect(one(list([item({ item: "rice", check: false, for: "added by hand" })], [staple("Rice")]))).toMatchObject({ answer: "need", meal: false });
    expect(one(list([item({ item: "rice", have: true, for: "" })], [staple("Rice")]))).toMatchObject({ answer: "have", meal: false });
  });

  it("highlights a kept thing a dinner needs, whatever its section (tortillas)", () => {
    const r = one(list([item({ item: "tortillas", section: "fresh", for: "chicken tacos", check: false })], [staple("Tortillas", "fresh")]));
    expect(r).toMatchObject({ name: "Tortillas", section: "fresh", answer: "need", meal: true });
  });

  it("shows a dinner's fresh things too, leaves out what's been bought, and counts what's left to check", () => {
    expect(rowsOf(list([item({ section: "fresh", item: "cilantro" })]), null)).toMatchObject([{ name: "cilantro", section: "fresh", answer: "check", meal: true }]);
    expect(rowsOf(list([item({ section: "fresh", check: false, item: "cilantro" })]), null)).toMatchObject([{ answer: "need", meal: true }]); // Need stays on Stock
    expect(rowsOf(list([item({ check: false, checked: true })]), null)).toHaveLength(0);
  });

  it("tells a dinner's thing from one added by hand", () => {
    expect(fromDinner(item({}))).toBe(true);
    expect(fromDinner(item({ for: "added by hand, Turkey chili" }))).toBe(false);
    expect(fromDinner(item({ for: "" }))).toBe(false);
    expect(fromDinner(item({ for: "Every week" }))).toBe(false);
  });

  it("shows everything on the list, even with no kept thing or dinner behind it (Sam, Nov 24: sugar on Shop, not on the List)", () => {
    // Its kept thing removed while it was Needed, or added by hand: still answerable here, in its own section.
    const sugar = item({ id: "s1", item: "Sugar", quantity: "", for: "", check: false });
    expect(rowsOf(list([sugar]), null)).toMatchObject([{ key: "l|s1", name: "Sugar", section: "pantry", answer: "need", meal: false, staple: null, item: sugar }]);
    expect(rowsOf(list([item({ item: "foil", section: "household", for: "added by hand", check: false })]), null)).toMatchObject([{ name: "foil", section: "household", answer: "need" }]);
    // Once only, and never ahead of its kept row or a freezer row of the same name; bought things stay off.
    expect(rowsOf(list([sugar], [staple("sugar")]), null)).toMatchObject([{ key: "s|sugar", answer: "need" }]);
    expect(rowsOf(list([sugar], [staple("sugar")]), null)).toHaveLength(1);
    expect(rowsOf(list([{ ...sugar, checked: true }]), null)).toHaveLength(0);
  });

  it("takes a kept thing's rows off the list with it when it's removed, but not a dinner's or what's been bought (Nov 24)", () => {
    const rows = [
      item({ id: "need", item: "Sugar", for: "", check: false }), item({ id: "have", item: "sugar", for: "", have: true }),
      item({ id: "dinner", item: "sugar", for: "Cookies" }), item({ id: "got", item: "sugar", for: "", checked: true }),
      item({ id: "other", item: "rice", for: "", check: false }), item({ id: "weekly", item: "sugar", for: "Every week", check: false }),
    ];
    expect(removalOf(rows, "Sugar")).toEqual({ drop: ["need", "have", "weekly"], keep: [] });
  });

  it("keeps a dinner's part of a row added by hand too, back to waiting for the dinner (review, Nov 24)", () => {
    const rows = [item({ id: "both", item: "eggs", for: "added by hand, Frittata, Cake", check: false })];
    expect(removalOf(rows, "Eggs")).toEqual({ drop: [], keep: [{ id: "both", for: "Frittata, Cake" }] });
    expect(afterRemoval(rows, "Eggs")).toMatchObject([{ id: "both", for: "Frittata, Cake", check: true, have: false }]);
    expect(rowsOf(list(afterRemoval(rows, "Eggs")), null)).toMatchObject([{ name: "eggs", meal: true, answer: "check" }]);
  });

  it("takes a row with a line in the Safeway cart off too, and its cart line to 0; a dinner's part keeps its line (Sam, Nov 24 night)", () => {
    const rows = [
      item({ id: "cart", item: "Bread", for: "", check: false }), item({ id: "loose", item: "bread", for: "added by hand", check: false }),
      item({ id: "both", item: "bread", for: "added by hand, Toast", check: false }),
    ];
    const cart = [{ itemId: "cart", qty: 1 }, { itemId: "both", qty: 2 }, { itemId: "", qty: 1 }, { itemId: "other", qty: 1 }];
    const { drop } = removalOf(rows, "bread");
    expect(drop).toEqual(["cart", "loose"]);
    expect(afterRemoval(rows, "bread").map((r) => r.id)).toEqual(["both"]);
    expect(cartLinesOf(cart, drop)).toEqual([{ itemId: "cart", qty: 1 }]); // queued to 0; the dinner's part keeps its line
  });

  it("an answer that takes a Need off the shopping list takes its cart line out (Sam, Nov 24 night)", () => {
    const need = { item: item({ id: "b", item: "bread", check: false }), answer: "need" as const };
    expect(leavingBy(need, "check")).toBe("b"); // the lit cart tapped again
    expect(leavingBy(need, "have")).toBe("b");
    expect(leavingBy(need, "need")).toBeNull();
    expect(leavingBy({ ...need, answer: "check" }, "have")).toBeNull(); // wasn't on the shopping list
    expect(leavingBy({ ...need, answer: "have" }, "check")).toBeNull();
    expect(leavingBy({ item: null, answer: "check" }, "have")).toBeNull();
    expect(cartLinesOf([{ itemId: "b", qty: 1 }, { itemId: "b", qty: 0 }], ["b"])).toEqual([{ itemId: "b", qty: 1 }]);
  });
});

// Nov 16 (Robin's run): common and specialty things, and groups.
describe("Stock: specialty things and groups", () => {
  it("shows a common thing always, a specialty one only while it's on the list or answered", () => {
    const goat = staple("Goat cheese", "fresh", { kind: "specialty" });
    expect(rowsOf(list([], [staple("Milk", "fresh"), goat]), null).map((r) => r.name)).toEqual(["Milk"]);
    const need = rowsOf(list([item({ item: "goat cheese", section: "fresh", check: false, for: "added by hand" })], [goat]), null);
    expect(need.map((r) => [r.name, r.answer])).toEqual([["Goat cheese", "need"]]);
    expect(rowsOf(list([item({ item: "goat cheese", checked: true, for: "added by hand" })], [goat]), null)).toEqual([]);
  });

  it("puts a group's things together under it, A to Z among the rest, even a group of one (Nov 16, Sam)", () => {
    const rows = rowsOf(list([], [
      staple("Swiss", "fresh", { group: "Cheese" }), staple("Cheddar", "fresh", { group: "cheese" }), staple("Apples", "fresh"),
      staple("Greek yogurt", "fresh", { group: "Yogurt" }), staple("Eggs", "fresh"),
    ]), null);
    const lines = linesOf(rows);
    expect(lines.map((l) => (l.kind === "row" ? l.row.name : `${l.name}: ${l.rows.map((r) => r.name).join(", ")}`)))
      .toEqual(["Apples", "Cheese: Cheddar, Swiss", "Eggs", "Yogurt: Greek yogurt"]);
  });
});

describe("Stock: empty groups (Sam, Nov 24)", () => {
  it("shows a group with nothing in it as its header alone, A to Z among the rest, once", () => {
    const rows = rowsOf(list([], [staple("Swiss", "fresh", { group: "Cheese" }), staple("Apples", "fresh")]), null);
    const lines = linesOf(rows, ["Milk", "cheese"]);
    expect(lines.map((l) => (l.kind === "row" ? l.row.name : `[${l.name}:${l.rows.length}]`))).toEqual(["Apples", "[Cheese:1]", "[Milk:0]"]);
  });
});
