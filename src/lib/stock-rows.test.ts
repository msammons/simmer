// Stock's rows (Nov 11, Matt: "I tapped on stock items in recipes. They disappeared!"): a dinner's pantry thing stays in
// Stock once it's ticked (it's on the list now), still highlighted, and unticking puts it back to highlighted.
import { describe, expect, it } from "vitest";
import type { Item, ListState } from "./client";
import { fromDinner, rowsOf } from "./stock-rows";

const item = (p: Partial<Item>): Item => ({
  id: "x", item: "tomato paste", quantity: "1 can", store: "safeway", section: "pantry", for: "Turkey chili", addedBy: "Robin",
  addedAt: "", checked: false, check: true, ...p,
});
const list = (items: Item[], staples: ListState["staples"] = []): ListState => ({ items, staples });

describe("Stock rows for a dinner's things", () => {
  it("shows a dinner's pantry thing highlighted and not ticked while it's still to decide", () => {
    const [r] = rowsOf(list([item({})]), null);
    expect(r).toMatchObject({ name: "tomato paste", have: true, open: null });
    expect(r.meal?.id).toBe("x");
  });

  it("keeps it, ticked and still highlighted, once it's on the list", () => {
    const rows = rowsOf(list([item({ check: false })]), null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ have: false });
    expect(rows[0].open?.id).toBe("x");
    expect(rows[0].meal?.id).toBe("x");
  });

  it("keeps a kept thing's highlight when a dinner's need for it is ticked", () => {
    const [r] = rowsOf(list([item({ item: "rice", check: false })], [{ item: "rice", section: "pantry", store: "safeway", quantity: "" } as ListState["staples"][number]]), null);
    expect(r).toMatchObject({ name: "rice", have: false });
    expect(r.meal?.id).toBe("x");
  });

  it("doesn't fill Stock with a dinner's fresh groceries or things added by hand", () => {
    expect(rowsOf(list([item({ section: "fresh", check: false, item: "cilantro" })]), null)).toHaveLength(0);
    expect(rowsOf(list([item({ check: false, for: "added by hand" })]), null)).toHaveLength(0);
    expect(rowsOf(list([item({ check: false, checked: true })]), null)).toHaveLength(0);
  });

  it("tells a dinner's thing from one added by hand", () => {
    expect(fromDinner(item({}))).toBe(true);
    expect(fromDinner(item({ for: "added by hand, Turkey chili" }))).toBe(false);
    expect(fromDinner(item({ for: "" }))).toBe(false);
    expect(fromDinner(item({ for: "Every week" }))).toBe(false);
  });
});
