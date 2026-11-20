// "Nothing changed" answers (Nov 19): the four reads made on opening and coming back answer 304 with no body while
// none of the tabs they're made from has been written, after reading only the version keys. Run against the in-memory
// store (each tab its sample from data/), watched so the test can see which keys were read.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));

import { resetKv } from "../kv";
import { resetLockout } from "./lockout";
import { resetCounters } from "./counter";
import { memoryStore } from "../store/memory";
import { NS, transact, useTabStore, writeTab, type TabStore } from "../store";
import { loadList, LIST_READS } from "../groceries";
import { KITCHEN_READS, loadKitchen, loadPlan, PLAN_READS } from "../plan";
import { loadRecipes, RECIPES_READS } from "../recipes";
import { PROFILE_TAB } from "../data";
import { matches } from "./fresh";
import * as list from "@/app/api/list/route";
import * as plan from "@/app/api/plan/route";
import * as recipes from "@/app/api/recipes/route";
import * as freezer from "@/app/api/freezer/route";

/** The in-memory store, with every MGET's keys and every write noted. */
function watched() {
  const m = memoryStore();
  const s: TabStore & { reads: string[][]; writes: number } = {
    ...m, reads: [], writes: 0,
    mget: (...ks) => { s.reads.push(ks); return m.mget(...ks); },
    set: (k, v) => { s.writes++; return m.set(k, v); },
    eval: (script, keys, args) => { s.writes++; return m.eval!(script, keys, args); },
  };
  return s;
}
let s: ReturnType<typeof watched>;

const get = (etag?: string, passcode = "right-one") =>
  new Request("http://x/api", { headers: { "x-passcode": passcode, "x-real-ip": "1.2.3.4", ...(etag && { "if-none-match": etag }) } });
const post = (b: unknown) =>
  new Request("http://x/api", { method: "POST", body: JSON.stringify(b), headers: { "x-passcode": "right-one", "x-real-ip": "1.2.3.4", "content-type": "application/json" } });

beforeEach(() => {
  process.env.HOUSEHOLD_PASSCODE = "right-one";
  resetKv(); resetCounters(); resetLockout();
  s = watched();
  useTabStore(s);
});

describe("nothing changed answers", () => {
  it("answers 200 with an ETag and no-store, then 304 with no body for that ETag, reading only the version keys", async () => {
    const first = await list.GET(get());
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"list\..*"$/);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const body = await first.json();
    expect(body).toHaveProperty("staples");

    s.reads = [];
    const again = await list.GET(get(etag));
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("no-store");
    expect(await again.text()).toBe("");
    expect(s.reads).toEqual([LIST_READS.map((t) => `${NS}:tabv:${t}`)]);
  });

  it("gives a stable ETag for tabs never written (no version yet)", async () => {
    const a = (await list.GET(get())).headers.get("etag");
    const b = (await list.GET(get())).headers.get("etag");
    expect(a).toBe(b);
    expect(a).toMatch(/\.0\.0"$/);
    expect(await s.get(`${NS}:tabv:List`)).toBeNull();
  });

  it("answers in full after a change from this phone or another, and a change's answer carries the new ETag", async () => {
    const old = (await list.GET(get())).headers.get("etag")!;
    const changed = await list.POST(post({ op: "keepSet", item: "Eggs", kind: "specialty" }));
    expect(changed.status).toBe(200);
    const mine = changed.headers.get("etag")!;
    expect(mine).not.toBe(old);

    // The read after one's own change: nothing changed since its answer.
    expect((await list.GET(get(mine))).status).toBe(304);
    // A phone still holding the old copy gets the new one, named by the same ETag the change answered with.
    const full = await list.GET(get(old));
    expect(full.status).toBe(200);
    expect(full.headers.get("etag")).toBe(mine);
    expect((await full.json()).staples.find((x: { item: string }) => x.item === "Eggs").kind).toBe("specialty");

    // Another phone's write, made outside these routes: never missed.
    await transact(async () => writeTab("Staples", [["item", "store", "section"], ["Bread", "safeway", "pantry"]]));
    const after = await list.GET(get(mine));
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(mine);
  });

  it("does the same for the plan, the recipes and the freezer, and a freezer change is seen by the plan", async () => {
    for (const route of [plan, recipes, freezer]) {
      const first = await route.GET(get());
      expect(first.status).toBe(200);
      const etag = first.headers.get("etag")!;
      expect(etag).toBeTruthy();
      expect((await route.GET(get(etag))).status).toBe(304);
    }
    const planTag = (await plan.GET(get())).headers.get("etag")!;
    const kitchenTag = (await freezer.GET(get())).headers.get("etag")!;
    const added = await freezer.POST(post({ op: "add", text: "2 salmon" }));
    expect(added.headers.get("etag")).not.toBe(kitchenTag);
    expect((await freezer.GET(get(added.headers.get("etag")!))).status).toBe(304);
    expect((await plan.GET(get(planTag))).status).toBe(200);
  });

  it("names the day in the plan's ETag (which store trips are due turns with it)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-19T20:00:00Z"));
      const today = (await plan.GET(get())).headers.get("etag")!;
      vi.setSystemTime(new Date("2026-11-20T20:00:00Z"));
      expect((await plan.GET(get(today))).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });

  it("never answers 304 to a wrong passcode", async () => {
    const etag = (await list.GET(get())).headers.get("etag")!;
    expect((await list.GET(get(etag, "wrong"))).status).toBe(401);
  });

  it("reads If-None-Match as a list and in weak form, and never matches *", () => {
    expect(matches(`"a", W/"b"`, `"b"`)).toBe(true);
    expect(matches(`*`, `"b"`)).toBe(false);
    expect(matches(null, `"b"`)).toBe(false);
  });
});

describe("what each read is made from", () => {
  // The ETag names only the tabs declared beside each loader; a loader that read another tab would answer 304 to a
  // change it can't see. Each is run once outside a transaction, with the tabs it read noted.
  const tabsRead = async (load: () => Promise<unknown>) => {
    s.reads = []; s.writes = 0;
    await load();
    expect(s.writes).toBe(0);
    return new Set(s.reads.flat().filter((k) => k.startsWith(`${NS}:tab:`)).map((k) => k.slice(`${NS}:tab:`.length)));
  };
  it("declares every tab loadList, loadRecipes, loadKitchen and loadPlan read", async () => {
    expect(await tabsRead(loadList)).toEqual(new Set(LIST_READS));
    expect(await tabsRead(loadRecipes)).toEqual(new Set(RECIPES_READS));
    expect(await tabsRead(loadKitchen)).toEqual(new Set(KITCHEN_READS));
    // Outside a transaction the household is kept for a minute (data.ts), so Profile may or may not be read here; the
    // routes read it inside one, where it always comes from the rows read.
    const p = await tabsRead(loadPlan);
    p.add(PROFILE_TAB);
    expect(p).toEqual(new Set(PLAN_READS));
  });
});
