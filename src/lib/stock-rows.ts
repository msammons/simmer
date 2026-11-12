// Stock's rows (Nov 11, Matt: "you're checking stock, so flagging what you've checked matters"). At the top, "For this
// plan": what the planned dinners need from the house, each answered Have or Need (or not yet, "to check"). Below, by
// section: everything else the house keeps and the freezer, each with one tick (on the list this time or not).
import type { Frozen, Item, Kitchen, ListState, Section, Staple, Store } from "./client";
import { norm } from "./words";

/** On the list for a dinner (not added by hand or ticked on Stock). */
export const fromDinner = (it: Pick<Item, "for" | "checked">) => {
  const f = it.for.trim().toLowerCase();
  return !it.checked && Boolean(f) && f !== "every week" && !f.split(",").map((x) => x.trim()).includes("added by hand");
};

/** check: not answered yet; have: there, so it stays off the list; need: on the list. */
export type PlanAnswer = "check" | "have" | "need";
export type PlanRow = { key: string; name: string; amount: string; answer: PlanAnswer; item: Item };

export type StockRow = { key: string; name: string; section: Section; have: boolean; open: Item | null; staple: Staple | null; frozen: Frozen | null; store: Store };

/**
 * What the dinners need from the house: things waiting to be checked (a dinner's pantry things, and anything kept in
 * Stock), and the ones already answered, so an answer can be seen and changed. A dinner's fresh groceries go straight on
 * the list and aren't here, unless they're kept in Stock (tortillas).
 */
export function planRows(list: ListState | null): PlanRow[] {
  const kept = new Set((list?.staples ?? []).map((s) => norm(s.item)));
  const seen = new Set<string>();
  const out: PlanRow[] = [];
  for (const it of list?.items ?? []) {
    if (it.checked) continue;
    const needed = !it.check && fromDinner(it) && (it.section !== "fresh" || kept.has(norm(it.item)));
    if (!it.check && !needed) continue;
    if (seen.has(norm(it.item))) continue;
    seen.add(norm(it.item));
    out.push({ key: it.id, name: it.item, amount: it.quantity, answer: it.have ? "have" : it.check ? "check" : "need", item: it });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything else in Stock, by section: the things kept and the freezer, minus what's in "For this plan". */
export function rowsOf(list: ListState | null, kitchen: Kitchen | null): StockRow[] {
  const items = list?.items ?? [];
  const inPlan = new Set(planRows(list).map((r) => norm(r.name)));
  const onList = (name: string) => items.find((i) => !i.checked && !i.check && norm(i.item) === norm(name)) ?? null;
  const rows: StockRow[] = [];
  const known = new Set(inPlan);
  for (const s of list?.staples ?? []) {
    if (known.has(norm(s.item))) continue;
    known.add(norm(s.item));
    const open = onList(s.item);
    rows.push({ key: `s|${norm(s.item)}`, name: s.item, section: s.section, have: !open, open, staple: s, frozen: null, store: s.store });
  }
  for (const f of kitchen?.freezer ?? []) {
    if (known.has(norm(f.item))) continue;
    known.add(norm(f.item));
    const open = onList(f.item);
    rows.push({ key: `f|${f.id}`, name: f.item, section: "freezer", have: !open, open, staple: null, frozen: f, store: (f.store as Store) || "safeway" });
  }
  return rows;
}
