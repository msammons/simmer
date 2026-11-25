// Stock's rows (Nov 11, Sam: checking stock means flagging what you've checked; you can't have and need a thing at once;
// keep everything in its section, with the meal highlight). Every row is answered Have or Need, or not yet ("check"):
// the things kept, what the planned dinners need from the house (highlighted, with the amount), and the freezer.
import type { Frozen, Item, Kitchen, ListState, Section, Staple, Store } from "./client";
import { norm } from "./words";

/** On the list for a dinner (not added by hand or ticked on Stock). */
export const fromDinner = (it: Pick<Item, "for" | "checked">) => {
  const f = it.for.trim().toLowerCase();
  return !it.checked && Boolean(f) && f !== "every week" && !f.split(",").map((x) => x.trim()).includes("added by hand");
};

/** The dinners a row names, without "added by hand" or "every week" ("added by hand, Tacos" names Tacos). */
const dinnersOf = (f: string) => f.split(",").map((x) => x.trim()).filter((x) => x && x.toLowerCase() !== "added by hand" && x.toLowerCase() !== "every week");

/**
 * What Remove from the list does to the thing's List rows (Sam, Nov 24: sugar stayed on Shop after its kept thing was
 * removed), on the phone and the server alike. Only rows not yet bought: a row with no dinner goes; a row a dinner also
 * needs ("added by hand, Tacos") keeps the dinner's part and goes back to waiting for it, as the dinner's alone; a
 * dinner's own row stays as it is. A row that goes takes its Safeway cart line with it (`cartLinesOf`, Nov 24 night:
 * "isn't removing from list enough signal?"); a row that stays keeps its line.
 */
export function removalOf(items: Item[], name: string): { drop: string[]; keep: { id: string; for: string }[] } {
  const drop: string[] = [], keep: { id: string; for: string }[] = [];
  for (const i of items) {
    if (i.checked || norm(i.item) !== norm(name) || fromDinner(i)) continue;
    const dinners = dinnersOf(i.for);
    if (dinners.length) keep.push({ id: i.id, for: dinners.join(", ") });
    else drop.push(i.id);
  }
  return { drop, keep };
}

/** The List rows after Remove from the list (`removalOf` applied): what the phone shows at once. */
export function afterRemoval(items: Item[], name: string): Item[] {
  const { drop, keep } = removalOf(items, name);
  const gone = new Set(drop), back = new Map(keep.map((k) => [k.id, k.for]));
  return items.filter((i) => !gone.has(i.id)).map((i) => (back.has(i.id) ? { ...i, for: back.get(i.id)!, check: true, have: false } : i));
}

/**
 * The list row an answer takes off the shopping list (Sam, Nov 24 night): Have, or the lit cart tapped again, on a row
 * marked Need. Its Safeway cart line comes out with it, with no question.
 */
export const leavingBy = (r: Pick<StockRow, "item" | "answer">, a: Answer): string | null =>
  r.item && r.answer === "need" && a !== "need" ? r.item.id : null;

/**
 * Which list row each Safeway cart line is for (Sam, Nov 24 night: bread added and taken out again and again showed
 * twice, its row and a loose line): the row it was put in the cart for, while that row is on the list; otherwise (that
 * row taken off while Safeway kept the product, then put back as a new row; or a line that came in for no row) the row
 * of the same name, else the row whose chosen product it is (`picks`), an unticked row first either way. Only a line
 * matching no row is for no row (put in on Safeway's own site). `items`: the rows that can hold a cart line (Shop's
 * Safeway rows, `cartRows`).
 */
export function tiesOf<L extends { itemId: string; item: string; productId?: string }>(lines: L[], items: Pick<Item, "id" | "item" | "checked">[], picks: { item: string; id: string }[] = []): Map<string, L[]> {
  const ids = new Set(items.map((i) => i.id));
  type Row = Pick<Item, "id" | "checked">;
  const better = (m: Map<string, Row>, k: string, i: Row) => { const had = m.get(k); if (!had || (had.checked && !i.checked)) m.set(k, i); };
  const byName = new Map<string, Row>(), byProduct = new Map<string, Row>();
  const pickOf = new Map(picks.map((p) => [norm(p.item), p.id]));
  for (const i of items) {
    better(byName, norm(i.item), i);
    const pid = pickOf.get(norm(i.item));
    if (pid) better(byProduct, pid, i);
  }
  const ties = new Map<string, L[]>();
  for (const l of lines) {
    const id = l.itemId && ids.has(l.itemId) ? l.itemId
      : (l.item?.trim() && byName.get(norm(l.item))?.id) || (l.productId && byProduct.get(l.productId)?.id) || undefined;
    if (id) ties.set(id, [...(ties.get(id) ?? []), l]);
  }
  return ties;
}

/** The rows that can hold a Safeway cart line, as Shop shows them: Safeway's, leaving out a dinner's thing still waiting on Have or Need. */
export const cartRows = <I extends Pick<Item, "store" | "check" | "checked">>(items: I[]): I[] => items.filter((i) => i.store === "safeway" && !(i.check && !i.checked));

/**
 * The list item ids the Safeway cart holds (`tiesOf`): what an order, Mark bought or New plan treats as in the cart. Every
 * line's own item too, so nothing it names is missed.
 */
export function heldIds(lines: { itemId: string; item: string; productId?: string }[], items: Item[], picks: { item: string; id: string }[] = []): Set<string> {
  return new Set([...lines.map((l) => l.itemId).filter(Boolean), ...tiesOf(lines, cartRows(items), picks).keys()]);
}

