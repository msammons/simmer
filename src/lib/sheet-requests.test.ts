// The Sheet paths, against a pretend Google Sheet kept in memory: what each change does to the tabs, and how many reads
// and writes it costs (Nov 10: Google allows about 60 of each a minute, and one write per cell ran into it).
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./google/gemini", () => ({ generateJson: async () => ({ data: { store: "trader-joes", section: "freezer" } }) }));

const tabs = new Map<string, string[][]>();
const count = { reads: 0, writes: 0 };
const calls: string[] = [];

const colNum = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
function cellAt(a1: string) { const m = a1.match(/^([A-Z]+)(\d+)$/)!; return { c: colNum(m[1]), r: Number(m[2]) - 1 }; }
function put(range: string, values: string[][]) {
  const [tab, at = "A1"] = decodeURIComponent(range).split("!");
  const all = tabs.get(tab) ?? [];
  const { c, r } = cellAt(at.split(":")[0]);
  values.forEach((row, i) => {
    const target = (all[r + i] ??= []);
    row.forEach((v, j) => { while (target.length < c + j) target.push(""); target[c + j] = v; });
  });
  tabs.set(tab, all);
}
/** Trimmed as the API gives it: no trailing blank cells or rows (blank rows inside stay, as []). */
function trimmed(all: string[][]) {
  const rows = all.map((r) => { const x = [...r]; while (x.length && !x[x.length - 1]) x.pop(); return x; });
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
  return rows;
}

async function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = String(input), method = init?.method ?? "GET";
  const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
  const ok = (j: unknown = {}) => new Response(JSON.stringify(j), { status: 200 });
  if (url.includes("oauth2")) return ok({ access_token: "t", expires_in: 3600 });
  const path = decodeURIComponent(url.split("/spreadsheets/")[1].split("?")[0]);
  calls.push(`${method} ${path.replace(/^[^/:]+/, "")}`);
  if (path.endsWith(":batchUpdate") && !path.includes("/values")) {
    count.writes++;
    const title = body.requests[0].addSheet.properties.title;
    if (tabs.has(title)) return new Response("already exists", { status: 400 });
    tabs.set(title, []);
    return ok();
  }
  if (path.endsWith("/values:batchUpdate")) { count.writes++; for (const d of body.data) put(d.range, d.values); return ok(); }
  const rest = path.split("/values/")[1];
  if (method === "GET") {
    count.reads++;
    if (!tabs.has(rest)) return new Response("", { status: 400 });
    return ok({ values: trimmed(tabs.get(rest)!) });
  }
  count.writes++;
  if (rest.endsWith(":clear")) { tabs.set(rest.replace(/:clear$/, ""), []); return ok(); }
  if (rest.endsWith(":append")) {
    const tab = rest.replace(/!A1:append$/, "");
    const all = trimmed(tabs.get(tab) ?? []);
    tabs.set(tab, [...all, ...body.values]);
    return ok();
  }
  put(rest, body.values);
  return ok();
}

const reset = () => { count.reads = 0; count.writes = 0; calls.length = 0; };
const cost = () => ({ reads: count.reads, writes: count.writes });
const table = (tab: string) => trimmed(tabs.get(tab) ?? []);

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "x@y", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  vi.stubGlobal("fetch", fakeFetch);
});
afterAll(() => { delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; vi.unstubAllGlobals(); });

const LIST = ["id", "item", "quantity", "store", "section", "for", "added_by", "added_at", "checked", "checked_at", "check"];
const row = (id: string, item: string, extra: Partial<Record<(typeof LIST)[number], string>> = {}) => LIST.map((h) => ({ id, item, store: "safeway", section: "fresh", checked: "no", ...extra })[h] ?? "");

