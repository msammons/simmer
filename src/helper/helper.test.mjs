// The helper's decisions, fast (Nov 23, Sam: "be efficient with tests. And intelligent."): the helper's own files run
// unchanged against a stand-in Chrome and Safeway (world.mjs) on a fake clock, so the cases that wait out its real limits
// (an 8 s signed-out hold, 20 s and 60 s page limits, a body gone 3 s, slow loads) take milliseconds. What only a real
// browser can show (Chrome's own events, the panel, Simmer's screens) is in scripts/extension-test.mjs; whether Safeway's
// real pages still read right is scripts/real-pages-test.mjs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BREAD, makeWorld, OTHER_STREET, OUR_STREET, PAGE, ROBIN, SAFEWAY, SAM, SETTINGS, WINDOW } from "./world.mjs";
import { resetKv } from "../lib/kv";
import { finishJob, jobStatus, queueJob, resetJobs, takeJob } from "../lib/jobs";

let world, helper, ids = 0;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
  world = makeWorld();
  world.open();
  helper = world.start();
});
afterEach(() => { world.stopHelper(); vi.clearAllTimers(); vi.useRealTimers(); });

/** Runs `p` on the fake clock until it settles (10 minutes at most): its value and how long it took, in fake ms. */
async function drive(p, limit = 600_000) {
  let done = false, value, error;
  p.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
  const t0 = Date.now();
  while (!done && Date.now() - t0 < limit) await vi.advanceTimersByTimeAsync(100);
  if (error) throw error;
  if (!done) throw new Error(`still going after ${limit} ms`);
  return { value, ms: Date.now() - t0 };
}
/** Lets the stand-in pages settle (a redirect, the sign-in page sending the tab home). */
const wait = (ms) => vi.advanceTimersByTimeAsync(ms);
const job = (kind, args = {}) => ({ id: `j${++ids}`, kind, args, page: PAGE, settings: SETTINGS });
const run = async (kind, args) => (await drive(helper.runJob(job(kind, args), null))).value;
const timed = (kind, args) => drive(helper.runJob(job(kind, args), null));
const setQty = (productId, qty, query, name, more = {}) => run("setQty", { productId, qty, query, name, ...more });
const ids_ = (r) => (r.result?.products ?? []).map((p) => p.id);

