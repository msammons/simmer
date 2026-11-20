// Tabs kept in Redis (Nov 11): read and written whole, as their rows. Since Nov 19 every
// change is a transaction: written only if the tabs it read are unchanged, else worked out again from fresh rows.
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import { allTabs, readTab, readTabs, transact, writeTab, type TabStore } from "./tabs";
import { AppError } from "../errors";

/**
 * A pretend Redis. Its EVAL does what the Lua script does, in one step (as Redis runs a script). `meddle`: run just
 * before an MGET answers, with the answer already read, so a change it makes lands between a read and its write. It
 * runs as another server call would, outside the transaction that's reading.
 */
function pretend(meddle?: (keys: string[]) => Promise<void>): TabStore & { data: Map<string, string>; sets: number } {
  const outside = AsyncLocalStorage.snapshot();
  const data = new Map<string, string>();
  const s = {
    data, sets: 0,
    async get(k: string) { return data.get(k) ?? null; },
    async set(k: string, v: string) { s.sets++; data.set(k, v); return "OK"; },
    async mget(...ks: string[]) {
      const got = ks.map((k) => data.get(k) ?? null);
      if (meddle) await outside(() => meddle(ks));
      await Promise.resolve(); // others get a turn, as over the network
      return got;
    },
    async keys(p: string) { const pre = p.replace(/\*$/, ""); return [...data.keys()].filter((k) => k.startsWith(pre)); },
    async eval(_script: string, keys: string[], args: string[]) {
      const n = keys.length / 2;
      for (let i = 0; i < n; i++) if (args[i] !== "!" && (data.get(keys[2 * i + 1]) ?? "") !== args[i]) return 0;
      for (let i = 0; i < n; i++) if (args[n + i] !== "!") { s.sets++; data.set(keys[2 * i], args[n + i]); data.set(keys[2 * i + 1], String(Number(data.get(keys[2 * i + 1]) ?? 0) + 1)); }
      return 1;
    },
  };
  return s;
}

/** Rows added after the last row with anything in it, in one transaction (as table.ts append does). */
const appendRows = (s: TabStore, tab: string, rows: string[][]) => transact(s, async () => {
  const all = await readTab(s, tab);
  while (all.length && !all[all.length - 1].some(Boolean)) all.pop();
  await writeTab(s, tab, [...all, ...rows]);
});

describe("tabs in Redis", () => {
  it("reads a missing tab as no rows, without writing anything", async () => {
    const s = pretend();
    expect(await readTab(s, "Nothing")).toEqual([]);
    expect(await transact(s, () => readTab(s, "Nothing"))).toEqual([]);
    expect(s.sets).toBe(0);
    expect(s.data.size).toBe(0);
  });

  it("reads several tabs in one call", async () => {
    const s = pretend();
    await writeTab(s, "A", [["x"]]);
    await writeTab(s, "B", [["y"]]);
    expect(await readTabs(s, ["A", "B"])).toEqual([[["x"]], [["y"]]]);
  });

  it("writes each tab once per change, however many times the change writes it", async () => {
    const s = pretend();
    await transact(s, async () => {
      await writeTab(s, "List", [["id"], ["a"]]);
      await writeTab(s, "List", [...(await readTab(s, "List")), ["b"]]);
    });
    expect(s.sets).toBe(1);
    expect(await readTab(s, "List")).toEqual([["id"], ["a"], ["b"]]);
  });

  it("lists every tab for the copy to the Sheet (not their versions)", async () => {
    const s = pretend();
    await writeTab(s, "List", [["id"]]);
    await writeTab(s, "Planned", [["id"]]);
    expect((await allTabs(s)).map(([t]) => t)).toEqual(["List", "Planned"]);
  });
});

