import { beforeEach, describe, expect, it } from "vitest";
import { cancelJob, finishJob, HELPER_VERSION, helperOutdated, helperStatus, jobStatus, parseTab, queueJob, recentJobs, resetJobs, takeJob } from "./jobs";
import { loadCart, loadPicks, resetSafeway, setCartLine } from "./safeway";

const milk = { productId: "960001", query: "milk", name: "Lucerne Milk 2% - 1/2 Gallon", price: "$3.49", image: "https://images.example/milk.jpg", itemId: "m", item: "milk" };

describe("jobs for the Safeway helper", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); });

  it("isn't answering until the helper checks in", async () => {
    expect((await helperStatus()).answering).toBe(false);
    expect(await takeJob("1.0.0", false)).toBeNull();
    expect((await helperStatus()).answering).toBe(true);
  });

  it("goes from Simmer to the helper and back, oldest first", async () => {
    const a = await queueJob("search", { query: "milk" });
    const b = await queueJob("search", { query: "bananas" });
    const took = await takeJob("1.0.0", true);
    expect(took).toMatchObject({ id: a.id, status: "working" });
    await finishJob(a.id, true, { products: [{ id: "1", name: "Milk", price: "$3", image: "https://x/y.jpg", inCart: false, qty: 0 }, { id: "bad", name: "x" }], signedIn: true });
    const done = (await jobStatus(a.id)).job;
    expect(done?.status).toBe("done");
    expect((done?.result?.products as unknown[]).length).toBe(1); // only real products come back
    expect((await takeJob("1.0.0", true))?.id).toBe(b.id);
    expect(await takeJob("1.0.0", true)).toBeNull();
  });

  it("puts a quantity set on Safeway in the cart, and keeps the pick with its picture", async () => {
    const j = await queueJob("setQty", { ...milk, qty: 2 });
    await takeJob("1.0.0", false);
    await finishJob(j.id, true, { ok: true, qty: 2 });
    expect(await loadCart()).toMatchObject([{ productId: "960001", qty: 2, itemId: "m", item: "milk", image: milk.image }]);
    expect(await loadPicks()).toEqual([{ item: "milk", id: "960001", name: milk.name, image: milk.image }]);
    const off = await queueJob("setQty", { ...milk, qty: 0 });
    await takeJob("1.0.0", false);
    await finishJob(off.id, true, { ok: true, qty: 0 });
    expect(await loadCart()).toEqual([]);
  });

  it("turns quick taps on the same product into one trip", async () => {
    const a = await queueJob("setQty", { ...milk, qty: 1 });
    const b = await queueJob("setQty", { ...milk, qty: 3 });
    expect(b.id).toBe(a.id);
    expect((await takeJob("1.0.0", false))?.args.qty).toBe(3);
  });

  it("a failure says why, and a cancelled job isn't taken", async () => {
    const a = await queueJob("setQty", { ...milk, qty: 1 });
    await takeJob("1.0.0", false);
    await finishJob(a.id, false, { error: "signed-out" });
    expect((await jobStatus(a.id)).job).toMatchObject({ status: "failed", result: { error: "signed-out" } });
    expect(await loadCart()).toEqual([]);
    const c = await queueJob("search", { query: "eggs" });
    await cancelJob(c.id);
    expect(await takeJob("1.0.0", false)).toBeNull();
  });

  it("a search can raise a quantity but never takes a product out (search results miss what's in the cart)", async () => {
    await setCartLine({ ...milk, qty: 2 });
    await setCartLine({ productId: "5", qty: 1, name: "Bread" });
    const s = await queueJob("search", { query: "milk" });
    await takeJob("1.0.0", false);
    await finishJob(s.id, true, { products: [{ id: "960001", name: milk.name, inCart: true, qty: 3 }, { id: "5", name: "Bread", inCart: false }], signedIn: true });
    expect((await loadCart()).map((l) => [l.productId, l.qty])).toEqual([["960001", 3], ["5", 1]]);
  });
});