describe("reading a page", () => {
  it("reads a search, after Safeway's moment of \"No search results\", from a slow page", async () => {
    world.shop.chaos = { slow: 6000 };
    const r = await run("search", { query: "milk" });
    expect(r).toMatchObject({ ok: true, result: { signedIn: true } });
    expect(ids_(r)).toEqual(["960001", "960002"]);
    // A name Safeway shortened on screen is read whole from its labels.
    expect(r.result.products[1].name).toBe("Lucerne Milk Reduced Fat 2% - 1 Gallon");
  });

  it("isn't fooled by Sign In showing a moment while the page builds (search and cart)", async () => {
    world.shop.chaos = { flash: true };
    expect(ids_(await run("search", { query: "milk" }))).toContain("960001");
    expect((await run("cart")).result.signedIn).toBe(true);
    expect(world.onSignIn()).toBe(false);
  });

  it("reads a page that never stops changing, and one whose every check throws for 3 s", async () => {
    world.shop.chaos = { churn: true };
    expect(ids_(await run("search", { query: "butter" }))).toEqual(["960090"]);
    world.shop.chaos = { nobody: true };
    expect(ids_(await run("search", { query: "milk" }))).toContain("960001");
  });

  it("a page that never finishes building is \"didn't load\", never an empty search", async () => {
    const { value, ms } = await timed("search", { query: "slowpoke" });
    expect(value).toEqual({ ok: false, error: "not-loaded" });
    expect(ms).toBeLessThan(120_000);
  });

  it("opens a page once more when Safeway sends the tab elsewhere while it builds", async () => {
    const r = await run("search", { query: "yogurt" });
    expect(ids_(r)).toEqual(["960120"]);
    expect(world.shop.loads.filter((l) => l.includes("yogurt"))).toHaveLength(2);
  });

  it("reads an empty cart that lists past purchases with Add as empty, and then the Purchases page's Online tab", async () => {
    world.shop.ordered = true;
    const r = await run("cart", { orders: true });
    expect(r.result).toMatchObject({ signedIn: true, empty: true });
    expect(r.result.products.some((p) => p.inCart)).toBe(false);
    expect(r.result.orders).toMatchObject({ online: true, pressed: true });
    expect(r.result.orders.entries[0]).toMatch(/Order #5550123/);
    expect(world.path()).toBe(PAGE.cartPath); // back to the cart page
  });
});

describe("signed out", () => {
  it("counts only once Sign In has stayed 8 s; then the tab waits on the sign-in page", async () => {
    world.shop.signedIn = false;
    world.shop.sessionGone = true;
    const { value, ms } = await timed("search", { query: "milk" });
    expect(value.result.signedIn).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(SETTINGS.signedOutHold);
    expect(world.onSignIn()).toBe(true);
    expect(world.local.get("parked")).toBe("fresh");
  });

  it("looks once more after parking, and after that leaves the sign-in page alone", async () => {
    world.shop.signedIn = false;
    world.shop.sessionGone = true;
    await run("search", { query: "milk" });
    // The first job after parking looks at Safeway again: still signed out.
    expect(await setQty("960050", 1, "bread", BREAD)).toEqual({ ok: false, error: "signed-out" });
    expect(world.local.get("parked")).toBe("looked");
    const loads = world.shop.loads.length;
    // The next says so without leaving the sign-in page (Sam may be typing there).
    expect(await setQty("960050", 1, "bread", BREAD)).toEqual({ ok: false, error: "signed-out" });
    expect(world.shop.loads.length).toBe(loads);
    expect(world.onSignIn()).toBe(true);
  });

  it("leaves the sign-in page alone while a field there has the focus", async () => {
    world.shop.signedIn = false;
    world.shop.sessionGone = true;
    await run("search", { query: "milk" });
    world.doc.getElementById("user").focus();
    vi.spyOn(world.doc, "hasFocus").mockReturnValue(true);
    const loads = world.shop.loads.length;
    expect((await run("cart")).result).toMatchObject({ signedIn: false, empty: false });
    expect(world.shop.loads.length).toBe(loads);
  });

  it("a sign-out that wasn't: the next Add looks again and takes", async () => {
    world.shop.fails = "expired";
    world.shop.sessionGone = true;
    expect(await setQty("960050", 1, "bread", BREAD)).toEqual({ ok: false, error: "signed-out" });
    expect(world.onSignIn()).toBe(true);
    world.shop.fails = null;
    world.shop.sessionGone = false;
    await wait(1000); // signed in, Safeway's sign-in page sends the tab home
    expect((await setQty("960050", 1, "bread", BREAD)).result).toMatchObject({ ok: true, qty: 1 });
    expect(world.shop.cart["960050"]).toBe(1);
  });

  it("sent home twice (Nov 23): signed out promptly, the tab parked; once more and again; signed in, it reads", async () => {
    world.shop.cartGone = true;
    world.shop.sessionGone = true;
    let t = await timed("cart");
    expect(t.value.result).toMatchObject({ signedIn: false, empty: false, products: [] });
    expect(t.ms).toBeLessThan(30_000);
    expect(world.onSignIn()).toBe(true);
    t = await timed("cart");
    expect(t.value.result.signedIn).toBe(false);
    expect(t.ms).toBeLessThan(30_000);
    world.shop.cartGone = false;
    world.shop.sessionGone = false;
    world.go("/");
    await wait(500);
    expect((await run("cart")).result.signedIn).toBe(true);
  });
});

describe("Pickup not chosen and delivery (26.11.23.4)", () => {
  it("sent home with a signed-in customer's note and no pickup: noPickup, the tab stays where Safeway put it", async () => {
    world.note({ userType: "C", preference: "" });
    world.shop.cartGone = true;
    const r = await run("cart");
    expect(r.result).toMatchObject({ noPickup: true, products: [] });
    expect(world.onSignIn()).toBe(false);
    expect(await run("search", { query: "milk" })).toMatchObject({ ok: true }); // search pages still show
  });

  it("an Add sent home that way is \"no-pickup\", not signed out", async () => {
    world.note({ userType: "C", preference: "" });
    world.shop.cartGone = true;
    expect(await setQty("960001", 1, "", "", { on: "cart" })).toEqual({ ok: false, error: "no-pickup" });
    expect(world.onSignIn()).toBe(false);
  });

  it("a guest's note, or none, sent home: signed out, as before", async () => {
    world.note({ userType: "G", preference: "" });
    world.shop.cartGone = true;
    world.shop.sessionGone = true;
    const r = await run("cart");
    expect(r.result.signedIn).toBe(false);
    expect(r.result.noPickup).toBeUndefined();
    expect(world.onSignIn()).toBe(true);
  });

  const prepare = () => run("checkoutPrepare", { list: true });
  beforeEach(() => { world.shop.cart = { "960001": 1 }; world.shop.checkoutButton = true; });

  it("checkout stops \"delivery\" by the note, before any press", async () => {
    world.note({ userType: "C", preference: "Delivery" });
    expect((await prepare()).result.stopped).toBe("delivery");
    expect(world.shop.presses).toEqual({});
  });

  it("checkout stops \"delivery\" from the checkout page's words, only the cart's Checkout pressed", async () => {
    expect((await prepare()).result.stopped).toBe("delivery");
    expect(world.shop.presses).toEqual({ checkout: 1 });
  });

  it("checkout stops \"no pickup chosen\" when the cart is sent home that way, nothing pressed", async () => {
    world.note({ userType: "C", preference: "" });
    world.shop.cartGone = true;
    expect((await prepare()).result.stopped).toBe("no pickup chosen");
    expect(world.shop.presses).toEqual({});
  });

  it("checkout read caught mid-redirect looks once more where the tab lands (the race fixed in 26.11.23.4)", async () => {
    world.note({ userType: "C", preference: "" });
    world.shop.cartGone = true;
    // The cart page shows, the helper sees it's there, and Safeway sends the tab home just as the helper's read of it
    // goes in (the read is lost, as in Chrome): injected 60 ms after asking, the redirect 90 ms after the page loaded.
    world.shop.goneShows = true;
    world.shop.goneAfter = 90;
    world.inject = 60;
    expect((await prepare()).result.stopped).toBe("no pickup chosen");
    expect(world.shop.presses).toEqual({});
  });
});

describe("Add, + and −", () => {
  it("an Add puts one in on the search page showing, without loading it again; + adds the next", async () => {
    await run("search", { query: "milk" });
    const loads = world.shop.loads.length;
    expect((await setQty("960002", 1, "milk", "Lucerne Milk Reduced Fat 2% - 1 Gallon")).result).toMatchObject({ ok: true, qty: 1 });
    expect((await setQty("960002", 2, "milk", "Lucerne Milk Reduced Fat 2% - 1 Gallon")).result).toMatchObject({ ok: true, qty: 2 });
    expect(world.shop.loads.length).toBe(loads);
    expect(world.shop.cart["960002"]).toBe(2);
  });

  it("an Add answered by Safeway's error box says so in its words, nothing pressed on the box", async () => {
    world.shop.fails = "error";
    const r = await setQty("960050", 1, "bread", BREAD);
    expect(r.result).toMatchObject({ ok: false, qty: 0, why: "said" });
    expect(r.result.said).toMatch(/having issues\. We cannot/);
    expect(r.result.said).not.toMatch(/Close/);
    expect(world.shop.cart).toEqual({});
  });

  it("an Add answered by the Session Expired box is signed out, and the tab waits on the sign-in page", async () => {
    world.shop.fails = "expired";
    world.shop.sessionGone = true;
    expect(await setQty("960050", 1, "bread", BREAD)).toEqual({ ok: false, error: "signed-out" });
    expect(world.onSignIn()).toBe(true);
  });

  it("an Add answered by a toast says so in its words", async () => {
    world.shop.chaos = { toast: true };
    const r = await setQty("960140", 1, "marinara", "Raos Homemade Marinara Sauce - 24 Oz");
    expect(r.result).toMatchObject({ ok: false, why: "said" });
    expect(r.result.said).toMatch(/couldn't add/);
  });

  it("an Add that opens a box to choose from: nothing chosen, Safeway's words said; the next Add takes", async () => {
    world.shop.chaos = { choice: true };
    const r = await setQty("960130", 1, "spaghetti", "Barilla Spaghetti - 16 Oz");
    expect(r.result).toMatchObject({ ok: false, why: "said" });
    expect(r.result.said).toMatch(/Pick a size/);
    expect(r.result.said).not.toMatch(/12 Oz/);
    expect(Object.keys(world.shop.presses).filter((k) => k.startsWith("choice"))).toEqual([]);
    world.shop.chaos = {};
    expect((await setQty("960130", 1, "spaghetti", "Barilla Spaghetti - 16 Oz")).result).toMatchObject({ ok: true, qty: 1 });
  });

  it("Safeway sending the tab home right after an Add: found in the cart, never pressed twice", async () => {
    world.shop.chaos = { away: true };
    const r = await setQty("960110", 1, "cheddar", "Tillamook Medium Cheddar Cheese Block - 8 Oz");
    world.shop.chaos = {};
    expect(r.result).toMatchObject({ ok: true, qty: 1 });
    expect(world.shop.presses["960110"]).toBe(1);
  });

  it("+ on a product named \"… Plus\" presses its Increase, never its Decrease; − brings it back", async () => {
    const name = "Gatorade Plus Thirst Quencher Fruit Punch - 20 Fl Oz";
    expect((await setQty("960080", 2, "gatorade", name)).result).toMatchObject({ ok: true, qty: 2 });
    expect(world.shop.presses["960080"]).toBe(2);
    expect((await setQty("960080", 1, "gatorade", name)).result).toMatchObject({ ok: true, qty: 1 });
    expect(world.shop.cart["960080"]).toBe(1);
  });

  it("a product whose name starts \"Add Notes\" still has its Add", async () => {
    expect((await setQty("960160", 1, "notes", "Add Notes Sticky Notes - 3 Pack")).result).toMatchObject({ ok: true, qty: 1 });
  });

  it("a shortened long name: added, and its whole name reported", async () => {
    const r = await setQty("960050", 1, "bread", BREAD);
    expect(r.result).toMatchObject({ ok: true, qty: 1, name: BREAD });
  });

  it("a tile far down the page, its buttons not built yet: scrolled to and added", async () => {
    expect((await setQty("960070", 1, "eggs", "Lucerne Farms Eggs Cage Free Large - 18 Count")).result).toMatchObject({ ok: true, qty: 1 });
  });

  it("− on the cart page takes one off there; the last one out answers Safeway's \"Are you sure?\"", async () => {
    world.shop.cart = { "960001": 2 };
    expect((await setQty("960001", 1, "milk", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", { on: "cart" })).result).toMatchObject({ ok: true, qty: 1 });
    expect(world.path()).toBe(PAGE.cartPath);
    expect(world.shop.loads.some((l) => l.includes("search"))).toBe(false);
    expect((await setQty("960001", 0, "milk", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", { on: "cart" })).result).toMatchObject({ ok: true, qty: 0 });
    expect(world.shop.cart).toEqual({});
  });

  it("the cart page just loaded (Nov 24 evening, a press then did nothing): − and + wait for it, then take, each pressed once", async () => {
    world.shop.cart = { "960050": 1, "960001": 2 };
    world.shop.chaos = { deafFor: 3000 };
    await run("search", { query: "bread" }); // the tab on a search, as after an Add: the cart page opens fresh
    expect((await setQty("960050", 0, "bread", BREAD, { on: "cart" })).result).toMatchObject({ ok: true, qty: 0 });
    world.go("/erums/cart");
    expect((await setQty("960001", 3, "milk", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", { on: "cart" })).result).toMatchObject({ ok: true, qty: 3 });
    expect(world.shop.cart).toEqual({ "960001": 3 });
    expect(world.shop.presses).toEqual({ "960050": 1, "960001": 1 });
  });

  it("a take-out Safeway doesn't take: − once more on its control as read now, then out; never past 0, never toward another count", async () => {
    world.shop.cart = { "960050": 1, "960001": 2 };
    await run("cart");
    await wait(10_000); // a page loaded a while ago, pressed at once
    world.shop.chaos = { deafOnce: true };
    expect((await setQty("960050", 0, "bread", BREAD, { on: "cart" })).result).toMatchObject({ ok: true, qty: 0 });
    expect(world.shop.presses).toEqual({ ignored: 1, "960050": 1 });
    // A − toward 1 that doesn't take isn't pressed again (a page showing an old count could take it past 1): the cart is
    // read afresh, and it says so.
    world.go("/erums/cart");
    await wait(10_000);
    world.shop.presses = {};
    expect((await setQty("960001", 1, "milk", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", { on: "cart" })).result).toMatchObject({ ok: false, qty: 2 });
    expect(world.shop.presses).toEqual({ ignored: 1 });
    expect(world.shop.cart).toEqual({ "960001": 2 });
  });
});

describe("the background: jobs in order, reports kept, a job lost when Chrome stops it", () => {
  // Simmer's own job rules (src/lib/jobs.ts) answer the background, as the jobs route does.
  let drop = false;
  beforeEach(() => {
    resetJobs(); resetKv(); drop = false;
    world.local.set("address", "https://simmer.test");
    world.local.set("passcode", "test");
    world.simmer = async (op, b) => {
      if (op === "next") { const j = await takeJob(b.version, b.panel === true, { helper: b.helper, pending: b.pending }); return { job: j && { ...j, page: PAGE, settings: SETTINGS }, settings: SETTINGS }; }
      if (op === "done" || op === "failed") {
        if (drop) return "drop";
        return { job: await finishJob(b.id, op === "done", b.result ?? { error: b.error, ...(b.why && { why: b.why }) }) };
      }
      return { ok: true };
    };
  });
  const status = async (id) => (await jobStatus(id))?.status;

  it("does five jobs queued at once behind one that never loads, all of them, in order", async () => {
    const queued = [];
    for (const [kind, args] of [["search", { query: "slowpoke" }], ["search", { query: "milk" }], ["setQty", { productId: "960090", qty: 1, query: "butter", name: "Lucerne Butter Salted - 16 Oz" }], ["search", { query: "bananas" }], ["cart", {}]]) queued.push(await queueJob(kind, args));
    await drive(helper.check());
    const all = await Promise.all(queued.map((j) => jobStatus(j.id)));
    expect(all.map((j) => j.status)).toEqual(["failed", "done", "done", "done", "done"]);
    expect(all[0].result.error).toBe("not-loaded");
    const ends = all.map((j) => Date.parse(j.updated));
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(world.shop.cart["960090"]).toBe(1);
  });

  it("a job dropped when Chrome stops the helper mid-way is said at once (\"lost\"), never done again", async () => {
    world.shop.chaos = { slow: 8000 };
    const lost = await queueJob("setQty", { productId: "960110", qty: 2, query: "cheddar", name: "Tillamook Medium Cheddar Cheese Block - 8 Oz" });
    const next = await queueJob("search", { query: "milk" });
    void helper.check();
    await wait(2000);
    expect(await status(lost.id)).toBe("working");
    world.stopHelper();
    world.shop.chaos = {};
    helper = world.start(); // started again (a push or the panel)
    await drive(helper.check());
    expect(await jobStatus(lost.id)).toMatchObject({ status: "failed", result: { error: "lost" } });
    expect(await status(next.id)).toBe("done");
    expect(world.shop.presses["960110"]).toBeUndefined();
  });

  it("a report Simmer couldn't take is kept and sent once the helper starts again; the Add isn't made twice", async () => {
    drop = true;
    const kept = await queueJob("setQty", { productId: "960120", qty: 1, query: "yogurt", name: "Chobani Greek Yogurt Plain - 32 Oz" });
    await drive(helper.check());
    expect(world.local.get("pendingReports").map((r) => r.id)).toEqual([kept.id]);
    world.stopHelper();
    drop = false;
    helper = world.start();
    await drive(helper.check());
    expect(await jobStatus(kept.id)).toMatchObject({ status: "done", result: { reached: true } });
    expect(world.local.get("pendingReports")).toEqual([]);
    expect(world.shop.presses["960120"]).toBe(1);
  });
});

void SAFEWAY;

describe("signed in, set to In Store (live, Nov 25)", () => {
  // Robin's account on the Mac: signed in, Safeway set to In Store (the header shows only the store, no Delivery/Pickup
  // button), and Safeway's note not a customer's. The cart is sent home; the Pickup switch finds no box button, so
  // nothing's pressed; Safeway's sign-in page sends the signed-in tab straight home, so Google's button is never there.
  const STORE = `Safeway ${OUR_STREET} Petaluma, CA 00000`;
  const live = (kind, args = {}) => ({ id: `j${++ids}`, kind, args, page: PAGE, settings: SETTINGS, store: STORE, google: SAM });
  let told;
  beforeEach(() => { told = []; world.simmer = async (op, b) => { if (op === "step") told.push(b); return { ok: true }; }; });
  const stepsOf = (id) => told.filter((t) => t.id === id).map((t) => t.step);
  const inStore = () => { world.note(null); world.shop.cartGone = true; world.shop.signedIn = true; world.shop.sessionGone = false; world.shop.signInAtOnce = true; };

  it("a cart read says why Google wasn't tried (the sign-in page went home), and nothing is pressed", async () => {
    inStore();
    const j = live("cart");
    const { value } = await drive(helper.runJob(j, null));
    expect(value.result).toMatchObject({ signedIn: false, products: [], google: "not the sign-in page" });
    expect(world.shop.presses).toEqual({});
    expect(stepsOf(j.id)).toEqual(["cart", "wait", "cart", "wait", "pickup", "signin"]);
  });
});

describe("switching Safeway to Pickup (Sam, Nov 23: \"i want this process to be automated\")", () => {
  const STORE = `Safeway ${OUR_STREET} Petaluma, CA 00000`;
  const withStore = (kind, args = {}) => ({ id: `j${++ids}`, kind, args, page: PAGE, settings: SETTINGS, store: STORE });
  const runS = async (kind, args) => (await drive(helper.runJob(withStore(kind, args), null))).value;
  const noPickupNow = () => { world.note({ userType: "C", preference: "" }); world.shop.cartGone = true; world.shop.box = { selected: "" }; };

  it("signed in with Pickup not chosen: picks the household's store, then reads the cart", async () => {
    noPickupNow();
    world.shop.cart = { "960001": 2 };
    const r = await runS("cart");
    expect(r.result.noPickup).toBeUndefined();
    expect(r.result.signedIn).toBe(true);
    expect(world.shop.presses).toMatchObject({ box: 1, "pickup tab": 1, [`select ${OUR_STREET}`]: 1 });
    expect(world.shop.presses[`select ${OTHER_STREET}`]).toBeUndefined();
    expect(world.shop.presses["delivery tab"]).toBeUndefined();
  });

  it("an Add with Pickup not chosen switches, then adds", async () => {
    noPickupNow();
    expect(await setQtyS("960001", 1)).toMatchObject({ ok: true });
    expect(world.shop.presses[`select ${OUR_STREET}`]).toBe(1);
    async function setQtyS(productId, qty) { return runS("setQty", { productId, qty, query: "milk", name: "", on: "cart" }); }
  });

  it("Safeway not taking the Select: one try, then said as before (noPickup), nothing pressed again", async () => {
    noPickupNow();
    world.shop.box.noTake = true;
    const r = await runS("cart");
    expect(r.result.noPickup).toBe(true);
    expect(world.shop.presses[`select ${OUR_STREET}`]).toBe(1);
  });

  it("the household's store not in the list, or there twice: nothing selected", async () => {
    noPickupNow();
    world.shop.box.stores = [OTHER_STREET, "300 Elm Rd"];
    expect((await runS("cart")).result.noPickup).toBe(true);
    expect(Object.keys(world.shop.presses).filter((k) => k.startsWith("select"))).toEqual([]);
    world.shop.box.stores = [OUR_STREET, OUR_STREET];
    world.shop.presses = {};
    expect((await runS("cart")).result.noPickup).toBe(true);
    expect(Object.keys(world.shop.presses).filter((k) => k.startsWith("select"))).toEqual([]);
  });

  it("signed in with Pickup forgotten and a note that doesn't say customer (Nov 24): switches anyway, then reads the cart", async () => {
    world.note({ userType: "G", preference: "" });
    world.shop.cartGone = true;
    world.shop.box = { selected: "", quietNote: true };
    world.shop.cart = { "960001": 1 };
    const { value: r, ms } = await drive(helper.runJob(withStore("cart"), null));
    expect(r.result.signedIn).toBe(true);
    expect(world.shop.presses[`select ${OUR_STREET}`]).toBe(1);
    expect(ms).toBeLessThan(15_000); // the redirect is seen as the load finishes, not after a watch's whole limit
  });

  it("signed out for real: one Select tried, then signed out as before, and the sign-in page waits", async () => {
    world.note(null);
    world.shop.cartGone = true;
    world.shop.sessionGone = true;
    world.shop.box = { selected: "" };
    const r = await runS("cart");
    expect(r.result.signedIn).toBe(false);
    expect(r.result.noPickup).toBeUndefined();
    expect(world.shop.presses[`select ${OUR_STREET}`]).toBe(1);
    expect(world.onSignIn()).toBe(true);
  });

  it("no store known (Simmer sent none): no switch, said as before", async () => {
    noPickupNow();
    expect((await run("cart")).result.noPickup).toBe(true);
    expect(world.shop.presses).toEqual({});
  });

  it("getting ready on delivery switches to Pickup first, then goes on to Checkout", async () => {
    world.note({ userType: "C", preference: "Delivery" });
    world.shop.box = { selected: "", mode: "Delivery" };
    world.shop.cart = { "960001": 1 }; world.shop.checkoutButton = true;
    const r = await runS("checkoutPrepare", { list: true });
    expect(world.shop.presses[`select ${OUR_STREET}`]).toBe(1);
    expect(world.shop.presses.checkout).toBe(1);
    expect(r.result.stopped).not.toBe("no pickup chosen");
  });

  it("placing never switches: stops \"no pickup chosen\", nothing pressed", async () => {
    noPickupNow();
    world.shop.cart = { "960001": 1 };
    const r = await runS("checkoutPlace", { windowId: "w1", expect: { cart: "960001x1" } });
    expect(r.result?.stopped ?? r.error).toBe("no pickup chosen");
    expect(Object.keys(world.shop.presses).filter((k) => k !== "close")).toEqual([]);
  });
});

describe("progress told to Simmer as it goes (Nov 23, Sam: \"some sort of status message\")", () => {
  let told, answer;
  beforeEach(() => {
    told = []; answer = async () => ({ ok: true });
    world.simmer = async (op, b) => { if (op === "step") { told.push(b); return answer(); } return { ok: true }; };
  });
  const stepsOf = (id) => told.filter((t) => t.id === id).map((t) => t.step);
  /** `want` appears in `list` in this order (other steps may come between). */
  const inOrder = (list, want) => { let i = 0; for (const x of list) if (x === want[i]) i++; return i === want.length; };
  const STORE = `Safeway ${OUR_STREET} Petaluma, CA 00000`;
  const runAs = async (kind, args = {}, more = {}) => { const j = { ...job(kind, args), ...more }; return { id: j.id, ...(await drive(helper.runJob(j, null))) }; };
  const pickupCheckout = () => { world.shop.cart = { "960001": 1 }; world.shop.checkoutButton = true; world.shop.checkoutFor = "pickup"; };

  it("a cart read: opening the cart, then waiting for Safeway, each with the time, once each", async () => {
    const { id, value } = await runAs("cart");
    expect(value.ok).toBe(true);
    expect(stepsOf(id)).toEqual(["cart", "wait"]);
    const at = told.map((t) => t.at);
    expect(at.every((t) => typeof t === "number")).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("switching to Pickup on the way: the cart, choosing Pickup, then the cart again", async () => {
    world.note({ userType: "C", preference: "" }); world.shop.cartGone = true; world.shop.box = { selected: "" };
    const { id, value } = await runAs("cart", {}, { store: STORE });
    expect(value.result.signedIn).toBe(true);
    expect(inOrder(stepsOf(id), ["cart", "wait", "pickup", "cart", "wait"])).toBe(true);
    expect(stepsOf(id).at(-1)).toBe("wait");
  });

  it("an Add: the search, waiting, then adding", async () => {
    const { id } = await runAs("setQty", { productId: "960090", qty: 1, query: "butter", name: "Lucerne Butter Salted - 16 Oz" });
    expect(stepsOf(id)).toEqual(["search", "wait", "add"]);
  });

  it("getting ready: the cart, Checkout, then the pickup times", async () => {
    pickupCheckout();
    const { id, value } = await runAs("checkoutPrepare", { list: true });
    expect(value.result.stopped).toBe("times");
    expect(inOrder(stepsOf(id), ["cart", "wait", "checkout", "times"])).toBe(true);
  });

  it("a test run: the cart, Checkout, the times, choosing the time, reading the order; Place Order never pressed", async () => {
    pickupCheckout();
    const { id, value } = await runAs("checkoutDry", { windowId: WINDOW });
    expect(value.result).toMatchObject({ stopped: "ready", chosen: { id: WINDOW } });
    expect(inOrder(stepsOf(id), ["cart", "wait", "checkout", "times", "time", "read"])).toBe(true);
    expect(world.shop.presses.place).toBeUndefined();
  });

  it("progress that fails, or never answers, changes nothing about the job and doesn't slow it", async () => {
    pickupCheckout();
    const base = await runAs("checkoutDry", { windowId: WINDOW });
    const presses = { ...world.shop.presses };
    for (const fail of [async () => "drop", () => new Promise(() => {})]) {
      answer = fail;
      world.shop.presses = {};
      world.go("/");
      await wait(200);
      const r = await runAs("checkoutDry", { windowId: WINDOW });
      expect(r.value.result.stopped).toBe("ready");
      expect(r.value.result.chosen).toEqual(base.value.result.chosen);
      expect(world.shop.presses).toEqual(presses);
      expect(r.ms).toBeLessThan(base.ms + 1000);
      expect(stepsOf(r.id).length).toBeGreaterThan(3);
    }
  });
});

describe("signing in through Google (Sam, Nov 24: \"Yes build it\")", () => {
  const withGoogle = (kind, args = {}) => ({ id: `j${++ids}`, kind, args, page: PAGE, settings: SETTINGS, google: SAM });
  const runG = async (kind, args) => (await drive(helper.runJob(withGoogle(kind, args), null))).value;
  const signedOut = () => { world.shop.signedIn = false; world.shop.sessionGone = true; };
  const presses = () => world.shop.presses;

  it("signed out: Safeway's Google button, then Sam's account in Google's list, then the search reads", async () => {
    signedOut();
    world.shop.google = { accounts: [SAM, ROBIN] };
    const r = await runG("search", { query: "milk" });
    expect(r.result.signedIn).toBe(true);
    expect(ids_(r)).toContain("960001");
    expect(presses()).toEqual({ "google button": 1, [`google ${SAM}`]: 1 });
    expect(world.onSignIn()).toBe(false);
  });

  it("an Add signed out: signs in, then adds", async () => {
    signedOut();
    world.shop.google = {};
    const r = await runG("setQty", { productId: "960050", qty: 1, query: "bread", name: BREAD });
    expect(r.result).toMatchObject({ ok: true, qty: 1 });
    expect(world.shop.cart["960050"]).toBe(1);
    expect(presses()[`google ${SAM}`]).toBe(1);
  });

  it("a cart read sent home signed out (as on Nov 23–24): signs in, then reads the cart", async () => {
    world.shop.cartGone = true; world.shop.sessionGone = true; world.shop.signedIn = false;
    world.shop.cart = { "960001": 2 };
    world.shop.google = {};
    const r = await runG("cart");
    expect(r.result.signedIn).toBe(true);
    expect(ids_(r)).toEqual(["960001"]);
  });

  it("Safeway's box not showing: its one Sign In first, then Google", async () => {
    signedOut();
    world.shop.google = { hidden: true };
    expect((await runG("cart")).result.signedIn).toBe(true);
    expect(presses()).toMatchObject({ "sign in": 1, "google button": 1, [`google ${SAM}`]: 1 });
  });

  it("Google sending the tab straight back (no list): signed in, nothing pressed on Google", async () => {
    signedOut();
    world.shop.google = { straight: true };
    expect((await runG("cart")).result.signedIn).toBe(true);
    expect(presses()).toEqual({ "google button": 1 });
  });

  it("a password asked after choosing: stops, nothing typed, the tab waits on Safeway's sign-in page", async () => {
    signedOut();
    world.shop.google = { signedIn: "nobody@example.com" };
    const r = await runG("search", { query: "milk" });
    expect(r.result).toMatchObject({ signedIn: false, google: "password" });
    expect(presses()).toEqual({ "google button": 1, [`google ${SAM}`]: 1 });
    expect(world.onSignIn()).toBe(true);
  });

  it("a password, a check that it's a person, or a consent screen instead of the list: nothing pressed on Google", async () => {
    for (const [ask, why] of [["password", "password"], ["captcha", "captcha"], ["consent", "asks for more"]]) {
      world.go("/");
      await wait(500);
      signedOut();
      world.local.delete("parked");
      world.shop.presses = {};
      world.shop.google = { ask };
      const r = await runG("search", { query: "milk" });
      expect(r.result.google, ask).toBe(why);
      expect(presses(), ask).toEqual({ "google button": 1 });
    }
  });

  it("Sam's account not listed, or listed twice: nothing chosen", async () => {
    signedOut();
    world.shop.google = { accounts: [ROBIN] };
    expect((await runG("cart")).result.google).toBe("account not listed");
    world.go("/"); await wait(500); world.local.delete("parked"); world.shop.presses = {};
    world.shop.google = { accounts: [SAM, SAM] };
    expect((await runG("cart")).result.google).toBe("more than one account");
    expect(Object.keys(presses()).filter((k) => k.includes("@"))).toEqual([]);
  });

  it("one try per job: the look after parking tries once more, then the sign-in page is left alone", async () => {
    signedOut();
    world.shop.google = { signedIn: "nobody@example.com" };
    expect((await runG("search", { query: "milk" })).result.google).toBe("password");
    expect(presses()["google button"]).toBe(1);
    expect(await drive(helper.runJob(withGoogle("setQty", { productId: "960050", qty: 1, query: "bread", name: BREAD }), null)).then((x) => x.value)).toMatchObject({ ok: false, error: "signed-out", why: "google: password" });
    expect(presses()["google button"]).toBe(2);
    expect((await runG("cart")).result.signedIn).toBe(false);
    expect(presses()["google button"]).toBe(2);
  });

  it("no account sent by Simmer: never tried, as before", async () => {
    signedOut();
    world.shop.google = {};
    expect((await run("search", { query: "milk" })).result.signedIn).toBe(false);
    expect(presses()).toEqual({});
  });

  it("never during checkout: getting ready signed out stops as before, nothing pressed on the sign-in page", async () => {
    world.shop.cartGone = true; world.shop.sessionGone = true; world.shop.signedIn = false;
    world.shop.google = {};
    const r = await runG("checkoutPrepare", { list: true });
    expect(r.result.stopped).not.toBe("ready");
    expect(presses()["google button"]).toBeUndefined();
  });
});
