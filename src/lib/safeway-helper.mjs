// The Safeway helper's thinking, kept in Simmer so it can change without reinstalling the helper (extension-working/). The
// helper is only hands: it asks Simmer what to fill (`prepare`), reads Safeway's pages using the page details here
// (`PAGE`), and asks Simmer which product to take (`choose`). Plain JavaScript, shared by Simmer's server, its tests
// and the helper's end-to-end check (scripts/extension-test.mjs).

/**
 * How the helper goes about it. `pause`: between items, so it moves like a person and Safeway can catch up.
 * `usualClear`/`usualGap`: a usual product is taken without asking only when one result matches it this well, this far
 * ahead of the next. `mostOfOne`: the most of one thing a plain count can ask for. For the helper's jobs (1.0 on):
 * `fastPoll`, how often it checks for jobs once there's activity or the panel is open, and `idleAfter`, how long after
 * the last job it goes back to checking every half minute. `stepWait`: how long to wait for Safeway after a tap.
 * `cartTries`: how many times to look for the cart page's products before going on without it.
 */
export const SETTINGS = { pause: 1500, searchTries: 6, resultsTries: 25, resultsWait: 800, usualClear: 0.8, usualGap: 0.2, mostOfOne: 12, fastPoll: 2500, idleAfter: 180_000, stepWait: 10_000, cartTries: 8 };

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
  // The cart page (helper 1.2 on): read with the same details as search results, with these in place where given.
  // Not yet seen on the real site; a `sample` of the cart page would show what to put here.
  cartItems: {},
  emptyCart: "your cart is empty|cart is empty|no items in (your )?cart",
  // Safeway shortens long titles on screen ("Pop-Tarts Toaster Pastries Fro...s 12 Count"); the whole name is then
  // read from the product's buttons ("Add <name>", "Increase Quantity 1 unit of <name>") with this taken off the front.
  fullName: "^(?:add|remove|decrease|increase)(?:\\s+quantity)?(?:\\s+\\d+\\s+units?)?(?:\\s+of)?\\s+",
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
 * @param {{ item: string, id: string, name: string, image?: string }[]} [picks]
 */
export function prepare(list, picks = []) {
  const byKey = new Map(picks.map((p) => [keyOf(p.item), { id: p.id, name: p.name, ...(p.image && { image: p.image }) }]));
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

/**
 * What to type in Safeway's search: the item's own name, without its amount, size or container ("2 lb ground beef" →
 * "ground beef", "can canned pumpkin" → "canned pumpkin", "9-inch homemade pie crust" → "pie crust"). The remembered and
 * usual products aren't searched by their full names (those carry sizes, and Safeway shortens long ones); they're
 * shown first when the search finds them.
 * @type {(item: { item: string }, usual?: string, picked?: { id?: string, name?: string } | null) => string}
 */
export const searchFor = (item) => searchWords(item.item);

const AMOUNT = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔⅛])(?:\s*(?:-|to)\s*(?:\d+\/\d+|\d+(?:\.\d+)?))?`;
const UNIT = "cups?|c|tablespoons?|tbsps?|tbsp|teaspoons?|tsps?|tsp|pounds?|lbs?|ounces?|oz|fl\\.? oz|grams?|g|kilograms?|kg|ml|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal|dozen|count|ct|packs?|pk|inch(?:es)?|in|cm";
const CONTAINER = "cans?|jars?|packages?|pkgs?|bags?|boxes|box|bottles?|cartons?|containers?|tubs?|bunch(?:es)?|heads?|sticks?|packets?|envelopes?|pouch(?:es)?|loaf|loaves|bunches";
const NOT_BOUGHT = /\b(?:homemade|home-made|store[- ]bought|prepared|to taste|as needed|optional|for serving|divided|plus more)\b/gi;

/** An item as Safeway should be searched for it: its name, without amounts, sizes, containers or how it's prepared. */
export function searchWords(item) {
  const raw = String(item ?? "").replace(/\s+/g, " ").trim();
  let s = raw.replace(/\([^)]*\)/g, " ").split(/,| - | – /)[0];
  // Sizes anywhere: "9-inch", "15 oz", "1/2 gallon", "18 count".
  s = s.replace(new RegExp(String.raw`(?:^|\s)${AMOUNT}\s*-?\s*(?:${UNIT})\.?(?=\s|$)`, "gi"), " ");
  // A leading amount and container: "2 cans black beans", "a bag of spinach", "can canned pumpkin".
  s = s.trim().replace(new RegExp(String.raw`^(?:(?:${AMOUNT}|an?|one|two|three|four|a few|a couple(?: of)?)\s+)?(?:(?:${UNIT}|${CONTAINER})\.?\s+)?(?:of\s+)?`, "i"), "");
  // A trailing amount: "lemons x3", "eggs 1 dozen", "milk 2".
  s = s.replace(new RegExp(String.raw`\s+(?:x\s*)?${AMOUNT}(?:\s*(?:${UNIT}|${CONTAINER}))?\s*$`, "i"), "");
  s = s.replace(NOT_BOUGHT, " ").replace(/\s+/g, " ").trim();
  return s || raw;
}

/**
 * A product's name as Safeway search words: up to where Safeway shortened it ("…"), without the size after " - ".
 * "Pop-Tarts Toaster Pastries Fro...s 12 Count - 20.3 Oz" → "Pop-Tarts Toaster Pastries".
 */
export function nameWords(name) {
  const s = String(name ?? "").replace(/\s+/g, " ").trim();
  const cut = s.search(/\.{3}|…/);
  const before = cut >= 0 ? s.slice(0, cut).replace(/\s*\S*$/, "") : s.split(/ - | – /)[0];
  return before.trim() || s;
}

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
