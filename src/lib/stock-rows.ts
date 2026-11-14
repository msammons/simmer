// Stock's rows (Nov 11, Matt: checking stock means flagging what you've checked; you can't have and need a thing at once;
// keep everything in its section, with the meal highlight). Every row is answered Have or Need, or not yet ("check"):
// the things kept, what the planned dinners need from the house (highlighted, with the amount), and the freezer.
import type { Frozen, Item, Kitchen, ListState, Section, Staple, Store } from "./client";
import { norm } from "./words";

/** On the list for a dinner (not added by hand or ticked on Stock). */
export const fromDinner = (it: Pick<Item, "for" | "checked">) => {
  const f = it.for.trim().toLowerCase();
  return !it.checked && Boolean(f) && f !== "every week" && !f.split(",").map((x) => x.trim()).includes("added by hand");
};

/** check: not answered yet; have: checked and there (off every list); need: on the list. */
export type Answer = "check" | "have" | "need";

export type StockRow = {
  key: string; name: string; section: Section; store: Store; answer: Answer;
  /** A planned dinner needs it: highlighted, with how much. */
  meal: boolean; amount: string;
  /** Its List row, if it has one (on the list, answered Have, or waiting for a dinner). */
  item: Item | null; staple: Staple | null; frozen: Frozen | null;
};

const answerOf = (it: Item | null): Answer => (!it ? "check" : it.have ? "have" : it.check ? "check" : "need");

export function rowsOf(list: ListState | null, kitchen: Kitchen | null): StockRow[] {
  const items = (list?.items ?? []).filter((i) => !i.checked);
  const find = (name: string) => items.find((i) => norm(i.item) === norm(name)) ?? null;
  const row = (key: string, name: string, section: Section, store: Store, it: Item | null, staple: Staple | null, frozen: Frozen | null): StockRow => {
    const meal = Boolean(it && fromDinner(it));
    return { key, name, section, store, answer: answerOf(it), meal, amount: meal ? it!.quantity : "", item: it, staple, frozen };
  };
  const rows: StockRow[] = [];
  const known = new Set<string>();
  for (const s of list?.staples ?? []) {
    if (known.has(norm(s.item))) continue;
    known.add(norm(s.item));
    rows.push(row(`s|${norm(s.item)}`, s.item, s.section, s.store, find(s.item), s, null));
  }
  // What the dinners need from the house that isn't kept: a dinner's pantry things (its fresh groceries go straight on the
  // list), in their own sections, highlighted.
  for (const it of items) {
    if (known.has(norm(it.item)) || !fromDinner(it) || (!it.check && it.section === "fresh")) continue;
    known.add(norm(it.item));
    rows.push(row(`m|${it.id}`, it.item, it.section, it.store, it, null, null));
  }
  for (const f of kitchen?.freezer ?? []) {
    if (known.has(norm(f.item))) continue;
    known.add(norm(f.item));
    rows.push(row(`f|${f.id}`, f.item, "freezer", (f.store as Store) || "safeway", find(f.item), null, f));
  }
  return rows;
}

/** How many highlighted (meal) things haven't been answered yet. */
export const toCheck = (rows: StockRow[]) => rows.filter((r) => r.meal && r.answer === "check").length;
