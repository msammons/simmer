// The shared grocery list: one row per item in the List tab, the Staples the house always keeps, and the Ingredients tab,
// the app's memory of which store and section an item goes in. Every change writes only its own row (add a row, set a
// row's checked cells), so two people changing the list at once can't erase each other's items. Without the Sheet (local
// dev) the list lives in memory, seeded from data/*.csv.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateJson } from "./google/gemini";
import { appendRows, ensureTab, readTab, replaceTab, sheetsConfigured, updateRange } from "./google/sheets";
import { AppError } from "./errors";
import { parseCsv, records } from "./parse";

export const STORES = ["safeway", "trader-joes", "costco"] as const;
export type Store = (typeof STORES)[number];
export const SECTIONS = ["fresh", "pantry", "freezer", "household"] as const;
export type Section = (typeof SECTIONS)[number];

export type Item = { id: string; item: string; quantity: string; store: Store; section: Section; for: string; addedBy: string; addedAt: string; checked: boolean };
export type Staple = { item: string; store: Store; section: Section; quantity: string; product: string };

const LIST = "List", STAPLES = "Staples", INGREDIENTS = "Ingredients";
const LIST_HEADERS = ["id", "item", "quantity", "store", "section", "for", "added_by", "added_at", "checked", "checked_at"];

const asStore = (s: string): Store => {
  const k = s.toLowerCase().replace(/[^a-z]/g, "");
  return k.startsWith("trader") || k === "tj" || k === "tjs" ? "trader-joes" : k.startsWith("costco") ? "costco" : "safeway";
};
const asSection = (s: string): Section => (SECTIONS as readonly string[]).includes(s.toLowerCase()) ? (s.toLowerCase() as Section) : "fresh";
const yes = (s: string) => /^(yes|y|true|1|x)$/i.test(s.trim());

/** The words for an item, the same however it's typed ("Lemons", "lemon"), for matching and merging. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/(?<=[a-z]{3})(es|s)$/, "");

/** "2 lemons" → 2, lemons; "lemons x2" → 2, lemons; "TP" → TP. */
export function parseEntry(text: string): { item: string; quantity: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const lead = t.match(/^(\d+(?:\.\d+)?|a dozen|dozen|a couple|a few)\s+(.+)$/i);
  if (lead) return { quantity: lead[1].toLowerCase().replace(/^a /, ""), item: lead[2] };
  const tail = t.match(/^(.+?)\s*(?:x|×)\s*(\d+)$/i);
  if (tail) return { quantity: tail[2], item: tail[1] };
  return { quantity: "", item: t };
}

// ---- reading

let memory: { list: Item[]; staples: Staple[]; ingredients: Map<string, { store: Store; section: Section }> } | null = null;

async function local(tab: string) {
  return readFile(path.join(process.cwd(), "data", `${tab.toLowerCase()}.csv`), "utf8").then(parseCsv, () => [] as string[][]);
}
const rowsOf = (tab: string) => (sheetsConfigured() ? readTab(tab).catch(() => [] as string[][]) : local(tab));

function toItems(rows: string[][]): Item[] {
  return records(rows).flatMap((r) => (r.get("id") && r.get("item") ? [{
    id: r.get("id"), item: r.get("item"), quantity: r.get("quantity"), store: asStore(r.get("store")), section: asSection(r.get("section")),
    for: r.get("for"), addedBy: r.get("added_by"), addedAt: r.get("added_at"), checked: yes(r.get("checked")),
  }] : []));
}
function toStaples(rows: string[][]): Staple[] {
  return records(rows).flatMap((r) => (r.get("item") ? [{ item: r.get("item"), store: asStore(r.get("store")), section: asSection(r.get("section")), quantity: r.get("usual_quantity"), product: r.get("usual_product") }] : []));
}

async function mem() {
  if (!memory) {
    const [l, s, i] = await Promise.all([local(LIST), local(STAPLES), local(INGREDIENTS)]);
    memory = { list: toItems(l), staples: toStaples(s), ingredients: new Map(records(i).map((r) => [norm(r.get("name")), { store: asStore(r.get("store")), section: asSection(r.get("section")) }])) };
  }
  return memory;
}

