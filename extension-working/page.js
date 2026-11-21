// Runs inside the safeway.com page, passed to chrome.scripting.executeScript, so it must not use anything from outside
// itself. It only reads what's on screen and presses Safeway's own buttons, the same ones a person presses, one at a
// time. It never signs in. Checkout: it presses the cart page's Checkout, the suggestions page's Continue, the checkout
// page's Order info Continue, its pickup step's Edit, a pickup day, More times, the one time picked, the bags switch,
// and Place Order only in `placeOrder`, only on what Face ID approved (docs/CHECKOUT.md).
//
// How Safeway's pages are built (which parts hold a product, its title, price and buttons, and what those buttons say)
// comes from Simmer as `P` (`PAGE` in Simmer's src/lib/safeway-helper.mjs), so when Safeway changes its pages, Simmer is
// what changes and the helper picks it up on its next run.

/**
 * safewayPage("read") → { signedIn, loading, noResults, cartCount, tiles, products: [{ id, name, price, image, inCart, qty }] }
 *   tiles: { [id]: what that product's Add button says now ("" when there's none), for every product on the page }
 * safewayPage("setQty", { id, qty, wait }) → { ok, qty, name, price, image }
 * safewayPage("snapshot", { id }) → that product's part of the page, for fixing this file when Safeway changes
 * safewayPage("orders", { wait, hold }) → Safeway's Purchases page, Online tab (pressed once if another shows), watched up to
 *   `wait` for an order or a held "no orders": { signedIn, online, pressed, none, entries, text }
 * safewayPage("look") → { url, title, text, links: [{ text, href }], buttons: [label] } — reads only, presses nothing
 * safewayPage("pressCheckout", { path, words }) → { pressed, found, label } — on that page only: presses its one
 *   Checkout or Continue button made only of `words`, and nothing else
 * safewayPage("readWindows") → { windows: [{ id, checked, off, words }], days: [{ label, active }] } — reads only
 * safewayPage("chooseWindow", { path, id }) → { pressed, words } — on the checkout page only: the one free window chosen
 * safewayPage("pressDay", { path, label? }) → { pressed, found, label } — on the checkout page only: presses the first
 *   pickup day not chosen yet, or the one with exactly that label (never a time), and nothing else
 * safewayPage("pressPickupEdit", { path }) → { pressed, found, label } — on the checkout page only: presses its one
 *   "Pickup date & time Edit" button, which reopens the pickup times, and nothing else
 * safewayPage("pressMoreTimes", { path }) → { pressed, found, label } — on the checkout page only: presses its one
 *   "More times" button (the day's times past the first five), and nothing else
 * safewayPage("placeOrder", { path, expect }) → { pressed, why, label } — on the checkout page only, the one press that
 *   orders (phase 3, Nov 14): the page read again first and checked against what was approved (`expect`); any
 *   difference, a card detail asked for, or not exactly one "Place Order": nothing is pressed
 * safewayPage("waitFor", { until, label?, dd?, count?, id?, qty?, own?, onlyInCart?, hold?, ms }) → { ok, held? } — reads
 *   only: answers as soon as the page shows what's named (watching the page change), or after `ms` at most with whether
 *   it does then
 *
 * "In the cart" is read two ways, because Safeway's own sign of it has changed before: the product's Add button turns
 * into a quantity (+ / - / a number), or the cart count at the top of the page goes up.
 */
