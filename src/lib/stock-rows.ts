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
  return rows;
}


/** One line on Stock within a section: a thing, or a group (Nov 16; one thing is enough since Sam's note that day). */
export type StockLine = { kind: "row"; row: StockRow } | { kind: "group"; name: string; rows: StockRow[] };

/**
 * A section's lines, A to Z (Nov 16, Robin's rule): things in the same group sit together under it. A group shows from
 * its first thing (Sam, Nov 16: a group just made with one thing didn't show).
 */
export function linesOf(rows: StockRow[]): StockLine[] {
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
  const nameOf = (l: StockLine) => (l.kind === "row" ? l.row.name : l.name);
  return lines.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}
