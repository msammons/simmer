import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { addItem, checkItem, doneShopping, loadList, moveItem, removeItem, SECTIONS, STORES, type Section, type Store } from "@/lib/groceries";

const isStore = (s: unknown): s is Store => typeof s === "string" && (STORES as readonly string[]).includes(s);
const isSection = (s: unknown): s is Section => typeof s === "string" && (SECTIONS as readonly string[]).includes(s);
const clean = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** GET: the shared list and the staples. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json(await loadList(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}

/**
 * POST { op, ... }: add { text, by }, many { items: { item, quantity }[], for, by }, check { id, checked }, move { id, store?, section? }, remove { id },
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
        // A recipe's ingredients, one at a time so each merges into what's already on the list.
        const items: { item?: unknown; quantity?: unknown }[] = Array.isArray(b.items) ? b.items.slice(0, 80) : [];
        for (const it of items) {
          const item = clean(it?.item);
          if (item) await addItem(item, clean(b.by, 20), clean(b.for, 60), undefined, clean(it?.quantity, 30));
        }
        break;
      }
      case "remove": await removeItem(clean(b.id, 40)); break;
      case "done": if (!isStore(b.store)) throw new AppError("Which store?"); await doneShopping(b.store); break;
      default: return Response.json({ error: "Unknown change." }, { status: 400 });
    }
    return Response.json(await loadList(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
