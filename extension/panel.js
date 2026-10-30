// The panel beside safeway.com, for filling the cart at the computer: reads Simmer's list, then fills the cart
// (fill.js) and asks here when it isn't sure. Orders started from Simmer on a phone are filled in the background
// (background.js) instead.
import { WrongPasscode, cartUrl, fillCart, go, onPage, safewayTab, searchUrl, sleep, start, store } from "./fill.js";

const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
      const sub = !r ? (i === s.at && s.screen === "filling" ? (s.asking ? "Which one?" : s.note || "Looking…") : "") : r.ok ? (r.qty > 1 ? `In the cart, ${r.qty}` : "In the cart") + (r.want > r.qty ? ` (${r.want} on the list)` : "") + (r.name ? ` · ${r.name}` : "") : r.skipped ? "Skipped" : r.why;
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
        <button class="btn" id="back">Back to the list</button>
        ${s.lastPage ? `<button class="btn" id="copy">${s.copied ? "Copied" : "Copy what Safeway showed"}</button>` : ""}`}`;
    app.querySelector("#stop")?.addEventListener("click", () => { state.stopped = true; state.answer?.("skip"); show({ note: "Stopping…" }); });
    app.querySelector("#cart")?.addEventListener("click", async () => go(await safewayTab(), cartUrl()));
    app.querySelector("#back")?.addEventListener("click", load);
    app.querySelector("#copy")?.addEventListener("click", async () => { await navigator.clipboard.writeText(s.lastPage).catch(() => {}); show({ copied: true }); });
    app.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", async (e) => { e.preventDefault(); go(await safewayTab(), a.href); }));
    if (s.asking) {
      app.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => state.answer?.(s.asking.options[Number(b.dataset.pick)])));
      app.querySelector("#skip").onclick = () => state.answer?.("skip");
      app.querySelector("#sample")?.addEventListener("click", async () => { await navigator.clipboard.writeText(await store.get("lastPage", "")).catch(() => {}); show({ copied: true }); });
      app.querySelector("#other").onsubmit = (e) => { e.preventDefault(); const q = app.querySelector("#q").value.trim(); if (q) state.answer?.({ search: q }); };
    }
  }
}

function askCard({ item, options }) {
  return `
    <p><strong>Which ${esc(item.item)}?</strong>${item.quantity ? ` <span class="muted">${esc(item.quantity)}</span>` : ""}</p>
    ${options.length ? `<p class="muted">${options.length === 1 ? "One found" : `${options.length} found, the likeliest first`}.</p>` : ""}
    ${options.length ? `<div class="group">${options.map((p, i) => `
      <button class="row" data-pick="${i}">${p.image ? `<img src="${esc(p.image)}" alt="" />` : ""}
        <span class="grow">${esc(p.name)}<span class="sub" style="display:block">${esc(p.price)}${p.inCart ? " · already in the cart" : ""}</span></span></button>`).join("")}</div>`
    : `<p class="muted">Nothing came up.</p><button class="btn" id="sample">${state.copied ? "Copied" : "Copy what Safeway showed"}</button>`}
    <form id="other"><input id="q" placeholder="Not here? Look for something else" aria-label="Look for something else" /></form>
    <button class="btn" id="skip">Skip this one</button>`;
}

/** Shows the question and waits for a tap: a product, "skip", or { search }. */
function ask(item, options, tabId, before) {
  return new Promise((resolve) => {
    let watching = true;
    state.answer = (a) => { watching = false; state.answer = null; show({ asking: null }); resolve(a); };
    show({ asking: { item, options }, copied: false });
    // Picking happens here, but if someone presses Add on the Safeway page anyway, whatever goes into the cart while
    // this is asked is the pick.
    (async () => {
      while (watching) {
        await sleep(1000);
        if (!watching) return;
        const page = await onPage(tabId, "read");
        if (!page || !watching) continue;
        // Gone in: its Add button turned into a quantity, or changed while the cart count went up.
        const wasIn = new Set(before.products.filter((p) => p.inCart).map((p) => p.id));
        const counted = before.cartCount !== null && page.cartCount !== null && page.cartCount > before.cartCount;
        const changed = Object.keys(before.tiles ?? {}).filter((id) => before.tiles[id] && (page.tiles?.[id] ?? "") !== before.tiles[id]);
        const added = page.products.find((p) => p.inCart && !wasIn.has(p.id))
          ?? (counted && changed.length === 1 ? [...page.products, ...before.products].find((p) => p.id === changed[0]) : null);
        // Known only by the count: keep what Safeway showed for that product, so its sign can be learned.
        if (added && !added.inCart) await store.set("lastPage", (await onPage(tabId, "snapshot", { id: added.id })) || "");
        if (added && watching) state.answer?.({ ...added, inCart: true });
        else if (counted) state.answer?.({ unknown: true });
      }
    })();
  });
}

// ---- actions

async function load() {
  show({ screen: "start", error: "", halted: "", stopped: false });
  const address = await store.get("address", "");
  if (!address || !(await store.get("passcode", ""))) return show({ screen: "passcode", address });
  try {
    show({ screen: "list", items: await start() });
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

async function fill() {
  // Asked again at the start of the run, so the list, the picks and how to read Safeway are Simmer's latest.
  let items;
  try { items = await start(); } catch (e) { return e instanceof WrongPasscode ? load() : show({ screen: "error", error: e.message }); }
  show({ screen: "filling", items, results: [], at: 0, stopped: false, halted: "", note: "", lastPage: "" });
  const ui = {
    at: (i) => show({ at: i, note: "" }),
    note: (note) => show({ note }),
    ask,
    result: (i, r) => { state.results[i] = r; render(); },
    stopped: () => state.stopped,
  };
  const { halted } = await fillCart({ items, ui });
  state.halted = halted;
  state.lastPage = await store.get("lastPage", "");
  state.copied = false;
  show({ screen: "done", at: -1, asking: null, note: "" });
}

load();
