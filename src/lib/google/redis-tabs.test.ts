// Tabs kept in Redis (Nov 11): read, written, appended to and changed cell by cell as on the Sheet, and a tab not there
// yet copied from the Sheet the first time it's read.
import { describe, expect, it } from "vitest";
import { allTabs, appendRows, readTab, readTabs, updateRanges, writeTab, type TabStore } from "./redis-tabs";

function pretend(): TabStore & { data: Map<string, string>; calls: number } {
  const data = new Map<string, string>();
  const s = {
    data, calls: 0,
    async get(k: string) { s.calls++; return data.get(k) ?? null; },
    async set(k: string, v: string) { s.calls++; data.set(k, v); return "OK"; },
    async mget(...ks: string[]) { s.calls++; return ks.map((k) => data.get(k) ?? null); },
    async keys(p: string) { s.calls++; const pre = p.replace(/\*$/, ""); return [...data.keys()].filter((k) => k.startsWith(pre)); },
  };
  return s;
}

describe("tabs in Redis", () => {
  it("copies a tab from the Sheet the first time, then reads it from Redis", async () => {
    const s = pretend();
    let asked = 0;
    const sheet = async (tab: string) => { asked++; return tab === "List" ? [["id", "item"], ["a", "milk"]] : null; };
    expect(await readTab(s, "List", sheet)).toEqual([["id", "item"], ["a", "milk"]]);
    expect(await readTab(s, "List", sheet)).toEqual([["id", "item"], ["a", "milk"]]);
    expect(asked).toBe(1);
    expect(await readTab(s, "Nothing", sheet)).toEqual([]); // not on the Sheet either: empty, and not asked again
    await readTab(s, "Nothing", sheet);
    expect(asked).toBe(2);
  });

  it("reads several tabs in one call", async () => {
    const s = pretend();
    await writeTab(s, "A", [["x"]]);
    await writeTab(s, "B", [["y"]]);
    s.calls = 0;
    expect(await readTabs(s, ["A", "B"], async () => null)).toEqual([[["x"]], [["y"]]]);
    expect(s.calls).toBe(1);
  });

  it("appends after the last row with anything in it", async () => {
    const s = pretend();
    await writeTab(s, "List", [["id", "item"], ["a", "milk"], ["", ""], []]);
    await appendRows(s, "List", [["b", "eggs"]], async () => null);
    expect(await readTab(s, "List", async () => null)).toEqual([["id", "item"], ["a", "milk"], ["b", "eggs"]]);
  });

  it("writes cells at A1 ranges, each tab read and written once", async () => {
    const s = pretend();
    await writeTab(s, "List", [["id", "item", "quantity"], ["a", "milk", "1"]]);
    s.calls = 0;
    await updateRanges(s, [{ range: "List!C2", values: [["2"]] }, { range: "List!A3:C3", values: [["b", "eggs", "12"]] }], async () => null);
    expect(s.calls).toBe(2);
    expect(await readTab(s, "List", async () => null)).toEqual([["id", "item", "quantity"], ["a", "milk", "2"], ["b", "eggs", "12"]]);
  });

  it("lists every tab for the copy to the Sheet", async () => {
    const s = pretend();
    await writeTab(s, "List", [["id"]]);
    await writeTab(s, "Planned", [["id"]]);
    expect((await allTabs(s)).map(([t]) => t)).toEqual(["List", "Planned"]);
  });
});

describe("the grocery list on Redis", () => {
  it("adds, merges and reads back through the app's own list code", async () => {
    const { useTabStore } = await import("./redis-tabs");
    const s = pretend();
    useTabStore(s);
    try {
      const g = await import("../groceries");
      await g.addItems([{ item: "redis-test onions", quantity: "1", for: "tacos" }, { item: "redis-test onions", quantity: "2", for: "chili" }], "Robin");
      const l = await g.loadList();
      const onions = l.items.find((x) => x.item === "redis-test onions")!;
      expect(onions.quantity).toBe("3");
      expect(onions.for).toBe("tacos, chili");
      await g.removeItems([onions.id]);
      expect((await g.loadList()).items.some((x) => x.item === "redis-test onions")).toBe(false);
    } finally { useTabStore(null); }
  });
});
