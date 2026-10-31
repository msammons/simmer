// The Safeway side of Simmer, kept in the Sheet (in memory without it, for local dev and tests):
// - Picks: for each item as written on the list, the exact Safeway product to take (its id, name and picture address),
//   so Find shows it first as "Your usual", on any device. One row per item in the Safeway tab; people can fix or delete
//   a row by hand. Rows from before pictures were kept have no picture, which is fine.
// - The cart: what was put in the Safeway cart through Simmer, one row per product, in the "Safeway cart" tab. Safeway's
//   own cart page can't be read yet, so anything added on Safeway directly doesn't show here. The `cart` column says
//   which cart a row belongs to ("safeway" for now), so more than one can be kept later.
import { appendRows, ensureTab, readTab, readTabIfAny, replaceTab, sheetsConfigured, updateRange } from "./google/sheets";
import { records } from "./parse";
import { norm } from "./words";

export type Pick = { item: string; id: string; name: string; image?: string };

const TAB = "Safeway";
const HEADERS = ["item", "product_id", "product_name", "updated", "product_image"];

let memory: Pick[] = [];

const safeImage = (s: unknown) => (typeof s === "string" && /^https:\/\/[^\s"'<>]+$/.test(s) ? s.slice(0, 500) : "");

export async function loadPicks(): Promise<Pick[]> {
  if (!sheetsConfigured()) return memory.map((p) => ({ ...p }));
  const rows = await readTab(TAB).catch(() => [] as string[][]);
  return records(rows).flatMap((r) => (r.get("item") && /^\d+$/.test(r.get("product_id"))
    ? [{ item: r.get("item"), id: r.get("product_id"), name: r.get("product_name"), ...(r.get("product_image") && { image: r.get("product_image") }) }] : []));
}

/**
 * Saves the pick for an item, replacing the one before (the same item, however it's capitalized or pluralized). A pick
 * without a picture keeps the picture already kept for the same product.
 */
export async function savePick(p: Pick): Promise<void> {
  const n = norm(p.item);
  const image = safeImage(p.image);
  if (!sheetsConfigured()) {
    const before = memory.find((m) => norm(m.item) === n);
    const keep = image || (before?.id === p.id ? before.image ?? "" : "");
    memory = [...memory.filter((m) => norm(m.item) !== n), { item: p.item, id: p.id, name: p.name, ...(keep && { image: keep }) }];
    return;
  }
  await ensureTab(TAB);
  const rows = await readTabIfAny(TAB);
  const at = records(rows).find((r) => norm(r.get("item")) === n);
  const keep = image || (at && at.get("product_id") === p.id ? at.get("product_image") : "");
  const row = [p.item, p.id, p.name, new Date().toISOString().slice(0, 10), keep];
  // The picture column comes after the older four, so rows written before it still read the same.
  if (rows.length && !(rows[0] ?? []).map((h) => h.trim().toLowerCase()).includes("product_image")) await updateRange(`${TAB}!A1:E1`, [HEADERS]);
  if (at) await updateRange(`${TAB}!A${at.rowNumber}:E${at.rowNumber}`, [row]);
  else await appendRows(TAB, [...(rows.length ? [] : [HEADERS]), row]);
}

// ---- the cart

export type CartLine = { cart: string; productId: string; name: string; price: string; image: string; qty: number; itemId: string; item: string; updated: string };

const CART = "Safeway cart";
const CART_HEADERS = ["cart", "product_id", "name", "price", "image", "qty", "item_id", "item", "updated"];
let cartMemory: CartLine[] = [];

export async function loadCart(cart = "safeway"): Promise<CartLine[]> {
  if (!sheetsConfigured()) return cartMemory.filter((l) => l.cart === cart).map((l) => ({ ...l }));
  return (await allCart()).filter((l) => l.cart === cart);
}

async function allCart(): Promise<CartLine[]> {
  // A failed read throws rather than reading as an empty cart (a change written after it would lose the rest).
  const rows = await readTabIfAny(CART);
  return records(rows).flatMap((r) => {
    const qty = Number(r.get("qty"));
    return /^\d+$/.test(r.get("product_id")) && qty > 0 ? [{
      cart: r.get("cart") || "safeway", productId: r.get("product_id"), name: r.get("name"), price: r.get("price"), image: r.get("image"),
      qty, itemId: r.get("item_id"), item: r.get("item"), updated: r.get("updated"),
    }] : [];
  });
}

async function saveAll(lines: CartLine[]) {
  if (!sheetsConfigured()) { cartMemory = lines; return; }
  await replaceTab(CART, [CART_HEADERS, ...lines.map((l) => [l.cart, l.productId, l.name, l.price, l.image, String(l.qty), l.itemId, l.item, l.updated])]);
}

/**
 * Sets a product's quantity in Simmer's copy of the cart (0 takes it out). Details not given (which list item it's for,
 * its picture) are kept from before.
 */
export async function setCartLine(change: { productId: string; qty: number; name?: string; price?: string; image?: string; itemId?: string; item?: string }, cart = "safeway"): Promise<CartLine[]> {
  const all = sheetsConfigured() ? await allCart() : cartMemory.map((l) => ({ ...l }));
  const at = all.findIndex((l) => l.cart === cart && l.productId === change.productId);
  const before = at >= 0 ? all[at] : null;
  const qty = Math.max(0, Math.min(99, Math.round(change.qty)));
  if (before && before.qty === qty && !change.name && !change.itemId) return all.filter((l) => l.cart === cart);
  if (qty === 0) { if (at >= 0) all.splice(at, 1); else return all.filter((l) => l.cart === cart); }
  else {
    const line: CartLine = {
      cart, productId: change.productId, qty, updated: new Date().toISOString(),
      name: change.name || before?.name || "", price: change.price || before?.price || "", image: safeImage(change.image) || before?.image || "",
      itemId: change.itemId || before?.itemId || "", item: change.item || before?.item || "",
    };
    if (at >= 0) all[at] = line; else all.push(line);
  }
  await saveAll(all);
  return all.filter((l) => l.cart === cart);
}

/**
 * Safeway's cart page, read by the helper: Simmer's copy becomes what's there, in one save. Products seen keep the list
 * item they were for; products added on Safeway itself come in with no item; products no longer there go. An empty read
 * changes nothing (a page that didn't load reads the same as an empty cart).
 */
export async function matchCart(seen: { id: string; name: string; price: string; image: string; qty: number }[], cart = "safeway"): Promise<CartLine[]> {
  const all = sheetsConfigured() ? await allCart() : cartMemory.map((l) => ({ ...l }));
  const mine = all.filter((l) => l.cart === cart);
  if (!seen.length) return mine;
  const now = new Date().toISOString();
  const lines: CartLine[] = seen.filter((p) => p.qty > 0).map((p) => {
    const before = mine.find((l) => l.productId === p.id);
    // The cart page's name is whole; a search's may have been shortened ("Pop-Tarts Toaster Pastries Fro...s").
    return {
      cart, productId: p.id, qty: Math.min(99, p.qty), updated: before && before.qty === p.qty ? before.updated : now,
      name: p.name || before?.name || "", price: before?.price || p.price, image: before?.image || safeImage(p.image) || "",
      itemId: before?.itemId || "", item: before?.item || "",
    };
  });
  await saveAll([...all.filter((l) => l.cart !== cart), ...lines]);
  return lines;
}

/** Checked out (Done shopping for Safeway): the cart starts empty again. */
export async function clearCart(cart = "safeway"): Promise<void> {
  const all = sheetsConfigured() ? await allCart() : cartMemory;
  if (!all.some((l) => l.cart === cart)) return;
  await saveAll(all.filter((l) => l.cart !== cart));
}

/** For tests. */
export const resetSafeway = () => { memory = []; cartMemory = []; };
