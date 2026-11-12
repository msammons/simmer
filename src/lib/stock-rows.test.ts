// Stock's "For this plan" (Nov 11, Matt: checking stock means flagging what you've checked; you can't have and need a
// thing at once): every dinner's thing from the house is there with its answer, Have, Need or still to check, and the
// sections below don't repeat it.
import { describe, expect, it } from "vitest";
import type { Item, ListState } from "./client";
import { fromDinner, planRows, rowsOf } from "./stock-rows";

const item = (p: Partial<Item>): Item => ({
  id: "x", item: "tomato paste", quantity: "1 can", store: "safeway", section: "pantry", for: "Turkey chili", addedBy: "Robin",
  addedAt: "", checked: false, check: true, ...p,
});
const staple = (name: string, section = "pantry") => ({ item: name, section, store: "safeway", quantity: "", product: "" }) as ListState["staples"][number];
const list = (items: Item[], staples: ListState["staples"] = []): ListState => ({ items, staples });

describe("For this plan", () => {
  it("answers each dinner's thing: to check, Have or Need", () => {
    expect(planRows(list([item({})]))[0]).toMatchObject({ name: "tomato paste", amount: "1 can", answer: "check" });
    expect(planRows(list([item({ have: true })]))[0].answer).toBe("have");
    expect(planRows(list([item({ check: false })]))[0].answer).toBe("need");
  });

  it("keeps a kept fresh thing a dinner needs (tortillas), answered either way", () => {
    for (const [check, answer] of [[true, "check"], [false, "need"]] as const) {
      const [r] = planRows(list([item({ item: "tortillas", section: "fresh", for: "chicken tacos", check })], [staple("Tortillas", "fresh")]));
      expect(r).toMatchObject({ name: "tortillas", answer });
    }
  });

  it("leaves out a dinner's fresh groceries, things added by hand, and what's been bought", () => {
    expect(planRows(list([item({ section: "fresh", check: false, item: "cilantro" })]))).toHaveLength(0);
    expect(planRows(list([item({ check: false, for: "added by hand" })]))).toHaveLength(0);
    expect(planRows(list([item({ check: false, checked: true })]))).toHaveLength(0);
  });

  it("doesn't repeat a planned thing in its section below", () => {
    const l = list([item({ item: "rice", check: false })], [staple("Rice"), staple("Flour")]);
    expect(planRows(l).map((r) => r.name)).toEqual(["rice"]);
    expect(rowsOf(l, null).map((r) => r.name)).toEqual(["Flour"]);
  });

  it("tells a dinner's thing from one added by hand", () => {
    expect(fromDinner(item({}))).toBe(true);
    expect(fromDinner(item({ for: "added by hand, Turkey chili" }))).toBe(false);
    expect(fromDinner(item({ for: "" }))).toBe(false);
    expect(fromDinner(item({ for: "Every week" }))).toBe(false);
  });
});
