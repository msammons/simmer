// The panel beside safeway.com: reads Simmer's list, then goes through the Safeway items one at a time in the Safeway
// window, at a person's pace. It adds what it's sure of, asks about the rest, remembers what was picked, ticks each item
// off in Simmer once it's in the cart, and stops before checkout. Signing in to Safeway is left to the person.
import { choose, howMany, keyOf, safewayItems, searchFor, usualFor } from "./match.js";
import { safewayPage } from "./page.js";

// Simmer's address is typed once at setup, so it isn't written in this public code.
const SAFEWAY = "https://www.safeway.com";
const searchUrl = (q) => `${SAFEWAY}/shop/search-results.html?q=${encodeURIComponent(q)}`;
const CART = `${SAFEWAY}/erums/cart`;
const PAUSE = 1500; // between items, so it moves like a person and Safeway has time to catch up

const app = document.getElementById("app");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const store = {
  get: async (k, d) => (await chrome.storage.local.get(k))[k] ?? d,
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

// ---- Simmer

class WrongPasscode extends Error {}

async function simmer(method, body) {
  const [address, passcode] = [await store.get("address", ""), await store.get("passcode", "")];
  let res;
  try {
    res = await fetch(`${address}/api/list`, {
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

async function safewayTab() {
  const [open] = await chrome.tabs.query({ url: `${SAFEWAY}/*`, currentWindow: true });
  if (open) return open.id;
  return (await chrome.tabs.create({ url: SAFEWAY, active: true })).id;
}

function go(tabId, url) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, 30_000);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.update(tabId, { url, active: true });
  });
}

async function onPage(tabId, action, arg = null) {
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

// ---- screens

let state = { screen: "start" };
const show = (s) => { state = { ...state, ...s }; render(); };

function render() {
  const s = state;
  if (s.screen === "passcode") {
    app.innerHTML = `
      <h1>Welcome</h1>
      <p class="muted">Type Simmer's address and the household passcode, the same one Simmer asks for.</p>
      <form id="pc"><input id="address" placeholder="Simmer's address" aria-label="Simmer's address" autocomplete="off" value="${esc(s.address ?? "")}" ${s.address ? "" : "autofocus"} />
      <p></p><input id="code" type="password" placeholder="Passcode" autocomplete="off" aria-label="Passcode" ${s.address ? "autofocus" : ""} />
      ${s.error ? `<p class="warn">${esc(s.error)}</p>` : ""}
      <button class="btn primary" ${s.busy ? "disabled" : ""}>${s.busy ? "Checking…" : "Continue"}</button></form>`;
    app.querySelector("#pc").onsubmit = (e) => { e.preventDefault(); savePasscode(app.querySelector("#address").value, app.querySelector("#code").value); };
    return;
  }
  if (s.screen === "start") { app.innerHTML = `<p class="muted">Loading…</p>`; return; }
  if (s.screen === "error") {
    app.innerHTML = `<h1>Safeway</h1><p class="warn">${esc(s.error)}</p><button class="btn primary" id="again">Try again</button>
      <button class="btn" id="setup">Change the address or passcode</button>`;
    app.querySelector("#again").onclick = load;
    app.querySelector("#setup").onclick = async () => show({ screen: "passcode", address: await store.get("address", ""), error: "" });
    return;
  }
  if (s.screen === "list") {
    const items = s.items;
    app.innerHTML = `
      <h1>Safeway</h1>
      ${items.length ? `
        <p class="muted">${items.length === 1 ? "One thing" : `${items.length} things`} on the list for Safeway.</p>
        <div class="group">${items.map((it) => `<div class="row"><div class="grow">${esc(cap(it.item))}${it.quantity ? `<div class="sub">${esc(it.quantity)}</div>` : ""}</div></div>`).join("")}</div>
        <button class="btn primary" id="fill">Fill my Safeway cart</button>
        <p class="muted">You'll pick a time and check out on Safeway yourself.</p>`
      : `<p class="muted">Nothing on the list for Safeway.</p>`}
      <button class="btn" id="reload">Check the list again</button>`;
    app.querySelector("#fill")?.addEventListener("click", fill);
    app.querySelector("#reload").onclick = load;
    return;
  }
  if (s.screen === "filling" || s.screen === "done") {
    const rows = s.items.map((it, i) => {
      const r = s.results[i];
      const dot = !r ? (i === s.at && s.screen === "filling" ? "now" : "") : r.ok ? "done" : r.skipped ? "" : "miss";
      const sub = !r ? (i === s.at && s.screen === "filling" ? (s.asking ? "Which one?" : s.note || "Looking…") : "") : r.ok ? (r.qty > 1 ? `In the cart, ${r.qty}` : "In the cart") + (r.name ? ` · ${r.name}` : "") : r.skipped ? "Skipped" : r.why;
      const link = r && !r.ok && !r.skipped ? ` <a href="${esc(searchUrl(it.item))}" data-open>Find it</a>` : "";
      return `<div class="row"><span class="dot ${dot}"></span><div class="grow">${esc(cap(it.item))}${it.quantity ? ` <span class="muted">${esc(it.quantity)}</span>` : ""}<div class="sub">${esc(sub)}${link}</div></div></div>`;
    }).join("");
    const misses = s.results.filter((r) => r && !r.ok && !r.skipped).length;
    const head = s.screen === "filling" ? "Filling your cart" : s.halted ? "Stopped" : misses ? "Almost ready" : "Your cart is ready";
    app.innerHTML = `
      <h1>${head}</h1>
      ${s.halted ? `<p class="warn">${esc(s.halted)}</p>` : ""}
      ${s.asking ? askCard(s.asking) : ""}
      <div class="group">${rows}</div>
      ${s.screen === "filling" ? `<button class="btn" id="stop">Stop</button>` : `
        ${misses ? `<p class="muted">${misses === 1 ? "One thing needs" : `${misses} things need`} adding by hand.</p>` : ""}
        <button class="btn primary" id="cart">Open my Safeway cart</button>
        <p class="muted">Pick a time and check out on Safeway when it looks right.</p>
        <button class="btn" id="back">Back to the list</button>`}`;
    app.querySelector("#stop")?.addEventListener("click", () => { state.stopped = true; state.answer?.("skip"); show({ note: "Stopping…" }); });
    app.querySelector("#cart")?.addEventListener("click", async () => go(await safewayTab(), CART));
    app.querySelector("#back")?.addEventListener("click", load);
    app.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); go(await safewayTab(), a.href); }));
    if (s.asking) {
      app.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => state.answer?.(s.asking.options[Number(b.dataset.pick)])));
      app.querySelector("#skip").onclick = () => state.answer?.("skip");
      app.querySelector("#other").onsubmit = (e) => { e.preventDefault(); const q = app.querySelector("#q").value.trim(); if (q) state.answer?.({ search: q }); };
    }
  }
}

function askCard({ item, options }) {
  return `
    <p><strong>Which ${esc(item.item)}?</strong>${item.quantity ? ` <span class="muted">${esc(item.quantity)}</span>` : ""}</p>
    ${options.length ? `<div class="group">${options.map((p, i) => `
      <button class="row" data-pick="${i}">${p.image ? `<img src="${esc(p.image)}" alt="" />` : ""}
        <span class="grow">${esc(p.name)}<span class="sub" style="display:block">${esc(p.price)}${p.inCart ? " · already in the cart" : ""}</span></span></button>`).join("")}</div>`
    : `<p class="muted">Nothing came up.</p>`}
    <form id="other"><input id="q" placeholder="Look for something else" aria-label="Look for something else" /></form>
    <button class="btn" id="skip">Skip this one</button>`;
}

/** Shows the question and waits for a tap: a product, "skip", or { search }. */
function ask(item, options) {
  return new Promise((resolve) => {
    state.answer = (a) => { state.answer = null; show({ asking: null }); resolve(a); };
    show({ asking: { item, options } });
  });
}

// ---- actions

async function load() {
  show({ screen: "start", error: "", halted: "", stopped: false });
  const address = await store.get("address", "");
  if (!address || !(await store.get("passcode", ""))) return show({ screen: "passcode", address });
  try {
    const list = await simmer("GET");
    show({ screen: "list", items: safewayItems(list), staples: list.staples ?? [] });
  } catch (e) {
    if (e instanceof WrongPasscode) return show({ screen: "passcode", address, error: "Wrong passcode." });
    show({ screen: "error", error: e.message });
  }
}

/** "simmer-x.vercel.app" or a full link → "https://simmer-x.vercel.app", or "" if it isn't one of the apps' addresses. */
function origin(typed) {
  try {
    const u = new URL(/^https?:\/\//i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`);
    return u.hostname.endsWith(".vercel.app") ? `https://${u.hostname}` : "";
  } catch { return ""; }
}

