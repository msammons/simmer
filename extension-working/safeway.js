// The helper's hands on safeway.com: Simmer queues small jobs (search, set a product's quantity in the cart, or read a
// page so Simmer can learn how Safeway builds it), and this does one at a time in a Safeway tab, using the page details
// each job carries (`PAGE` in Simmer's src/lib/safeway-helper.mjs). It only opens Safeway's pages and presses Safeway's
// own buttons, at a person's pace. It never signs in (signed out, it opens Safeway's sign-in page for Sam and waits).
// Checkout (getting ready, test runs, placing) follows docs/CHECKOUT.md step by step; every wait watches the page or
// Chrome's own events, with one limit (Nov 14, and the last pauses gone Nov 19).
import { safewayPage } from "./page.js";

export const SAFEWAY = "https://www.safeway.com";
const SIGN_IN = `${SAFEWAY}/account/sign-in.html`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const store = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

export class WrongPasscode extends Error {}

/**
 * A call to Simmer, at the address and with the passcode typed at setup (neither is in this public code). `ms`: given up
 * after that long (Nov 19, review: "may I press?" could hang with no limit).
 */
export async function simmer(method, body, path, ms = 0) {
  const [address, passcode] = [await store.get("address", ""), await store.get("passcode", "")];
  let res;
  try {
    res = await fetch(`${address}${path}`, {
      method, cache: "no-store", ...(ms > 0 && { signal: AbortSignal.timeout(ms) }),
      headers: { "x-passcode": passcode, ...(body && { "content-type": "application/json" }) },
      ...(body && { body: JSON.stringify(body) }),
    });
  } catch { throw new Error("No connection. Try again in a minute."); }
  if (res.status === 401) throw new WrongPasscode("Wrong passcode.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That didn't load. Try again in a minute.");
  return data;
}

/**
 * A Safeway tab to work in: one in the panel's window when it's open there, else any, else a new one. It's never brought
 * to the front, and a new one opens behind (Sam brings it forward when he wants to, Oct 31).
 */
async function safewayTab(windowId) {
  const inPanel = windowId != null;
  const [here] = inPanel ? await chrome.tabs.query({ url: `${SAFEWAY}/*`, windowId }) : [];
  const [open] = here ? [here] : await chrome.tabs.query({ url: `${SAFEWAY}/*` });
  if (open) return open.id;
  // The panel's window may be gone (closed since; Nov 12, searches "failed" at once): then any window will do.
  try { return (await chrome.tabs.create({ url: SAFEWAY, active: false, ...(inPanel && { windowId }) })).id; }
  catch {
    if (inPanel) {
      await chrome.storage.session.remove("panelWindow").catch(() => {});
      try { return (await chrome.tabs.create({ url: SAFEWAY, active: false })).id; } catch { /* no window at all */ }
    }
    // Chrome running with every window closed (Nov 17: every job failed with "No current window"): open a window of
    // its own for Safeway, without taking the focus.
    const w = await chrome.windows.create({ url: SAFEWAY, focused: false });
    return w.tabs[0].id;
  }
}

/**
 * Opens `url` in the tab and waits for it to load. Only a load that started after asking counts (Nov 23: when Safeway was
 * already taking the tab to another page, that page finishing was taken as this one loaded, and the job read the wrong page).
 */
function go(tabId, url) {
  return new Promise((resolve) => {
    let started = false;
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(); };
    const on = (id, info) => { if (id !== tabId) return; if (info.status === "loading") started = true; else if (info.status === "complete" && started) done(); };
    const t = setTimeout(done, 30_000);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.update(tabId, { url });
  });
}

/**
 * Runs one action on the Safeway page, never for longer than its limit (Nov 21: a page that never answered held the
 * helper on one job for good, and every job behind it was given up). A watch gets its own time plus 10 s; anything
 * else 30 s. No answer in time is no answer (null), as when the page can't be reached.
 */
async function onPage(tabId, action, arg, page) {
  const limit = (action === "waitFor" ? Math.min(Number(arg?.ms) || 15000, 30000) : 20000) + 10000;
  let t;
  const late = new Promise((done) => { t = setTimeout(() => done(null), limit); });
  try {
    const run = chrome.scripting.executeScript({ target: { tabId }, func: safewayPage, args: [action, arg, page] }).then(([r]) => r?.result ?? null, () => null);
    return await Promise.race([run, late]);
  } finally { clearTimeout(t); }
}

/**
 * Opens a page and waits for its products (or Safeway saying there are none). Safeway's search page can say "No search
 * results" for a moment while it's still building (Oct 31: "canned pumpkin" came back empty, then full the next time,
 * with the page's header not yet there), so "none" counts only once it has stayed that way for `noResultsHold`.
 */
