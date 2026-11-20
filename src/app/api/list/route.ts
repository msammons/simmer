import { AppError } from "@/lib/errors";
import { recordTrip } from "@/lib/plan";
import { clearCart, loadCart } from "@/lib/safeway";
import { addItem, addItems, addStaple, checkItem, haveTheRest, haveItem, needItem, unneedItem, doneShopping, loadList, moveItem, moveStaple, removeItem, removeStaple, renameGroup, setStaple, SECTIONS, STORES, type Section, type StapleKind, type Store } from "@/lib/groceries";
import { transact } from "@/lib/store";
import { norm } from "@/lib/words";
import { backUpAfter, before } from "@/lib/ops/backup";
import { api, body, clean, noStore, refuse } from "@/lib/ops/route";

const isStore = (s: unknown): s is Store => typeof s === "string" && (STORES as readonly string[]).includes(s);
const isSection = (s: unknown): s is Section => typeof s === "string" && (SECTIONS as readonly string[]).includes(s);
const isKind = (s: unknown): s is StapleKind => s === "common" || s === "specialty";

/** GET: the shared list and the staples. */
export const GET = api(async () => Response.json(await loadList(), noStore));

/**
 * POST { op, ... }: add { text, by }, many { items: { item, quantity, check? }[], for, by }, need { id }, have {}, check { id, checked }, move { id, store?, section? }, remove { id },
 * done { store }, and Stock's keepAdd { text, section? }, keepRemove { item }, keepMove { item, section }, keepSet { item,
 * kind?, group? } (keepAdd also takes kind?, group?, need?), keepGroup { from, to } (a group renamed, or removed with to "").
 * Answers with the list as it is after the change. The change and the list answered are one transaction (Nov 19), so
 * the list is read once, and a change made at the same moment elsewhere isn't lost.
 */
export const POST = api(async (req) => {
  const b = await body(req);
  // Done shopping: the tabs as they were are kept as a backup (Nov 19), read before the change and written once the
  // answer has gone (the newest 7 kept).
  const kept = b?.op === "done" && isStore(b.store) ? await before("done shopping") : null;
  const list = await transact(async () => {
    switch (b?.op) {
      case "add": {
        // A store alone (added on that store's list): the section is still Simmer's to work out, if it's a new line.
        const text = clean(b.text);
        const filing = isStore(b.store) ? { store: b.store, ...(isSection(b.section) && { section: b.section }) } : undefined;
        const added = await addItem(text, clean(b.by, 20), "", filing, typeof b.amount === "string" ? clean(b.amount, 30) : undefined);
        // Answered Have on Stock (Nov 11): kept as checked and there, off every list.
        if (b.have === true) await haveItem(added.id);
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
      case "haveIt": await haveItem(clean(b.id, 40)); break;
      case "have": await haveTheRest(); break;
      case "remove": await removeItem(clean(b.id, 40)); break;
      case "keepAdd": {
        // Quick add (Nov 16): common or specialty, maybe in a group, and with need, on the list at once.
        const text = clean(b.text);
        await addStaple(text, isSection(b.section) ? b.section : undefined, { ...(isKind(b.kind) && { kind: b.kind }), ...(typeof b.group === "string" && { group: clean(b.group, 40) }) });
        if (b.need === true && text) {
          const { items, staples } = await loadList();
          const s = staples.find((x) => norm(x.item) === norm(text));
          const row = items.find((x) => !x.checked && norm(x.item) === norm(text));
          if (row) await needItem(row.id);
          else if (s) await addItem(text, clean(b.by, 20), "", { store: s.store, section: s.section }, s.quantity || undefined);
        }
        break;
      }
      case "keepSet": await setStaple(clean(b.item), { ...(isKind(b.kind) && { kind: b.kind }), ...(typeof b.group === "string" && { group: clean(b.group, 40) }) }); break;
      case "keepGroup": if (!clean(b.from, 40)) throw new AppError("Which group?"); await renameGroup(clean(b.from, 40), typeof b.to === "string" ? clean(b.to, 40) : ""); break;
      case "keepRemove": await removeStaple(clean(b.item)); break;
      case "keepMove": if (!isSection(b.section)) throw new AppError("Which part of the list?"); await moveStaple(clean(b.item), b.section); break;
      case "done": if (!isStore(b.store)) throw new AppError("Which store?"); {
        // Safeway: what's in the cart counts as bought too, and the cart starts empty again.
        // Ticked in the store (cart: false) leaves the online cart alone.
        const cart = b.store === "safeway" && b.cart !== false ? await loadCart() : [];
        await doneShopping(b.store, new Set(cart.map((l) => l.itemId).filter(Boolean)));
        if (cart.length) await clearCart();
      } await recordTrip(b.store).catch((e) => console.error("couldn't record the trip", e)); break;
      default: return null;
    }
    return loadList();
  });
  if (!list) return refuse("Unknown change.");
  backUpAfter(kept, "done shopping");
  return Response.json(list, noStore);
});
