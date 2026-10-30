// The Shop tab's logic, kept out of the screens so it can be tested: which list items Find goes through and in what
// order, how search results are ordered (the usual first), what's in the cart for an item, and the cart's total.
import { prepare, score } from "./safeway-helper.mjs";
import { norm } from "./words";
import type { Item, Staple } from "./groceries";
import type { CartLine, Pick } from "./safeway";

export type Product = { id: string; name: string; price: string; image: string; inCart?: boolean; qty?: number };
/** One list item to find: what to search for first, how many, and its remembered product. */
export type FindItem = { id: string; item: string; quantity: string; usual: string; picked: { id: string; name: string } | null; query: string; want: number };

/** The Safeway items Find goes through, in the list's order: unchecked, leaving out the "check you have these" ones. */
export function findItems(items: Item[], staples: Staple[], picks: Pick[]): FindItem[] {
  return prepare({ items, staples }, picks) as FindItem[];
}

/** What's in the cart for a list item (by the item it was added for). */
export const cartFor = (cart: CartLine[], itemId: string) => cart.filter((l) => l.itemId === itemId);
export const qtyFor = (cart: CartLine[], itemId: string) => cartFor(cart, itemId).reduce((n, l) => n + l.qty, 0);

/** Where "Find them at Safeway" starts: the first item with nothing in the cart yet (else the first). */
export function firstToFind(items: FindItem[], cart: CartLine[]): number {
  const i = items.findIndex((it) => !qtyFor(cart, it.id));
  return i < 0 ? 0 : i;
}

/** The next item after `from` with nothing in the cart yet, or -1 when every one after it has something. */
export function nextToFind(items: FindItem[], cart: CartLine[], from: number): number {
  for (let i = from + 1; i < items.length; i++) if (!qtyFor(cart, items[i].id)) return i;
  return -1;
}

/**
 * Search results in the order to show them: the remembered product first, marked as the usual; without one, a result
 * that clearly matches the house's usual product is marked instead. The rest by how well they match, Safeway's own
 * order breaking ties (so a sponsored result that matches no better doesn't jump ahead).
 */
export function rankResults<P extends Product>(products: P[], wanted: { picked?: { id: string } | null; usual?: string; item: string }): { product: P; usual: boolean }[] {
  const target = wanted.usual || wanted.item;
  const ranked = products.map((p, i) => ({ p, i, s: score(p.name, target) })).sort((a, b) => b.s - a.s || a.i - b.i).map((r) => r.p);
  let usualId = wanted.picked && products.some((p) => p.id === wanted.picked!.id) ? wanted.picked.id : "";
  if (!usualId && wanted.usual && ranked.length) {
    const s0 = score(ranked[0].name, wanted.usual), s1 = ranked[1] ? score(ranked[1].name, wanted.usual) : 0;
    if (s0 >= 0.8 && s0 - s1 >= 0.2 - 1e-9) usualId = ranked[0].id;
  }
  const first = ranked.filter((p) => p.id === usualId);
  return [...first, ...ranked.filter((p) => p.id !== usualId)].map((product) => ({ product, usual: product.id === usualId }));
}

/** "$3.49", "$0.29 each", "$4.99 /lb" → 3.49, 0.29, 4.99; nothing readable → null. */
export function priceOf(s: string): number | null {
  const m = String(s ?? "").match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

/** The cart's total, and whether it's only an estimate (something sold by weight, or a price that couldn't be read). */
export function cartTotal(cart: CartLine[]): { total: number; estimate: boolean } {
  let total = 0, estimate = false;
  for (const l of cart) {
    const p = priceOf(l.price);
    if (p === null) { estimate = true; continue; }
    if (/lb|per\b|\/\s*oz/i.test(l.price)) estimate = true;
    total += p * l.qty;
  }
  return { total: Math.round(total * 100) / 100, estimate };
}

export const money = (n: number) => `$${n.toFixed(2)}`;

/** A list item's line: "In the cart · 2" once something's in the cart for it. */
export function inCartLine(cart: CartLine[], it: { id: string }): string {
  const n = qtyFor(cart, it.id);
  return n ? `In the cart · ${n}` : "";
}

/** The pick for an item, however the item is written. */
export const pickFor = (picks: Pick[], item: string) => picks.find((p) => norm(p.item) === norm(item));