async function open(tabId, url, page, settings, tries = settings.resultsTries ?? 25) {
  // Safeway can take the tab somewhere else while its page builds (to its home page, say): then it's opened once more.
  // Reads only, so opening again changes nothing on Safeway. Sent to its home page or its sign-in page both times is
  // signed out (Nov 23: with the session over, Safeway sends its cart address to its home page every time, and that
  // page shows the name it remembers and no Sign In; 26.11.23.2 watched it for products, opened it again, and said
  // "didn't load").
  // Signed in with Pickup not chosen sends every page home too (Nov 23: after signing in again Safeway had forgotten
  // Pickup, and the helper said signed out while Sam was signed in): Safeway's own session note says which (`noPickup`).
  // Signed in with Pickup not chosen, the helper switches Safeway to Pickup at the household's store once (Sam, Nov 23:
  // "i want this process to be automated"), then opens the page again; still sent away, it's said as before.
  let switched = false;
  for (let i = 0; i < 2; i++) {
    await go(tabId, url);
    const r = await waitForProducts(tabId, url, page, settings, tries);
    const away = r ? r.away === true : await sentAway(tabId, url);
    if (away && i === 0) continue;
    if (away) {
      const s = r && "session" in r ? r.session : await onPage(tabId, "session", null, page);
      if (!switched && noPickup(s, page) && page.store) { switched = true; if (await choosePickup(tabId, page)) { i = -1; continue; } }
      return { ...(r ?? { cartCount: null, tiles: {}, noResults: false, loading: false }), products: [], signedIn: false, away: true, ...(noPickup(s, page) && { noPickup: true }) };
    }
    if (r || !(await movedOff(tabId, url))) return r;
  }
  return null;
}
/**
 * Switches Safeway to Pickup at the household's store (page.js "choosePickup"; docs/CHECKOUT.md), on whatever Safeway
 * page the tab is on, and says whether Safeway's note now says pickup. One try; a page reload after Safeway's Select ends
 * the script, so the note is read again where the tab lands.
 */
async function choosePickup(tabId, page) {
  // Safeway's home page carries the box's button (the cart and checkout pages are another app and may not).
  let at = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
  if (!at.startsWith(`${page.site}/`) || new URL(at).pathname !== "/") { await go(tabId, `${page.site}/`); at = `${page.site}/`; }
  const r = await onPage(tabId, "choosePickup", { store: page.store }, page);
  if (r && r.done === false) return false;
  // Safeway's note can already say pickup (the box closed in place); otherwise the page is reloading: read it once loaded.
  let s = r?.mode !== undefined && r.closed ? { mode: r.mode } : null;
  if (!s || !same(s.mode, page.session?.pickup)) { await loaded(tabId); s = await onPage(tabId, "session", null, page); }
  return Boolean(s && page.session && same(s.mode, page.session.pickup));
}
/** Waits until the tab has finished loading (Chrome's own event; at most 10 s). */
function loaded(tabId) {
  return new Promise((resolve) => {
    let t = null;
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    chrome.tabs.onUpdated.addListener(on);
    t = setTimeout(done, 10_000);
    chrome.tabs.get(tabId).then((tab) => { if (tab?.status === "complete") done(); }, done);
  });
}

/** Whether the tab is now on another page than `url` (by its address without the part after #). */
async function movedOff(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return false;
  const [a, b] = [new URL(tab.url), new URL(url)];
  return a.origin + a.pathname + a.search !== b.origin + b.pathname + b.search;
}
/**
 * Safeway's session note (page.js `session()`, `PAGE.session`) says signed in, with Pickup not chosen: a signed-in
 * customer whose choice isn't pickup. Missing, unreadable, or any other user: not this (judged as before, signed out).
 */
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
const noPickup = (s, page) => Boolean(s && page.session) && same(s.user, page.session.customer) && !same(s.mode, page.session.pickup);
/** The note says Safeway is set to something other than pickup (delivery): a choice written there that isn't pickup. */
const onDelivery = (s, page) => Boolean(s && page.session && s.mode) && !same(s.mode, page.session.pickup);
/**
 * Safeway's checkout page set for delivery, read from its words when the note doesn't say (Nov 23): no pickup anywhere
 * on it, and delivery named. Reads only.
 */
const deliveryPage = (text) => !/\bpick\s*-?up\b/i.test(text ?? "") && /\bdeliver(?:y|ed|ing)?\b/i.test(text ?? "");
/** Safeway's home page and its sign-in page: where it sends a page it won't show signed out. */
const AWAY = ["/", "/home.html", new URL(SIGN_IN).pathname];
/** Whether the tab is now on Safeway's home page or its sign-in page instead of `url`. */
async function sentAway(tabId, url) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url?.startsWith(`${SAFEWAY}/`)) return false;
  const at = new URL(tab.url).pathname;
  return at !== new URL(url).pathname && AWAY.includes(at);
}
/**
 * Watches the page for its products (Nov 19: it read the page again every 800 ms), up to `tries` × `resultsWait`. On the
 * cart page only what's in the cart counts: an empty cart lists past purchases, each with Add, under "Your shopping cart
 * is empty" (Nov 16: 40 of them kept Simmer's copy of a cart Safeway no longer had). `held`: it said "none" for the
 * whole hold, so it means it (the cart page's "cart is empty" counts on this).
 *
 * What's answered is the page as the watch read it when it decided (Nov 23): its products, "none" held, or Sign In held
 * (signed out). A page that never got there (it never finished building, or kept changing pages) is null, "didn't load",
 * never an empty search, an empty cart or a sign-out read in passing.
 */