describe("the list on the Sheet", () => {
  beforeEach(() => {
    tabs.clear();
    tabs.set("List", [LIST, row("a", "lemons", { quantity: "2" }), row("b", "milk", { checked: "yes" }), row("c", "onions", { for: "tacos, chili", quantity: "2" }), row("d", "cilantro", { for: "tacos" })]);
    tabs.set("Staples", [["item", "store", "section", "usual_quantity", "usual_product", "weekly"]]);
    tabs.set("Ingredients", [["name", "section", "store"]]);
    tabs.set("Bought", [["item", "quantity", "store", "date_bought", "for"]]);
    reset();
  });

  it("adds many things with each tab read once, the new guesses remembered together", async () => {
    const { addItems } = await import("./groceries");
    await addItems([
      { item: "lemons", quantity: "1", for: "" },
      { item: "mystery dumplings", quantity: "", for: "" },
      { item: "glimmer puffs", quantity: "", for: "" },
      { item: "bananas", quantity: "", for: "" },
    ], "Robin");
    expect(cost()).toEqual({ reads: 3, writes: 3 }); // List, Staples, Ingredients; remembered, merged, added
    expect(table("Ingredients").slice(1).map((r) => r[0])).toEqual(["mystery dumplings", "glimmer puffs"]);
    expect(table("List").find((r) => r[0] === "a")![2]).toBe("3");
    expect(table("List").map((r) => r[1])).toEqual(["item", "lemons", "milk", "onions", "cilantro", "mystery dumplings", "glimmer puffs", "bananas"]);
    reset();
    await addItems([{ item: "mystery dumplings", quantity: "2", for: "" }], "Robin"); // merged: the list and Stock read, one write
    expect(cost()).toEqual({ reads: 2, writes: 1 });
  });

  it("adds one thing, or merges it, with one read of the list", async () => {
    const { addItem } = await import("./groceries");
    await addItem("1 lemon", "Sam");
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("List")[1][2]).toBe("3");
    reset();
    await addItem("2 bananas", "Sam");
    expect(cost()).toEqual({ reads: 2, writes: 1 }); // the list, and where it goes
  });

  it("takes a dinner off in one write: shared things cut back, the rest gone", async () => {
    const { takeOffFor } = await import("./groceries");
    const n = await takeOffFor([{ item: "onions", quantity: "1", for: "tacos" }, { item: "cilantro", quantity: "", for: "tacos" }]);
    expect(n).toBe(1);
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("List").map((r) => r[0])).toEqual(["id", "a", "b", "c"]);
    expect(table("List")[3].slice(2, 6)).toEqual(["1", "safeway", "fresh", "chili"]);
  });

  it("clears, removes, puts back and finishes a trip in one write each", async () => {
    const g = await import("./groceries");
    const gone = await g.removeItems(["a", "c"]);
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("List").map((r) => r[0])).toEqual(["id", "b", "d"]);
    reset();
    await g.putBack(gone);
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("List").map((r) => r[0])).toEqual(["id", "b", "d", "a", "c"]);
    reset();
    await g.removeItem("d");
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    reset();
    expect(await g.doneShopping("trader-joes")).toBe(0); // nothing to clear (and no Every week things)
    reset();
    expect(await g.doneShopping("safeway")).toBe(1);
    expect(table("Bought").slice(1).map((r) => r[0])).toEqual(["milk"]);
    expect(table("List").map((r) => r[0])).toEqual(["id", "a", "c"]);
    // List and Bought read, Bought written, List written (no Every week refill since Nov 10)
    expect(cost()).toEqual({ reads: 2, writes: 2 });
  });

  it("moves an item and remembers where it goes", async () => {
    const { moveItem } = await import("./groceries");
    await moveItem("d", { store: "trader-joes" });
    expect(cost()).toEqual({ reads: 2, writes: 2 });
    expect(table("List")[4][3]).toBe("trader-joes");
    expect(table("Ingredients")[1]).toEqual(["cilantro", "fresh", "trader-joes"]);
    reset();
    await moveItem("d", { section: "pantry" }); // the remembered row is changed, not added again
    expect(table("Ingredients").length).toBe(2);
    expect(table("Ingredients")[1]).toEqual(["cilantro", "pantry", "trader-joes"]);
  });

  it("changes Stock in one write", async () => {
    const { addStaple, removeStaple } = await import("./groceries");
    await addStaple("rice");
    expect(cost()).toEqual({ reads: 2, writes: 1 }); // Ingredients (filing), Staples
    reset();
    await removeStaple("rice");
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("Staples").length).toBe(1);
  });
});

