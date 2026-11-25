// A stand-in for Chrome and Safeway, for the helper's fast checks (helper.test.mjs). The helper's own files
// (extension-working/page.js, safeway.js, background.js) are loaded unchanged, as text, the way Chrome would run them:
// the background with this file's `chrome` and `fetch`, and page.js's function copied into the page by its source (so
// it can't lean on anything outside itself, as in Chrome). The page is one jsdom document standing in for the Safeway
// tab; Safeway's pages are built here with their behaviour (results arriving late, Sign In for a moment, boxes after an
// Add, being sent home…) on the test's clock (vitest's fake timers), so a case that waits out an 8 s hold takes
// milliseconds. Reading only, it can't say whether Safeway's real pages still match (real-pages-test.mjs does).
import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { PAGE, SETTINGS } from "../lib/safeway-helper.mjs";

export { PAGE, SETTINGS };
export const SAFEWAY = "https://www.safeway.com";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
/** Where the helper's files are read from: extension-working/, or HELPER_DIR (a scratch copy, to see a check fail). */
const helperDir = () => path.resolve(root, process.env.HELPER_DIR || "extension-working");

// ---- the page: one jsdom document, its layout faked just enough for page.js's "showing" and innerText
const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: `${SAFEWAY}/` });
const win = dom.window;
const shown = (el) => {
  if (!el.isConnected) return false;
  for (let e = el; e; e = e.parentElement ?? e.parentNode?.host ?? null) if (e.hidden || e.style?.display === "none") return false;
  return true;
};
const BLOCK = /^(DIV|P|H[1-6]|LI|UL|SECTION|MAIN|ARTICLE|BR|TR|HEADER|FOOTER|NAV)$/;
function innerText(el) {
  if (!shown(el)) return "";
  let out = "";
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.data;
    else if (n.nodeType === 1 && !/^(SCRIPT|STYLE)$/.test(n.tagName)) out += innerText(n) + (BLOCK.test(n.tagName) ? "\n" : "");
  }
  return out;
}
for (const prop of ["offsetWidth", "offsetHeight"]) Object.defineProperty(win.HTMLElement.prototype, prop, { configurable: true, get() { return shown(this) ? 10 : 0; } });
Object.defineProperty(win.HTMLElement.prototype, "innerText", { configurable: true, get() { return innerText(this); } });
win.Element.prototype.getClientRects = function () { return shown(this) ? [{ width: 10, height: 10 }] : []; };
// Scrolling a part into view: said to the page, which builds a far-down tile's buttons then, as Safeway does.
win.Element.prototype.scrollIntoView = function () { this.dispatchEvent(new win.Event("scrolledto")); };
for (const name of ["document", "MutationObserver", "ShadowRoot", "NodeFilter", "HTMLElement", "Node"]) globalThis[name] = win[name];
Object.defineProperty(globalThis, "location", { configurable: true, get: () => win.location });
const doc = win.document;

// ---- the helper's files, as text, in one function per "life" of the background (Chrome stopping it ends one)
const read = (f) => readFileSync(path.join(helperDir(), f), "utf8");
let helperSource = null;
function helperFn() {
  helperSource ??= ["page.js", "google.js", "safeway.js", "background.js"].map(read).join("\n")
    .replace(/^import .*$/gm, "")
    .replace(/^export (async function|function|const|class|let)\b/gm, "$1");
  return new Function("chrome", "fetch", "self", `"use strict";\n${helperSource}\nreturn { runJob, check, store, safewayPage };`);
}
/** A function the helper hands executeScript, made again from its source as Chrome does (nothing outside it comes). */
const copies = new Map();
/** The page's own clock (`performance.now()` in the page): ms since its load began, on the test's clock. */
let pageStart = 0;
const pagePerformance = { now: () => Date.now() - pageStart };
const copied = (func) => { const s = func.toString(); if (!copies.has(s)) copies.set(s, new Function("performance", `"use strict"; return (${s});`)(pagePerformance)); return copies.get(s); };

/**
 * The world for one test: a Safeway tab, Safeway's state (`shop`), the computer's storage, and the background, started
 * with `start()` (again after `stopHelper()`, as Chrome does). `simmer(op, body)`: how the background's calls to Simmer
 * are answered.
 */