async function waitForProducts(tabId, url, page, settings, tries = settings.resultsTries ?? 25) {
  // The cart page watched 10 s at least (Nov 19, review: placing's cart read could give up early and stop "cart changed").
  const ms = Math.max(tries * (settings.resultsWait ?? 800), page.onlyInCart ? 10_000 : 0);
  const outHold = settings.signedOutHold ?? 8000;
  const watch = () => onPage(tabId, "waitFor", { until: "products", onlyInCart: Boolean(page.onlyInCart), hold: settings.noResultsHold ?? 4000, outHold, path: new URL(url).pathname, away: AWAY, ms: Math.max(ms, outHold + 2000) }, page);
  // No answer: the page moved on under the watch (Nov 19, review), so it's watched once more on the page it moved to.
  const w = (await watch()) ?? (await watch());
  if (!w?.page) return null;
  // On Safeway's home page or sign-in page instead: none of its products are the page's (open() judges it).
  if (w.away) return { ...w.page, products: [], away: true };
  return w.held ? { ...w.page, held: true } : w.page;
}
const searchUrl = (query, page) => `${page.site}${page.searchPath}${encodeURIComponent(query)}`;
const search = (tabId, query, page, settings) => open(tabId, searchUrl(query, page), page, settings);
const sameWords = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();
// not-checkout:start (searching: never used by checkout; changes here need no test run, docs/CHECKOUT.md)
/**
 * A search as it is: read where it stands when the tab is already showing that search (an Add from Find, right after
 * Find's search; no reload, Oct 31), else opened.
 */
async function searchHere(tabId, query, page, settings) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const want = new URL(searchUrl(query, page));
  const at = tab?.url ? new URL(tab.url) : null;
  const key = [...want.searchParams.keys()][0] ?? "q";
  if (!at || at.origin !== want.origin || at.pathname !== want.pathname || !sameWords(at.searchParams.get(key), query)) return search(tabId, query, page, settings);
  const r = await waitForProducts(tabId, want.href, page, settings, 3);
  return r && r.products.length ? r : search(tabId, query, page, settings);
}
// not-checkout:end
/** Safeway's cart page, read with the page details for it (Simmer's `cartItems`, over the search page's). Placing reads
 * the cart with it, so it counts for checkout. */
const cartPage = (page) => ({ ...page, ...(page.cartItems ?? {}), noResults: page.emptyCart || page.noResults, onlyInCart: true });
const openCart = (tabId, page, settings) => open(tabId, `${page.site}${page.cartPath}`, cartPage(page), settings, settings.cartTries ?? 8);
/** The cart page as it is: read where it stands when the tab is already showing it (no reload), else opened. */
async function cartHere(tabId, page, settings) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || new URL(tab.url).pathname !== page.cartPath) return openCart(tabId, page, settings);
  // Watched where it stands, without a reload, long enough that an empty cart is Safeway saying so (not a page still building).
  const r = await waitForProducts(tabId, tab.url, cartPage(page), settings, settings.cartTries ?? 8);
  return r && (r.products.some((p) => p.inCart) || r.held) ? r : openCart(tabId, page, settings);
}

// not-checkout:start (the Purchases page, read after an empty cart: never used by checkout)
/**
 * Safeway's Purchases page, Online tab (1.3): opened, the tab pressed once if another is showing, then watched until an
 * order with a date is listed, or "no orders" has held for a few seconds (as with "no results", it may show for a
 * moment while the page builds). Answers what page.js read, or null when it never loaded.
 */
async function readOrders(tabId, page, settings) {
  await go(tabId, `${page.site}${page.orders.path}`);
  return onPage(tabId, "orders", { wait: 15 * (settings.resultsWait ?? 800), hold: settings.noResultsHold ?? 4000 }, page);
}

// not-checkout:end
/**
 * Does one job. Answers { ok: true, result } or { ok: false, error } with an error word Simmer turns into plain words
 * ("signed-out", "not-found", "not-loaded", "failed").
 */
export async function runJob(job, windowId) {
  if (!job.page?.site) return { ok: false, error: "failed" };
  const tabId = await safewayTab(windowId);
  // Signed out (Sam, Nov 17: "why does the app not open the page?"): the Safeway tab waits on Safeway's sign-in page for
  // him, and jobs leave it alone there, so nothing reloads it while he types. Signing in takes Safeway off that page,
  // and the jobs carry on. It only opens the page; it never types or presses anything on it.
  // A sign-out can be wrong (Nov 23: a read said signed out, the helper parked the tab here, Safeway itself sent the tab
  // on to its home page, signed in, and a job in between said signed out without looking). So the first search, cart
  // read or Add after the helper parks the tab looks at Safeway once more, on its own page, as it always does, unless
  // Sam is typing on the sign-in page. Signed out again, the tab goes back here and stays until he signs in.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const looks = job.kind === "search" || job.kind === "cart" || job.kind === "setQty";
  const parked = await store.get("parked", "");
  let again = false;
  if (tab?.url?.startsWith(SIGN_IN)) {
    again = looks && parked === "fresh" && !(await typing(tabId));
    if (!again) return job.kind === "search" || job.kind === "cart" ? { ok: true, result: { products: [], signedIn: false, ...(job.kind === "cart" && { empty: false }) } } : { ok: false, error: "signed-out" };
    await store.set("parked", "looked");
  } else if (parked) await store.set("parked", "");
  const r = await doJob(job, tabId);
  // Signed in with Pickup not chosen isn't signed out: the tab stays where Safeway put it, for Sam to choose Pickup.
  const out = r.error !== "no-pickup" && r.result?.noPickup !== true && (r.error === "signed-out" || r.result?.signedIn === false);
  if (out && looks) { await go(tabId, SIGN_IN); await store.set("parked", again ? "looked" : "fresh"); }
  return r;
}

