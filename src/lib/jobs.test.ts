import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetKv } from "./kv";
import { addItem, loadList, removeItem } from "./groceries";
import { cancelJob, finishJob, returnJob, HELPER_VERSION, helperOutdated, helperPush, olderVersion, helperStatus, jobStatus, pressJob, queueJob, recentJobs, resetJobs, safewaySignedOut, cartChanging, savePush, takeJob } from "./jobs";
import { loadCart, loadPicks, resetSafeway, setCartLine } from "./safeway";

const milk = { productId: "960001", query: "milk", name: "Lucerne Milk 2% - 1/2 Gallon", price: "$3.49", image: "https://images.example/milk.jpg", itemId: "m", item: "milk" };

describe("jobs for the Safeway helper", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); resetKv(); });

  it("knows when a cart change is still on its way, so checking out waits (Nov 16)", async () => {
    expect(await cartChanging()).toBe(false);
    const j = await queueJob("setQty", { productId: "1", qty: 2 });
    expect(await cartChanging()).toBe(true);
    await takeJob("1.0.0", true);
    expect(await cartChanging()).toBe(true);
    await finishJob(j.id, true, { ok: true, qty: 2, name: "Milk" });
    expect(await cartChanging()).toBe(false);
  });

  it("keeps whether Safeway was last seen signed out, and doesn't change the cart while it is (Nov 16)", async () => {
    await setCartLine({ ...milk, qty: 1 });
    const finish = async (kind: "cart" | "checkoutPrepare", raw: Record<string, unknown>) => {
      const j = await queueJob(kind, {}); await takeJob("1.0.0", true); await finishJob(j.id, true, raw);
    };
    expect(await safewaySignedOut()).toBe(false);
    await finish("cart", { products: [], signedIn: false });
    expect(await safewaySignedOut()).toBe(true);
    expect((await loadCart()).map((l) => l.productId)).toEqual([milk.productId]);
    await finish("cart", { products: [{ id: milk.productId, name: milk.name, price: milk.price, image: "", inCart: true, qty: 1 }], signedIn: true });
    expect(await safewaySignedOut()).toBe(false);
    await finish("checkoutPrepare", { stopped: "signed out", chosen: null, final: null });
    expect(await safewaySignedOut()).toBe(true);
  });

  it("never guesses the helper's away from when it last checked in (Nov 11: no timer keeps that fresh)", async () => {
    expect(await helperStatus()).toMatchObject({ away: false });
    expect(await takeJob("1.0.0", false)).toBeNull();
    expect((await helperStatus()).away).toBe(false);
  });

  it("says it's away once a job wasn't taken, until a job is next done (Nov 19)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const a = await queueJob("search", { query: "milk" });
      vi.setSystemTime(Date.now() + 30_000);
      expect(await jobStatus(a.id)).toMatchObject({ status: "failed", result: { error: "not-answering" } });
      expect((await helperStatus()).away).toBe(true);
      const b = await queueJob("search", { query: "eggs" });
      await takeJob("1.0.0", false);
      await finishJob(b.id, true, { products: [], signedIn: true });
      expect((await helperStatus()).away).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("goes from Simmer to the helper and back, oldest first", async () => {
    const a = await queueJob("search", { query: "milk" });
    const b = await queueJob("search", { query: "bananas" });
    const took = await takeJob("1.0.0", true);
    expect(took).toMatchObject({ id: a.id, status: "working" });
    await finishJob(a.id, true, { products: [{ id: "1", name: "Milk", price: "$3", image: "https://x/y.jpg", inCart: false, qty: 0 }, { id: "bad", name: "x" }, { id: "2", name: "Oat milk", price: "$4", image: "", inCart: false, qty: 0 }], signedIn: true });
    const done = (await jobStatus(a.id));
    expect(done?.status).toBe("done");
    const products = done?.result?.products as { id: string; image: string }[];
    expect(products.map((p) => p.id)).toEqual(["1", "2"]); // only real products come back
    // One further down Safeway's page, whose picture hadn't loaded: Safeway's picture for that product.
    expect(products[1].image).toMatch(/^https:\/\/images\.albertsons-media\.com\/is\/image\/ABS\/2\?/);
    expect((await takeJob("1.0.0", true))?.id).toBe(b.id);
    expect(await takeJob("1.0.0", true)).toBeNull();
  });

  it("gives a job the old helper was in the middle of to the new one when it checks in as a new version", async () => {
    const j = await queueJob("checkoutLook", {});
    expect((await takeJob("1.0.0", false))?.id).toBe(j.id);
    expect(await takeJob("1.0.0", false)).toBeNull(); // same version: still the old one's
    expect((await takeJob("2.0.0", false))?.id).toBe(j.id);
    expect((await jobStatus(j.id))?.status).toBe("working");
  });

  it("takes back a job the helper hands back as it reloads, for the reloaded helper to take", async () => {
    const j = await queueJob("checkoutLook", {});
    expect((await takeJob("1.0.0", false))?.id).toBe(j.id);
    await returnJob(j.id);
    expect((await jobStatus(j.id))?.status).toBe("waiting");
    expect((await takeJob("2.0.0", false))?.id).toBe(j.id);
    await returnJob("nope"); // nothing to hand back: nothing changes
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

  it("says why an Add didn't take: Safeway's words, or nothing changed; an expired session is signed out (Nov 23)", async () => {
    const a = await queueJob("setQty", { ...milk, qty: 1 });
    await takeJob("1.0.0", false);
    await finishJob(a.id, true, { ok: false, qty: 0, why: "said", said: "Sorry, we're having issues. We cannot complete your request at this time." });
    expect((await jobStatus(a.id))?.result).toEqual({ qty: 0, reached: false, why: "said", said: "Sorry, we're having issues. We cannot complete your request at this time." });
    const b = await queueJob("setQty", { ...milk, qty: 1 });
    await takeJob("1.0.0", false);
    await finishJob(b.id, true, { ok: false, qty: 0, why: "not-added", said: "ignored" });
    expect((await jobStatus(b.id))?.result).toEqual({ qty: 0, reached: false, why: "not-added" });
    const c = await queueJob("setQty", { ...milk, qty: 1 });
    await takeJob("1.0.0", false);
    await finishJob(c.id, true, { ok: true, qty: 1, why: "said", said: "x" });
    expect((await jobStatus(c.id))?.result).toEqual({ qty: 1, reached: true });
    expect(await safewaySignedOut()).toBe(false);
    const d = await queueJob("setQty", { ...milk, qty: 2 });
    await takeJob("1.0.0", false);
    await finishJob(d.id, false, { error: "signed-out" });
    expect(await safewaySignedOut()).toBe(true);
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
    expect((await jobStatus(a.id))).toMatchObject({ status: "failed", result: { error: "signed-out" } });
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
  it("isn't called away for not checking in, and says when it last did", async () => {
    expect(await helperStatus()).toMatchObject({ away: false, seen: "" });
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
});

describe("helperOutdated", () => {
  const h = (version: string) => ({ seen: new Date().toISOString(), version, panel: false });
  it("flags only a helper older than the one Simmer ships", () => {
    expect(helperOutdated(h("0.6.1"))).toBe(true);
    expect(helperOutdated(h("1.0.0"))).toBe(true);
    expect(helperOutdated(h(HELPER_VERSION))).toBe(false);
    expect(helperOutdated(h("99.1.1"))).toBe(false);
    expect(helperOutdated(h("1.3.0"))).toBe(true); // the last version before date versions
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

describe("a failure's reason (Nov 14)", () => {
  it("keeps the helper's why with the error", async () => {
    const { queueJob, takeJob, finishJob } = await import("./jobs");
    const j = await queueJob("checkoutPrepare", {});
    await takeJob("26.11.14", false);
    const done = await finishJob(j.id, false, { error: "failed", why: "TypeError: x is undefined" });
    expect(done?.result).toMatchObject({ error: "failed", why: "TypeError: x is undefined" });
  });
});

describe("the wake-up subscription (Nov 14)", () => {
  it("survives check-ins: only subscribing changes it", async () => {
    const fresh = { key: "k", sub: { endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "p", auth: "a" } } };
    await savePush(fresh);
    await takeJob("26.11.14.3", false);
    await takeJob("26.11.14.4", true);
    expect(await helperPush()).toEqual(fresh);
  });
});

describe("a placing job is never handed out twice (phase 3, Nov 14)", () => {
  beforeEach(() => resetJobs());
  it("isn't put back when the helper reloads, or handed back: it's marked unsure", async () => {
    const j = await queueJob("checkoutPlace", { windowId: "w" });
    await takeJob(HELPER_VERSION, false);
    await takeJob("99.0.0", false); // the helper reloaded as a new version
    expect((await jobStatus(j.id))).toMatchObject({ status: "failed", result: { error: "unsure" } });
    expect(await takeJob("99.0.0", false)).toBeNull();
    const k = await queueJob("checkoutPlace", { windowId: "w" });
    await takeJob(HELPER_VERSION, false);
    await returnJob(k.id);
    expect((await jobStatus(k.id))).toMatchObject({ status: "failed", result: { error: "unsure" } });
    expect(await takeJob(HELPER_VERSION, false)).toBeNull();
  });

  it("is claimed by only one of two helpers asking at once", async () => {
    resetKv();
    const j = await queueJob("checkoutPlace", { windowId: "w" });
    const [a, b] = await Promise.all([takeJob(HELPER_VERSION, false), takeJob(HELPER_VERSION, false)]);
    expect([a, b].filter((x) => x?.id === j.id)).toHaveLength(1);
  });

  it("lets the helper press only a placing job it's working on, within its deadline, and never gives up on one pressing (Nov 19)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const j = await queueJob("checkoutPlace", { windowId: "w", expect: { deadline: Date.now() + 60_000 } });
      expect(await pressJob(j.id)).toBe(false); // not taken yet
      await takeJob(HELPER_VERSION, false);
      expect(await pressJob(j.id)).toBe(true);
      expect(await pressJob(j.id)).toBe(false); // once
      vi.setSystemTime(Date.now() + 60 * 60_000);
      expect(await jobStatus(j.id)).toMatchObject({ status: "pressing" });
      const late = await queueJob("checkoutPlace", { windowId: "w", expect: { deadline: Date.now() + 1000 } });
      await takeJob(HELPER_VERSION, false);
      vi.setSystemTime(Date.now() + 2000);
      expect(await pressJob(late.id)).toBe(false); // past the deadline by Simmer's clock
      // Taken, not pressed: stuck only a minute after the deadline (and the backstop after it was taken, Nov 23: five minutes).
      vi.setSystemTime(Date.now() + 119_000);
      expect(await jobStatus(late.id)).toMatchObject({ status: "working" });
      vi.setSystemTime(Date.now() + 3 * 60_000);
      expect(await jobStatus(late.id)).toMatchObject({ status: "failed", result: { error: "stuck" } });
    } finally { vi.useRealTimers(); }
  });

  it("counts a report sent twice once (Nov 19)", async () => {
    const j = await queueJob("setQty", { ...milk, qty: 2 });
    await takeJob("26.11.19", false);
    await finishJob(j.id, true, { ok: true, qty: 2 });
    await setCartLine({ ...milk, qty: 5 });
    expect(await finishJob(j.id, true, { ok: true, qty: 2 })).toMatchObject({ status: "done" });
    expect((await loadCart())[0].qty).toBe(5);
  });

  it("keeps what the helper reported, even after it was marked unsure", async () => {
    const j = await queueJob("checkoutPlace", { windowId: "w" });
    await takeJob(HELPER_VERSION, false);
    await returnJob(j.id);
    const done = await finishJob(j.id, true, { stopped: "placed", pressed: true, after: { url: "u", text: "Order number 12345678" } });
    expect(done).toMatchObject({ status: "done", result: { stopped: "placed", pressed: true } });
  });
});

describe("review, Nov 19", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); resetKv(); });

  it("hands test runs and placing only to the helper Simmer ships (an older one never asks to press)", async () => {
    const dry = await queueJob("checkoutDry", { windowId: "w" });
    const place = await queueJob("checkoutPlace", { windowId: "w" });
    expect(await takeJob("26.11.18", false)).toBeNull();
    expect((await takeJob(HELPER_VERSION, false))?.id).toBe(dry.id);
    expect((await takeJob(HELPER_VERSION, false))?.id).toBe(place.id);
  });

  it("keeps when the helper was let press, through its report", async () => {
    const j = await queueJob("checkoutPlace", { windowId: "w", expect: { deadline: Date.now() + 60_000 } });
    await takeJob(HELPER_VERSION, false);
    expect(await pressJob(j.id)).toBe(true);
    const done = await finishJob(j.id, true, { stopped: "not pressed", pressed: "unknown", why: "no answer" });
    expect(done).toMatchObject({ status: "done", result: { pressed: "unknown" } });
    expect(done?.pressedAt).toBeTruthy();
  });

  it("does what a report means once, however many copies arrive at the same moment", async () => {
    const safeway = await import("./safeway");
    const spy = vi.spyOn(safeway, "setCartLine");
    try {
      const j = await queueJob("setQty", { ...milk, qty: 2 });
      await takeJob(HELPER_VERSION, false);
      const outs = await Promise.all([1, 2, 3].map(() => finishJob(j.id, true, { ok: true, qty: 2 })));
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await jobStatus(j.id))?.status).toBe("done");
      expect(outs.some((o) => o?.status === "done")).toBe(true);
    } finally { spy.mockRestore(); }
  });

  it("works out what a placing job came to however it finishes: lost in a reload, or given up", async () => {
    const { kv } = await import("./kv");
    const order = (id: string) => kv().set(`simmer:checkout-order:${id}`, JSON.stringify({ id, totalCents: 500, windowWords: "Fri 6–7 AM", faceId: "f" }), { ex: 3600 });
    await order("approval00000001");
    await queueJob("checkoutPlace", { approvalId: "approval00000001", windowId: "w" });
    await takeJob(HELPER_VERSION, false);
    await takeJob("99.0.0", false); // reloaded
    expect(JSON.parse((await kv().get("simmer:checkout-outcome:approval00000001"))!)).toMatchObject({ ok: false, unsure: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await order("approval00000002");
      const late = await queueJob("checkoutPlace", { approvalId: "approval00000002", windowId: "w" });
      vi.setSystemTime(Date.now() + 120_000);
      expect(await jobStatus(late.id)).toMatchObject({ status: "failed", result: { error: "not-answering" } });
      expect(JSON.parse((await kv().get("simmer:checkout-outcome:approval00000002"))!)).toMatchObject({ ok: false, unsure: true });
    } finally { vi.useRealTimers(); }
  });

  it("the panel's log reaches back 15 minutes, past 80 other jobs", async () => {
    await queueJob("search", { query: "bananas", from: "app" });
    for (let i = 0; i < 90; i++) await queueJob("snapshot", { query: "x", productId: "1" });
    expect((await recentJobs()).map((j) => j.what)).toEqual(["bananas"]);
  });
});

describe("judged from what happened, not how long it's been (Nov 23)", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); resetKv(); });
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("keeps a search waiting while the helper reads the cart, however long that takes, then hands it over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const cart = await queueJob("cart", {});
      expect((await takeJob("26.11.23", false))?.id).toBe(cart.id);
      later(11_000);
      const find = await queueJob("search", { query: "milk" });
      later(25_000); // the cart read is at 36 s, the search has waited 25 s
      expect(await jobStatus(find.id)).toMatchObject({ status: "waiting" });
      expect((await recentJobs()).find((a) => a.id === find.id)).toMatchObject({ status: "waiting", error: "" });
      expect((await helperStatus()).away).toBe(false);
      await finishJob(cart.id, true, { products: [], signedIn: true });
      later(1500); // the helper's pause between jobs: its report counts as hearing from it
      expect(await jobStatus(find.id)).toMatchObject({ status: "waiting" });
      expect((await takeJob("26.11.23", false))?.id).toBe(find.id);
    } finally { vi.useRealTimers(); }
  });

  it("keeps a quantity change behind a busy helper counted as on its way, and merges taps into it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await queueJob("cart", {});
      await takeJob("26.11.23", false);
      const a = await queueJob("setQty", { ...milk, qty: 1 });
      later(60_000);
      expect(await cartChanging()).toBe(true);
      expect((await queueJob("setQty", { ...milk, qty: 2 })).id).toBe(a.id);
    } finally { vi.useRealTimers(); }
  });

  it("is not answering when nothing has come from the helper since the job was queued and it's working on nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(await takeJob("26.11.23", false)).toBeNull(); // checked in, then the computer slept
      later(1000);
      const find = await queueJob("search", { query: "milk" });
      later(15_000);
      expect(await jobStatus(find.id)).toMatchObject({ status: "waiting" });
      later(10_000);
      expect(await jobStatus(find.id)).toMatchObject({ status: "failed", result: { error: "not-answering" } });
      expect((await helperStatus()).away).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("stops waiting behind a job the helper never reports once that job is past its backstop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const cart = await queueJob("cart", {});
      await takeJob("26.11.23", false); // the computer slept mid-job
      later(1000);
      const find = await queueJob("search", { query: "milk" });
      later(4 * 60_000);
      expect(await jobStatus(find.id)).toMatchObject({ status: "waiting" });
      later(60_000 + 1);
      expect(await jobStatus(find.id)).toMatchObject({ status: "failed", result: { error: "not-answering" } });
      expect(await jobStatus(cart.id)).toMatchObject({ status: "failed", result: { error: "stuck" } });
    } finally { vi.useRealTimers(); }
  });

  it("gives up a job a helper that's answering doesn't take only past the backstop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const dry = await queueJob("checkoutDry", { windowId: "w" });
      later(1000);
      expect(await takeJob("26.11.1", false)).toBeNull(); // an older helper: here, but doesn't take test runs
      later(2 * 60_000);
      expect(await jobStatus(dry.id)).toMatchObject({ status: "waiting" });
      later(60_000);
      expect(await jobStatus(dry.id)).toMatchObject({ status: "failed", result: { error: "not-answering" } });
    } finally { vi.useRealTimers(); }
  });
});
