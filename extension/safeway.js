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

/** A Safeway tab to work in: in the panel's window when it's open there (and then in front), else any, else a new one behind. */
async function safewayTab(windowId) {
  const front = windowId != null;
  const [open] = await chrome.tabs.query(front ? { url: `${SAFEWAY}/*`, windowId } : { url: `${SAFEWAY}/*` });
  if (open) { if (front && !open.active) await chrome.tabs.update(open.id, { active: true }); return open.id; }
  return (await chrome.tabs.create({ url: SAFEWAY, active: front, ...(front && { windowId }) })).id;
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

/** Opens a search and waits for its results (or Safeway saying there are none). */
async function search(tabId, query, page, settings) {
  await go(tabId, `${page.site}${page.searchPath}${encodeURIComponent(query)}`);
  let last = null;
  for (let i = 0; i < (settings.resultsTries ?? 25); i++) {
    last = await onPage(tabId, "read", null, page);
    if (last && (last.products.length || last.noResults)) return last;
    await sleep(settings.resultsWait ?? 800);
  }
  return last;
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
  if (job.kind === "setQty") {
    let r = await search(tabId, args.query || args.name, page, settings);
    if (!r) return { ok: false, error: "not-loaded" };
    if (r.signedIn === false) return { ok: false, error: "signed-out" };
    if (!r.products.some((p) => p.id === args.productId) && args.name && args.name !== args.query) r = await search(tabId, args.name, page, settings);
    if (!r?.products.some((p) => p.id === args.productId)) return { ok: false, error: "not-found" };
    const x = await onPage(tabId, "setQty", { id: args.productId, qty: args.qty, wait: settings.stepWait ?? 10_000 }, page);
    if (!x) return { ok: false, error: "failed" };
    if (!x.ok && x.why === "not-found") return { ok: false, error: "not-found" };
    return { ok: true, result: { ok: x.ok, qty: x.qty, name: x.name, price: x.price, image: x.image } };
  }
  if (job.kind === "sample" || job.kind === "snapshot") {
    await search(tabId, args.query, page, settings);
    const text = await onPage(tabId, job.kind, { id: args.productId }, page);
    return { ok: true, result: { text: text || "" } };
  }
  return { ok: false, error: "failed" };
}