/** Whether Sam is typing on the page: a field has the focus in the window he's using. Reads only. */
async function typing(tabId) {
  let t;
  const late = new Promise((done) => { t = setTimeout(() => done(true), 10_000); }); // no answer: left alone, as if typing
  try {
    const run = chrome.scripting.executeScript({ target: { tabId }, func: () => document.hasFocus() && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") })
      .then(([r]) => r?.result === true, () => false);
    return await Promise.race([run, late]);
  } finally { clearTimeout(t); }
}

async function doJob(job, tabId) {
  const { settings = {}, args = {} } = job;
  // The household's pickup store (Simmer sends the one checkout learned), for switching Safeway to Pickup there. Placing
  // never switches (docs/CHECKOUT.md), so its page has no store.
  const page = job.kind === "checkoutPlace" ? job.page : { ...job.page, store: typeof job.store === "string" ? job.store : "" };
  if (job.kind === "search") {
    const r = await search(tabId, args.query, page, settings);
    if (!r) return { ok: false, error: "not-loaded" };
    return { ok: true, result: { products: r.products, signedIn: r.signedIn, noResults: r.noResults, ...(r.noPickup && { noPickup: true }) } };
  }
  if (job.kind === "cart") {
    const r = await cartHere(tabId, page, settings);
    if (!r) return { ok: false, error: "not-loaded" };
    const empty = Boolean(r.held && r.noResults && !r.products.some((p) => p.inCart));
    // An empty cart may mean the order went through: Safeway's Purchases page (Online) says, and Simmer decides (1.3).
    // Only asked for when Simmer's copy of the cart has something in it (`args.orders`).
    const orders = empty && args.orders === true && r.signedIn !== false && page.orders?.path ? await readOrders(tabId, page, settings) : null;
    // Back to the cart page, which is what the Safeway tab shows beside Simmer's Lists.
    if (orders) await go(tabId, `${page.site}${page.cartPath}`);
    return { ok: true, result: { products: r.products, signedIn: r.signedIn, empty, ...(orders && { orders }), ...(r.noPickup && { noPickup: true }) } };
  }
  if (job.kind === "setQty") {
    // Where the product can be changed: Safeway's cart page first when asked (from Cart, where it's listed), then
    // searches for it: Simmer's words, other words, its name (unless Safeway shortened it).
    const tries = [];
    if (args.on === "cart") tries.push({ cart: true });
    for (const q of [args.query, args.alt, /\.{3}|…/.test(args.name ?? "") ? "" : args.name]) if (q && !tries.some((t) => t.q === q)) tries.push({ q });
    let loaded = false, done = null;
    for (const t of tries) {
      const p = t.cart ? cartPage(page) : page;
      // On the cart page, or that search, already: change it where it stands (no reload).
      const r = t.cart ? await cartHere(tabId, page, settings) : await searchHere(tabId, t.q, page, settings);
      if (!r) continue;
      loaded = true;
      if (r.noPickup) return { ok: false, error: "no-pickup" };
      if (r.signedIn === false) return { ok: false, error: "signed-out" };
      // On the page: read, or a tile whose buttons Safeway builds once it's scrolled to (page.js scrolls to it).
      if (!r.products.some((x) => x.id === args.productId) && !(args.productId in (r.tiles ?? {}))) continue;
      let x = await onPage(tabId, "setQty", { id: args.productId, qty: args.qty, wait: settings.stepWait ?? 10_000 }, p);
      if (!x || (!x.ok && x.why === "not-found")) continue;
      // Safeway said its session expired instead of taking the Add (Nov 23): signed out, said so, nothing pressed again.
      if (!x.ok && x.why === "signed-out") return { ok: false, error: "signed-out" };
      // The count may not have caught up on screen (Oct 31: + took on Safeway, the page still read 1): read the cart
      // once more, fresh, before saying it didn't take. Never press again from a search page after a press here.
      if (t.cart && !x.ok) {
        const again = (await openCart(tabId, page, settings))?.products.find((y) => y.id === args.productId);
        x = { ...x, qty: again?.inCart ? again.qty || 1 : 0, ok: (again?.inCart ? again.qty || 1 : 0) === args.qty };
      }
      // On a search page: watch it a moment more where it stands (no reload, no second press) before saying it didn't take.
      if (!t.cart && !x.ok) {
        await onPage(tabId, "waitFor", { until: "qty", id: args.productId, qty: args.qty, ms: 2000 }, p);
        const again = (await onPage(tabId, "read", null, page))?.products.find((y) => y.id === args.productId);
        if (again) { const n = again.inCart ? again.qty || 1 : 0; x = { ...x, qty: n, ok: n === args.qty }; }
      }
      done = x;
      break;
    }
    if (!done) return { ok: false, error: loaded ? "not-found" : "not-loaded" };
    // Why it didn't take, when it didn't (Nov 23: the phone heard only 0): Safeway's own words when it said something.
    const why = !done.ok && done.why ? { why: String(done.why), ...(done.said && { said: String(done.said).slice(0, 200) }) } : {};
    return { ok: true, result: { ok: done.ok, qty: done.qty, name: done.name, price: done.price, image: done.image, ...why } };
  }
  if (job.kind === "checkoutLook") return { ok: true, result: await checkoutLook(tabId, page) };
  // Getting ready (Nov 14): first the free times to pick from (`list`), then the one picked (`windowId`).
  if (job.kind === "checkoutPrepare") {
    const id = typeof args.windowId === "string" ? args.windowId : "";
    const day = typeof args.day === "string" ? args.day : "";
    const own = typeof args.bagsOwn === "boolean" ? args.bagsOwn : null;
    return { ok: true, result: id ? await checkoutReady(tabId, page, id, null, own) : await checkoutReady(tabId, page, null, { day }) };
  }
  // Placing an approved order (phase 3, Nov 14): run once, never again (Simmer never hands this job out twice).
  if (job.kind === "checkoutPlace") {
    const id = typeof args.windowId === "string" ? args.windowId : "";
    if (!id || !args.expect) return { ok: true, result: { stopped: "no window", pressed: false } };
    // The deadline held to the earlier of the approval's own and the time Simmer said was left at hand-off, counted on
    // this computer's clock from when the job arrived (Nov 19: the Mac's clock alone could run behind).
    const left = Number(args.expect.left), got = Number(job.got) || Date.now();
    const deadline = Number.isFinite(left) ? Math.min(Number(args.expect.deadline) || 0, got + left) : Number(args.expect.deadline) || 0;
    return { ok: true, result: await placeOrder(tabId, page, settings, id, { ...args.expect, deadline }, job.id) };
  }
  if (job.kind === "checkoutDry") {
    const id = typeof job.args?.windowId === "string" ? job.args.windowId : "";
    const own = typeof job.args?.bagsOwn === "boolean" ? job.args.bagsOwn : null;
    return { ok: true, result: id ? await checkoutReady(tabId, page, id, null, own) : { stopped: "no window", chosen: null, final: null } };
  }
  if (job.kind === "sample" || job.kind === "snapshot") {
    const onCart = args.on === "cart";
    if (onCart) await openCart(tabId, page, settings); else await search(tabId, args.query, page, settings);
    const text = await onPage(tabId, job.kind, { id: args.productId }, onCart ? cartPage(page) : page);
    return { ok: true, result: { text: text || "" } };
  }
  return { ok: false, error: "failed" };
}

/**
 * Getting ready on Safeway, and test runs (Nov 13, docs/CHECKOUT.md): the cart page's Checkout, the suggestions page's
 * Continue, Order info's Continue when it's there, then a pickup window, and the final page read. With no window named
 * (the listing, `list`) it reads each day's free times and chooses none; with one named (getting ready with the time
 * picked, and test runs) it takes exactly that window or stops. Each step waits for what it needs to see, never a pause. It presses nothing else: there is no code here that presses
 * Place Order, and the final page is only read. Simmer checks what it read (src/lib/checkout.ts).
 */
async function checkoutReady(tabId, page, windowId, list = null, bagsOwn = null) {
  const checkoutPath = page.cartPath.replace(/cart$/, "checkout");
  const stop = (stopped) => ({ stopped, chosen: null, final: null });
  // Each step waits for what it needs to see on Safeway's page (Sam, Nov 14: no guessed pauses), with one limit each.
  const until = (what, extra = {}, ms = 15000) => onPage(tabId, "waitFor", { until: what, ms, ...extra }, page);
  const look = () => onPage(tabId, "look", null, page);
  const shows = { [page.cartPath]: "cart", [`${page.cartPath}/dnf`]: "suggestions", [checkoutPath]: "checkout" };
  const settle = async (url) => { const w = shows[new URL(url).pathname]; if (w) await until(w); return look(); };
  // Already on Safeway's checkout page (the last step left it there): reload it where it is, fresh, and carry on,
  // instead of starting over from the cart (Sam, Nov 16: "like it got impatient and started over"). Placing reads the
  // cart page first on purpose, so it always comes through the cart.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const onCheckout = Boolean(tab?.url) && tab.url.startsWith(`${page.site}/`) && new URL(tab.url).pathname === checkoutPath;
  const start = onCheckout ? tab.url : `${page.site}${page.cartPath}`;
  await go(tabId, start);
  let here = await settle(start);
  // Read as Safeway was sending the tab elsewhere (Nov 23: home, signed in with Pickup not chosen): looked at once more
  // where it lands (Chrome's events, with a limit), reading only.
  if (!here) { await urlChange(tabId, start, 5000); here = await look(); }
  if (!here) return stop("page didn't load");
  if (/sign back in|sign in to continue/i.test(here.text)) return stop("signed out");
  // Simmer orders pickup only (docs/CHECKOUT.md). Safeway's session note, read before any press (Nov 23): signed in with
  // Pickup not chosen (Safeway sent the cart home), or set to delivery: stop, nothing pressed, and the mode is never
  // The checkout page's own words say delivery too, below. Getting ready and test runs switch Safeway to Pickup at the
  // household's store first, once (Sam, Nov 23: "i want this process to be automated"), and start again from the cart;
  // placing never switches (its page carries no store), so placing stops here as before.
  let sentHome = AWAY.includes(new URL(here.url).pathname) && new URL(here.url).pathname !== new URL(start).pathname;
  if (page.store && ((sentHome && noPickup(here.session, page)) || onDelivery(here.session, page)) && await choosePickup(tabId, page)) {
    const cart = `${page.site}${page.cartPath}`;
    await go(tabId, cart);
    here = await settle(cart);
    if (!here) return stop("page didn't load");
    sentHome = AWAY.includes(new URL(here.url).pathname);
  }
  if (sentHome && noPickup(here.session, page)) return stop("no pickup chosen");
  if (onDelivery(here.session, page)) return stop("delivery");
  if (new URL(here.url).pathname === checkoutPath && deliveryPage(here.text)) return stop("delivery");
  const steps = [
    { path: page.cartPath, words: ["checkout", "safeway"] },
    { path: `${page.cartPath}/dnf`, words: ["continue", "to", "checkout", "safeway"] },
    { path: checkoutPath, words: ["continue"], samePage: true, optional: true },
  ];
  for (const step of steps) {
    if (new URL(here.url).pathname !== step.path) continue;
    const p = await onPage(tabId, "pressCheckout", step, page);
    if (!p?.pressed && step.optional) break;
    if (!p?.pressed) return stop("no button to press");
    if (step.samePage) { await until("times"); here = await look(); }
    else {
      const to = await urlChange(tabId, here.url);
      if (!to) return stop("page didn't load");
      here = await settle(to);
    }
    if (!here) return stop("page didn't load");
    // On the checkout page and set for delivery: stopped before Order info's Continue or any pickup step.
    if (new URL(here.url).pathname === checkoutPath && (onDelivery(here.session, page) || deliveryPage(here.text))) return stop("delivery");
  }
  if (new URL(here.url).pathname !== checkoutPath) return stop("not the checkout page");
  if (onDelivery(here.session, page) || deliveryPage(here.text)) return stop("delivery");
  // Free times, Regular or Express (Nov 14), and since Nov 16 Flash too, shown with its price (Sam: "offer flash but
  // show it"). Other paid times aren't offered.
  const free = (w) => !/FLASH/i.test(`${w.id} ${w.words}`) && /\bprice Free\b/i.test(w.words) && !w.off;
  const offered = (w) => !w.off && (free(w) || (/FLASH/i.test(`${w.id} ${w.words}`) && /\bprice \$[\d,]+\.\d\d\b/i.test(w.words)));
  const read = () => onPage(tabId, "readWindows", null, page);
  /** All of the day showing's times: Safeway shows five, and "More times" shows the rest (Nov 14), pressed once. */
  const allTimes = async (r) => {
    if (!r) return r;
    const more = await onPage(tabId, "pressMoreTimes", { path: checkoutPath }, page);
    if (!more?.pressed) return r;
    await until("more", { count: r.windows.length }, 8000);
    return (await read()) ?? r;
  };
  /** A day's tile pressed, then its own times waited for (their ids end in its date), all of them. */
  const openDay = async (label, dd) => {
    await onPage(tabId, "pressDay", { path: checkoutPath, label }, page);
    await until("day", { label, dd }, 8000);
    return allTimes(await read());
  };
  const ddOf = (label) => String(Number(label.match(/[A-Z][a-z]{2}, (\d{1,2}) /)?.[1] ?? 0)).padStart(2, "0");
  await until("times");
  let seen = await read();
  // A time chosen earlier (the last Get ready) folds the pickup step into one line: reopen it once (Sam, Nov 14), then read.
  if (seen && !seen.days.length && !seen.windows.length) {
    // No pickup times and no pickup on the page: set for delivery (Nov 23: this said "pickup times closed").
    const now = await look();
    if (now && (onDelivery(now.session, page) || deliveryPage(now.text))) return stop("delivery");
    const opened = await onPage(tabId, "pressPickupEdit", { path: checkoutPath }, page);
    if (!opened?.pressed) return { ...stop("pickup times closed"), detail: { found: opened?.found ?? null, why: opened?.why ?? "" } };
    await until("timesOpen");
    seen = await read();
  }
  if (!seen) return stop("no pickup times");
  // To pick from, as on Safeway's site (Sam, Nov 14): the days, and one day's free times (the day Safeway shows, or the
  // one asked for, its tile pressed). Nothing is chosen.
  if (list) {
    const days = seen.days.slice(0, 14).map((d) => ({ label: d.label }));
    const tile = list.day ? seen.days.find((d) => d.label === list.day) : seen.days.find((d) => d.active);
    if (list.day && !tile) return stop("pickup day gone");
    const r = tile && !tile.active ? await openDay(tile.label, ddOf(tile.label)) : await allTimes(seen);
    const dd = tile ? ddOf(tile.label) : "";
    const onDay = (w) => !dd || (w.id.match(/(\d{4})-(\d{2})-(\d{2})/)?.[3] ?? "") === dd;
    const times = (r?.windows ?? []).filter((w) => offered(w) && onDay(w)).map((w) => ({ id: w.id, words: w.words }));
    return { stopped: "times", days, day: tile?.label ?? "", times, chosen: null, final: null };
  }
  // The time picked: only exactly that one.
  if (!windowId) return stop("no window");
  let target = seen.windows.find((w) => w.id === windowId) ?? null;
  // Past the first five that day: "More times" first.
  if (!target && seen.windows.some((w) => w.id.endsWith(windowId.slice(-10)))) { seen = await allTimes(seen); target = seen?.windows.find((w) => w.id === windowId) ?? null; }
  if (!target) {
    const date = windowId.match(/(\d{4})-(\d{2})-(\d{2})/);
    const mon = date && ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date[2]) - 1];
    const tile = date && seen.days.find((d) => d.label.includes(` ${mon}, ${Number(date[3])} `));
    if (!tile) return stop("pickup day gone");
    seen = tile.active ? seen : await openDay(tile.label, date[3]);
    target = seen?.windows.find((w) => w.id === windowId) ?? null;
  }
  if (!target || !offered(target)) return stop("pickup time gone");
  // A paid time (Flash) is chosen only when it's the one Simmer asked for, with its price shown to her.
  const chose = await onPage(tabId, "chooseWindow", { path: checkoutPath, id: target.id, paid: !free(target) }, page);
  if (!chose?.pressed) return stop("couldn't choose the pickup time");
  // The pickup step's own Continue (exactly "Continue", the only one), which Safeway turns on once a time is chosen.
  await until("continueOn", {}, 8000);
  const on = await onPage(tabId, "pressCheckout", { path: checkoutPath, words: ["continue"] }, page);
  if (on?.pressed) await until("picked");
  // The bags she picked for this order (Nov 16): the one switch pressed once if it isn't already that way, then read
  // back until Safeway shows it (its fee, if any, is in the total read next).
  if (typeof bagsOwn === "boolean") {
    const set = await onPage(tabId, "setBags", { path: checkoutPath, own: bagsOwn }, page);
    if (!set?.ok && !set?.pressed) return stop("couldn't set the bags");
    // Read back by watching the switch (Nov 19: it was read every 250 ms), 5 s at most.
    if (!set.ok && !(await until("bags", { own: bagsOwn }, 5000))?.ok) return stop("couldn't set the bags");
    // Pressed: Safeway may add or take off a bag fee. The total is read only once it has held the same for 2 s
    // (watched, counted again from each change), 10 s at most.
    if (set.pressed && !(await until("settled", {}, 10000))?.ok) return stop("total didn't settle");
  }
  const final = await look();
  if (!final) return stop("page didn't load");
  const bagsNow = (await onPage(tabId, "bagsState", null, page))?.own ?? null;
  return { stopped: "ready", chosen: { id: target.id, words: target.words }, final: { url: final.url, text: final.text, buttons: final.buttons }, bagsOwn: bagsNow };
}