/**
 * The Safeway cart lines tied to list rows leaving the list (`ids`, by `tiesOf` over `items`, the list before the change):
 * each is taken to 0, as Shop's − does. `lines` may include changes still on their way (a + not answered yet).
 */
export function cartLinesOf<L extends { itemId: string; item: string; qty: number; productId?: string }>(lines: L[], ids: Iterable<string>, items: Item[], picks: { item: string; id: string }[] = []): L[] {
  const ties = tiesOf(lines, cartRows(items), picks);
  return [...new Set(ids)].flatMap((id) => ties.get(id) ?? []).filter((l) => l.qty > 0);
}

/** check: not answered yet; have: checked and there (off every list); need: on the list. */
export type Answer = "check" | "have" | "need";

export type StockRow = {
  key: string; name: string; section: Section; store: Store; answer: Answer;
  /** A planned dinner needs it: highlighted, with how much. */
  meal: boolean; amount: string;
  /** Its List row, if it has one (on the list, answered Have, or waiting for a dinner). */
  item: Item | null; staple: Staple | null; frozen: Frozen | null;
  /** The group it sits in on Stock (Nov 16), "" for none. */
  group: string;
};

const answerOf = (it: Item | null): Answer => (!it ? "check" : it.have ? "have" : it.check ? "check" : "need");

export function rowsOf(list: ListState | null, kitchen: Kitchen | null, opts: { all?: boolean } = {}): StockRow[] {
  const items = (list?.items ?? []).filter((i) => !i.checked);
  // Looked up by name once (Nov 19), the first of a name winning as before, and each item's dinner mark worked out once.
  const byName = new Map<string, Item>();
  for (const i of items) if (!byName.has(norm(i.item))) byName.set(norm(i.item), i);
  const dinner = new Map(items.map((i) => [i, fromDinner(i)]));
  const find = (name: string) => byName.get(norm(name)) ?? null;
  const row = (key: string, name: string, section: Section, store: Store, it: Item | null, staple: Staple | null, frozen: Frozen | null): StockRow => {
    const meal = Boolean(it && dinner.get(it));
    return { key, name, section, store, answer: answerOf(it), meal, amount: meal ? it!.quantity : "", item: it, staple, frozen, group: staple?.group ?? "" };
  };
  const rows: StockRow[] = [];
  const known = new Set<string>();
  for (const s of list?.staples ?? []) {
    if (known.has(norm(s.item))) continue;
    const it = find(s.item);
    // Specialty (Nov 16): shown only while on the list or answered; after the shop it leaves until added again.
    // With Show everything on the list (Nov 17), every kept thing shows, hidden specialty things too.
    if (s.kind === "specialty" && !it && !opts.all) continue;
    known.add(norm(s.item));
    rows.push(row(`s|${norm(s.item)}`, s.item, s.section, s.store, it, s, null));
  }
  // What the dinners need that isn't kept: every dinner thing, fresh and pantry (Nov 14), in its own section, highlighted.
  for (const it of items) {
    if (known.has(norm(it.item)) || !dinner.get(it)) continue;
    known.add(norm(it.item));
    rows.push(row(`m|${it.id}`, it.item, it.section, it.store, it, null, null));
  }
  for (const f of kitchen?.freezer ?? []) {
    if (known.has(norm(f.item))) continue;
    known.add(norm(f.item));
    rows.push(row(`f|${f.id}`, f.item, "freezer", (f.store as Store) || "safeway", find(f.item), null, f));
  }
  // Anything else on the list (Sam, Nov 24: sugar was on Shop but not here, its kept thing removed while it was Needed;
  // the same for a thing added by hand): its own row in its section, so everything on Shop shows here and can be answered.
  for (const it of items) {
    if (known.has(norm(it.item))) continue;
    known.add(norm(it.item));
    rows.push(row(`l|${it.id}`, it.item, it.section, it.store, it, null, null));
  }
  return rows;
}


/** One line on Stock within a section: a thing, or a group (Nov 16; one thing is enough since Sam's note that day). */
export type StockLine = { kind: "row"; row: StockRow } | { kind: "group"; name: string; rows: StockRow[] };

/**
 * A section's lines, A to Z (Nov 16, Robin's rule): things in the same group sit together under it. A group shows from
 * its first thing (Sam, Nov 16: a group just made with one thing didn't show). `empty`: groups to show even with nothing
 * showing in them (Show all groups, Nov 24), each as its header alone.
 */
export function linesOf(rows: StockRow[], empty: string[] = []): StockLine[] {
  const groups = new Map<string, StockRow[]>();
  for (const r of rows) if (r.group) groups.set(norm(r.group), [...(groups.get(norm(r.group)) ?? []), r]);
  const lines: StockLine[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const g = r.group ? groups.get(norm(r.group))! : null;
    if (!g) { lines.push({ kind: "row", row: r }); continue; }
    if (seen.has(norm(r.group))) continue;
    seen.add(norm(r.group));
    lines.push({ kind: "group", name: g[0].group, rows: [...g].sort((a, b) => a.name.localeCompare(b.name)) });
  }
  for (const name of empty) {
    if (seen.has(norm(name))) continue;
    seen.add(norm(name));
    lines.push({ kind: "group", name, rows: [] });
  }
  const nameOf = (l: StockLine) => (l.kind === "row" ? l.row.name : l.name);
  return lines.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}
