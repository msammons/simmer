// Stock's rows: the staples, what the dinners need, and the freezer, each once, with whether it's on the list.
import type { Frozen, Item, Kitchen, ListState, Section, Staple, Store } from "./client";
import { norm } from "./words";

/**
 * On the list for a dinner (not added by hand or ticked on Stock): a dinner's pantry things start highlighted, and stay
 * in Stock, ticked, once she says she needs them (Nov 11, Matt: ticked ones disappeared).
 */
export const fromDinner = (it: Pick<Item, "for" | "checked">) => {
  const f = it.for.trim().toLowerCase();
  return !it.checked && Boolean(f) && f !== "every week" && !f.split(",").map((x) => x.trim()).includes("added by hand");
};

export type StockRow = { key: string; name: string; section: Section; have: boolean; meal: Item | null; open: Item | null; staple: Staple | null; frozen: Frozen | null; store: Store };

export function rowsOf(list: ListState | null, kitchen: Kitchen | null): StockRow[] {
  const items = list?.items ?? [];
  const onList = (name: string) => items.find((i) => !i.checked && !i.check && norm(i.item) === norm(name)) ?? null;
  // Highlighted for a dinner: still to decide (check), or ticked since (a dinner's pantry thing now on the list).
  const forMeal = (i: Item) => !i.checked && (i.check || (i.section !== "fresh" && fromDinner(i)));
  const mealOf = (name: string) => items.find((i) => forMeal(i) && norm(i.item) === norm(name)) ?? null;
  const rows: StockRow[] = (list?.staples ?? []).map((s) => {
    const open = onList(s.item);
    return { key: `s|${norm(s.item)}`, name: s.item, section: s.section, have: !open, meal: mealOf(s.item), open, staple: s, frozen: null, store: s.store };
  });
  const known = new Set(rows.map((r) => norm(r.name)));
  // What the meals need that isn't kept as a staple: highlighted in its section, ticked once it's on the list.
  for (const it of items) {
    if (!forMeal(it) || known.has(norm(it.item))) continue;
    known.add(norm(it.item));
    rows.push({ key: `m|${it.id}`, name: it.item, section: it.section, have: it.check, meal: it, open: it.check ? null : it, staple: null, frozen: null, store: it.store });
  }
  for (const f of kitchen?.freezer ?? []) {
    if (known.has(norm(f.item))) continue;
    known.add(norm(f.item));
    const open = onList(f.item);
    rows.push({ key: `f|${f.id}`, name: f.item, section: "freezer", have: !open, meal: null, open, staple: null, frozen: f, store: (f.store as Store) || "safeway" });
  }
  return rows;
}

