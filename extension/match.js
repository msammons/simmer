// Plain rules for the Safeway helper, kept apart from the browser so they can be tested (match.test.js).

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
export const safewayItems = (list) => (list?.items ?? []).filter((i) => i.store === "safeway" && !i.checked && !i.check);

/** The usual product for an item, from the house's staples. */
export function usualFor(item, staples) {
  const k = keyOf(item.item);
  return (staples ?? []).find((s) => s.product && keyOf(s.item) === k)?.product ?? "";
}

/** What to type in Safeway's search: the remembered product, else the usual one, else the item. */
export const searchFor = (item, usual, picked) => picked?.name || usual || item.item;

/** How many to add. Only plain counts mean more than one; "2 lb" or "a dozen" is one of whatever Safeway sells. */
export function howMany(quantity) {
  const q = String(quantity ?? "").trim().toLowerCase();
  if (/^\d+$/.test(q)) return Math.min(Math.max(Number(q), 1), 12);
  if (q === "couple") return 2;
  return 1;
}

/**
 * Which product to add, or which to ask about. A remembered pick wins when it's there. A usual product is taken
 * without asking only when one result matches it clearly. Everything else is asked, with the three likeliest.
 */
export function choose(products, { picked, usual, item }) {
  const all = (products ?? []).filter((p) => p && p.id && p.name);
  if (!all.length) return { none: true };
  const mine = picked && all.find((p) => p.id === picked.id);
  if (mine) return { pick: mine, why: "remembered" };
  if (usual) {
    const ranked = all.map((p) => ({ p, s: score(p.name, usual) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s >= 0.8 && (ranked.length === 1 || ranked[0].s - ranked[1].s >= 0.2)) return { pick: ranked[0].p, why: "usual" };
  }
  const target = usual || item;
  // Safeway's own order breaks ties, so a sponsored result that matches no better than the rest doesn't jump ahead.
  const ranked = all.map((p, i) => ({ p, i, s: score(p.name, target) })).sort((a, b) => b.s - a.s || a.i - b.i);
  return { ask: ranked.slice(0, 3).map((r) => r.p) };
}
