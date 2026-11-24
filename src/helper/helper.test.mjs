// The helper's decisions, fast (Nov 23, Sam: "be efficient with tests. And intelligent."): the helper's own files run
// unchanged against a stand-in Chrome and Safeway (world.mjs) on a fake clock, so the cases that wait out its real limits
// (an 8 s signed-out hold, 20 s and 60 s page limits, a body gone 3 s, slow loads) take milliseconds. What only a real
// browser can show (Chrome's own events, the panel, Simmer's screens) is in scripts/extension-test.mjs; whether Safeway's
// real pages still read right is scripts/real-pages-test.mjs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BREAD, makeWorld, PAGE, SAFEWAY, SETTINGS } from "./world.mjs";
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
