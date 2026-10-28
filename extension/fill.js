// Filling the Safeway cart, shared by the panel (someone at the computer) and the background (an order started from
// Simmer on a phone). Goes through the Safeway items one at a time in the Safeway window, at a person's pace: adds
// what it's sure of, asks about the rest through `ui`, remembers what was picked, and ticks each item off in Simmer
// once it's in the cart. It stops before checkout, and signing in to Safeway is left to the person.
import { choose, howMany, keyOf, searchFor, usualFor } from "./match.js";
import { safewayPage } from "./page.js";

// Simmer's address is typed once at setup, so it isn't written in this public code.
export const SAFEWAY = "https://www.safeway.com";
export const searchUrl = (q) => `${SAFEWAY}/shop/search-results.html?q=${encodeURIComponent(q)}`;
export const productUrl = (id) => `${SAFEWAY}/shop/product-details.${id}.html`;
export const CART = `${SAFEWAY}/erums/cart`;
const PAUSE = 1500; // between items, so it moves like a person and Safeway has time to catch up

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
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: safewayPage, args: [action, arg] });
    return r?.result ?? null;
  } catch { return null; }
}

/** Waits for search results (or Safeway saying there are none), up to about 20 seconds. */
async function results(tabId) {
  let last = null;
  for (let i = 0; i < 25; i++) {
    last = await onPage(tabId, "read");
    if (last && (last.products.length || last.noResults)) return last;
    await sleep(800);
  }
  return last;
}

// ---- picks

/**
 * The picks, from Simmer, so every computer shares them; this computer's own copy fills in when Simmer can't be reached.
 * Picks only this computer has (made before they were kept in Simmer) are sent to Simmer once.
 */
export async function loadPicks() {
  const here = await store.get("picks", {});
  let shared;
  try { shared = (await simmer("GET", null, "/api/safeway")).picks ?? []; } catch { return here; }
  const picks = Object.fromEntries(shared.map((p) => [keyOf(p.item), { id: p.id, name: p.name }]));
  for (const [key, p] of Object.entries(here)) if (!picks[key]) { picks[key] = p; await savePick(key, p); }
  await store.set("picks", picks);
  return picks;
}

/** Keeps a pick in Simmer. If that fails it stays on this computer, and goes to Simmer next time if Simmer has none for that item. */
const savePick = (item, p) => simmer("POST", { item, id: p.id, name: p.name }, "/api/safeway").catch(() => {});

// ---- filling

/**
 * One item: search, pick (asking through ui.ask if unsure), add. Answers what happened: { ok, qty, want, id, name },
 * { skipped }, { why } (add it by hand), or { halt } (stop everything, e.g. Safeway isn't signed in).
 */
async function one(tabId, item, picks, staples, ui, active) {
  const usual = usualFor(item, staples);
  const key = keyOf(item.item);
  let query = searchFor(item, usual, picks[key]);
  let page = null, choice = null;
  for (let tries = 0; tries < 6 && !ui.stopped(); tries++) {
    ui.note(`Looking for ${query}…`);
    await go(tabId, searchUrl(query), active);
    page = await results(tabId);
    if (!page) return { why: "Safeway didn't load. Add it by hand." };
    if (page.signedIn === false) return { halt: "Safeway isn't signed in. Sign in to Safeway in Chrome, then fill the cart again." };
    // No products read at all: keep a short account of the page, to learn what Safeway's results look like now.
    if (!page.products.length && !page.noResults) await store.set("lastPage", (await onPage(tabId, "sample")) || "");
    choice = choose(page.products, { picked: picks[key], usual, item: query });
    if (choice.none && query !== item.item) { query = item.item; continue; }
    if (choice.pick) break;
    const answer = await ui.ask(item, choice.ask ?? [], tabId, page);
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
  const want = howMany(item.quantity);
  const added = choice.pick.inCart && !(want > 1) ? { ok: true, qty: choice.pick.qty || 1, sure: true } : await onPage(tabId, "add", { id: choice.pick.id, times: want });
  if (added?.snapshot) await store.set("lastPage", added.snapshot);
  if (!added?.ok) return { why: "Didn't go in. Add it by hand.", id: choice.pick.id };
  if (picks[key]?.id !== choice.pick.id) {
    picks[key] = { id: choice.pick.id, name: choice.pick.name };
    await store.set("picks", picks);
    await savePick(item.item, picks[key]);
  }
  return { ok: true, qty: added.qty, want, id: choice.pick.id, name: choice.pick.name };
}

/**
 * Every item in turn. ui: { at(i), note(text), ask(item, options, tabId, page) → answer, result(i, r), stopped() }.
 * active: whether the Safeway tab comes to the front (someone's watching) or works behind. Answers { halted }.
 */
export async function fillCart({ items, staples, ui, active = true, tabId }) {
  await store.set("lastPage", "");
  tabId ??= await safewayTab(active);
  const picks = await loadPicks();
  for (let i = 0; i < items.length && !ui.stopped(); i++) {
    ui.at(i);
    const r = await one(tabId, items[i], picks, staples, ui, active);
    if (r.halt) return { halted: r.halt };
    // Ticked in Simmer means it's in the cart, the same as ticking it by hand.
    if (r.ok) await simmer("POST", { op: "check", id: items[i].id, checked: true }).catch(() => {});
    await ui.result(i, r);
    await sleep(PAUSE);
  }
  return { halted: ui.stopped() ? "Stopped before the end. What's in the cart stays there." : "" };
}