async function savePasscode(typedAddress, code) {
  const address = origin(typedAddress);
  if (!address) return show({ address: typedAddress, error: "That address doesn't look right." });
  await store.set("address", address);
  await store.set("passcode", code.trim());
  show({ busy: true, error: "" });
  await load();
  state.busy = false;
  render();
}

/** One item: search, pick (asking if unsure), add. Answers what happened. */
async function one(tabId, item, picks) {
  const usual = usualFor(item, state.staples);
  const key = keyOf(item.item);
  let query = searchFor(item, usual, picks[key]);
  let page = null, choice = null;
  for (let tries = 0; tries < 6 && !state.stopped; tries++) {
    show({ note: `Looking for ${query}…` });
    await go(tabId, searchUrl(query));
    page = await results(tabId);
    if (!page) return { why: "Safeway didn't load. Add it by hand." };
    if (page.signedIn === false) return { halt: "Sign in to Safeway in the window beside this, then fill the cart again." };
    choice = choose(page.products, { picked: picks[key], usual, item: query });
    if (choice.none && query !== item.item) { query = item.item; continue; }
    if (choice.pick) break;
    const answer = await ask(item, choice.ask ?? []);
    if (answer === "skip") return { skipped: true };
    if (answer?.search) { query = answer.search; continue; }
    choice = { pick: answer };
    break;
  }
  if (state.stopped) return { skipped: true };
  if (!choice?.pick) return { why: "Couldn't find it." };
  show({ note: `Adding ${choice.pick.name}…` });
  const added = await onPage(tabId, "add", { id: choice.pick.id, times: howMany(item.quantity) });
  if (!added?.ok) return { why: "Didn't go in. Add it by hand." };
  picks[key] = { id: choice.pick.id, name: choice.pick.name };
  await store.set("picks", picks);
  return { ok: true, qty: added.qty, name: choice.pick.name };
}

async function fill() {
  const items = state.items;
  show({ screen: "filling", results: [], at: 0, stopped: false, halted: "", note: "" });
  const tabId = await safewayTab();
  const picks = await store.get("picks", {});
  for (let i = 0; i < items.length && !state.stopped; i++) {
    show({ at: i, note: "" });
    const r = await one(tabId, items[i], picks);
    if (r.halt) { show({ halted: r.halt }); break; }
    state.results[i] = r;
    // Ticked in Simmer means it's in the cart, the same as ticking it by hand.
    if (r.ok) await simmer("POST", { op: "check", id: items[i].id, checked: true }).catch(() => {});
    render();
    await sleep(PAUSE);
  }
  if (state.stopped && !state.halted) state.halted = "Stopped before the end. What's in the cart stays there.";
  show({ screen: "done", at: -1, asking: null, note: "" });
}

load();
