// The helper's hands on safeway.com: Simmer queues small jobs (search, set a product's quantity in the cart, or read a
// page so Simmer can learn how Safeway builds it), and this does one at a time in a Safeway tab, using the page details
// each job carries (`PAGE` in Simmer's src/lib/safeway-helper.mjs). It only opens Safeway's pages and presses Safeway's
// own buttons, at a person's pace. It never signs in and never goes near checkout.
import { safewayPage } from "./page.js";

export const SAFEWAY = "https://www.safeway.com";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const store = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

export class WrongPasscode extends Error {}

/** A call to Simmer, at the address and with the passcode typed at setup (neither is in this public code). */
export async function simmer(method, body, path) {
  const [address, passcode] = [await store.get("address", ""), await store.get("passcode", "")];
  let res;
  try {
    res = await fetch(`${address}${path}`, {
      method, cache: "no-store",
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
  return (await chrome.tabs.create({ url: SAFEWAY, active: false, ...(inPanel && { windowId }) })).id;
}

function go(tabId, url) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, 30_000);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.update(tabId, { url });
  });
}

async function onPage(tabId, action, arg, page) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: safewayPage, args: [action, arg, page] });
    return r?.result ?? null;
  } catch { return null; }
}

/**
 * Opens a page and waits for its products (or Safeway saying there are none). Safeway's search page can say "No search
 * results" for a moment while it's still building (Oct 31: "canned pumpkin" came back empty, then full the next time,
 * with the page's header not yet there), so "none" counts only once it has stayed that way for `noResultsHold`.
 */
async function open(tabId, url, page, settings, tries = settings.resultsTries ?? 25) {
  await go(tabId, url);
  return waitForProducts(tabId, page, settings, tries);
}
async function waitForProducts(tabId, page, settings, tries = settings.resultsTries ?? 25) {
  let last = null, none = 0;
  for (let i = 0; i < tries; i++) {
    last = await onPage(tabId, "read", null, page);
    if (last && (last.products.length || last.signedIn === false)) return last;
    if (last?.noResults) { none ||= Date.now(); if (Date.now() - none >= (settings.noResultsHold ?? 4000)) return last; }
    else none = 0;
    await sleep(settings.resultsWait ?? 800);
  }
  return last;
}
const searchUrl = (query, page) => `${page.site}${page.searchPath}${encodeURIComponent(query)}`;
const search = (tabId, query, page, settings) => open(tabId, searchUrl(query, page), page, settings);
const sameWords = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();
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
  const r = await waitForProducts(tabId, page, settings, 3);
  return r && r.products.length ? r : search(tabId, query, page, settings);
}
/** Safeway's cart page, read with the page details for it (Simmer's `cartItems`, over the search page's). */
const cartPage = (page) => ({ ...page, ...(page.cartItems ?? {}), noResults: page.emptyCart || page.noResults });
const openCart = (tabId, page, settings) => open(tabId, `${page.site}${page.cartPath}`, cartPage(page), settings, settings.cartTries ?? 8);
/** The cart page as it is: read where it stands when the tab is already showing it (no reload), else opened. */
async function cartHere(tabId, page, settings) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || new URL(tab.url).pathname !== page.cartPath) return openCart(tabId, page, settings);
  const r = await onPage(tabId, "read", null, cartPage(page));
  return r && (r.products.length || r.noResults) ? r : openCart(tabId, page, settings);
}

/**
 * Does one job. Answers { ok: true, result } or { ok: false, error } with an error word Simmer turns into plain words
 * ("signed-out", "not-found", "not-loaded", "failed").
 */
export async function runJob(job, windowId) {
  const { page, settings = {}, args = {} } = job;
  if (!page?.site) return { ok: false, error: "failed" };
  const tabId = await safewayTab(windowId);
  if (job.kind === "search") {
    const r = await search(tabId, args.query, page, settings);
    if (!r) return { ok: false, error: "not-loaded" };
    return { ok: true, result: { products: r.products, signedIn: r.signedIn, noResults: r.noResults } };
  }
  if (job.kind === "cart") {
    const r = await cartHere(tabId, page, settings);
    if (!r) return { ok: false, error: "not-loaded" };
    return { ok: true, result: { products: r.products, signedIn: r.signedIn } };
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
      if (r.signedIn === false) return { ok: false, error: "signed-out" };
      if (!r.products.some((x) => x.id === args.productId)) continue;
      let x = await onPage(tabId, "setQty", { id: args.productId, qty: args.qty, wait: settings.stepWait ?? 10_000 }, p);
      if (!x || (!x.ok && x.why === "not-found")) continue;
      // The count may not have caught up on screen (Oct 31: + took on Safeway, the page still read 1): read the cart
      // once more, fresh, before saying it didn't take. Never press again from a search page after a press here.
      if (t.cart && !x.ok) {
        const again = (await openCart(tabId, page, settings))?.products.find((y) => y.id === args.productId);
        x = { ...x, qty: again?.inCart ? again.qty || 1 : 0, ok: (again?.inCart ? again.qty || 1 : 0) === args.qty };
      }
      // On a search page: look once more where it stands (no reload, no second press) before saying it didn't take.
      if (!t.cart && !x.ok) {
        await sleep(settings.resultsWait ?? 800);
        const again = (await onPage(tabId, "read", null, page))?.products.find((y) => y.id === args.productId);
        if (again) { const n = again.inCart ? again.qty || 1 : 0; x = { ...x, qty: n, ok: n === args.qty }; }
      }
      done = x;
      break;
    }
    if (!done) return { ok: false, error: loaded ? "not-found" : "not-loaded" };
    return { ok: true, result: { ok: done.ok, qty: done.qty, name: done.name, price: done.price, image: done.image } };
  }
  if (job.kind === "sample" || job.kind === "snapshot") {
    const onCart = args.on === "cart";
    if (onCart) await openCart(tabId, page, settings); else await search(tabId, args.query, page, settings);
    const text = await onPage(tabId, job.kind, { id: args.productId }, onCart ? cartPage(page) : page);
    return { ok: true, result: { text: text || "" } };
  }
  return { ok: false, error: "failed" };
}
