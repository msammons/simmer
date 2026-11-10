import { beforeEach, describe, expect, it } from "vitest";
import { addItem, loadList, removeItem } from "./groceries";
import { cancelJob, finishJob, HELPER_VERSION, helperOutdated, helperPush, olderVersion, helperStatus, jobStatus, parseTab, queueJob, recentJobs, resetJobs, savePush, takeJob } from "./jobs";
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
    await finishJob(a.id, true, { products: [{ id: "1", name: "Milk", price: "$3", image: "https://x/y.jpg", inCart: false, qty: 0 }, { id: "bad", name: "x" }, { id: "2", name: "Oat milk", price: "$4", image: "", inCart: false, qty: 0 }], signedIn: true });
    const done = (await jobStatus(a.id)).job;
    expect(done?.status).toBe("done");
    const products = done?.result?.products as { id: string; image: string }[];
    expect(products.map((p) => p.id)).toEqual(["1", "2"]); // only real products come back
    // One further down Safeway's page, whose picture hadn't loaded: Safeway's picture for that product.
    expect(products[1].image).toMatch(/^https:\/\/images\.albertsons-media\.com\/is\/image\/ABS\/2\?/);
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

describe("taking a product out", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); });
  it("counts as done when Safeway no longer has it (a second tap)", async () => {
    await setCartLine({ ...milk, qty: 1 });
    const off = await queueJob("setQty", { ...milk, qty: 0 });
    await takeJob("1.2.1", true);
    const j = await finishJob(off.id, false, { error: "not-found" });
    expect(j?.status).toBe("done");
    expect(await loadCart()).toEqual([]);
  });
  it("a missing product is still a problem when it was meant to go in", async () => {
    const on = await queueJob("setQty", { ...milk, qty: 2 });
    await takeJob("1.2.1", true);
    expect((await finishJob(on.id, false, { error: "not-found" }))?.status).toBe("failed");
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
  it("a cart Safeway says is empty empties Simmer's cart, and the list stays (an empty cart isn't an order)", async () => {
    const it = await addItem("milk", "Robin", "", { store: "safeway", section: "fresh" });
    const other = await addItem("bread", "Robin", "", { store: "safeway", section: "fresh" });
    await setCartLine({ ...milk, itemId: it.id, qty: 1 });
    const a = await queueJob("cart", {});
    await takeJob("1.2.6", true);
    await finishJob(a.id, true, { products: [], signedIn: true, empty: true });
    expect(await loadCart()).toEqual([]);
    const { items } = await loadList();
    expect(items.some((x) => x.id === it.id)).toBe(true);
    expect(items.some((x) => x.id === other.id)).toBe(true);
  });

  // Nov 3: an empty cart sends the helper to Safeway's Purchases page (Online); an order there since the cart was filled
  // means it went through.
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
  async function emptyCartWith(orders: unknown) {
    resetJobs(); resetSafeway();
    for (const x of (await loadList()).items) await removeItem(x.id);
    const it = await addItem("milk", "Robin", "", { store: "safeway", section: "fresh" });
    const other = await addItem("bread", "Robin", "", { store: "safeway", section: "fresh" });
    await setCartLine({ ...milk, itemId: it.id, qty: 1 });
    const a = await queueJob("cart", {});
    expect(a.args.orders).toBe(true); // Simmer's cart has something, so the helper is asked to look
    await takeJob("1.3.0", true);
    const j = await finishJob(a.id, true, { products: [], signedIn: true, empty: true, orders });
    const { items } = await loadList();
    return { ordered: j?.result?.ordered, milkStays: items.some((x) => x.id === it.id), breadStays: items.some((x) => x.id === other.id) };
  }
  it("an online order placed since the cart was filled takes the cart's things off the list", async () => {
    const r = await emptyCartWith({ online: true, none: false, entries: [`Order #1234 Placed ${today} Delivery Tomorrow $42.10`], text: "" });
    expect(r).toEqual({ ordered: true, milkStays: false, breadStays: true });
    expect(await loadCart()).toEqual([]);
  });
  it("no online orders: only Simmer's cart empties, the list stays", async () => {
    const r = await emptyCartWith({ online: true, none: true, entries: [], text: "You have no orders placed within the last 90 days." });
    expect(r).toEqual({ ordered: false, milkStays: true, breadStays: true });
    expect(await loadCart()).toEqual([]);
  });
  it("an older order, an order with no date, the wrong tab, or nothing read isn't this order", async () => {
    for (const orders of [
      { online: true, none: false, entries: ["Order #1200 Placed Jan 2, 2020 Delivered Jan 3, 2020"] },
      { online: true, none: false, entries: ["Order #1234 Out for delivery"] },
      { online: false, none: false, entries: [`Order #1234 Placed ${today}`] },
      undefined,
    ]) {
      expect((await emptyCartWith(orders)).milkStays).toBe(true);
    }
  });
  it("with nothing in Simmer's cart, the helper isn't sent to look", async () => {
    expect((await queueJob("cart", {})).args.orders).toBe(false);
  });
});

describe("whether Safeway can be reached", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); });
  it("is away until the helper checks in, and says when it last did", async () => {
    expect(await helperStatus()).toMatchObject({ away: true, seen: "" });
    await takeJob("1.3.0", false);
    const s = await helperStatus();
    expect(s.away).toBe(false);
    expect(Date.now() - Date.parse(s.seen)).toBeLessThan(5000);
  });
  it("keeps the helper's push subscription through check-ins", async () => {
    const push = { key: "BKey", sub: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } } };
    await takeJob("1.3.0", false);
    await savePush(push);
    await takeJob("1.3.0", true); // the panel opened: a new check-in is written
    expect(await helperPush()).toEqual(push);
    await savePush(null);
    expect(await helperPush()).toBeNull();
  });
  it("a check-in row with a subscription reads back", () => {
    const H = ["id", "kind", "status", "args", "result", "created", "updated"];
    const t = parseTab([H, ["helper", "check-in", "", "", '{"version":"1.3.0","panel":false,"push":{"key":"K","sub":{"endpoint":"https://fcm.googleapis.com/x","keys":{"p256dh":"p","auth":"a"}}}}', "", "2026-11-03T20:00:00Z"]]);
    expect(t.helper).toMatchObject({ version: "1.3.0", push: { key: "K" } });
    expect(t.junk).toBe(0);
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
  it("reads date versions, a same-day release included", () => {
    expect(olderVersion("1.3.0", "26.11.10")).toBe(true);
    expect(olderVersion("26.11.10", "26.11.10.1")).toBe(true);
    expect(olderVersion("26.11.10.1", "26.11.10.2")).toBe(true);
    expect(olderVersion("26.11.10.2", "26.11.10")).toBe(false);
    expect(olderVersion("26.9.30", "26.11.1")).toBe(true);
    expect(olderVersion("26.12.31", "27.1.1")).toBe(true);
    expect(olderVersion("26.11.10", "26.11.10")).toBe(false);
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