export async function safewayPage(action, arg, P) {
  const re = (pattern) => new RegExp(pattern, "i");
  const label = (el) => `${el.getAttribute("aria-label") ?? ""} ${el.innerText ?? el.textContent ?? ""}`.replace(/\s+/g, " ").trim();
  const wordsOf = (el) => (el ? (el.innerText ?? el.textContent ?? "") : "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  // Safeway's one bags switch, "Bring your own bag" (Nov 16), for setting it and for Place Order's check.
  // Shown on the page: the switch, or the label it sits in (a styled switch hides its own box).
  const bagSwitches = () => deepAll(document, "input[type=checkbox], [role=switch]")
    .filter((e) => /^bring your own bags?\b/i.test(label(e)) && (visible(e) || Boolean(e.closest("label") && visible(e.closest("label")))));
  const isOn = (e) => Boolean(e.checked) || e.getAttribute("aria-checked") === "true";
  const idOf = (a) => a.getAttribute("href")?.match(re(P.link.pattern))?.[1] ?? null;
  // Safeway builds parts of its pages from components that keep their insides in a separate layer (a shadow root),
  // which plain lookups don't see, so every lookup here goes into those layers too, and climbs back out of them.
  function deepAll(root, sel) {
    const out = [...root.querySelectorAll(sel)];
    const walk = (r) => { for (const el of r.querySelectorAll("*")) if (el.shadowRoot) { out.push(...el.shadowRoot.querySelectorAll(sel)); walk(el.shadowRoot); } };
    walk(root);
    if (root.shadowRoot) { out.push(...root.shadowRoot.querySelectorAll(sel)); walk(root.shadowRoot); }
    return out;
  }
  /** Every shadow layer on the page, to watch them too (a change inside one isn't seen from the document). */
  function shadowRoots(root = document, out = []) {
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) { out.push(el.shadowRoot); shadowRoots(el.shadowRoot, out); }
    return out;
  }
  /**
   * Watching the page (Sam, Nov 14: guessed pauses are fragile): `check` runs as the page changes, its shadow layers
   * too, and the first truthy answer is the answer; after `ms` at most, whatever it says then. A busy page changes many
   * times a second, so it runs at most every 50 ms, and once after the last change (Nov 19: it walked the whole page on
   * every change; not per animation frame, as a tab in the background gets none). `check(soon)` may ask to be run again
   * after a moment with nothing changing (a total that must hold still, "no results" that must last).
   */
  function watch(check, ms) {
    return new Promise((resolve) => {
      const roots = new Set();
      let last = 0, later = null, again = null, done = false;
      const finish = (v) => { if (done) return; done = true; seen.disconnect(); clearTimeout(later); clearTimeout(again); clearTimeout(limit); resolve(v); };
      const soon = (wait) => { clearTimeout(again); again = setTimeout(run, wait); };
      const seen = new MutationObserver(() => run());
      const observe = (r) => { if (!roots.has(r)) { roots.add(r); seen.observe(r, { subtree: true, childList: true, attributes: true, characterData: true }); } };
      function run() {
        if (done) return;
        const wait = 50 - (Date.now() - last);
        if (wait > 0) { if (!later) later = setTimeout(() => { later = null; run(); }, wait); return; }
        last = Date.now();
        // A check that throws on a page it doesn't expect counts as "not yet" (Nov 21: one threw at the limit on the real
        // cart page, the watch never finished, and the helper sat on that job for good).
        let v = false;
        try { shadowRoots().forEach(observe); v = check(soon); } catch { v = false; }
        if (v) finish(v);
      }
      observe(document);
      const last_ = () => { try { return check(() => {}) || null; } catch { return null; } };
      const limit = setTimeout(() => finish(last_()), Math.min(Number(ms) || 15000, 30000));
      run();
    });
  }
  const parentOf = (el) => el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);
  const buttons = (root) => deepAll(root, "button, [role=button]").filter(visible);
  const addButton = (card) => buttons(card).find((b) => re(P.add.label).test(label(b)) && !re(P.add.not).test(label(b)));
  const plusButton = (card) => buttons(card).find((b) => re(P.plus).test(label(b)));
  const minusButton = (card) => buttons(card).find((b) => re(P.minus).test(label(b)));
  // A page can hold a hidden copy of the quantity box (one per screen size) that doesn't change: the one showing counts.
  const qtyBox = (card) => { const all = deepAll(card, P.qtyBox); return all.find(visible) ?? all[0]; };
  const links = (root) => deepAll(root, P.link.selector);
  /** In the cart: the Add button has turned into a quantity (a + or - button, or a quantity box). */
  const inCartNow = (card) => !addButton(card) && !!(plusButton(card) || minusButton(card) || qtyBox(card));

  /** The smallest box around a product link that holds that product and no other. */
  function cardFor(a) {
    const id = idOf(a);
    let el = a, best = null;
    for (let i = 0; i < 12 && parentOf(el); i++) {
      el = parentOf(el);
      const ids = new Set(links(el).map(idOf).filter(Boolean));
      if (ids.size > 1 || !ids.has(id)) break;
      best = el;
      if (addButton(el) || inCartNow(el)) return el;
    }
    return best;
  }

  function qtyOf(card) {
    const input = qtyBox(card);
    // A box's number, or the first number in its words: Safeway's cart page writes "3 - click to specify a quantity".
    const n = Number(input?.value || input?.getAttribute("aria-valuenow") || (input?.textContent ?? "").match(/\d+/)?.[0]);
    if (n > 0) return n;
    const m = card.innerText.match(re(P.inCartText));
    return m ? Number(m[1]) : 1;
  }

  const TILE = P.tile;
  const TITLE = P.title;
  /** Every product tile on the page: { id, card, title } — Safeway's tiles first, then old-style product links. */
  function cards() {
    const out = new Map();
    const tiles = deepAll(document, TILE);
    for (const t of deepAll(document, TITLE)) {
      let up = t;
      while (up && !tiles.includes(up)) up = parentOf(up);
      if (!up) { up = t; for (let i = 0; i < 8 && parentOf(up) && deepAll(parentOf(up), TITLE).length === 1; i++) up = parentOf(up); }
      const id = deepAll(up, P.tileId.selector).map((x) => x.id.match(re(P.tileId.pattern))?.[1]).find(Boolean);
      if (id && !out.has(id) && visible(t)) out.set(id, { id, card: up, title: (t.innerText || t.textContent || "").replace(/\s+/g, " ").trim() });
    }
    for (const a of links(document)) {
      const id = idOf(a);
      if (!id || out.has(id) || !visible(a)) continue;
      const card = cardFor(a);
      if (card) out.set(id, { id, card, title: (a.getAttribute("aria-label") || a.innerText || "").replace(/\s+/g, " ").trim() });
    }
    return [...out.values()];
  }

  /**
   * A product's whole name. Safeway shortens long titles on screen ("Pop-Tarts Toaster Pastries Fro...s 12 Count"), so
   * when the title is shortened the longest unshortened name among its title's own attributes, its picture's
   * description and its buttons' labels ("Add <name>", with `P.fullName` taken off the front) is used instead.
   */
  const short = (s) => /\.{3}|…/.test(s);
  function fullName(card, title, img) {
    if (title && !short(title)) return title;
    const t = deepAll(card, TITLE)[0];
    const strip = P.fullName ? re(P.fullName) : null;
    const options = [t?.getAttribute("title"), t?.getAttribute("aria-label"), img?.alt, ...buttons(card).map((b) => (b.getAttribute("aria-label") ?? "").replace(strip ?? /^/, ""))]
      .map((x) => (x ?? "").replace(/\s+/g, " ").trim()).filter((x) => x && !short(x) && x.length > 3 && (!strip || !re(P.add.label).test(x)));
    const first = (title || "").split(/\.{3}|…/)[0].trim().toLowerCase();
    const best = options.filter((x) => !first || x.toLowerCase().startsWith(first)).sort((a, b) => b.length - a.length)[0];
    return best || title || (img?.alt ?? "").trim();
  }

  /**
   * A product's picture address. Safeway loads pictures as they're scrolled to: one further down has no picture yet,
   * only its address waiting in `data-src` (or a `data-srcset` / `srcset` beside it), so those are read too.
   */
  function picture(img) {
    if (!img) return "";
    const near = [img, ...(img.parentElement ? [...img.parentElement.querySelectorAll("source")] : [])];
    for (const name of P.imageAttrs ?? ["currentSrc", "src", "data-src"]) {
      for (const el of near) {
        const v = (name === "currentSrc" || name === "src" ? el[name] : el.getAttribute(name)) || "";
        const first = String(v).trim().split(/[\s,]/)[0];
        if (first && !/^data:|^blob:/.test(first)) return first.startsWith("//") ? `https:${first}` : first;
      }
    }
    return "";
  }

  function products() {
    const seen = new Map();
    for (const { id, card, title } of cards()) {
      if (seen.has(id)) continue;
      const img = deepAll(card, "img")[0];
      const name = fullName(card, title, img);
      if (!name) continue;
      const add = addButton(card), inCart = inCartNow(card);
      if (!add && !inCart) continue;
      const price = (deepAll(card, P.price.selector)[0]?.innerText ?? card.innerText).match(re(P.price.pattern))?.[0] ?? "";
      seen.set(id, { id, name, price, image: picture(img), inCart, qty: inCart ? qtyOf(card) : 0, card });
    }
    return [...seen.values()];
  }

  /** The number on the cart at the top of the page, or null if there isn't one to read. */
  function cartCount() {
    const top = deepAll(document, P.cart.selector).filter(visible);
    const counts = top.filter((el) => re(P.cart.label).test(label(el) + " " + (el.getAttribute("data-qa") ?? ""))).map((el) => label(el).match(/\b(\d{1,3})\b/)?.[1]).filter(Boolean).map(Number);
    return counts.length ? Math.max(...counts) : null;
  }

  /** Every product on the page and what its Add button says, so a change after a tap can be seen. */
  function tiles() {
    const out = {};
    for (const { id, card } of cards()) if (!(id in out)) { const add = addButton(card); out[id] = add ? label(add) : ""; }
    return out;
  }

  const cardOf = (id) => cards().find((c) => c.id === id)?.card ?? null;

  /** A product's part of the page, without pictures or styling, small enough to paste. */
  function snapshot(id) {
    const card = cardOf(id);
    if (!card) return "";
    const copy = card.cloneNode(true);
    copy.querySelectorAll("script, style, svg, img, picture, source").forEach((el) => el.replaceWith(document.createTextNode(`[${el.tagName.toLowerCase()}]`)));
    copy.querySelectorAll("*").forEach((el) => { el.removeAttribute("style"); el.removeAttribute("srcset"); });
    return `cart count: ${cartCount()}\n${copy.outerHTML.replace(/\s+/g, " ").slice(0, 6000)}`;
  }

  const strip = (p) => ({ id: p.id, name: p.name, price: p.price, image: p.image, inCart: p.inCart, qty: p.qty });

  function readPage() {
    const header = document.querySelector("header") ?? document.body;
    const signInShown = buttons(header).concat([...header.querySelectorAll("a")]).some((el) => visible(el) && re(P.signIn).test(label(el)));
    const text = document.body.innerText;
    const list = products();
    return {
      signedIn: !signInShown,
      cartCount: cartCount(),
      tiles: tiles(),
      noResults: re(P.noResults).test(text),
      loading: !list.length && !re(P.noResults).test(text),
      products: list.slice(0, 40).map(strip),
    };
  }
  if (action === "read") return readPage();


  // Checkout, read-only (Nov 12, docs/CHECKOUT.md phase 1): what the page says, its links (with where they go) and its
  // buttons' words. Nothing here presses, types, or changes anything.
  if (action === "look") {
    const words = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    const links = deepAll(document, "a[href]").filter(visible).map((a) => ({ text: label(a).slice(0, 80), href: a.href })).filter((l) => l.text).slice(0, 80);
    // Checkout-sounding buttons first, so a page full of products can't push them past the 80 kept (Nov 12).
    const key = /check\s*out|continue|place|order|pay|submit|review|pick\s*up|time|window/i;
    const buttons = deepAll(document, "button, [role=button], input[type=submit]").filter(visible).map((b) => (label(b) || b.value || "").slice(0, 80)).filter(Boolean)
      .sort((a, b) => Number(key.test(b)) - Number(key.test(a))).slice(0, 80);
    return { url: location.href, title: document.title, text: words(document.body).slice(0, 12000), links, buttons };
  }

  // The checkout look's presses (Nov 12, Sam: "Checkout only", then "Continue only"): on the one page named (`path`, exact),
  // a visible, enabled button whose every word is one of `words` and that says "checkout" or "continue", only when
  // there's exactly one, pressed once. Simmer's helper asks for the cart page's Checkout ("Safeway Checkout Checkout")
  // then the suggestions page's Continue, then the checkout page's Order info Continue. Anything else: nothing is pressed.
  if (action === "pressCheckout") {
    const allowed = new Set((arg?.words ?? []).map((w) => String(w).toLowerCase()));
    if (!arg?.path || location.pathname !== arg.path) return { pressed: false, found: 0, label: "", why: "not that page" };
    const fits = (t) => { const w = t.toLowerCase().split(" ").filter(Boolean); return w.some((x) => x === "checkout" || x === "continue") && w.every((x) => allowed.has(x)); };
    const found = deepAll(document, "button, [role=button], input[type=submit]").filter(visible)
      .filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && fits(label(b) || b.value || ""));
    if (found.length !== 1) return { pressed: false, found: found.length, label: "" };
    const said = label(found[0]).slice(0, 80); // before the press: Safeway's button turns into "Processing"
    found[0].click();
    return { pressed: true, found: 1, label: said };
  }

  // A pickup day on the checkout page (Sam, Nov 12: "a day only"), to see that day's windows: only on that page, only a
  // button that reads exactly "select slots for <WEEKDAY> <Mon>, <day> …" (Safeway's day tabs), the first one not already
  // chosen, pressed once. Never a time window. Anything else: nothing is pressed.
  if (action === "pressDay") {
    if (!arg?.path || location.pathname !== arg.path) return { pressed: false, found: 0, label: "", why: "not that page" };
    const day = /^select slots for (MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY) [A-Z][a-z]{2}, \d{1,2} (Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2}$/;
    const found = deepAll(document, "button, [role=button]").filter(visible)
      .filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && day.test(label(b)))
      // Getting ready and test runs name the day tile exactly (as readWindows gave it).
      .filter((b) => !arg.label || label(b) === arg.label);
    if (!found.length) return { pressed: false, found: 0, label: "" };
    const said = label(found[0]).slice(0, 80);
    found[0].click();
    return { pressed: true, found: found.length, label: said };
  }

  // Reopening the pickup times (Sam, Nov 14): once a time is chosen Safeway folds that step into one line with an Edit
  // button, and the times aren't on the page. Only on the checkout page, only a button that reads exactly "Pickup date &
  // time Edit", only when there's exactly one, pressed once. It commits to nothing. Anything else: nothing is pressed.
  if (action === "pressPickupEdit") {
    if (!arg?.path || location.pathname !== arg.path) return { pressed: false, found: 0, label: "", why: "not that page" };
    const exact = (t) => t.replace(/\s+/g, " ").trim().toLowerCase() === "pickup date & time edit";
    const found = deepAll(document, "button, [role=button]").filter(visible)
      .filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && exact(label(b)));
    if (found.length !== 1) return { pressed: false, found: found.length, label: "" };
    // Never a button that would send a form (outside review, Nov 14): an Edit only opens; one that submits isn't pressed.
    if (found[0].form && (found[0].type ?? "submit") === "submit" && found[0].tagName === "BUTTON") return { pressed: false, found: 1, label: "", why: "submits a form" };
    const said = label(found[0]).slice(0, 80);
    found[0].click();
    return { pressed: true, found: 1, label: said };
  }

  // Placing the order (docs/CHECKOUT.md phase 3, Sam, Nov 14: "Build it"). The only press anywhere that orders. Done
  // only when Simmer asks with what Face ID approved (`expect`), and only when the page, read again right here before
  // the press, says exactly that: the total once, the item count, the card's last 4, the store, the pickup day and time,
  // no card detail asked for, and exactly one visible, enabled button that says "Place Order". Pressed once; never again.
  if (action === "placeOrder") {
    const e = arg?.expect ?? {};
    if (!arg?.path || location.pathname !== arg.path) return { pressed: false, why: "not the checkout page" };
    const t = (document.body?.innerText ?? document.body?.textContent ?? "").replace(/\s+/g, " ");
    const count = (s) => (s ? t.split(s).length - 1 : 0);
    if (!e.total || count(`Estimated total ${e.total}`) !== 1) return { pressed: false, why: "total" };
    if (!e.items || count(`Safeway Items (${e.items})`) !== 1) return { pressed: false, why: "items" };
    if (!e.itemsLine || count(e.itemsLine) !== 1) return { pressed: false, why: "items subtotal" };
    // The card in the Payment line, where Safeway shows the one it will charge.
    if (!/^\d{4}$/.test(e.card ?? "") || !new RegExp(`Payment \\$[\\d,]+\\.\\d\\d (?:Visa|Mastercard|MasterCard|Amex|American Express|Discover)\\s*[•·*]+\\s*${e.card}\\b`).test(t)) return { pressed: false, why: "card" };
    // Another card's last 4 anywhere on the page: not this card for sure, so nothing is pressed.
    if (/[•·*]{2,}\s*\d{4}/.test(t.replace(new RegExp(`[•·*]+\\s*${e.card}\\b`, "g"), ""))) return { pressed: false, why: "another card" };
    if (!e.storeLine || count(e.storeLine) !== 1) return { pressed: false, why: "store" };
    if (!e.whenLine || count(e.whenLine) !== 1) return { pressed: false, why: "pickup time" };
    // A paid time (Flash): its slot line and price, exactly once.
    if (e.slotLine && count(e.slotLine) !== 1) return { pressed: false, why: "paid pickup time" };
    // The bags as approved (Nov 16): exactly one bags switch, set that way.
    if (typeof e.bagsOwn === "boolean") { const b = bagSwitches(); if (b.length !== 1 || isOn(b[0]) !== e.bagsOwn) return { pressed: false, why: "bags" }; }
    // Anywhere on the page, even run into other words (a copy of the page wrote "Confirm CVVPlace Order"): never a press.
    if (/CVV|security code|card number|expiration date/i.test(t)) return { pressed: false, why: "asks for card details" };
    const place = deepAll(document, "button, [role=button], input[type=submit]").filter(visible).filter((b) => (label(b) || b.value || "").trim() === "Place Order");
    if (place.length !== 1) return { pressed: false, why: `place order buttons: ${place.length}` };
    if (place[0].disabled || place[0].getAttribute("aria-disabled") === "true") return { pressed: false, why: "place order turned off" };
    // The approval's 2 minutes, checked last, right before the press (outside review, Nov 14).
    if (!(Number(e.deadline) > Date.now())) return { pressed: false, why: "approval ran out" };
    place[0].click();
    return { pressed: true, why: "", label: "Place Order" };
  }

  // Safeway's bags choice (Nov 16, Sam: "user chooses bags", his yes to setting it): one switch, "Bring your own bag",
  // on for bringing her own. `setBags` (only on the checkout page, only when there's exactly one such switch) presses it
  // once, and only when it isn't already as asked; it reads `own` back. Nothing else near it is touched.
  if (action === "bagsState") {
    const found = bagSwitches();
    const total = ((document.body?.innerText ?? "").replace(/\s+/g, " ").match(/Estimated total \$[\d,]+\.\d\d/) ?? [""])[0];
    return found.length === 1 ? { own: isOn(found[0]), total } : { own: null, found: found.length, total };
  }
  if (action === "setBags") {
    if (!arg?.path || location.pathname !== arg.path) return { pressed: false, why: "not that page" };
    const found = bagSwitches();
    if (found.length !== 1) return { pressed: false, why: `bag switches: ${found.length}` };
    const want = arg.own === true;
    if (isOn(found[0]) === want) return { pressed: false, ok: true, own: want };
    if (found[0].disabled || found[0].getAttribute("aria-disabled") === "true") return { pressed: false, why: "switch off" };
    found[0].click();
    return { pressed: true, own: isOn(found[0]) };
  }

  // The day's times past the first five (Sam, Nov 14: "the times offered are not the same as on the site"): only on
  // the checkout page, only a button that reads exactly "More times" (Safeway adds "collapsed" while it's closed), only
  // when there's exactly one, pressed once. It shows more times and chooses none. Anything else: nothing is pressed.
  if (action === "pressMoreTimes") {
    if (!arg?.path || location.pathname !== arg.path) return { pressed: false, found: 0, label: "", why: "not that page" };
    const found = deepAll(document, "button, [role=button]").filter(visible)
      .filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && /^more times( collapsed)?$/i.test(label(b)));
    if (found.length !== 1) return { pressed: false, found: found.length, label: "" };
    const said = label(found[0]).slice(0, 80);
    found[0].click();
    return { pressed: true, found: 1, label: said };
  }

  // Waiting for Safeway's page (Sam, Nov 14: guessed pauses are fragile): answers the moment the page shows what's
  // named, watching it change, with one limit for giving up. It reads only.
  if (action === "waitFor") {
    const all = () => deepAll(document, "button, [role=button]").filter(visible);
    const on = (b) => !b.disabled && b.getAttribute("aria-disabled") !== "true";
    const said = (re) => all().filter((b) => re.test(label(b)));
    const tiles = () => deepAll(document, ".date-tile[role=button]").filter(visible);
    const radios = () => deepAll(document, "input[type=radio][name=slot]");
    const pickupEdit = () => said(/^pickup date & time edit$/i).length > 0;
    const text = () => document.body?.innerText ?? document.body?.textContent ?? "";
    const totalNow = () => (text().replace(/\s+/g, " ").match(/Estimated total \$[\d,]+\.\d\d/) ?? [""])[0];
    // `products` and `settled` keep a little state between runs: since when "no results", and the total last seen.
    let noneSince = 0, total = null, totalSince = 0;
    const checks = {
      cart: () => said(/check\s*out/i).length > 0 || /sign back in|sign in to continue|cart is empty/i.test(text()),
      suggestions: () => said(/continue/i).length > 0,
      checkout: () => /pickup date & time/i.test(text()) || said(/^place order$/i).length > 0,
      times: () => tiles().length > 0 || radios().length > 0 || pickupEdit(),
      timesOpen: () => tiles().length > 0 || radios().length > 0,
      day: () => tiles().some((t) => label(t) === arg.label && t.classList.contains("date-is-active")) && radios().some((r) => r.id.endsWith(`-${arg.dd}`)),
      continueOn: () => all().filter((b) => on(b) && label(b).toLowerCase() === "continue").length === 1,
      picked: () => pickupEdit(),
      more: () => radios().length > (Number(arg?.count) || 0),
      // Safeway's order confirmation, once its words fill in (Nov 18).
      confirmed: () => /thank you|order (?:number|no\.?|#)|order (?:is |has been )?(?:placed|confirmed|received)/i.test(text()),
      // The one Place Order, turned on (Nov 15: Safeway keeps it off for a moment after the pickup time is set).
      placeOn: () => all().filter((b) => label(b).trim() === "Place Order").length === 1 && all().some((b) => label(b).trim() === "Place Order" && on(b)),
      // The one bags switch showing as asked (Nov 19: was read again every 250 ms).
      bags: () => { const b = bagSwitches(); return b.length === 1 && isOn(b[0]) === (arg?.own === true); },
      // Safeway's total, held the same for 2 s, counted again from each change (a bag fee coming or going, Nov 16).
      // With no total showing, only the page changing runs it again (Nov 19, review: it re-read the page every 50 ms).
      settled: (soon) => {
        const t = totalNow();
        if (t !== total) { total = t; totalSince = Date.now(); }
        if (!t) return false;
        const held = Date.now() - totalSince;
        if (held >= 2000) return true;
        soon(Math.max(50, 2000 - held));
        return false;
      },
      // A page's products (on the cart page only what's in the cart), Safeway signed out, or "no results" for the whole
      // hold, which it says for a moment while building (Oct 31).
      products: (soon) => {
        const r = readPage();
        if (r.signedIn === false || (arg?.onlyInCart ? r.products.some((x) => x.inCart) : r.products.length)) return { ok: true };
        if (!r.noResults) { noneSince = 0; return false; }
        noneSince ||= Date.now();
        const hold = Number(arg?.hold) || 4000;
        if (Date.now() - noneSince >= hold) return { ok: true, held: true };
        soon(Math.max(50, hold - (Date.now() - noneSince))); // once, when the hold is up; else only a change runs it
        return false;
      },
      // One product's count as asked (0: not in the cart).
      qty: () => { const p = products().find((x) => x.id === arg?.id); return Boolean(p) && (p.inCart ? p.qty || 1 : 0) === Number(arg?.qty); },
    };
    const ok = checks[arg?.until] ?? (() => false);
    const v = await watch((soon) => ok(soon), arg?.ms);
    return v && typeof v === "object" ? v : { ok: Boolean(v) };
  }

  // The pickup windows on the checkout page, read only (Nov 12): each window's radio id and words, and the day tiles.
  if (action === "readWindows") {
    const windows = deepAll(document, "input[type=radio][name=slot]").map((r) => ({
      id: r.id, checked: r.checked, off: r.disabled,
      words: wordsOf(r.closest("label, li, div")?.parentElement).slice(0, 160),
    }));
    const days = deepAll(document, ".date-tile[role=button]").filter(visible).map((t) => ({ label: label(t).slice(0, 80), active: t.classList.contains("date-is-active") }));
    return { windows, days };
  }

  // Choosing a pickup window, for dry runs (docs/CHECKOUT.md: every step for real, one press short of Place Order): only
  // on the checkout page, only the radio with exactly the id Simmer chose, only when its own words say "price Free".
  // Anything else: nothing is pressed.
  if (action === "chooseWindow") {
    if (!arg?.path || location.pathname !== arg.path || !arg?.id) return { pressed: false, why: "not that page" };
    const found = deepAll(document, "input[type=radio][name=slot]").filter((r) => r.id === arg.id && !r.disabled);
    if (found.length !== 1) return { pressed: false, why: "not there" };
    const words = wordsOf(found[0].closest("label, li, div")?.parentElement);
    // Free, unless Simmer asked for a paid one (Flash, with its price shown and approved; Nov 16), whose price must show.
    const isFree = /\bprice Free\b/i.test(words) && !/flash/i.test(words);
    if (!isFree && !(arg.paid === true && /\bprice \$[\d,]+\.\d\d\b/i.test(words))) return { pressed: false, why: "not free" };
    found[0].click();
    return { pressed: true, words: words.slice(0, 160), checked: found[0].checked };
  }

  // not-checkout:start (add, quantities, snapshots: never used by checkout; changes here need no test run, docs/CHECKOUT.md)
  // Sets how many of a product are in the cart (0 takes it out), pressing Add, + or − one at a time and waiting for
  // Safeway to show each change. Answers { ok, qty, name, price, image }, qty being what the page shows at the end.
  if (action === "setQty") {
    const { id, qty: want, wait = 10000 } = arg;
    const find = () => products().find((p) => p.id === id);
    let p = find();
    if (!p) return { ok: false, why: "not-found" };
    p.card.scrollIntoView({ block: "center" });
    // Each change waited for by watching the page (Nov 19: it looked again every 400 ms), up to `wait`.
    const settle = async (changed) => Boolean(await watch(() => { p = find(); return changed(p); }, wait));
    const now = () => (p?.inCart ? p.qty || 1 : 0);
    const about = { name: p.name, price: p.price, image: p.image };
    if (!p.inCart && want > 0) {
      const add = addButton(p.card);
      if (!add) return { ok: false, why: "no-add", qty: 0, ...about };
      const count = cartCount();
      add.click();
      await settle((x) => x?.inCart || (count !== null && (cartCount() ?? 0) > count));
      if (!p?.inCart) return { ok: false, why: "not-added", qty: 0, ...about };
    }
    for (let n = 0; n < 40 && p && now() !== want; n++) {
      const before = now();
      const button = before < want ? plusButton(p.card) : minusButton(p.card);
      if (!button) break;
      button.click();
      // Taking out the last one can ask "Are you sure?" (when it empties the cart): the trash in Simmer already said so.
      // Only on −: a + from 1 waited 3 s for a question that never comes (Nov 18: every change after Add took ~16 s).
      if (before === 1 && before > want && P.confirmRemove) {
        await watch(() => {
          const yes = buttons(document).find((b) => re(P.confirmRemove).test(label(b)));
          if (yes) { yes.click(); return true; }
          return !find();
        }, 3000);
      }
      if (!(await settle((x) => !x || (x.inCart ? x.qty || 1 : 0) !== before))) break;
    }
    p = find();
    return { ok: now() === want, qty: now(), ...about };
  }

  if (action === "snapshot") return snapshot(arg.id);
  // not-checkout:end
  // not-checkout:start (Purchases page and samples: never used by checkout)
  // Safeway's Purchases page (1.3): shows its Online tab (pressing it once when another is showing), then reads it.
  // Answers { signedIn, online (the Online tab found and showing), pressed, none ("no orders" said), entries (the words
  // of each order listed with a date), text (the page's words, to learn from) }. It only reads and presses that tab.
  if (action === "orders") {
    const O = P.orders;
    let pressed = false;
    const readOrders = () => {
      const header = document.querySelector("header") ?? document.body;
      const signedIn = !buttons(header).concat([...header.querySelectorAll("a")]).some((el) => visible(el) && re(P.signIn).test(label(el)));
      const tabs = deepAll(document, "[role=tab], button, a").filter((el) => visible(el) && re(O.tab).test((el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim()));
      const tab = tabs[0] ?? null;
      const showing = !!tab && (tab.getAttribute("aria-selected") === "true" || tab.getAttribute("aria-current") === "page" || tab.getAttribute("aria-current") === "true" || /\b(active|selected)\b/i.test(tab.className ?? ""));
      // The Online tab pressed once, only when another is showing.
      if (tab && !showing && !pressed) { tab.click(); pressed = true; }
      const text = (document.querySelector("main") ?? document.body).innerText.replace(/\s+/g, " ").trim();
      const dated = (el) => re(O.date).test((el.innerText ?? "").replace(/\s+/g, " "));
      const found = deepAll(document, O.entry).filter((el) => visible(el) && dated(el) && (el.innerText ?? "").length < 1500);
      // The smallest part holding each order: a part holding another dated part is the list, not an order.
      const entries = found.filter((el) => !found.some((x) => x !== el && el.contains(x))).slice(0, 10).map((el) => el.innerText.replace(/\s+/g, " ").trim().slice(0, 400));
      return { signedIn, online: !!tab && (showing || pressed), pressed, none: re(O.none).test(text), entries, text: text.slice(0, 2000) };
    };
    // Watched (Nov 19: it was read again every 800 ms) until an order with a date shows, or "no orders" has held for
    // `hold` (it may show for a moment while the page builds), or Safeway is signed out.
    let noneSince = 0, last = null;
    await watch((soon) => {
      const r = (last = readOrders());
      if (r.signedIn === false || (r.online && !r.none && r.entries.length)) return true;
      if (!(r.online && r.none)) { noneSince = 0; return false; }
      noneSince ||= Date.now();
      const hold = Number(arg?.hold) || 4000;
      if (Date.now() - noneSince >= hold) return true;
      soon(hold - (Date.now() - noneSince));
      return false;
    }, arg?.wait ?? 12000);
    return last ?? readOrders();
  }

  // A short account of the page when no products could be read: its Add buttons, product links and cart, and the
  // stretch of page around the first Add button. No pictures, nothing about the person.
  if (action === "sample") {
    const tidy = (el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll("script, style, svg, img, picture, source").forEach((x) => x.replaceWith(document.createTextNode(`[${x.tagName.toLowerCase()}]`)));
      copy.querySelectorAll("*").forEach((x) => { x.removeAttribute("style"); x.removeAttribute("srcset"); });
      return copy.outerHTML.replace(/\s+/g, " ");
    };
    const adds = buttons(document).filter((b) => /add/i.test(label(b)));
    let around = adds[0] ?? null;
    for (let i = 0; i < 6 && around && parentOf(around); i++) around = parentOf(around);
    return [
      `page: ${location.pathname}${location.search}`,
      `layers: ${deepAll(document, "*").filter((x) => x.shadowRoot).length}`,
      `tiles: ${deepAll(document, TILE).length}, titles: ${deepAll(document, TITLE).length}, products read: ${products().length}`,
      `cart count: ${cartCount()}`,
      `cart: ${deepAll(document, P.cart.links).filter(visible).slice(0, 4).map((x) => tidy(x).slice(0, 300)).join(" | ")}`,
      `add buttons (${adds.length}): ${adds.slice(0, 8).map(label).join(" | ")}`,
      `product links: ${deepAll(document, P.productLinks).slice(0, 5).map((a) => a.getAttribute("href")).join(" | ")}`,
      `around the first add: ${around ? tidy(around).slice(0, 5000) : "none"}`,
    ].join("\n");
  }
  // not-checkout:end

  return null;
}