describe("two changes at once", () => {
  it("an append that lands between another's read and write: both rows are kept", async () => {
    let once = true;
    const s = pretend(async (ks) => {
      if (!once || !ks.includes("simmer:tab:List")) return;
      once = false;
      await appendRows(s, "List", [["b", "eggs"]]); // the other phone, finished before this one writes
    });
    await writeTab(s, "List", [["id", "item"], ["a", "milk"]]);
    await appendRows(s, "List", [["c", "bread"]]);
    expect(await readTab(s, "List")).toEqual([["id", "item"], ["a", "milk"], ["b", "eggs"], ["c", "bread"]]);
  });

  it("a change worked out from rows goes again from fresh rows, so row numbers are right", async () => {
    let once = true;
    const s = pretend(async (ks) => {
      if (!once || !ks.includes("simmer:tab:List")) return;
      once = false;
      await writeTab(s, "List", [["id", "checked"], ["new", "no"], ["a", "no"]]); // a row went in above "a"
    });
    await writeTab(s, "List", [["id", "checked"], ["a", "no"]]);
    let tries = 0;
    await transact(s, async () => {
      tries++;
      const rows = await readTab(s, "List");
      rows[rows.findIndex((r) => r[0] === "a")][1] = "yes";
      await writeTab(s, "List", rows);
    });
    expect(tries).toBe(2);
    expect(await readTab(s, "List")).toEqual([["id", "checked"], ["new", "no"], ["a", "yes"]]);
  });

  it("many at once, all kept", async () => {
    const s = pretend();
    await writeTab(s, "List", [["id"]]);
    await Promise.all(Array.from({ length: 4 }, (_, i) => appendRows(s, "List", [[`x${i}`]])));
    expect((await readTab(s, "List")).slice(1).map((r) => r[0]).sort()).toEqual(["x0", "x1", "x2", "x3"]);
  });

  it("a tab read but not written still counts: a change to it makes the write go again", async () => {
    let once = true;
    const s = pretend(async (ks) => {
      if (!once || !ks.includes("simmer:tab:Recipes")) return;
      once = false;
      await writeTab(s, "Recipes", [["id"], ["soup"], ["stew"]]);
    });
    await writeTab(s, "Recipes", [["id"], ["soup"]]);
    await transact(s, async () => {
      const recipes = await readTab(s, "Recipes");
      await writeTab(s, "Planned", recipes.slice(1).map((r) => [r[0]]));
    });
    expect(await readTab(s, "Planned")).toEqual([["soup"], ["stew"]]);
  });

  it("gives up after a few tries with a plain problem, writing nothing", async () => {
    const s = pretend(async (ks) => { if (ks.includes("simmer:tab:List")) await writeTab(s, "List", [["someone else"]]); });
    await expect(appendRows(s, "List", [["mine"]])).rejects.toThrow(AppError);
    expect(JSON.parse(s.data.get("simmer:tab:List")!)).toEqual([["someone else"]]);
  });

  it("two creating the same missing tab: the second sees the first's rows", async () => {
    let once = true;
    const s = pretend(async (ks) => {
      if (!once || !ks.includes("simmer:tab:Bought")) return;
      once = false;
      await appendRows(s, "Bought", [["item"], ["pears"]]);
    });
    await transact(s, async () => {
      const rows = await readTab(s, "Bought");
      await appendRows(s, "Bought", [...(rows.length ? [] : [["item"]]), ["figs"]]);
    });
    expect(await readTab(s, "Bought")).toEqual([["item"], ["pears"], ["figs"]]);
  });
});

describe("the grocery list on Redis", () => {
  it("adds, merges and reads back through the app's own list code", async () => {
    const { useTabStore } = await import("./client");
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

  it("a tick and an add from two phones at once: neither is lost", async () => {
    const { useTabStore } = await import("./client");
    const g = await import("../groceries");
    let meddling = false;
    const s = pretend(async (ks) => {
      if (!meddling || !ks.includes("simmer:tab:List")) return;
      meddling = false;
      await g.addItem("redis-test eggs", "Sam", "", { store: "safeway", section: "fresh" }); // the other phone
    });
    useTabStore(s);
    try {
      const milk = await g.addItem("redis-test milk", "Robin", "", { store: "safeway", section: "fresh" });
      meddling = true;
      await g.checkItem(milk.id, true);
      expect(meddling).toBe(false); // the other phone's add did land between the tick's read and write
      const items = (await g.loadList()).items;
      expect(items.find((x) => x.id === milk.id)?.checked).toBe(true);
      expect(items.some((x) => x.item === "redis-test eggs")).toBe(true);
    } finally { useTabStore(null); }
  });
});
