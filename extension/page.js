// Runs inside the safeway.com page, passed to chrome.scripting.executeScript, so it must not use anything from outside
// itself. It only reads what's on screen and presses Safeway's own buttons, the same ones a person presses, one at a
// time. It never signs in and never goes near checkout.
//
// Safeway's pages aren't documented and change, so products are found by what a person sees: each product links to
// its own page (/shop/product-details.<number>.html), and has an Add button, or a quantity with + and - once it's in
// the cart.

/**
 * safewayPage("read") → { signedIn, loading, noResults, cartCount, tiles, products: [{ id, name, price, image, inCart, qty }] }
 *   tiles: { [id]: what that product's Add button says now ("" when there's none), for every product on the page }
 * safewayPage("add", { id, times }) → { ok, qty, sure, snapshot? }
 * safewayPage("snapshot", { id }) → that product's part of the page, for fixing this file when Safeway changes
 *
 * "In the cart" is read two ways, because Safeway's own sign of it has changed before: the product's Add button turns
 * into a quantity (+ / - / a number), or the cart count at the top of the page goes up.
 */
export async function safewayPage(action, arg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const label = (el) => `${el.getAttribute("aria-label") ?? ""} ${el.innerText ?? el.textContent ?? ""}`.replace(/\s+/g, " ").trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const idOf = (a) => a.getAttribute("href")?.match(/product-details\.(\d+)\.html/)?.[1] ?? null;
  const buttons = (root) => [...root.querySelectorAll("button, [role=button]")].filter(visible);
  const addButton = (card) => buttons(card).find((b) => /^add\b/i.test(label(b)) && !/list|note|coupon|clip/i.test(label(b)));
  const plusButton = (card) => buttons(card).find((b) => /increase|increment|add one|add another|plus|^[+＋]$/i.test(label(b)));
  const minusButton = (card) => buttons(card).find((b) => /decrease|decrement|remove one|minus|^[-−–]$/i.test(label(b)));
  const qtyBox = (card) => card.querySelector('input[type="number"], input[aria-label*="quantity" i], input[name*="qty" i], [role="spinbutton"]');
  /** In the cart: the Add button has turned into a quantity (a + or - button, or a quantity box). */
  const inCartNow = (card) => !addButton(card) && !!(plusButton(card) || minusButton(card) || qtyBox(card));

  /** The smallest box around a product link that holds that product and no other. */
  function cardFor(a) {
    const id = idOf(a);
    let el = a, best = null;
    for (let i = 0; i < 10 && el.parentElement; i++) {
      el = el.parentElement;
      const ids = new Set([...el.querySelectorAll('a[href*="product-details."]')].map(idOf).filter(Boolean));
      if (ids.size > 1 || !ids.has(id)) break;
      best = el;
      if (addButton(el) || inCartNow(el)) return el;
    }
    return best;
  }

  function qtyOf(card) {
    const input = qtyBox(card);
    const n = Number(input?.value || input?.getAttribute("aria-valuenow"));
    if (n > 0) return n;
    const m = card.innerText.match(/(\d+)\s+in\s+cart/i);
    return m ? Number(m[1]) : 1;
  }

  function products() {
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="product-details."]')) {
      const id = idOf(a);
      if (!id || seen.has(id) || !visible(a)) continue;
      const card = cardFor(a);
      if (!card) continue;
      const img = card.querySelector("img");
      const name = (a.getAttribute("aria-label") || a.innerText || img?.alt || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      const add = addButton(card), inCart = inCartNow(card);
      if (!add && !inCart) continue;
      const price = card.innerText.match(/\$\d+(?:\.\d{2})?(?:\s*(?:each|\/\s*lb|\/\s*ea|per lb))?/i)?.[0] ?? "";
      seen.set(id, { id, name, price, image: img?.currentSrc || img?.src || "", inCart, qty: inCart ? qtyOf(card) : 0, card });
    }
    return [...seen.values()];
  }

  /** The number on the cart at the top of the page, or null if there isn't one to read. */
  function cartCount() {
    const top = [...document.querySelectorAll("header a, header button, [aria-label*='cart' i], [data-qa*='cart' i]")].filter(visible);
    const counts = top.filter((el) => /cart/i.test(label(el) + " " + (el.getAttribute("data-qa") ?? ""))).map((el) => label(el).match(/\b(\d{1,3})\b/)?.[1]).filter(Boolean).map(Number);
    return counts.length ? Math.max(...counts) : null;
  }

  /** Every product on the page and what its Add button says, so a change after a tap can be seen. */
  function tiles() {
    const out = {};
    for (const a of document.querySelectorAll('a[href*="product-details."]')) {
      const id = idOf(a);
      if (!id || id in out || !visible(a)) continue;
      const card = cardFor(a);
      if (card) { const add = addButton(card); out[id] = add ? label(add) : ""; }
    }
    return out;
  }

  function cardOf(id) {
    const a = [...document.querySelectorAll(`a[href*="product-details.${id}."]`)].find(visible);
    return a ? cardFor(a) : null;
  }

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
    const signInShown = buttons(header).concat([...header.querySelectorAll("a")]).some((el) => visible(el) && /^sign in$/i.test(label(el)));
    const text = document.body.innerText;
    const list = products();
    return {
      signedIn: !signInShown,
      cartCount: cartCount(),
      tiles: tiles(),
      noResults: /no (search )?results for/i.test(text),
      loading: !list.length && !/no (search )?results for/i.test(text),
      products: list.slice(0, 24).map(strip),
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

  if (action === "snapshot") return snapshot(arg.id);

  return null;
}
