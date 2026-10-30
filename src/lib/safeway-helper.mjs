// The Safeway helper's thinking, kept in Simmer so it can change without reinstalling the helper (extension/). The
// helper is only hands: it asks Simmer what to fill (`prepare`), reads Safeway's pages using the page details here
// (`PAGE`), and asks Simmer which product to take (`choose`). Plain JavaScript, shared by Simmer's server, its tests
// and the helper's end-to-end check (scripts/extension-test.mjs).

/**
 * How the helper goes about it. `pause`: between items, so it moves like a person and Safeway can catch up.
 * `usualClear`/`usualGap`: a usual product is taken without asking only when one result matches it this well, this far
 * ahead of the next. `mostOfOne`: the most of one thing a plain count can ask for. For the helper's jobs (1.0 on):
 * `fastPoll`, how often it checks for jobs once there's activity or the panel is open, and `idleAfter`, how long after
 * the last job it goes back to checking every half minute. `stepWait`: how long to wait for Safeway after a tap.
 */
export const SETTINGS = { pause: 1500, searchTries: 6, resultsTries: 25, resultsWait: 800, usualClear: 0.8, usualGap: 0.2, mostOfOne: 12, fastPoll: 2000, idleAfter: 180_000, stepWait: 10_000 };

/**
 * Safeway's pages, as data the helper reads them with (patterns are matched without regard to case). Safeway's pages
 * aren't documented and change; when they do, this is what to fix, and the helper picks it up on its next run. As of
 * Oct 2026 (read from Safeway's own page code), each search result is a <product-item-al-v2> tile: its title is
 * [data-qa="prd-itm-pttl"] with id "pg<product number>", there's no link to the product's page, and its quantity
 * control has an "Add <product>" button that turns into "Remove/Decrease Quantity…" and "Increase Quantity…" buttons
 * around a quantity box once it's in the cart. Older pages linked each product to /shop/product-details.<number>.html;
 * that still works as a fallback.
 */
export const PAGE = {
  site: "https://www.safeway.com",
  searchPath: "/shop/search-results.html?q=",
  productPath: "/shop/product-details.{id}.html",
  cartPath: "/erums/cart",
  tile: "product-item-al-v2, product-item-al-v1",
  title: '[data-qa="prd-itm-pttl"]',
  tileId: { selector: "[id^='pg']", pattern: "^pg(\\d+)" },
  link: { selector: 'a[href*="product-details."]', pattern: "product-details\\.(\\d+)\\.html" },
  price: { selector: '[data-qa="prd-itm-prc"]', pattern: "\\$\\d+(?:\\.\\d{2})?(?:\\s*(?:each|/\\s*lb|/\\s*ea|per lb))?" },
  qtyBox: '[data-qa="prd-qty-stppr-qtybox"], input[type="number"], input[aria-label*="quantity" i], input[name*="qty" i], [role="spinbutton"]',
  add: { label: "^add\\b", not: "list|note|coupon|clip" },
  plus: "increase|increment|add one|add another|plus|^[+＋]$",
  minus: "decrease|decrement|remove one|remove quantity|minus|^[-−–]$",
  inCartText: "(\\d+)\\s+in\\s+cart",
  cart: { selector: "header a, header button, [aria-label*='cart' i], [data-qa*='cart' i]", label: "cart", links: "[aria-label*='cart' i], [data-qa*='cart' i], a[href*='cart']" },
  signIn: "^sign in$",
  noResults: "no (search )?results for",
  productLinks: "a[href*='product']",
};

/** Everything the helper needs from Simmer to start: how to read Safeway, how to go about it, and what to fill. */
/** @type {(list: Parameters<typeof prepare>[0], picks: Parameters<typeof prepare>[1]) => object} */
export const helperStart = (list, picks) => ({ page: PAGE, settings: SETTINGS, items: prepare(list, picks) });

/**
 * The list's Safeway items, ready to fill: what to search for first (the remembered product, else the usual one, else
 * the item), how many, and the remembered pick. `picks`: { item, id, name }[] as kept in Simmer.
 */
/**
 * @param {{ items?: ListItem[], staples?: Staple[] } | null | undefined} list
 * @param {{ item: string, id: string, name: string }[]} [picks]
 */
