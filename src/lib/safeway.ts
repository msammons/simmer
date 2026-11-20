// The Safeway side of Simmer:
// - Picks: for each item as written on the list, the exact Safeway product to take (its id, name and picture address),
//   so Find shows it first as "Your usual", on any device. One row per item in the Safeway tab; people can fix or delete
//   a row by hand. Rows from before pictures were kept have no picture, which is fine.
// - The cart: what was put in the Safeway cart through Simmer, one row per product, in the "Safeway cart" tab. Safeway's
//   own cart page can't be read yet, so anything added on Safeway directly doesn't show here. The `cart` column says
//   which cart a row belongs to ("safeway" for now), so more than one can be kept later.
import { change, load, resetTabs, table } from "./store";
import { norm } from "./words";

export type Pick = { item: string; id: string; name: string; image?: string };

/** The picture column comes after the older four, so rows written before it still read the same. */
const PICKS = table<Pick & { updated?: string }>({
  tab: "Safeway",
  headers: ["item", "product_id", "product_name", "updated", "product_image"],
  read: (get) => (get("item") && /^\d+$/.test(get("product_id"))
    ? { item: get("item"), id: get("product_id"), name: get("product_name"), ...(get("product_image") && { image: get("product_image") }) } : null),
  cells: (p) => ({ item: p.item, product_id: p.id, product_name: p.name, updated: p.updated, product_image: p.image ?? "" }),
  key: (p) => norm(p.item),
});

const safeImage = (s: unknown) => (typeof s === "string" && /^https:\/\/[^\s"'<>]+$/.test(s) ? s.slice(0, 500) : "");

export const loadPicks = (): Promise<Pick[]> => load(PICKS);

/**
 * Saves the pick for an item, replacing the one before (the same item, however it's capitalized or pluralized). A pick
 * without a picture keeps the picture already kept for the same product.
 */
export async function savePick(p: Pick): Promise<void> {
  await change(PICKS, (all) => {
    const at = all.findIndex((x) => norm(x.item) === norm(p.item));
    const image = safeImage(p.image) || (at >= 0 && all[at].id === p.id ? all[at].image ?? "" : "");
    const pick = { item: p.item, id: p.id, name: p.name, updated: new Date().toISOString().slice(0, 10), ...(image && { image }) };
    return at >= 0 ? all.with(at, pick) : [...all, pick];
  });
}

// ---- the cart

export type CartLine = { cart: string; productId: string; name: string; price: string; image: string; qty: number; itemId: string; item: string; updated: string };

const CART = table<CartLine>({
  tab: "Safeway cart",
  headers: ["cart", "product_id", "name", "price", "image", "qty", "item_id", "item", "updated"],
  read: (get) => (/^\d+$/.test(get("product_id")) && Number(get("qty")) > 0 ? {
    cart: get("cart") || "safeway", productId: get("product_id"), name: get("name"), price: get("price"), image: get("image"),
    qty: Number(get("qty")), itemId: get("item_id"), item: get("item"), updated: get("updated"),
  } : null),
  cells: (l) => ({ cart: l.cart, product_id: l.productId, name: l.name, price: l.price, image: l.image, qty: String(l.qty), item_id: l.itemId, item: l.item, updated: l.updated }),
  key: (l) => `${l.cart}|${l.productId}`,
});

/** A cart's lines. A failed read throws rather than reading as an empty cart (a change written after it would lose the rest). */
export const loadCart = async (cart = "safeway"): Promise<CartLine[]> => (await load(CART)).filter((l) => l.cart === cart);

export type CartChange = { productId: string; qty: number; name?: string; price?: string; image?: string; itemId?: string; item?: string };

/**
 * Sets a product's quantity in Simmer's copy of the cart (0 takes it out). Details not given (which list item it's for,
 * its picture) are kept from before.
 */
export const setCartLine = (change: CartChange, cart = "safeway") => setCartLines(() => [change], cart);

/**
 * Several products' quantities set in one write (Nov 10: one save per product ran into Google's limit of about 60
 * writes a minute). `changes` is worked out from the cart as read.
 */
export async function setCartLines(changes: (mine: CartLine[]) => CartChange[], cart = "safeway"): Promise<CartLine[]> {
  const after = await change(CART, (before) => {
    const all = [...before];
    for (const c of changes(all.filter((l) => l.cart === cart))) {
      const at = all.findIndex((l) => l.cart === cart && l.productId === c.productId);
      const was = at >= 0 ? all[at] : null;
      const qty = Math.max(0, Math.min(99, Math.round(c.qty)));
      if (was && was.qty === qty && !c.name && !c.itemId) continue;
      if (qty === 0) { if (at >= 0) all.splice(at, 1); continue; }
      const line: CartLine = {
        cart, productId: c.productId, qty, updated: new Date().toISOString(),
        name: c.name || was?.name || "", price: c.price || was?.price || "", image: safeImage(c.image) || was?.image || "",
        itemId: c.itemId || was?.itemId || "", item: c.item || was?.item || "",
      };
      if (at >= 0) all[at] = line; else all.push(line);
    }
    return all.length === before.length && all.every((l, i) => l === before[i]) ? before : all;
  });
  return after.filter((l) => l.cart === cart);
}

/**
 * Safeway's cart page, read by the helper: Simmer's copy becomes what's there, in one save. Products seen keep the list
 * item they were for; products added on Safeway itself come in with no item; products no longer there go. An empty read
 * changes nothing (a page that didn't load reads the same as an empty cart).
 */
export async function matchCart(seen: { id: string; name: string; price: string; image: string; qty: number }[], cart = "safeway"): Promise<CartLine[]> {
  if (!seen.length) return loadCart(cart);
  const now = new Date().toISOString();
  const after = await change(CART, (all) => {
    const mine = all.filter((l) => l.cart === cart);
    // The cart page's name is whole; a search's may have been shortened ("Pop-Tarts Toaster Pastries Fro...s").
    return [...all.filter((l) => l.cart !== cart), ...seen.filter((p) => p.qty > 0).map((p) => {
      const before = mine.find((l) => l.productId === p.id);
      return {
        cart, productId: p.id, qty: Math.min(99, p.qty), updated: before && before.qty === p.qty ? before.updated : now,
        name: p.name || before?.name || "", price: before?.price || p.price, image: before?.image || safeImage(p.image) || "",
        itemId: before?.itemId || "", item: before?.item || "",
      };
    })];
  });
  return after.filter((l) => l.cart === cart);
}

/** Checked out (Done shopping for Safeway): the cart starts empty again. */
export async function clearCart(cart = "safeway"): Promise<void> {
  await change(CART, (all) => (all.some((l) => l.cart === cart) ? all.filter((l) => l.cart !== cart) : all));
}

/** For tests. */
export const resetSafeway = () => resetTabs([PICKS.tab, CART.tab]);
