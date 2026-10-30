// Filling the Safeway cart, shared by the panel (someone at the computer) and the background (an order started from
// Simmer on a phone). Goes through the Safeway items one at a time in the Safeway window, at a person's pace: adds
// what it's sure of, asks about the rest through `ui`, remembers what was picked, and ticks each item off in Simmer
// once it's in the cart. It stops before checkout, and signing in to Safeway is left to the person.
//
// The thinking lives in Simmer (src/lib/safeway-helper.mjs), so it can change without reinstalling this helper: at the
// start of each run Simmer says what to fill, how to read Safeway's pages and how to go about it (`start`), and for
// each search it says which product to take or what to ask (`chooseIn`). This file only carries that out.
import { safewayPage } from "./page.js";

// Simmer's address is typed once at setup, so it isn't written in this public code.
export const SAFEWAY = "https://www.safeway.com";
/** How Safeway's pages are read and how to go about it, from Simmer at the start of each run (see `start`). */
let page = null, settings = { pause: 1500, searchTries: 6, resultsTries: 25, resultsWait: 800 };
export const searchUrl = (q) => `${page?.site ?? SAFEWAY}${page?.searchPath ?? "/shop/search-results.html?q="}${encodeURIComponent(q)}`;
export const productUrl = (id) => `${page?.site ?? SAFEWAY}${(page?.productPath ?? "/shop/product-details.{id}.html").replace("{id}", id)}`;
export const cartUrl = () => `${page?.site ?? SAFEWAY}${page?.cartPath ?? "/erums/cart"}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const store = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

// ---- Simmer

export class WrongPasscode extends Error {}

export async function simmer(method, body, path = "/api/list") {
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

// ---- the Safeway window

/** A Safeway tab to work in: one that's open already, else a new one (in front only when someone's watching). */
export async function safewayTab(active = true) {
  const [open] = await chrome.tabs.query(active ? { url: `${SAFEWAY}/*`, currentWindow: true } : { url: `${SAFEWAY}/*` });
  if (open) return open.id;
  return (await chrome.tabs.create({ url: SAFEWAY, active })).id;
}

export function go(tabId, url, active = true) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, 30_000);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.update(tabId, { url, ...(active && { active: true }) });
  });
}

export async function onPage(tabId, action, arg = null) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: safewayPage, args: [action, arg, page] });
    return r?.result ?? null;
  } catch { return null; }
}

/** Waits for search results (or Safeway saying there are none), up to about 20 seconds. */
async function results(tabId) {
  let last = null;
  for (let i = 0; i < settings.resultsTries; i++) {
    last = await onPage(tabId, "read");
    if (last && (last.products.length || last.noResults)) return last;
    await sleep(settings.resultsWait);
  }
  return last;
}

// ---- from Simmer

/**
 * The start of a run: Simmer's Safeway items ready to fill ({ id, item, quantity, usual, picked, query, want }), and
 * how to read Safeway and go about it. Picks only this computer has (made before they were kept in Simmer) go to
 * Simmer first, once.
 */
export async function start() {
  const here = await store.get("picks", {});
  for (const [item, p] of Object.entries(here)) await savePick(item, p);
  if (Object.keys(here).length) await chrome.storage.local.remove("picks");
  const s = await simmer("GET", null, "/api/safeway/helper");
  page = s.page;
  settings = { ...settings, ...s.settings };
  return s.items ?? [];
}

/** Which product to take from what a search found, or which to ask about: Simmer decides. */
const chooseIn = (item, query, products) => simmer("POST", { item: { item: item.item, usual: item.usual, picked: item.picked }, query, products }, "/api/safeway/helper");

/** Keeps a pick in Simmer, so every computer shares it. */
const savePick = (item, p) => simmer("POST", { item, id: p.id, name: p.name }, "/api/safeway").catch(() => {});

// ---- filling

/**
 * One item: search, pick (asking through ui.ask if unsure), add. Answers what happened: { ok, qty, want, id, name },
 * { skipped }, { why } (add it by hand), or { halt } (stop everything, e.g. Safeway isn't signed in).
 */
async function one(tabId, item, ui, active) {
  let query = item.query || item.item;
  let found = null, choice = null;
  for (let tries = 0; tries < settings.searchTries && !ui.stopped(); tries++) {
    ui.note(`Looking for ${query}…`);
    await go(tabId, searchUrl(query), active);
    found = await results(tabId);
    if (!found) return { why: "Safeway didn't load. Add it by hand." };
    if (found.signedIn === false) return { halt: "Safeway isn't signed in. Sign in to Safeway in Chrome, then fill the cart again." };
    // No products read at all: keep a short account of the page, to learn what Safeway's results look like now.
    if (!found.products.length && !found.noResults) await store.set("lastPage", (await onPage(tabId, "sample")) || "");
    choice = await chooseIn(item, query, found.products).catch(() => ({ ask: found.products }));
    if (choice.none && query !== item.item) { query = item.item; continue; }
    if (choice.pick) break;
    const answer = await ui.ask(item, choice.ask ?? [], tabId, found);
    if (answer === "skip") return { skipped: true };
    if (answer?.search) { query = answer.search; continue; }
    // Something went into the cart on Safeway, but which product couldn't be told: count it, remember nothing.
    if (answer?.unknown) return { ok: true, qty: 1, name: "" };
    choice = { pick: answer };
    break;
  }
  if (ui.stopped()) return { skipped: true };
  if (!choice?.pick) return { why: "Couldn't find it." };
  ui.note(`Adding ${choice.pick.name}…`);
  const want = item.want || 1;
  const added = choice.pick.inCart && !(want > 1) ? { ok: true, qty: choice.pick.qty || 1, sure: true } : await onPage(tabId, "add", { id: choice.pick.id, times: want });
  if (added?.snapshot) await store.set("lastPage", added.snapshot);
  if (!added?.ok) return { why: "Didn't go in. Add it by hand.", id: choice.pick.id };
  if (item.picked?.id !== choice.pick.id) {
    item.picked = { id: choice.pick.id, name: choice.pick.name };
    await savePick(item.item, item.picked);
  }
  return { ok: true, qty: added.qty, want, id: choice.pick.id, name: choice.pick.name };
}

/**
 * Every item in turn (as `start` gave them). ui: { at(i), note(text), ask(item, options, tabId, page) → answer, result(i, r), stopped() }.
 * active: whether the Safeway tab comes to the front (someone's watching) or works behind. Answers { halted }.
 */
export async function fillCart({ items, ui, active = true, tabId }) {
  await store.set("lastPage", "");
  tabId ??= await safewayTab(active);
  for (let i = 0; i < items.length && !ui.stopped(); i++) {
    ui.at(i);
    const r = await one(tabId, items[i], ui, active);
    if (r.halt) return { halted: r.halt };
    // Ticked in Simmer means it's in the cart, the same as ticking it by hand.
    if (r.ok) await simmer("POST", { op: "check", id: items[i].id, checked: true }).catch(() => {});
    await ui.result(i, r);
    await sleep(settings.pause);
  }
  return { halted: ui.stopped() ? "Stopped before the end. What's in the cart stays there." : "" };
}