/**
 * Places the order Face ID approved (docs/CHECKOUT.md phase 3): Safeway's cart read first, on its own page, and it must
 * be exactly the products and counts approved; then the same way as a test run to the final page, with exactly the
 * approved pickup time; then the one Place Order press, which page.js makes only when the page says exactly what was
 * approved. Pressed at most once: nothing here loops or tries again. Then the page it lands on is read for Simmer.
 */
async function placeOrder(tabId, page, settings, windowId, expect, jobId) {
  const stop = (stopped, extra = {}) => ({ stopped, pressed: false, chosen: null, final: null, ...extra });
  const cart = await openCart(tabId, page, settings);
  if (cart?.noPickup) return stop("no pickup chosen");
  if (!cart || cart.signedIn === false) return stop(cart ? "signed out" : "page didn't load");
  const key = cart.products.filter((p) => p.inCart).map((p) => `${p.id}x${p.qty || 1}`).sort().join(",");
  if (key !== expect.cart) return stop("cart changed");
  // The bags were set when getting ready; placing never presses the switch, and Place Order checks it's as approved.
  const r = await checkoutReady(tabId, page, windowId);
  if (r.stopped !== "ready") return { ...r, pressed: false };
  const checkoutPath = page.cartPath.replace(/cart$/, "checkout");
  const from = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
  // Safeway turns Place Order on a moment after the pickup time is set (Nov 15, Robin's run: "place order turned
  // off" twice). Wait for it, watching the page, then check everything and press.
  const turnedOn = await onPage(tabId, "waitFor", { until: "placeOn", ms: 15000 }, page);
  if (!turnedOn?.ok) return { ...r, stopped: "not pressed", pressed: false, why: "place order stayed off" };
  // "May I press?" (Nov 19): Simmer says yes only to a placing job still in hand and within its approval, by its own
  // clock, and from then on never calls it failed. No yes (or no answer): nothing is pressed.
  const may = await simmer("POST", { op: "press", id: jobId }, "/api/safeway/jobs", 10_000).catch(() => null);
  if (may?.ok !== true) return { ...r, stopped: "not pressed", pressed: false, why: "simmer said no" };
  const press = await onPage(tabId, "placeOrder", { path: checkoutPath, expect }, page);
  if (press && !press.pressed) return { ...r, stopped: "not pressed", pressed: false, why: String(press.why ?? "") };
  // Pressed, or no answer once Simmer said yes (Nov 19, review: the click may have started Safeway's next page, which
  // ends the script before it answers), reported "unknown", never "not pressed". Whatever happens next, it's never
  // pressed again: read where Safeway lands, for the order number.
  const to = await urlChange(tabId, from, 30_000);
  // Safeway's confirmation page fills in a few seconds after it opens (Nov 18: read at once, it was only the header, and
  // Simmer couldn't say the order went through). Watched, not polled: read as soon as its thank-you words show.
  await onPage(tabId, "waitFor", { until: "confirmed", ms: 15000 }, page);
  const after = await onPage(tabId, "look", null, page);
  // `landed`: the address Chrome says the tab moved to after the press, so Simmer can tell the page it read is that one.
  return { stopped: to ? "placed" : "pressed", pressed: press ? true : "unknown", landed: to ?? "", chosen: r.chosen, final: r.final, after: after ? { url: after.url, text: after.text.slice(0, 4000) } : null };
}