export function makeWorld() {
  let gen = 0, tab = null;
  const listeners = new Set();
  /** Waiting on the tab: run at each page change (a new page starting, or one finishing loading). */
  const waiters = new Set();
  const changed = () => { for (const w of [...waiters]) w(); };
  const local = new Map(), session = new Map();
  const shop = {
    signedIn: true, sessionGone: false, cartGone: false, cart: {}, presses: {}, chaos: {}, fails: null, note: null,
    yogurtAway: true, checkoutButton: false, ordered: false, loads: [], scripts: 0,
  };
  const world = { shop, local, inject: 20, load: 50, simmer: null, life: null };

  const fire = (info) => { for (const l of [...listeners]) l(tab.id, info, { ...tab }); };
  /** Opens `url` in the tab: loading at once, the page built after Safeway's time (`slow`, else 50 ms), then its script. */
  function navigate(url) {
    const g = ++gen;
    const spec = serve(new URL(url));
    // Answered by Safeway's server with another address (the browser never shows the first one).
    if (spec.redirect) { navigate(spec.redirect.startsWith("/") ? SAFEWAY + spec.redirect : spec.redirect); return; }
    shop.loads.push(new URL(url).pathname + new URL(url).search);
    tab.url = url; tab.status = "loading";
    pageStart = Date.now();
    fire({ status: "loading", url });
    changed();
    setTimeout(() => {
      if (g !== gen) return;
      dom.reconfigure({ url });
      doc.documentElement.innerHTML = `<head></head><body>${spec.html}</body>`;
      tab.status = "complete";
      fire({ status: "complete" });
      changed();
      spec.run?.(pageTools(g));
    }, spec.slow ?? world.load);
  }
  /** What a page's own script gets: timers and moves that end when the page does. */
  const pageTools = (g) => ({
    after: (ms, fn) => setTimeout(() => { if (g === gen) fn(); }, ms),
    every: (ms, fn) => { const t = setInterval(() => (g === gen ? fn() : clearInterval(t)), ms); },
    // A page sending the tab elsewhere starts the move after what it's doing now, as a browser does.
    go: (to) => setTimeout(() => { if (g === gen) navigate(to.startsWith("/") ? SAFEWAY + to : to); }, 0),
    alive: () => g === gen,
  });
  /** Resolves once `ok()` holds, checked now and at each page change. */
  const when = (ok) => new Promise((done) => { const w = () => { if (ok()) { waiters.delete(w); done(); } }; waiters.add(w); w(); });

  /** chrome.* for one life of the background. Once it's stopped, everything it asks for never answers. */
  function chromeFor(life) {
    const dead = () => life.dead;
    const never = new Promise(() => {});
    const call = (fn) => (...a) => (dead() ? never : fn(...a));
    const event = () => { const own = new Set(); return { addListener: (f) => { if (!dead()) own.add(f); }, removeListener: (f) => own.delete(f), own }; };
    const onUpdated = { addListener: (f) => { if (dead()) return; const w = (...a) => (dead() ? listeners.delete(w) : f(...a)); w.of = f; listeners.add(w); }, removeListener: (f) => { for (const w of listeners) if (w.of === f) listeners.delete(w); } };
    return {
      tabs: {
        query: call(async ({ url }) => (tab && (!url || tab.url.startsWith(url.replace(/\*$/, ""))) ? [{ ...tab }] : [])),
        get: call(async (id) => { if (!tab || id !== tab.id) throw new Error("No tab with id"); return { ...tab }; }),
        create: call(async ({ url }) => { tab = { id: 7, url: "about:blank", status: "complete" }; navigate(url); return { ...tab }; }),
        update: call(async (id, { url }) => { navigate(url); return { ...tab }; }),
        onUpdated,
      },
      windows: { create: call(async ({ url }) => { tab = { id: 7, url: "about:blank", status: "complete" }; navigate(url); return { tabs: [{ ...tab }] }; }) },
      scripting: {
        // Into the page as it is once it has loaded, a moment after asking; the page moving on meanwhile (Safeway
        // sending the tab elsewhere) loses the answer, as in Chrome.
        executeScript: call(async ({ func, args = [] }) => {
          await when(() => tab.status === "complete");
          const g = gen;
          await new Promise((r) => setTimeout(r, world.inject));
          if (g !== gen) throw new Error("The frame was removed.");
          shop.scripts++;
          const GONE = Symbol("gone");
          const v = await Promise.race([Promise.resolve().then(() => copied(func)(...args)), when(() => g !== gen).then(() => GONE)]);
          if (v === GONE) throw new Error("The frame was removed.");
          return [{ result: v === undefined ? null : structuredClone(v) }];
        }),
      },
      storage: {
        local: { get: call(async (k) => (local.has(k) ? { [k]: structuredClone(local.get(k)) } : {})), set: call(async (o) => { for (const [k, v] of Object.entries(o)) local.set(k, structuredClone(v)); }) },
        session: { get: call(async (k) => (session.has(k) ? { [k]: session.get(k) } : {})), remove: call(async (k) => { session.delete(k); }) },
      },
      runtime: { getManifest: () => ({ version: JSON.parse(read("manifest.json")).version }), onStartup: event(), onInstalled: event(), onMessage: event(), sendMessage: call(async () => {}), reload: () => {} },
      sidePanel: { setPanelBehavior: call(async () => {}) },
    };
  }
  /** fetch for one life: the background's calls go to `world.simmer`; a dropped connection when it says so. */
  const fetchFor = (life) => async (url, init = {}) => {
    if (life.dead) return new Promise(() => {});
    const body = init.body ? JSON.parse(init.body) : null;
    const answer = await world.simmer?.(body?.op, body);
    if (life.dead) return new Promise(() => {});
    if (answer === "drop") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer ?? {}), { status: 200, headers: { "content-type": "application/json" } });
  };

  /** Starts the background (Chrome starting it); answers its functions. The tab is Safeway's home page. */
  world.start = () => {
    const life = { dead: false };
    world.life = life;
    const self = { addEventListener: () => {}, registration: { pushManager: { getSubscription: async () => null } } };
    world.helper = helperFn()(chromeFor(life), fetchFor(life), self);
    return world.helper;
  };
  /** Chrome stopping the background: everything it was doing stops answering, and only what's kept on the computer stays. */
  world.stopHelper = () => { if (world.life) world.life.dead = true; for (const w of [...listeners]) listeners.delete(w); };
  world.open = (url = `${SAFEWAY}/`) => { tab = { id: 7, url: "about:blank", status: "complete" }; navigate(url); };
  world.go = (url) => navigate(url.startsWith("/") ? SAFEWAY + url : url);
  world.tab = () => ({ ...tab });
  world.path = () => new URL(tab.url).pathname;
  world.onSignIn = () => world.path() === "/account/sign-in.html";
  world.doc = doc;
  /** Safeway's session note (`PAGE.session`), or none. */
  world.note = (common) => {
    const value = common ? encodeURIComponent(JSON.stringify({ COMMON: common })) : "x";
    dom.cookieJar.setCookieSync(`${PAGE.session.cookie}=${value}; Path=/${common ? "" : "; Expires=Thu, 01 Jan 1970 00:00:00 GMT"}`, `${SAFEWAY}/`);
  };
  world.note(null);
  current = world;
  return world;
}