export function prepare(list, picks = []) {
  const byKey = new Map(picks.map((p) => [keyOf(p.item), { id: p.id, name: p.name }]));
  return safewayItems(list).map((it) => {
    const usual = usualFor(it, list?.staples), picked = byKey.get(keyOf(it.item)) ?? null;
    return { id: it.id, item: it.item, quantity: it.quantity ?? "", usual, picked, query: searchFor(it, usual, picked), want: howMany(it.quantity) };
  });
}

const STOP = new Set(["a", "an", "the", "of", "and", "or", "with", "for", "fresh", "each", "oz", "fl", "lb", "ct", "pack", "pk", "count"]);

/** "Lucerne 2% Reduced Fat Milk - 1/2 Gallon" → ["lucerne", "2%", "reduced", "fat", "milk", "1/2", "gallon"]. */
export function words(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9%/.]+/g, " ").split(" ").map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w && !STOP.has(w));
}

/** The words a product name shares with what we're after, as a share of what we're after: 0 to 1. Plurals count. */
export function score(name, target) {
  const want = words(target);
  if (!want.length) return 0;
  const have = new Set(words(name).flatMap((w) => [w, w.replace(/e?s$/, "")]));
  return want.filter((w) => have.has(w) || have.has(w.replace(/e?s$/, ""))).length / want.length;
}

/** The key a pick is remembered under: the item as written on the list, tidied. */
export const keyOf = (item) => words(item).join(" ");

/** What Simmer's list sends to Safeway: unchecked Safeway items, leaving out the "check you have these" ones. */
/** @typedef {{ id: string, item: string, quantity?: string, store: string, checked?: boolean, check?: boolean }} ListItem */
/** @typedef {{ item: string, product?: string }} Staple */
/** @type {(list: { items?: ListItem[] } | null | undefined) => ListItem[]} */
export const safewayItems = (list) => (list?.items ?? []).filter((i) => i.store === "safeway" && !i.checked && !i.check);

/** The usual product for an item, from the house's staples. */
/** @param {{ item: string }} item @param {Staple[] | undefined} staples */
export function usualFor(item, staples) {
  const k = keyOf(item.item);
  return (staples ?? []).find((s) => s.product && keyOf(s.item) === k)?.product ?? "";
}

/** What to type in Safeway's search: the remembered product, else the usual one, else the item. */
/** @type {(item: { item: string }, usual: string, picked?: { id?: string, name?: string } | null) => string} */
export const searchFor = (item, usual, picked) => picked?.name || usual || item.item;

/** How many to add. Only plain counts mean more than one; "2 lb" or "a dozen" is one of whatever Safeway sells. */
export function howMany(quantity) {
  const q = String(quantity ?? "").trim().toLowerCase();
  if (/^\d+$/.test(q)) return Math.min(Math.max(Number(q), 1), SETTINGS.mostOfOne);
  if (q === "couple") return 2;
  return 1;
}

/**
 * Which product to add, or which to ask about. A remembered pick wins when it's there. A usual product is taken
 * without asking only when one result matches it clearly. Everything else is asked, with every product found, the
 * likeliest first.
 */
/**
 * @param {{ id: string, name: string }[]} products
 * @param {{ picked?: { id: string, name?: string } | null, usual?: string, item?: string }} wanted
 */
export function choose(products, { picked, usual, item }) {
  const all = (products ?? []).filter((p) => p && p.id && p.name);
  if (!all.length) return { none: true };
  const mine = picked && all.find((p) => p.id === picked.id);
  if (mine) return { pick: mine, why: "remembered" };
  if (usual) {
    const ranked = all.map((p) => ({ p, s: score(p.name, usual) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s >= SETTINGS.usualClear && (ranked.length === 1 || ranked[0].s - ranked[1].s >= SETTINGS.usualGap)) return { pick: ranked[0].p, why: "usual" };
  }
  const target = usual || item;
  // Safeway's own order breaks ties, so a sponsored result that matches no better than the rest doesn't jump ahead.
  const ranked = all.map((p, i) => ({ p, i, s: score(p.name, target) })).sort((a, b) => b.s - a.s || a.i - b.i);
  return { ask: ranked.map((r) => r.p) };
}