/**
 * Waits for the tab to move off `from` and finish loading (events from Chrome, with a limit): the new address, or null.
 * Safeway moves between its cart and checkout both by loading a page and by changing the address in place.
 */
function urlChange(tabId, from, ms = 20_000) {
  return new Promise((resolve) => {
    let t = null;
    const done = (url) => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(url); };
    const moved = (tab) => tab?.url && tab.url !== from && tab.status === "complete";
    const on = (id, info, tab) => { if (id === tabId && moved(tab)) done(tab.url); };
    chrome.tabs.onUpdated.addListener(on);
    t = setTimeout(() => done(null), ms);
    chrome.tabs.get(tabId).then((tab) => { if (moved(tab)) done(tab.url); }).catch(() => {});
  });
}

/**
 * A look at Safeway's checkout (Nov 12, docs/CHECKOUT.md phase 1): the cart page's one Checkout button pressed (Sam:
 * "Checkout only"), the suggestions page's Continue when Safeway shows it ("Continue only"), then the checkout page's
 * Order info Continue and one pickup day, and what each page shows read; nothing further (never a time, never Place
 * Order) is pressed, nothing typed or picked, and no link followed. Each step watches the page or Chrome's events, with
 * one limit (Nov 19: it paused guessed seconds, and a branch for a Checkout link Safeway never had is gone).
 */
