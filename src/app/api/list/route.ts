import { AppError } from "@/lib/errors";
import { recordTrip } from "@/lib/plan";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { clearCart, loadCart } from "@/lib/safeway";
import { addItem, addItems, addStaple, file, parseEntry, checkItem, haveTheRest, needItem, unneedItem, doneShopping, loadList, moveItem, moveStaple, putBack, removeItem, removeItems, removeStaple, SECTIONS, STORES, type Item, type Section, type Store } from "@/lib/groceries";

const isStore = (s: unknown): s is Store => typeof s === "string" && (STORES as readonly string[]).includes(s);
const isSection = (s: unknown): s is Section => typeof s === "string" && (SECTIONS as readonly string[]).includes(s);
const clean = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** GET: the shared list and the staples. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json(await loadList(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}

/**
 * POST { op, ... }: add { text, by }, many { items: { item, quantity, check? }[], for, by }, need { id }, have {}, check { id, checked }, move { id, store?, section? }, remove { id },
 * done { store }, clear { ids } (answers with `cleared`, for Undo), putBack { items }, and Stock's keepAdd { text, section? },
 * keepRemove { item }, keepMove { item, section }. Answers with the list as it is after the change.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    switch (b?.op) {
      case "add": {
        // A store alone (added on that store's list): the section is still Simmer's to work out.
        const text = clean(b.text);
        const filing = isStore(b.store) ? { store: b.store, section: isSection(b.section) ? b.section : (await file(parseEntry(text).item)).section } : undefined;
        await addItem(text, clean(b.by, 20), "", filing, typeof b.amount === "string" ? clean(b.amount, 30) : undefined);
        break;
      }
      case "check": await checkItem(clean(b.id, 40), Boolean(b.checked)); break;
      case "move": await moveItem(clean(b.id, 40), { ...(isStore(b.store) && { store: b.store }), ...(isSection(b.section) && { section: b.section }) }); break;
      case "many": {
        // A recipe's ingredients: merged into what's already on the list, in one write.
        const items: { item?: unknown; quantity?: unknown; check?: unknown }[] = Array.isArray(b.items) ? b.items.slice(0, 80) : [];
        await addItems(items.map((it) => ({ item: clean(it?.item), quantity: clean(it?.quantity, 30), for: clean(b.for, 60), check: Boolean(it?.check) })), clean(b.by, 20));
        break;
      }
      case "need": await needItem(clean(b.id, 40)); break;
      case "unneed": await unneedItem(clean(b.id, 40)); break;
      case "have": await haveTheRest(); break;
      case "remove": await removeItem(clean(b.id, 40)); break;
      case "clear": {
        const ids: unknown[] = Array.isArray(b.ids) ? b.ids.slice(0, 300) : [];
        const cleared = await removeItems(ids.map((x) => clean(x, 40)).filter(Boolean));
        return Response.json({ ...(await loadList()), cleared }, { headers: { "cache-control": "no-store" } });
      }
      case "putBack": {
        const items: Partial<Item>[] = Array.isArray(b.items) ? b.items.slice(0, 300) : [];
        await putBack(items.flatMap((x) => (x && isStore(x.store) && isSection(x.section) && clean(x.id, 40) && clean(x.item) ? [{
          id: clean(x.id, 40), item: clean(x.item), quantity: clean(x.quantity, 30), store: x.store, section: x.section, for: clean(x.for, 120),
          addedBy: clean(x.addedBy, 20), addedAt: clean(x.addedAt, 40), checked: Boolean(x.checked), check: Boolean(x.check),
        }] : [])));
        break;
      }
      case "keepAdd": await addStaple(clean(b.text), isSection(b.section) ? b.section : undefined); break;
      case "keepRemove": await removeStaple(clean(b.item)); break;
      case "keepMove": if (!isSection(b.section)) throw new AppError("Which part of Stock?"); await moveStaple(clean(b.item), b.section); break;
      case "done": if (!isStore(b.store)) throw new AppError("Which store?"); {
        // Safeway: what's in the cart counts as bought too, and the cart starts empty again.
        // Ticked in the store (cart: false) leaves the online cart alone.
        const cart = b.store === "safeway" && b.cart !== false ? await loadCart() : [];
        await doneShopping(b.store, new Set(cart.map((l) => l.itemId).filter(Boolean)));
        if (cart.length) await clearCart();
      } await recordTrip(b.store).catch((e) => console.error("couldn't record the trip", e)); break;
      default: return Response.json({ error: "Unknown change." }, { status: 400 });
    }
    return Response.json(await loadList(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
