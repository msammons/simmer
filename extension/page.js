// Runs inside the safeway.com page, passed to chrome.scripting.executeScript, so it must not use anything from outside
// itself. It only reads what's on screen and presses Safeway's own buttons, the same ones a person presses, one at a
// time. It never signs in and never goes near checkout.
//
// Safeway's pages aren't documented and change, so products are found by what a person sees: each product links to
// its own page (/shop/product-details.<number>.html), and has an Add button, or a quantity with + and - once it's in
// the cart.

/**
 * safewayPage("read") → { signedIn, loading, noResults, products: [{ id, name, price, image, inCart, qty }] }
 * safewayPage("add", { id, times }) → { ok, qty, why? }
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

  const strip = (p) => ({ id: p.id, name: p.name, price: p.price, image: p.image, inCart: p.inCart, qty: p.qty });

  if (action === "read") {
    const header = document.querySelector("header") ?? document.body;
    const signInShown = buttons(header).concat([...header.querySelectorAll("a")]).some((el) => visible(el) && /^sign in$/i.test(label(el)));
    const text = document.body.innerText;
    const list = products();
    return {
      signedIn: !signInShown,
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
      if (!add) return { ok: false, why: "no-add" };
      add.click();
      // Wait for Safeway to say it's in the cart: the Add button turns into a quantity.
      for (let i = 0; i < 20 && !(p = find())?.inCart; i++) await sleep(400);
      if (!p?.inCart) return { ok: false, why: "not-added" };
    }
    for (let n = p.qty || 1; n < times; n++) {
      const plus = plusButton(p.card);
      if (!plus) break;
      plus.click();
      await sleep(1200);
      p = find() ?? p;
    }
    p = find() ?? p;
    return { ok: true, qty: p.qty || 1 };
  }

  return null;
}