describe("the plan and the freezer on the Sheet", () => {
  const PLANNED = ["id", "kind", "recipe", "kid", "main", "side", "snack", "treat", "added", "made", "pinned"];
  beforeEach(() => {
    tabs.clear();
    tabs.set("List", [LIST]);
    tabs.set("Ingredients", [["name", "section", "store"]]);
    tabs.set("Freezer", [["id", "item", "amount", "added", "store"], ["f1", "salmon", "2", "2026-11-01", ""], ["f2", "peas", "", "2026-11-02", ""]]);
    reset();
  });

  it("counts the freezer down, and takes the last one out, in one write each", async () => {
    const { takeFrozen, addFrozen } = await import("./plan");
    await takeFrozen("f1");
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("Freezer")[1][2]).toBe("1");
    reset();
    await takeFrozen("f2");
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("Freezer").map((r) => r[0])).toEqual(["id", "f1"]);
    reset();
    await addFrozen("3 salmon");
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("Freezer")[1][2]).toBe("4");
  });

  it("removes a planned dinner in one write to Planned", async () => {
    const { removePlanned } = await import("./plan");
    tabs.set("Planned", [PLANNED.slice(0, 10), ["p1", "quick", "tacos", "", "", "", "", "", "2026-11-09", ""], ["p2", "regular", "chili", "", "", "", "", "", "2026-11-09", ""]]);
    tabs.set("Recipes", [["id", "name", "ingredients"]]);
    tabs.set("Safeway cart", [["cart", "product_id"]]);
    await removePlanned("p1");
    expect(table("Planned").map((r) => r[0])).toEqual(["id", "p2"]);
    expect(calls.filter((c) => !c.startsWith("GET"))).toHaveLength(1);
  });

  it("plans the next shop with one write to Planned: this week made, lunches gone, the new ones added", async () => {
    const { savePlan } = await import("./plan");
    const { todayIn, addDays } = await import("./time");
    const today = todayIn();
    tabs.set("Planned", [PLANNED, ["p1", "quick", "tacos", "", "", "", "", "", addDays(today, -3), "", ""], ["l1", "lunch", "", "Theo", "pb&j", "", "", "", addDays(today, -3), "", ""], ["old", "regular", "chili", "", "", "", "", "", "2020-01-01", "2020-01-02", ""]]);
    tabs.set("Recipes", [["id", "name", "ingredients"], ["tacos", "Tacos", "1 lb ground beef\n1 bunch cilantro"], ["soup", "Soup", "2 carrots"]]);
    tabs.set("Safeway cart", [["cart", "product_id"]]);
    tabs.set("List", [LIST, row("x", "cilantro", { for: "tacos" })]);
    tabs.set("Staples", [["item", "store", "section", "usual_quantity", "usual_product", "weekly"]]);
    for (const t of ["Lunches", "Made", "Plan counts"]) tabs.delete(t);
    reset();
    await savePlan([{ kind: "regular", recipe: "soup", pinned: false }], [], { quick: 1, regular: 1, kids: 0, dessert: 0, lunches: {} } as never, "Robin");
    const planned = table("Planned");
    expect(planned.map((r) => r[0]).slice(0, 2)).toEqual(["id", "p1"]);
    expect(planned[1][9]).toBe(addDays(today, -3)); // made on the day it was planned
    expect(planned.length).toBe(3); // the lunch and the long-ago one gone, soup added
    expect(planned[2][2]).toBe("soup");
    expect(table("Made").slice(1)).toEqual([[addDays(today, -3), "tacos"]]);
    expect(table("List").map((r) => r[1])).toEqual(["item", "carrots"]); // tacos' cilantro off, soup's carrots on
    expect(calls.filter((c) => c.startsWith("PUT /values/Planned"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("Planned") && !c.startsWith("GET"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("GET /values/Planned"))).toHaveLength(1);
  });
});