export async function loadList(): Promise<{ items: Item[]; staples: Staple[] }> {
  if (!sheetsConfigured()) { const m = await mem(); return { items: [...m.list], staples: m.staples }; }
  const [l, s] = await Promise.all([rowsOf(LIST), rowsOf(STAPLES)]);
  return { items: toItems(l), staples: toStaples(s) };
}

// ---- filing: which store and section an item goes in

/** Common things, so most items are filed without asking anyone. */
const KNOWN: Record<string, [Store, Section]> = Object.fromEntries(([
  ["milk egg yogurt butter cheese cream sour cream half and half banana apple orange lemon lime grape strawberr raspberr blueberr berry avocado tomato onion garlic potato carrot celery lettuce spinach broccoli cucumber pepper cilantro parsley basil herb bread tortilla ground beef ground turkey chicken salmon fish shrimp bacon ham deli turkey salad", "safeway", "fresh"],
  ["rice pasta flour sugar salt oil olive oil vinegar cereal oat oatmeal peanut butter jam jelly honey cracker goldfish chip pretzel snack bar granola can bean broth stock soup sauce salsa ketchup mustard mayo spice coffee tea", "safeway", "pantry"],
  ["frozen ice cream nugget frozen pizza frozen vegetable", "safeway", "freezer"],
  ["toilet paper tp paper towel napkin soap detergent dish soap trash bag foil plastic wrap sponge tissue shampoo toothpaste", "costco", "household"],
] as const).flatMap(([words, st, sec]) => words.split(" ").map((w) => [w, [st, sec]])));

function known(name: string): { store: Store; section: Section } | null {
  const n = norm(name);
  // The longest word that matches wins: "goldfish crackers" is goldfish (pantry), not fish (fresh).
  const hit = KNOWN[n] ?? Object.entries(KNOWN).filter(([w]) => w.length > 3 && n.includes(w)).sort((x, y) => y[0].length - x[0].length)[0]?.[1];
  return hit ? { store: hit[0], section: hit[1] } : null;
}

async function remembered(name: string) {
  const n = norm(name);
  if (!sheetsConfigured()) return (await mem()).ingredients.get(n) ?? null;
  for (const r of records(await rowsOf(INGREDIENTS))) if (norm(r.get("name")) === n) return { store: asStore(r.get("store")), section: asSection(r.get("section")) };
  return null;
}

/** Where an item goes: remembered, then common knowledge, then a quick guess (remembered after, so it's asked once). */
export async function file(name: string): Promise<{ store: Store; section: Section }> {
  const r = await remembered(name);
  if (r) return r;
  const k = known(name);
  if (k) return k;
  let guess: { store: Store; section: Section } = { store: "safeway", section: "fresh" };
  try {
    const { data } = await generateJson<{ store: string; section: string }>(
      `A family grocery list item: "${name}". Which store would they usually buy it at, and which part of the list is it? Stores: safeway (most things; the default), trader-joes (only Trader Joe's own products, like their frozen meals or dressings), costco (bulk household things like toilet paper). Sections: fresh (produce, dairy, meat, bread), pantry (shelf-stable food), freezer, household (not food).`,
      { type: "OBJECT", properties: { store: { type: "STRING", enum: [...STORES] }, section: { type: "STRING", enum: [...SECTIONS] } }, required: ["store", "section"] },
      { light: true, timeoutMs: 8_000 },
    );
    guess = { store: asStore(data.store), section: asSection(data.section) };
  } catch (e) { console.error("couldn't file", name, e); return guess; }
  await rememberFiling(name, guess);
  return guess;
}

async function rememberFiling(name: string, f: { store: Store; section: Section }) {
  if (!sheetsConfigured()) { (await mem()).ingredients.set(norm(name), f); return; }
  await ensureTab(INGREDIENTS);
  const rows = await rowsOf(INGREDIENTS);
  const n = norm(name);
  const at = records(rows).find((r) => norm(r.get("name")) === n);
  if (at) await updateRange(`${INGREDIENTS}!A${at.rowNumber}:C${at.rowNumber}`, [[name, f.section, f.store]]);
  else await appendRows(INGREDIENTS, [...(rows.length ? [] : [["name", "section", "store"]]), [name, f.section, f.store]]);
}

// ---- changing

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const stamp = () => new Date().toISOString();