// ---- Safeway's pages, as stand-ins (the same shapes as scripts/extension-test.mjs, built from saved real pages)
export const BREAD = "Daves Killer Bread 21 Whole Grains & Seeds Thin-Sliced Whole Grain Organic Bread - 20.5 Oz";
export const CATALOG = {
  milk: [["960001", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", "$3.49"], ["960002", "Lucerne Milk Reduced Fat 2% - 1 Gallon", "$5.29"]],
  bananas: [["960010", "Bananas", "$0.29 each"], ["960011", "Organic Bananas", "$0.39 each"]],
  bread: [["960050", BREAD, "$7.49 each"]],
  butter: [["960090", "Lucerne Butter Salted - 16 Oz", "$5.99 each"]],
  cheddar: [["960110", "Tillamook Medium Cheddar Cheese Block - 8 Oz", "$4.99 each"]],
  yogurt: [["960120", "Chobani Greek Yogurt Plain - 32 Oz", "$6.49 each"]],
  spaghetti: [["960130", "Barilla Spaghetti - 16 Oz", "$2.29 each"]],
  marinara: [["960140", "Raos Homemade Marinara Sauce - 24 Oz", "$8.99 each"]],
  // Awkward names: "Plus" (its Decrease must never pass for +), "Notes" and "List" (their Add must still be found).
  gatorade: [["960080", "Gatorade Plus Thirst Quencher Fruit Punch - 20 Fl Oz", "$2.49 each"]],
  notes: [["960160", "Add Notes Sticky Notes - 3 Pack", "$4.29 each"]],
  // A tile far down the page, whose buttons Safeway builds only once it's scrolled to.
  eggs: [["960071", "O Organics Organic Eggs Large Brown - 12 Count", "$7.99 each"], ["960070", "Lucerne Farms Eggs Cage Free Large - 18 Count", "$5.99 each"]],
  slowpoke: [["960150", "Never Shown", "$1.00 each"]],
};
const NAMES = Object.fromEntries(Object.values(CATALOG).flat().map(([id, name, price]) => [id, [name, price]]));
const shortened = (name) => (name.length > 36 ? `${name.slice(0, 24)}...${name.slice(-8)}` : name);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The account bar: Sign in or Account (Safeway's pages have no <header>, so the whole page is read for Sign In). */
const bar = (shop, signedIn, cartHref) => `<div class="menu-nav" id="bar"><a href="/">Safeway</a> <span id="who">${shop.chaos.flash || !signedIn ? "<button>Sign in</button>" : "<button>Account</button>"}</span> <a href="${cartHref}" id="cart" aria-label="Cart">Cart</a></div>`;
/** What every page's script does for Safeway misbehaving: Sign In a moment, the page never still, the body gone a while. */
function misbehave(shop, t) {
  if (shop.chaos.flash && shop.signedIn) t.after(2500, () => { doc.getElementById("who").innerHTML = "<button>Account</button>"; });
  if (shop.chaos.churn) { const tick = doc.createElement("span"); doc.body.append(tick); let n = 0; t.every(5, () => { tick.textContent = String(n++); }); }
  if (shop.chaos.nobody) { const b = doc.body; doc.documentElement.removeChild(b); t.after(3000, () => doc.documentElement.appendChild(b)); }
}
const BOXES = `<div id="sessionTimeoutModal" class="modal" role="dialog" style="display:none"><div><h2>Session Expired</h2><p>Your session is expired. Please sign in to continue.</p><button>Sign In</button><button>Got It</button></div></div>
  <div id="errorModal" class="modal" role="dialog" style="display:none"><div><h4>Sorry, we're having issues.</h4><p>We cannot complete your request at this time. Please try again later.</p><button>Close</button></div></div>
  <div id="toastMessage" role="status" style="display:none"></div>`;
const press = (shop, key) => { shop.presses[key] = (shop.presses[key] ?? 0) + 1; };
const put = (shop, id, n) => { if (n > 0) shop.cart[id] = n; else delete shop.cart[id]; };
const total = (shop) => Object.values(shop.cart).reduce((a, b) => a + b, 0);

function searchPage(shop, q) {
  const hits = Object.entries(CATALOG).filter(([k, v]) => q.toLowerCase().includes(k) || v.some(([, n]) => n.toLowerCase() === q.toLowerCase())).flatMap(([, v]) => v);
  const never = /slowpoke/i.test(q);
  const away = /yogurt/i.test(q) && shop.yogurtAway;
  if (away) shop.yogurtAway = false;
  const tiles = hits.map(([id, name, price]) => `${id === "960070" ? '<div style="height:4000px">More products</div>' : ""}
    <product-item-al-v2 data-qa="prd-itm" data-id="${id}"><div class="pc" id="pg${id}container">
      <div id="pg${id}Img"><picture><img alt="${esc(name)}" data-src="//www.safeway.com/img/${id}.png"></picture></div>
      <quantity-stepper-al-v2 class="cta" id="pg${id}-qty"></quantity-stepper-al-v2>
      <span data-qa="prd-itm-prc" id="pg${id}price"><span> Your Price ${price}</span></span>
      <a data-qa="prd-itm-pttl" id="pg${id}" aria-label="${esc(name)}" href="/shop/pd/item/${id}">${esc(id === "960002" || id === "960050" ? shortened(name) : name)}</a>
    </div></product-item-al-v2>`).join("");
  return {
    slow: shop.chaos.slow,
    html: `${bar(shop, shop.signedIn, "/cart")}<main id="grid"></main>${BOXES}`,
    run: (t) => {
      misbehave(shop, t);
      if (never) { doc.getElementById("grid").innerHTML = "<p>Loading…</p>"; return; }
      if (away) t.after(800, () => t.go("/"));
      // "No search results" for a moment while the page builds (seen Oct 31), then the results.
      t.after(100, () => { const g = doc.getElementById("grid"); if (g) g.innerHTML = `<h1>No search results for "${esc(q)}"</h1>`; });
      t.after(shop.chaos.nobody ? 3500 : 1500, () => {
        doc.getElementById("grid").innerHTML = tiles || `<h1>No search results for "${esc(q)}"</h1>`;
        for (const tile of doc.querySelectorAll("product-item-al-v2")) {
          if (tile.dataset.id === "960070") tile.addEventListener("scrolledto", () => draw(tile), { once: true });
          else draw(tile);
        }
      });
      function draw(tile) {
        const id = tile.dataset.id, name = NAMES[id][0], n = shop.cart[id] || 0, cta = tile.querySelector(".cta");
        cta.innerHTML = n ? `<div role="group"><button data-qa="prdctdcrmntr" aria-label="${n === 1 ? "Remove" : "Decrease"} Quantity 1 unit of ${esc(name)}"></button>`
          + `<button data-qa="qty-stppr-qtymsg" aria-label="${n} units of ${esc(name)} in cart. Click to update">${n}</button>`
          + `<button data-qa="prdctincrmntr" aria-label="Increase Quantity 1 unit of ${esc(name)}"></button></div>`
          : `<button data-qa="addbutton" aria-label="Add 1 unit of ${esc(name)}"><span>Add</span></button>`;
        doc.getElementById("cart").textContent = `Cart ${total(shop)}`;
        for (const b of cta.querySelectorAll("button")) b.addEventListener("click", () => t.after(250, () => {
          const l = b.getAttribute("aria-label");
          if (/units of/.test(l)) return;
          press(shop, id);
          const isAdd = /^Add/.test(l);
          // The boxes the real page holds ready for an Add Safeway won't take (Nov 23): one shows, the tile stays.
          if (shop.fails && isAdd) { doc.getElementById(shop.fails === "expired" ? "sessionTimeoutModal" : "errorModal").style.display = "block"; return; }
          // A box to choose from first: nothing's added until a choice is made, and the helper makes none.
          if (shop.chaos.choice && isAdd) {
            const box = doc.createElement("div"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
            box.innerHTML = "<h2>Choose an option</h2><p>Pick a size before adding this item.</p><button>12 Oz</button><button>24 Oz</button>";
            box.querySelectorAll("button").forEach((x) => x.addEventListener("click", () => press(shop, `choice ${x.textContent}`)));
            doc.body.append(box); return;
          }
          if (shop.chaos.toast && isAdd) { const m = doc.getElementById("toastMessage"); m.textContent = "We couldn't add this item to your cart."; m.style.display = "block"; return; }
          put(shop, id, isAdd || /^Increase/.test(l) ? n + 1 : n - 1);
          // It took, and Safeway sends the tab to its home page before showing it.
          if (shop.chaos.away) { t.go("/"); return; }
          draw(tile);
        }));
      }
    },
  };
}

/** Safeway's cart page: each product a row with − / quantity / +; empty, it lists past purchases each with Add. */
function cartPage(shop) {
  const past = Object.values(CATALOG).flat().slice(0, 3).map(([id, name, price]) => `<product-item-al-v2 data-id="${id}"><div class="pc"><a data-qa="prd-itm-pttl" id="pg${id}" href="/shop/pd/item/${id}">${esc(name)}</a><span data-qa="prd-itm-prc">${price}</span><button aria-label="Add 1 unit of ${esc(name)}">Add</button></div></product-item-al-v2>`).join("");
  return {
    slow: shop.chaos.slow,
    html: `${bar(shop, shop.signedIn, "/erums/cart")}<main id="rows"></main>${shop.checkoutButton ? '<button id="checkout">Checkout</button>' : ""}`,
    run: (t) => {
      misbehave(shop, t);
      doc.getElementById("checkout")?.addEventListener("click", () => { press(shop, "checkout"); t.go("/erums/checkout"); });
      const draw = () => {
        const ids = Object.keys(shop.cart);
        doc.getElementById("rows").innerHTML = ids.length ? ids.map((id) => `<div class="row" data-id="${id}"><div><a href="/shop/product-details.${id}.html">${esc(NAMES[id][0])}</a><span>${NAMES[id][1]}</span></div>`
          + `<div class="qty"><button aria-label="Decrease quantity">-</button><div role="button" class="stepper-amount"><span>${shop.cart[id]} </span><span>- click to specify a quantity</span></div>`
          + `<button aria-label="Increase quantity">+</button><div style="display:none"><div role="button" class="stepper-qty-round"><span>${shop.cart[id]} </span></div></div></div></div>`).join("")
          : `<p>Your shopping cart is empty.</p><h2>Buy it again</h2>${past}`;
        for (const r of doc.querySelectorAll(".row")) for (const b of r.querySelectorAll("button")) b.addEventListener("click", () => {
          // Safeway's real cart page not taking a press yet (Nov 24 evening): `deafFor` ms after its load began, a press
          // does nothing at all; `deafOnce`: the first press on this page does nothing, however old the page is.
          if (shop.chaos.deafFor && Date.now() - built < shop.chaos.deafFor) { press(shop, "ignored"); return; }
          if (shop.chaos.deafOnce && !heard) { heard = true; press(shop, "ignored"); return; }
          t.after(250, () => pressed(r, b));
        });
      };
      const pressed = (r, b) => {
        const id = r.dataset.id, step = /Increase/.test(b.getAttribute("aria-label")) ? 1 : -1;
        press(shop, id);
        // Emptying the cart asks first, and only "Yes, remove" takes it out (as the real cart page, Oct 31).
        if (step < 0 && shop.cart[id] === 1 && Object.keys(shop.cart).length === 1) {
          const box = doc.createElement("div");
          box.innerHTML = "<p>Empty Safeway cart</p><p>Are you sure you want to remove all the items from your order?</p><button>No, don't remove</button><button>Yes, remove</button>";
          doc.body.append(box);
          const [no, yes] = box.querySelectorAll("button");
          no.addEventListener("click", () => box.remove());
          yes.addEventListener("click", () => { box.remove(); put(shop, id, 0); draw(); });
          return;
        }
        put(shop, id, (shop.cart[id] || 0) + step); draw();
      };
      const built = pageStart;
      let heard = false;
      t.after(400, draw);
    },
  };
}

/** Safeway's checkout page set for delivery (Nov 23): Order info's Continue, a delivery step's Edit, Place Order off. */
const deliveryCheckout = (shop) => ({
  html: `${bar(shop, true, "/erums/cart")}<main><h1>Checkout</h1><section><h2>Order info</h2><button id="continue">Continue</button></section>
    <section><h2>Delivery date &amp; time</h2><button id="edit">Delivery date &amp; time Edit</button><p>Delivery to your address</p></section>
    <button id="place" disabled>Place Order</button></main>`,
  run: () => { for (const id of ["continue", "edit", "place"]) doc.getElementById(id).addEventListener("click", () => press(shop, id)); },
});

/**
 * Safeway's checkout page for pickup (`shop.checkoutFor = "pickup"`), as scripts/extension-test.mjs has it: one day, its
 * free time, the pickup step's Continue (on once a time is chosen; then the step folds into its Edit), and Place Order,
 * every press counted.
 */
export const WINDOW = "slot-2026-11-24-1000";
const pickupCheckout = (shop) => ({
  html: `${bar(shop, true, "/erums/cart")}<main><h1>Checkout</h1><section><h2>Pickup date &amp; time</h2><div id="slots">
    <div class="date-tile date-is-active" role="button" aria-label="select slots for TUESDAY Nov, 24 Tue Nov 24">Tue 24</div>
    <div><label><input type="radio" name="slot" id="${WINDOW}"> 10:00 AM - 11:00 AM</label><span> price Free</span></div>
  </div><button id="go" disabled>Continue</button></section>
  <p>Estimated total $3.49</p><button id="place">Place Order</button></main>`,
  run: () => {
    doc.getElementById(WINDOW).addEventListener("click", () => { press(shop, "time"); doc.getElementById("go").disabled = false; });
    const go = doc.getElementById("go");
    go.addEventListener("click", () => { press(shop, "pickupContinue"); doc.getElementById("slots").innerHTML = "<p>Tue, Nov 24, 10:00 AM - 11:00 AM</p><button>Pickup date &amp; time Edit</button>"; go.remove(); });
    doc.getElementById("place").addEventListener("click", () => press(shop, "place"));
  },
});

/** Safeway's Purchases page: In-store showing first; Online shows "no orders", or an order placed today once `ordered`. */
function ordersPage(shop) {
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const online = shop.ordered ? `<div class="order-card"><p>Order #5550123</p><p>Placed ${today}</p><p>$4.12</p></div>` : "<p>You have no orders placed within the last 90 days.</p>";
  return {
    html: `${bar(shop, shop.signedIn, "/erums/cart")}<main><h1>Purchases</h1><div role="tablist"><button role="tab" id="store" aria-selected="true">In-store</button><button role="tab" id="online" aria-selected="false">Online</button></div><section id="list"><p>You have no orders placed within the last 90 days.</p></section></main>`,
    run: (t) => doc.getElementById("online").addEventListener("click", () => t.after(300, () => {
      press(shop, "online");
      doc.getElementById("online").setAttribute("aria-selected", "true");
      doc.getElementById("store").setAttribute("aria-selected", "false");
      doc.getElementById("list").innerHTML = online;
    })),
  };
}

/** Which page Safeway answers an address with, as it stands now. */
let current = null;
function serve(u) {
  const shop = current.shop;
  const p = u.pathname;
  if (p.startsWith("/shop/search-results")) return searchPage(shop, u.searchParams.get("q") ?? "");
  // Signed out (Nov 23), or signed in with Pickup not chosen: the cart's address sends the tab to the home page.
  // `goneAfter`: when; `goneShows`: the cart page shows first (its Checkout and all), as a page caught mid-redirect.
  if ((p === "/erums/cart" || p === "/erums/checkout") && shop.cartGone) {
    const first = shop.goneShows ? cartPage(shop) : { html: "<p>Loading…</p>" };
    return { html: first.html, run: (t) => { first.run?.(t); t.after(shop.goneAfter ?? 150, () => t.go("/")); } };
  }
  if (p === "/erums/cart") return cartPage(shop);
  if (p === "/erums/checkout") return shop.checkoutFor === "pickup" ? pickupCheckout(shop) : deliveryCheckout(shop);
  if (p === PAGE.orders.path) return ordersPage(shop);
  // Signed in, Safeway's sign-in page sends the tab on to its home page by itself (seen Nov 23).
  // Signed out, its box: an address field and "Sign in with Google" (saved real page, Nov 24), which sets the tab's address
  // to Safeway's sign-in service. `shop.google.hidden`: the box shows only after the page's Sign In is pressed.
  if (u.host === OKTA) return oktaPage(shop);
  if (u.host === GOOGLE) return googlePage(shop, u);
  if (p.startsWith("/bin/")) return { html: "<p>Signing in…</p>", run: (t) => { if (u.searchParams.get("code") === "ok") { shop.signedIn = true; shop.sessionGone = false; shop.cartGone = false; } t.after(200, () => t.go("/")); } };
  // `signInAtOnce` (live, Nov 25): signed in, Safeway's server answers its sign-in address with its home page.
  if (p === "/account/sign-in.html" && shop.signInAtOnce && shop.signedIn && !shop.sessionGone) return { redirect: "/" };
  if (p === "/account/sign-in.html") return signInPage(shop);
  // The home page signed out as on Nov 23: the name it remembers, Sign In there but hidden.
  if (shop.cartGone) return withBox(shop, { html: '<div class="menu-nav"><a href="/erums/cart" aria-label="Cart">Cart</a> <button aria-label="Account menu">Hi, Sam</button><div style="display:none"><a href="/account/sign-in.html">Sign In</a></div></div><h1>Safeway</h1>' });
  return withBox(shop, { html: `<div class="menu-nav">${shop.signedIn ? "<button>Account</button>" : "<button>Sign in</button>"}</div><h1>Safeway</h1>` });
}

/**
 * Signing in through Google, as worked out from Safeway's real pages (Nov 24): Safeway's sign-in page, its sign-in
 * service (a hop in the same tab), and Google's "Choose an account" list (safeway/google chooser.html). `shop.google`:
 * `accounts`: the addresses listed; `signedIn`: the one Google signs straight back in (others ask for a password);
 * `ask`: what Google asks instead of the list ("password", "consent", "captcha"); `straight`: Google sends the tab back
 * without showing anything; `hidden`: Safeway's box needs its Sign In first. Every press counted in `shop.presses`.
 */
export const OKTA = "albertsons.okta.com", GOOGLE = "accounts.google.com";
export const SAM = "sam@example.com", ROBIN = "robin@example.com";
function signInPage(shop) {
  const g = shop.google ?? {};
  const box = `<div id="box" ${g.hidden ? 'style="display:none"' : ""}><h2>Welcome back!</h2><input id="user" aria-label="Email or mobile number"><button disabled>Sign in with password</button>
    <button id="google" aria-label="Sign in with Google"><img alt=""> Sign in with Google </button></div>`;
  return {
    html: `<div class="menu-nav"><button id="open">Sign In</button></div><h1>Sign in</h1>${box}`,
    run: (t) => {
      if (shop.signedIn && !shop.sessionGone) { t.after(300, () => t.go("/")); return; }
      doc.getElementById("open").addEventListener("click", () => { press(shop, "sign in"); doc.getElementById("box").style.display = "block"; });
      doc.getElementById("google").addEventListener("click", () => { press(shop, "google button"); t.go(`https://${OKTA}/oauth2/x/v1/authorize?idp=google`); });
    },
  };
}
const oktaPage = (shop) => ({ html: "<p>Redirecting…</p>", run: (t) => t.after(200, () => t.go(shop.google?.straight ? `${SAFEWAY}/bin/safeway/unified/sso/authorize?code=ok` : `https://${GOOGLE}/v3/signin/accountchooser?flowName=GlifWebSignIn`)) });
function googlePage(shop, u) {
  const g = shop.google ?? {};
  const ask = u.pathname.includes("/challenge/") ? "password" : g.ask;
  if (ask === "password") return { html: '<h1>Welcome</h1><input type="email" style="display:none"><input type="password" name="Passwd"><button>Next</button>' };
  if (ask === "captcha") return { html: '<h1>Sign in</h1><img id="captchaimg" src="x"><input type="text"><button>Next</button>' };
  if (ask === "consent") return { html: "<h1>Sign in to Safeway</h1><p>Google will share your name and email address.</p><button id=\"go\">Continue</button>", run: () => doc.getElementById("go").addEventListener("click", () => press(shop, "consent")) };
  const accounts = g.accounts ?? [SAM, ROBIN];
  return {
    html: `<h1>Choose an account</h1><ul>${accounts.map((a) => `<li><div role="link" tabindex="0" data-identifier="${a}" data-button-type="multipleChoiceIdentifier"><div>${a.split("@")[0]}</div><div>${a}</div></div></li>`).join("")}<li><div role="link" tabindex="0">Use another account</div></li></ul>`,
    run: (t) => {
      // Google builds its list a moment after the page loads.
      for (const el of doc.querySelectorAll("[data-identifier]")) el.addEventListener("click", () => {
        const a = el.getAttribute("data-identifier");
        press(shop, `google ${a}`);
        t.after(300, () => t.go(a === (g.signedIn ?? SAM) ? `${SAFEWAY}/bin/safeway/unified/sso/authorize?code=ok` : `https://${GOOGLE}/v3/signin/challenge/pwd`));
      });
    },
  };
}

/**
 * Safeway's Delivery-or-Pickup box on its home page (`shop.box`), as on the real site Nov 23 (safeway/pickup box.html):
 * the header button opens it; the Pickup tab shows store cards (street first, then "Select" or "Selected"). Select saves
 * Pickup there: the note says "Dug" and the cart works again. `shop.box.stores`: the streets; `selected`: the one chosen.
 * `shop.box.noTake`: Select does nothing (Safeway didn't take it).
 * `mode: "InStore"` (live, Nov 25, Robin's account): the header button shows the store ("Instore at <street>"), twice (one
 * per screen size, one showing), with Safeway's own div and span inside; the box opens on its In Store tab, whose cards
 * say "Selected" for the store, and the Pickup tab's cards (street, town, "DriveUp & Go", distance) say "Select" for
 * it. `late`: the header's button is built this long after the page loads (as Safeway's script does).
 */
export const OUR_STREET = "100 Main St", OTHER_STREET = "200 Oak Ave";
function withBox(shop, page) {
  const b = shop.box;
  if (!b) return page;
  const stores = b.stores ?? [OUR_STREET, OTHER_STREET];
  const inStore = b.mode === "InStore";
  const chosen = (st) => st === b.selected && !inStore;
  const card = (st) => `<div class="card-store row"><div class="caption"><p>${st}</p><p>Petaluma, CA 00000</p>${inStore ? "<p>DriveUp &amp; Go</p><p>1.2 mi</p>" : ""}</div><div class="caption">${chosen(st)
    ? '<a href="#" role="button" aria-disabled="true" class="card-store-btn-disabled">Selected</a>'
    : `<a href="#" role="button" class="card-store-btn" data-street="${st}">Select</a>`}</div></div>`;
  const storeCard = (st) => `<div class="card-store row"><div class="caption"><p>${st}</p><p>Petaluma, CA 00000</p></div><div class="caption"><a href="#" role="button" class="card-store-btn" data-instore="${st}">${st === b.selected ? "Selected" : "Select"}</a></div></div>`;
  const header = inStore
    ? [true, false].map((wide) => `<button id="openFulfillmentModalButton" ${wide ? "" : 'style="display:none"'}><div id="fulFillMentAddressNav" role="button"><span class="s_nav_fulfillment_address-text" aria-label="Instore at ${b.selected}">${b.selected}</span></div></button>`).join("")
    : `<button id="openFulfillmentModalButton">${b.mode === "Delivery" ? "Delivery to 00000" : "Pickup at somewhere"}</button>`;
  const html = `<div id="hdr">${b.late ? "" : header}</div>${page.html}
    <div id="storeFulfillmentModal" role="dialog" aria-label="Store Fulfilment Modal" style="display:none"><button id="closeFulfillmentModalButton" aria-label="Close">x</button>
      <a id="modal-tab-instore-btn" role="tab" aria-selected="${inStore}">In Store</a>
      <a id="modal-tab-delivery-btn" role="tab" aria-selected="${b.mode === "Delivery"}">Delivery</a>
      <a id="modal-tab-pickup-btn" role="tab" aria-selected="false">Pickup</a>
      <div id="fulfilmentInstore" style="display:${inStore ? "block" : "none"}">${inStore ? stores.map(storeCard).join("") : ""}</div>
      <div id="fulfilmentDelivery" style="display:${b.mode === "Delivery" ? "block" : "none"}"><p>Deliver to 00000</p></div>
      <div id="fulfilmentPickup" style="display:none">${stores.map(card).join("")}</div></div>`;
  return { ...page, html, run: (t) => {
    page.run?.(t);
    const box = doc.getElementById("storeFulfillmentModal");
    const wire = () => { for (const o of doc.querySelectorAll("#openFulfillmentModalButton")) o.onclick = () => { press(shop, "box"); box.style.display = "block"; }; };
    if (b.late) t.after(b.late, () => { doc.getElementById("hdr").innerHTML = header; wire(); }); else wire();
    doc.getElementById("closeFulfillmentModalButton").onclick = () => { press(shop, "close"); box.style.display = "none"; };
    doc.getElementById("modal-tab-delivery-btn").onclick = () => press(shop, "delivery tab");
    doc.getElementById("modal-tab-instore-btn").onclick = () => press(shop, "instore tab");
    for (const a of doc.querySelectorAll("#fulfilmentInstore a[data-instore]")) a.onclick = () => press(shop, `instore select ${a.dataset.instore}`);
    doc.getElementById("modal-tab-pickup-btn").onclick = (e) => { press(shop, "pickup tab"); e.target.setAttribute("aria-selected", "true"); doc.getElementById("modal-tab-instore-btn").setAttribute("aria-selected", "false"); doc.getElementById("fulfilmentDelivery").style.display = "none"; t.after(300, () => { doc.getElementById("fulfilmentInstore").style.display = "none"; doc.getElementById("fulfilmentPickup").style.display = "block"; }); };
    for (const a of doc.querySelectorAll("#fulfilmentPickup a[data-street]")) a.onclick = () => {
      press(shop, `select ${a.dataset.street}`);
      if (b.noTake) return;
      // Signed out for real (`shop.sessionGone`), Safeway takes the choice for a guest, and its cart still sends the tab home.
      t.after(400, () => { b.selected = a.dataset.street; b.mode = "Dug"; if (!shop.sessionGone) { shop.cartGone = false; if (!b.quietNote) current.note({ userType: "C", preference: "Dug" }); } box.style.display = "none"; });
    };
  } };
}
