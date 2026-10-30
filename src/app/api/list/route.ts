import { AppError } from "@/lib/errors";
import { recordTrip } from "@/lib/plan";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { clearCart, loadCart } from "@/lib/safeway";
import { addItem, addItems, checkItem, haveTheRest, needItem, doneShopping, loadList, moveItem, removeItem, SECTIONS, STORES, type Section, type Store } from "@/lib/groceries";

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
 * POST { op, ... }: add { text, by }, many { items: { item, quantity }[], for, by }, need { id }, have {}, check { id, checked }, move { id, store?, section? }, remove { id },
 * done { store }. Answers with the list as it is after the change.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    switch (b?.op) {
      case "add": await addItem(clean(b.text), clean(b.by, 20), "", isStore(b.store) && isSection(b.section) ? { store: b.store, section: b.section } : undefined); break;
      case "check": await checkItem(clean(b.id, 40), Boolean(b.checked)); break;
      case "move": await moveItem(clean(b.id, 40), { ...(isStore(b.store) && { store: b.store }), ...(isSection(b.section) && { section: b.section }) }); break;
      case "many": {
        // A recipe's ingredients: merged into what's already on the list, in one write.
        const items: { item?: unknown; quantity?: unknown }[] = Array.isArray(b.items) ? b.items.slice(0, 80) : [];
        await addItems(items.map((it) => ({ item: clean(it?.item), quantity: clean(it?.quantity, 30), for: clean(b.for, 60) })), clean(b.by, 20));
        break;
      }
      case "need": await needItem(clean(b.id, 40)); break;
      case "have": await haveTheRest(); break;
      case "remove": await removeItem(clean(b.id, 40)); break;
      case "done": if (!isStore(b.store)) throw new AppError("Which store?"); {
        // Safeway: what's in the cart counts as bought too, and the cart starts empty again.
        const cart = b.store === "safeway" ? await loadCart() : [];
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