async function checkoutLook(tabId, page) {
  const checkoutPath = page.cartPath.replace(/cart$/, "checkout");
  const until = (what, extra = {}, ms = 15000) => onPage(tabId, "waitFor", { until: what, ms, ...extra }, page);
  const shows = { [page.cartPath]: "cart", [`${page.cartPath}/dnf`]: "suggestions", [checkoutPath]: "checkout" };
  const pages = [], pressed = [];
  const read = async () => { const r = await onPage(tabId, "look", null, page); if (r) pages.push(r); return r; };
  await go(tabId, `${page.site}${page.cartPath}`);
  await until("cart");
  let here = await read();
  if (!here) return { pages, pressed, stopped: "page didn't load" };
  const steps = [
    { path: page.cartPath, words: ["checkout", "safeway"] },
    { path: `${page.cartPath}/dnf`, words: ["continue", "to", "checkout", "safeway"] },
    // Then the checkout page's Order info Continue (Sam, Nov 12), which opens Pickup date & time on the same page. Only a
    // button that says exactly "Continue"; Place Order is never among the words.
    { path: checkoutPath, words: ["continue"], samePage: true, optional: true },
  ];
  for (const step of steps) {
    if (new URL(here.url).pathname !== step.path) continue;
    const p = await onPage(tabId, "pressCheckout", step, page);
    pressed.push(p);
    if (!p?.pressed && step.optional) break; // Order info already done: its Continue isn't there to press
    if (!p?.pressed) return { pages, pressed, stopped: "no button to press" };
    if (step.samePage) await until("times");
    else {
      const to = await urlChange(tabId, here.url);
      if (!to) break;
      const w = shows[new URL(to).pathname];
      if (w) await until(w);
    }
    here = await read();
    if (!here) break;
  }
  // Then one pickup day (Sam, Nov 12: "a day only"), to see its windows; never a time.
  if (here && new URL(here.url).pathname === checkoutPath) {
    const d = await onPage(tabId, "pressDay", { path: checkoutPath }, page);
    pressed.push(d);
    if (d?.pressed) {
      const dd = String(Number(d.label.match(/[A-Z][a-z]{2}, (\d{1,2}) /)?.[1] ?? 0)).padStart(2, "0");
      await until("day", { label: d.label, dd }, 8000);
      await read();
    }
  }
  return { pages, pressed, stopped: "looked" };
}