/** Adds an item, or merges it into the same unchecked item already on the list (quantities add up when they're numbers). */
export async function addItem(text: string, by: string, forWhat = "", filing?: { store: Store; section: Section }): Promise<Item> {
  const { item, quantity } = parseEntry(text);
  if (!item) throw new AppError("Type what to add.");
  const { items } = await loadList();
  const same = items.find((x) => !x.checked && norm(x.item) === norm(item));
  if (same) {
    const q = /^\d+$/.test(same.quantity) && /^\d+$/.test(quantity) ? String(Number(same.quantity) + Number(quantity)) : quantity || same.quantity;
    if (q !== same.quantity) await setCells(same.id, { quantity: q });
    return { ...same, quantity: q };
  }
  const f = filing ?? (await file(item));
  const row: Item = { id: newId(), item, quantity, store: f.store, section: f.section, for: forWhat, addedBy: by, addedAt: stamp(), checked: false };
  if (!sheetsConfigured()) { (await mem()).list.push(row); return row; }
  await ensureTab(LIST);
  const existing = await rowsOf(LIST);
  await appendRows(LIST, [...(existing.length ? [] : [LIST_HEADERS]), [row.id, row.item, row.quantity, row.store, row.section, row.for, row.addedBy, row.addedAt, "no", ""]]);
  return row;
}

const COLS: Record<string, string> = { quantity: "quantity", store: "store", section: "section", checked: "checked", checkedAt: "checked_at" };

/** Changes some of one row's cells, found by its id (the columns by their headers, so hand edits to the order are fine). */
async function setCells(id: string, change: Partial<Record<keyof typeof COLS, string>>) {
  if (!sheetsConfigured()) {
    const it = (await mem()).list.find((x) => x.id === id);
    if (it) Object.assign(it, { ...(change.quantity !== undefined && { quantity: change.quantity }), ...(change.store && { store: asStore(change.store) }), ...(change.section && { section: asSection(change.section) }), ...(change.checked !== undefined && { checked: yes(change.checked) }) });
    return;
  }
  const rows = await rowsOf(LIST);
  const headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = records(rows).find((r) => r.get("id") === id);
  if (!at) throw new AppError("That item isn't on the list anymore.");
  for (const [k, v] of Object.entries(change)) {
    const col = headers.indexOf(COLS[k]);
    if (col < 0 || v === undefined) continue;
    const letter = String.fromCharCode(65 + col);
    await updateRange(`${LIST}!${letter}${at.rowNumber}`, [[v]]);
  }
}

export const checkItem = (id: string, checked: boolean) => setCells(id, { checked: checked ? "yes" : "no", checkedAt: checked ? stamp() : "" });

/** Moves an item to another store or section, and remembers that's where it goes. */
export async function moveItem(id: string, to: { store?: Store; section?: Section }) {
  const it = (await loadList()).items.find((x) => x.id === id);
  if (!it) throw new AppError("That item isn't on the list anymore.");
  await setCells(id, { ...(to.store && { store: to.store }), ...(to.section && { section: to.section }) });
  await rememberFiling(it.item, { store: to.store ?? it.store, section: to.section ?? it.section }).catch((e) => console.error("couldn't remember filing", e));
}

/** Finishing a trip: the store's checked items come off the list (everything else stays, including other stores'). */
export async function doneShopping(store: Store): Promise<number> {
  if (!sheetsConfigured()) {
    const m = await mem();
    const before = m.list.length;
    m.list = m.list.filter((x) => !(x.store === store && x.checked));
    return before - m.list.length;
  }
  const rows = await rowsOf(LIST);
  const recs = records(rows);
  const keep = recs.filter((r) => !(asStore(r.get("store")) === store && yes(r.get("checked"))));
  await replaceTab(LIST, [rows[0] ?? LIST_HEADERS, ...keep.map((r) => rows[r.rowNumber - 1])]);
  return recs.length - keep.length;
}

export async function removeItem(id: string) {
  if (!sheetsConfigured()) { const m = await mem(); m.list = m.list.filter((x) => x.id !== id); return; }
  const rows = await rowsOf(LIST);
  const recs = records(rows);
  await replaceTab(LIST, [rows[0] ?? LIST_HEADERS, ...recs.filter((r) => r.get("id") !== id).map((r) => rows[r.rowNumber - 1])]);
}
