// Stock's rows (Nov 11, Sam: checking stock means flagging what you've checked; you can't have and need a thing at once;
// everything stays in its section, a dinner's things highlighted): each row answered Have, Need or not yet.
import { describe, expect, it } from "vitest";
import type { Item, ListState } from "./client";
import { fromDinner, linesOf, rowsOf } from "./stock-rows";

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