describe("the jobs tab", () => {
  const H = ["id", "kind", "status", "args", "result", "created", "updated"];
  const check = (seen: string) => ["helper", "check-in", "", "", '{"version":"1.1.0","panel":true}', "", seen];
  it("reads the latest check-in when stray copies were added, and counts the strays to clear", () => {
    const t = parseTab([H, check("2026-10-31T20:16:42.415Z"), ["a1", "search", "done", '{"query":"milk"}', "", "2026-10-31T20:00:00Z", "2026-10-31T20:00:01Z"], H, check("2026-10-31T20:13:39.170Z"), H, check("2026-10-31T20:17:00.000Z")]);
    expect(t.helper?.seen).toBe("2026-10-31T20:17:00.000Z");
    expect(t.helperRow).toBe(7);
    expect(t.jobs.map((j) => j.id)).toEqual(["a1"]);
    expect(t.junk).toBe(4);
    expect(parseTab([H, check("2026-10-31T20:16:42.415Z")]).junk).toBe(0);
  });
});

describe("showing Safeway's cart", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); });
  it("one waiting is enough, and the cart page keeps quantities in step", async () => {
    const a = await queueJob("cart", {});
    expect((await queueJob("cart", {})).id).toBe(a.id);
    await setCartLine({ ...milk, qty: 2 });
    await setCartLine({ productId: "5", qty: 1, name: "Bread" });
    await takeJob("1.2.0", true);
    await finishJob(a.id, true, { products: [{ id: "960001", name: milk.name, inCart: true, qty: 1 }], signedIn: true });
    // The cart page decides: milk takes its quantity and bread, no longer there, goes.
    expect((await loadCart()).map((l) => [l.productId, l.qty, l.item])).toEqual([["960001", 1, "milk"]]);
  });
  it("brings in what was added on Safeway, keeps item links, and an empty read changes nothing", async () => {
    await setCartLine({ ...milk, qty: 2 });
    const a = await queueJob("cart", {});
    await takeJob("1.2.0", true);
    await finishJob(a.id, true, { products: [
      { id: "960001", name: milk.name, inCart: true, qty: 2 },
      { id: "777", name: "O Organics Eggs - 18 Count", price: "$10.99", image: "https://images.example/eggs.jpg", inCart: true, qty: 1 },
    ], signedIn: true });
    expect((await loadCart()).map((l) => [l.productId, l.qty, l.item])).toEqual([["960001", 2, "milk"], ["777", 1, ""]]);
    const b = await queueJob("cart", {});
    await takeJob("1.2.0", true);
    await finishJob(b.id, true, { products: [], signedIn: true });
    expect((await loadCart()).length).toBe(2);
  });
});

describe("helperOutdated", () => {
  const h = (version: string) => ({ seen: new Date().toISOString(), version, panel: false });
  it("flags only a helper older than the one Simmer ships", () => {
    expect(helperOutdated(h("0.6.1"))).toBe(true);
    expect(helperOutdated(h("1.0.0"))).toBe(true);
    expect(helperOutdated(h(HELPER_VERSION))).toBe(false);
    expect(helperOutdated(h("9.0.0"))).toBe(false);
    expect(helperOutdated(null)).toBe(false);
  });
});

describe("recentJobs", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); });
  it("tells the panel's log what was done, newest first, and where it was asked for", async () => {
    const a = await queueJob("search", { query: "bananas", from: "app" });
    await new Promise((r) => setTimeout(r, 5));
    await queueJob("setQty", { ...milk, qty: 2, from: "panel" });
    let log = await recentJobs();
    expect(log.map((j) => [j.kind, j.from, j.status])).toEqual([["setQty", "panel", "waiting"], ["search", "app", "waiting"]]);
    expect(log[0]).toMatchObject({ what: milk.name, qty: 2 });
    await takeJob("1.1.0", true);
    await finishJob(a.id, true, { products: [], signedIn: false });
    log = await recentJobs();
    expect(log[1]).toMatchObject({ what: "bananas", status: "done", signedIn: false });
  });
});