describe("Safeway on the Sheet", () => {
  beforeEach(() => {
    tabs.clear();
    tabs.set("Safeway cart", [["cart", "product_id", "name", "price", "image", "qty", "item_id", "item", "updated"], ["safeway", "11", "Milk", "", "", "1", "", "", ""], ["safeway", "22", "Eggs", "", "", "1", "", "", ""]]);
    tabs.set("Safeway", [["item", "product_id", "product_name", "updated"], ["milk", "11", "Milk", "2026-11-01"]]);
    reset();
  });

  it("sets several cart quantities with one read and one write, and none when nothing changed", async () => {
    const { setCartLines, setCartLine } = await import("./safeway");
    await setCartLines(() => [{ productId: "11", qty: 3 }, { productId: "22", qty: 2 }, { productId: "33", qty: 0 }]);
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("Safeway cart").slice(1).map((r) => r[5])).toEqual(["3", "2"]);
    reset();
    await setCartLine({ productId: "11", qty: 3 });
    expect(cost()).toEqual({ reads: 1, writes: 0 });
    reset();
    await setCartLine({ productId: "22", qty: 0 });
    expect(table("Safeway cart").slice(1).map((r) => r[1])).toEqual(["11"]);
    expect(cost()).toEqual({ reads: 1, writes: 1 });
  });

  it("keeps a pick with its new picture column in one write", async () => {
    const { savePick, loadPicks } = await import("./safeway");
    await savePick({ item: "milk", id: "12", name: "Other milk", image: "https://x/y.png" });
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(await loadPicks()).toEqual([{ item: "milk", id: "12", name: "Other milk", image: "https://x/y.png" }]);
  });

  it("lets the helper check in and take a job in one write", async () => {
    const jobs = await import("./jobs");
    tabs.set("Safeway jobs", [["id", "kind", "status", "args", "result", "created", "updated"], ["helper", "check-in", "", "", JSON.stringify({ version: "1", panel: false }), "", "2020-01-01T00:00:00.000Z"]]);
    jobs.resetJobs();
    const queued = await jobs.queueJob("search", { query: "milk" });
    await new Promise((ok) => setTimeout(ok, 2100)); // past the moment's copy
    reset();
    const taken = await jobs.takeJob("1", false);
    expect(taken?.id).toBe(queued.id);
    expect(cost()).toEqual({ reads: 1, writes: 1 });
    expect(table("Safeway jobs")[2][2]).toBe("working");
    expect(Date.parse(table("Safeway jobs")[1][6])).toBeGreaterThan(Date.parse("2026-01-01"));
    reset();
    expect(await jobs.takeJob("1", false)).toBeNull(); // just checked in, nothing waiting: nothing written
    expect(cost().writes).toBe(0);
  });
});

describe("recipes on the Sheet", () => {
  it("saves many at once with one read, the changed rows in one write and the new ones in one more", async () => {
    const { saveRecipes, loadRecipes, fromDraft } = await import("./recipes");
    tabs.clear();
    tabs.set("Recipes", [["id", "name", "effort"], ["tacos", "Tacos", "quick"]]);
    reset();
    const draft = (name: string, id?: string) => fromDraft({ id, name, effort: "regular", minutes: null, serves: null, protein: "", ingredients: ["1 lb beef"], steps: [], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "" });
    await saveRecipes([draft("Tacos", "tacos"), draft("Chili"), draft("Soup")]);
    expect(cost()).toEqual({ reads: 1, writes: 2 });
    const all = await loadRecipes();
    expect(all.map((r) => [r.name, r.effort, r.ingredients.length])).toEqual([["Tacos", "regular", 1], ["Chili", "regular", 1], ["Soup", "regular", 1]]);
    expect(table("Recipes")[0]).toContain("ingredients");
  });
});
