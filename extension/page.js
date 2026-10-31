// Runs inside the safeway.com page, passed to chrome.scripting.executeScript, so it must not use anything from outside
// itself. It only reads what's on screen and presses Safeway's own buttons, the same ones a person presses, one at a
// time. It never signs in and never goes near checkout.
//
// How Safeway's pages are built (which parts hold a product, its title, price and buttons, and what those buttons say)
// comes from Simmer as `P` (`PAGE` in Simmer's src/lib/safeway-helper.mjs), so when Safeway changes its pages, Simmer is
// what changes and the helper picks it up on its next run.

/**
 * safewayPage("read") → { signedIn, loading, noResults, cartCount, tiles, products: [{ id, name, price, image, inCart, qty }] }
 *   tiles: { [id]: what that product's Add button says now ("" when there's none), for every product on the page }
 * safewayPage("add", { id, times }) → { ok, qty, sure, snapshot? }
 * safewayPage("setQty", { id, qty, wait }) → { ok, qty, name, price, image }
 * safewayPage("snapshot", { id }) → that product's part of the page, for fixing this file when Safeway changes
 *
 * "In the cart" is read two ways, because Safeway's own sign of it has changed before: the product's Add button turns
 * into a quantity (+ / - / a number), or the cart count at the top of the page goes up.
 */
export async function safewayPage(action, arg, P) {
  const re = (pattern) => new RegExp(pattern, "i");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const label = (el) => `${el.getAttribute("aria-label") ?? ""} ${el.innerText ?? el.textContent ?? ""}`.replace(/\s+/g, " ").trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
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
  const parentOf = (el) => el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null);
  const buttons = (root) => deepAll(root, "button, [role=button]").filter(visible);
  const addButton = (card) => buttons(card).find((b) => re(P.add.label).test(label(b)) && !re(P.add.not).test(label(b)));
  const plusButton = (card) => buttons(card).find((b) => re(P.plus).test(label(b)));
  const minusButton = (card) => buttons(card).find((b) => re(P.minus).test(label(b)));
  const qtyBox = (card) => deepAll(card, P.qtyBox)[0];
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
    const n = Number(input?.value || input?.getAttribute("aria-valuenow") || (input?.textContent ?? "").trim());
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
      seen.set(id, { id, name, price, image: img?.currentSrc || img?.src || "", inCart, qty: inCart ? qtyOf(card) : 0, card });
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

  if (action === "read") {
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

  if (action === "add") {
    const { id, times } = arg;
    const find = () => products().find((p) => p.id === id);
    let p = find();
    if (!p) return { ok: false, why: "gone" };
    p.card.scrollIntoView({ block: "center" });
    await sleep(600);
    if (!p.inCart) {
      const add = addButton(p.card);
      if (!add) return { ok: false, why: "no-add", snapshot: snapshot(id) };
      const before = { count: cartCount(), add: label(add) };
      add.click();
      // Wait for Safeway to show it's in the cart: the Add button turns into a quantity, or the cart count goes up.
      let counted = false, changed = false;
      for (let i = 0; i < 20; i++) {
        await sleep(400);
        p = find();
        const now = cartCount();
        counted = before.count !== null && now !== null && now > before.count;
        changed = (tiles()[id] ?? "") !== before.add;
        if (p?.inCart || counted) break;
      }
      // With no cart count to read, a changed Add button is the only sign left; trust it, but say so.
      if (!p?.inCart && !counted && !(before.count === null && changed)) return { ok: false, why: "not-added", snapshot: snapshot(id) };
      if (!p?.inCart) return { ok: true, qty: 1, sure: counted, snapshot: snapshot(id) };
    }
    for (let n = p.qty || 1; n < times; n++) {
      const plus = plusButton(p.card);
      if (!plus) break;
      plus.click();
      await sleep(1200);
      p = find() ?? p;
    }
    p = find() ?? p;
    return { ok: true, qty: p.qty || 1, sure: true };
  }

  // Sets how many of a product are in the cart (0 takes it out), pressing Add, + or − one at a time and waiting for
  // Safeway to show each change. Answers { ok, qty, name, price, image }, qty being what the page shows at the end.
  if (action === "setQty") {
    const { id, qty: want, wait = 10000 } = arg;
    const find = () => products().find((p) => p.id === id);
    let p = find();
    if (!p) return { ok: false, why: "not-found" };
    p.card.scrollIntoView({ block: "center" });
    await sleep(500);
    const settle = async (changed) => { for (let t = 0; t < wait; t += 400) { await sleep(400); p = find(); if (changed(p)) return true; } return false; };
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
      if (!(await settle((x) => !x || (x.inCart ? x.qty || 1 : 0) !== before))) break;
    }
    p = find();
    return { ok: now() === want, qty: now(), ...about };
  }

  if (action === "snapshot") return snapshot(arg.id);

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

  return null;
}
