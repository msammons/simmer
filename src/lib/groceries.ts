// The shared grocery list: one row per item in the List tab, the Staples the house always keeps, and the Ingredients tab,
// the app's memory of which store and section an item goes in. Every change writes only its own row (add a row, set a
// row's checked cells), so two people changing the list at once can't erase each other's items. Without the Sheet (local
// dev) the list lives in memory, seeded from data/*.csv.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateJson } from "./google/gemini";
import { appendRows, ensureTab, readTabIfAny, replaceTab, sheetsConfigured, updateRange, updateRanges } from "./google/sheets";
import { AppError } from "./errors";
import { parseCsv, records } from "./parse";
import { isSpice, norm } from "./words";

export const STORES = ["safeway", "trader-joes", "costco"] as const;
export type Store = (typeof STORES)[number];
export const SECTIONS = ["fresh", "pantry", "freezer", "household"] as const;
export type Section = (typeof SECTIONS)[number];

/** check: a pantry item from the plan, waiting in "Check you have these" until she says she needs it. */
export type Item = { id: string; item: string; quantity: string; store: Store; section: Section; for: string; addedBy: string; addedAt: string; checked: boolean; check: boolean };
/** `weekly`: bought every week (Nov 3: lunch foods and the like); Done shopping puts it back on its store's list. */
export type Staple = { item: string; store: Store; section: Section; quantity: string; product: string; weekly?: boolean };

const LIST = "List", STAPLES = "Staples", INGREDIENTS = "Ingredients";
const LIST_HEADERS = ["id", "item", "quantity", "store", "section", "for", "added_by", "added_at", "checked", "checked_at", "check"];

const asStore = (s: string): Store => {
  const k = s.toLowerCase().replace(/[^a-z]/g, "");
  return k.startsWith("trader") || k === "tj" || k === "tjs" ? "trader-joes" : k.startsWith("costco") ? "costco" : "safeway";
};
const asSection = (s: string): Section => (SECTIONS as readonly string[]).includes(s.toLowerCase()) ? (s.toLowerCase() as Section) : "fresh";
const yes = (s: string) => /^(yes|y|true|1|x)$/i.test(s.trim());

export { norm };

/** "2 lemons" → 2, lemons; "2 lb ground beef" → 2 lb, ground beef; "1 1/2 lb beef" → 1 1/2 lb, beef; "lemons x2" → 2, lemons; "TP" → TP. */
export function parseEntry(text: string): { item: string; quantity: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const lead = t.match(/^((?:\d+\s+\d+\/\d+|\d+(?:\.\d+)?|\d+\/\d+)(?:\s*(?:lbs?|pounds?|oz|ounces?|gallons?|gal|quarts?|pints?|liters?|kg|g)\.?(?=\s))?|a dozen|dozen|a couple|a few)\s+(.+)$/i);
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
// A failed read throws: read as empty, it would show an empty list or Stock, and a change written after it would erase the tab.
const rowsOf = (tab: string) => (sheetsConfigured() ? readTabIfAny(tab) : local(tab));

function toItems(rows: string[][]): Item[] {
  return records(rows).flatMap((r) => (r.get("id") && r.get("item") ? [{
    id: r.get("id"), item: r.get("item"), quantity: r.get("quantity"), store: asStore(r.get("store")), section: asSection(r.get("section")),
    for: r.get("for"), addedBy: r.get("added_by"), addedAt: r.get("added_at"), checked: yes(r.get("checked")), check: yes(r.get("check")),
  }] : []));
}
function toStaples(rows: string[][]): Staple[] {
  return records(rows).flatMap((r) => (r.get("item") ? [{ item: r.get("item"), store: asStore(r.get("store")), section: asSection(r.get("section")), quantity: r.get("usual_quantity"), product: r.get("usual_product"), weekly: yes(r.get("weekly")) }] : []));
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

/**
 * The list's items and, with the Sheet, the List tab's rows as read: read once and passed down, so a change is one read
 * and one write (Nov 10: re-reading the tab for each step ran into Google's limit of about 60 reads a minute).
 */
async function readList(): Promise<{ items: Item[]; rows?: string[][] }> {
  if (!sheetsConfigured()) return { items: [...(await mem()).list] };
  const rows = await rowsOf(LIST);
  return { items: toItems(rows), rows };
}

// ---- filing: which store and section an item goes in

/**
 * Common things, so most items are filed without asking anyone (spices first, by isSpice in words.ts). Entries are
 * phrases, comma-separated: "ice cream" and "peanut butter" are whole, so cream stays fresh and butter isn't pantry (split
 * into words they filed cream as freezer and milk as pantry, Nov 3). A stem like "strawberr" matches the word's start.
 */
const KNOWN: Record<string, [Store, Section]> = Object.fromEntries(([
  ["milk, egg, yogurt, butter, cheese, cream, sour cream, half and half, banana, apple, orange, lemon, lime, grape, strawberr, raspberr, blueberr, berry, avocado, tomato, onion, garlic, potato, carrot, celery, lettuce, spinach, broccoli, cucumber, bell pepper, cilantro, parsley, fresh basil, herb, bread, tortilla, ground beef, ground turkey, chicken, salmon, fish, shrimp, bacon, ham, deli, turkey, salad, zucchini, squash, mushroom, kale, cabbage, ginger root, jalapeno, scallion, green onion, mint, thyme, rosemary, dill, shallot, leek, asparagus, green bean, pork, sausage, steak, tofu, mozzarella, parmesan, cheddar, feta, ricotta, hummus, pie crust", "safeway", "fresh"],
  ["rice, pasta, spaghetti, penne, macaroni, lasagna noodle, flour, sugar, salt, oil, olive oil, vinegar, cereal, oat, oatmeal, peanut butter, jam, jelly, honey, cracker, goldfish, chip, pretzel, snack, granola, granola bar, canned, broth, stock, soup, sauce, salsa, ketchup, mustard, mayo, spice, coffee, tea, cumin, paprika, oregano, chili powder, cinnamon, vanilla, baking soda, baking powder, breadcrumb, panko, soy sauce, coconut milk, evaporated milk, condensed milk, tomato paste, tomato sauce, crushed tomato, diced tomato, noodle, quinoa, lentil, chickpea, black bean, refried bean, kidney bean, pinto bean, brown sugar, corn syrup, seasoning, taco seasoning, pecan, walnut, almond", "safeway", "pantry"],
  ["frozen, ice cream, nugget, frozen pizza, frozen vegetable", "safeway", "freezer"],
  ["toilet paper, tp, paper towel, napkin, soap, detergent, dish soap, trash bag, foil, plastic wrap, sponge, tissue, shampoo, toothpaste", "costco", "household"],
] as const).flatMap(([words, st, sec]) => words.split(",").map((w) => [w.trim(), [st, sec]])));

export function known(name: string): { store: Store; section: Section } | null {
  // Spices first: "ground cumin" isn't ground beef, "black pepper" isn't a bell pepper.
  if (isSpice(name)) return { store: "safeway", section: "pantry" };
  const n = norm(name);
  // The longest entry that matches from the start of a word wins: "goldfish crackers" is goldfish (pantry), not fish
  // (fresh); "graham crackers" isn't ham.
  const at = (w: string) => ` ${n} `.includes(` ${norm(w)}`);
  const hit = KNOWN[n] ?? Object.entries(KNOWN).filter(([w]) => w.length > 2 && at(w)).sort((x, y) => y[0].length - x[0].length)[0]?.[1];
  return hit ? { store: hit[0], section: hit[1] } : null;
}

type Filing = { store: Store; section: Section };

/** The Ingredients tab by name (the first row for a name wins) and its row number. */
function byName(rows: string[][]) {
  const out = new Map<string, Filing & { row: number }>();
  for (const r of records(rows)) { const n = norm(r.get("name")); if (!out.has(n)) out.set(n, { store: asStore(r.get("store")), section: asSection(r.get("section")), row: r.rowNumber }); }
  return out;
}

/** Where an item goes: remembered, then common knowledge, then a quick guess (remembered after, so it's asked once). */
export async function file(name: string): Promise<Filing> {
  return (await fileAll([name]))[0];
}

/**
 * Where each of several items goes, with what's remembered read once (Nov 10: one read per item ran into Google's limit
 * of about 60 reads a minute) and the new guesses remembered together.
 */
async function fileAll(names: string[]): Promise<Filing[]> {
  if (!names.length) return [];
  const rows = sheetsConfigured() ? await rowsOf(INGREDIENTS) : null;
  const saved: Map<string, Filing> = rows ? byName(rows) : (await mem()).ingredients;
  const guessed: { name: string; f: Filing }[] = [];
  const out = await Promise.all(names.map(async (name): Promise<Filing> => {
    const r = saved.get(norm(name));
    if (r) return { store: r.store, section: r.section };
    const k = known(name);
    if (k) return k;
    try {
      const { data } = await generateJson<{ store: string; section: string }>(
        `A family grocery list item: "${name}". Which store would they usually buy it at, and which part of the list is it? Stores: safeway (most things; the default), trader-joes (only Trader Joe's own products, like their frozen meals or dressings), costco (bulk household things like toilet paper). Sections: fresh (produce, dairy, meat, bread), pantry (shelf-stable food), freezer, household (not food).`,
        { type: "OBJECT", properties: { store: { type: "STRING", enum: [...STORES] }, section: { type: "STRING", enum: [...SECTIONS] } }, required: ["store", "section"] },
        { light: true, timeoutMs: 8_000 },
      );
      const f = { store: asStore(data.store), section: asSection(data.section) };
      guessed.push({ name, f });
      return f;
    } catch (e) { console.error("couldn't file", name, e); return { store: "safeway", section: "fresh" }; }
  }));
  await rememberFilings(guessed, rows ?? undefined);
  return out;
}

/** Remembers where things go: a row already there for the name is changed, the rest added, in one write each. */
async function rememberFilings(list: { name: string; f: Filing }[], rows?: string[][]) {
  if (!list.length) return;
  if (!sheetsConfigured()) { const m = await mem(); for (const { name, f } of list) m.ingredients.set(norm(name), f); return; }
  rows ??= await rowsOf(INGREDIENTS);
  if (!rows.length) await ensureTab(INGREDIENTS);
  const at = byName(rows);
  const last = new Map(list.map((x) => [norm(x.name), x])); // the same name twice: the later one
  const changed: { range: string; values: string[][] }[] = [], added: string[][] = [];
  for (const [n, { name, f }] of last) {
    const r = at.get(n)?.row;
    if (r) changed.push({ range: `${INGREDIENTS}!A${r}:C${r}`, values: [[name, f.section, f.store]] });
    else added.push([name, f.section, f.store]);
  }
  await updateRanges(changed);
  if (added.length) await appendRows(INGREDIENTS, [...(rows.length ? [] : [["name", "section", "store"]]), ...added]);
}

// ---- changing

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const stamp = () => new Date().toISOString();

/** Adds an item, or merges it into the same unchecked item already on the list (quantities add up when they're numbers). */
export async function addItem(text: string, by: string, forWhat = "", filing?: { store: Store; section: Section }, amount?: string): Promise<Item> {
  const parsed = parseEntry(text);
  const { item, quantity } = amount === undefined ? parsed : { item: text.trim(), quantity: amount.trim() };
  if (!item) throw new AppError("Type what to add.");
  const { items, rows } = await readList();
  const same = items.find((x) => !x.checked && norm(x.item) === norm(item));
  if (same) {
    const q = addUp(same.quantity, quantity);
    if (q !== same.quantity) await setManyCells([[same.id, { quantity: q }]], true, rows);
    return { ...same, quantity: q };
  }
  const f = filing ?? (await file(item));
  const row: Item = { id: newId(), item, quantity, store: f.store, section: f.section, for: forWhat, addedBy: by, addedAt: stamp(), checked: false, check: false };
  await appendItems([row], rows);
  return row;
}

const cellsOf = (row: Item): Record<string, string> => ({
  id: row.id, item: row.item, quantity: row.quantity, store: row.store, section: row.section, for: row.for, added_by: row.addedBy, added_at: row.addedAt,
  checked: row.checked ? "yes" : "no", checked_at: "", check: row.check ? "yes" : "", // ticked stays ticked when Undo puts it back
});

/** New rows at the end of the List tab, written by its own headers (a missing column is added first). `existing`: the tab as just read. */
async function appendItems(rows: Item[], existing?: string[][]) {
  if (!rows.length) return;
  if (!sheetsConfigured()) { (await mem()).list.push(...rows); return; }
  existing ??= await rowsOf(LIST);
  if (!existing.length) { await ensureTab(LIST); await appendRows(LIST, [LIST_HEADERS, ...rows.map((r) => LIST_HEADERS.map((h) => cellsOf(r)[h]))]); return; }
  const headers = existing[0].map((h) => h.trim().toLowerCase());
  const missing = LIST_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    await updateRange(`${LIST}!${col(headers.length)}1:${col(headers.length + missing.length - 1)}1`, [missing]);
    headers.push(...missing);
  }
  await appendRows(LIST, rows.map((r) => headers.map((h) => cellsOf(r)[h] ?? "")));
}
const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

// ---- adding amounts up

const GLYPHS: Record<string, number> = { "½": 1 / 2, "¼": 1 / 4, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 1 / 8 };
/** Units that can be added up, each spelling → one name ("lbs", "pounds" → lb). Others (a "medium" onion) aren't summed. */
const UNITS: Record<string, string> = {
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", oz: "oz", ounce: "oz", ounces: "oz",
  can: "can", cans: "can", head: "head", heads: "head", bunch: "bunch", bunches: "bunch", bag: "bag", bags: "bag",
  jar: "jar", jars: "jar", box: "box", boxes: "box", bottle: "bottle", bottles: "bottle", package: "package", packages: "package",
  pkg: "package", pkgs: "package", loaf: "loaf", loaves: "loaf", stick: "stick", sticks: "stick", clove: "clove", cloves: "clove",
  cup: "cup", cups: "cup", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  pint: "pint", pints: "pint", quart: "quart", quarts: "quart", gallon: "gallon", gallons: "gallon", dozen: "dozen",
};
const PLURAL: Record<string, string> = { bunch: "bunches", box: "boxes", loaf: "loaves" };
const SAME_PLURAL = new Set(["lb", "oz", "tbsp", "tsp", "dozen"]);

/** "1½ lb", "1 1/2 lbs", "1/2 pound", "2" → { n, unit } (unit "" for a plain count); null when it isn't one number and one known unit. */
export function amountOf(q: string): { n: number; unit: string } | null {
  const m = q.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+)|([½¼¾⅓⅔⅛]))?\s*([a-z]+\.?)?$/);
  if (!m || (!m[1] && !m[2] && !m[4])) return null;
  if (m[1] && m[2] && /\./.test(m[1])) return null; // "1.5 1/2"
  const n = Number(m[1] ?? 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0) + (m[4] ? GLYPHS[m[4]] : 0);
  if (!Number.isFinite(n) || (m[2] && !Number(m[3]))) return null;
  const word = (m[5] ?? "").replace(/\.$/, "");
  if (word && !UNITS[word]) return null;
  return { n, unit: word ? UNITS[word] : "" };
}
/** 2.5 → "2½", 0.5 → "½", 2 → "2"; other fractions as decimals ("1.38"). */
function numberText(n: number): string {
  const whole = Math.floor(n + 1e-9), rest = n - whole;
  if (rest < 1e-6) return String(whole);
  const glyph = Object.entries(GLYPHS).find(([, v]) => Math.abs(v - rest) < 1e-6)?.[0];
  if (glyph) return `${whole || ""}${glyph}`;
  return String(Math.round(n * 100) / 100);
}

/**
 * Two amounts of the same thing on the list, added up when they share a unit: "1 lb" + "1 lb" → "2 lb", "1½ lb" + "1/2 lb"
 * → "2 lb", "1" + "1" → "2" (Nov 9: pounds stayed "1 lb"). Otherwise the newer amount, or the one there is.
 */
export function addUp(a: string, b: string): string {
  const x = amountOf(a), y = amountOf(b);
  if (!x || !y || x.unit !== y.unit) return b || a;
  const n = x.n + y.n;
  const unit = !x.unit ? "" : SAME_PLURAL.has(x.unit) || n <= 1 ? x.unit : PLURAL[x.unit] ?? `${x.unit}s`;
  return [numberText(n), unit].filter(Boolean).join(" ");
}

/** Less of an amount: "2½ lb" less "1 lb" → "1½ lb", "" when none is left; null when it can't be worked out. */
export function takeAway(a: string, b: string): string | null {
  const x = amountOf(a), y = amountOf(b);
  if (!x || !y || x.unit !== y.unit) return null;
  const n = x.n - y.n;
  if (n <= 1e-6) return "";
  const unit = !x.unit ? "" : SAME_PLURAL.has(x.unit) || n <= 1 ? x.unit : PLURAL[x.unit] ?? `${x.unit}s`;
  return [numberText(n), unit].filter(Boolean).join(" ");
}

/** The dinners a list item is for ("tacos, turkey chili"). */
const forOf = (f: string) => f.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * A dinner off the plan (taken off, swapped, or replaced by starting over; Nov 10): what only it needed comes off the
 * list, and what it shared with another dinner is cut back by its amount. Never something ticked off or in the Safeway
 * cart (`held`: list item ids), which may be bought already; never something added by hand (it's for no dinner).
 * Answers how many things came off.
 */
export async function takeOffFor(needs: { item: string; quantity: string; for: string; stay?: boolean }[], held: Set<string> = new Set()): Promise<number> {
  if (!needs.length) return 0;
  const { items, rows } = await readList();
  const drop = new Set<string>();
  const cut = new Map<string, { quantity: string; for: string }>();
  for (const n of needs) {
    const it = items.find((x) => !x.checked && !drop.has(x.id) && norm(x.item) === norm(n.item) && forOf(cut.get(x.id)?.for ?? x.for).includes(n.for));
    if (!it || held.has(it.id)) continue;
    const now = cut.get(it.id) ?? { quantity: it.quantity, for: it.for };
    // `stay`: the same dinner is still planned (it was planned twice): its amount is cut back, and it stays for it.
    const others = n.stay ? forOf(now.for) : forOf(now.for).filter((f) => f !== n.for);
    if (!others.length) { drop.add(it.id); cut.delete(it.id); continue; }
    const less = n.quantity ? takeAway(now.quantity, n.quantity) : null;
    cut.set(it.id, { quantity: less === null || (n.stay && less === "") ? now.quantity : less, for: others.join(", ") });
  }
  const cuts: CellChanges = [...cut].map(([id, c]) => [id, { quantity: c.quantity, for: c.for }]);
  if (rows && drop.size) {
    // Cut back and taken off in one write: the tab as read, with the cuts made and the dropped rows gone.
    const next = withCells(rows, cuts);
    const recs = records(next);
    await replaceTab(LIST, [next[0] ?? LIST_HEADERS, ...recs.filter((r) => !drop.has(r.get("id"))).map((r) => next[r.rowNumber - 1])], rows);
    return drop.size;
  }
  await setManyCells(cuts, false, rows);
  if (drop.size) await removeItems([...drop]);
  return drop.size;
}

/**
 * Many items at once (a recipe's ingredients, a planned week): the list is read once, each item merges into the same
 * unchecked item already there (two recipes needing onions make one line), and the new ones go in one write.
 * check: pantry items for "Check you have these"; an item already on the list for real stays there.
 */
export async function addItems(entries: { item: string; quantity: string; for: string; check?: boolean }[], by: string): Promise<number> {
  const [{ items, rows }, staples] = await Promise.all([readList(), sheetsConfigured() ? rowsOf(STAPLES).then(toStaples) : mem().then((m) => m.staples)]);
  // What the house keeps (Stock) is only highlighted there, to check; so is the plan's pantry (below); everything else
  // goes on a list (Matt, Nov 2).
  const kept = new Set(staples.map((s) => norm(s.item)));
  const fresh: Item[] = [];
  const merged = new Map<string, { quantity: string; for: string }>();
  for (const e of entries) {
    const item = e.item.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!item) continue;
    const same = [...fresh, ...items].find((x) => !x.checked && norm(x.item) === norm(item));
    if (same) {
      const q = e.check && !same.check ? same.quantity : addUp(same.quantity, e.quantity);
      const f = same.for.includes(e.for) || !e.for ? same.for : [same.for, e.for].filter(Boolean).join(", ").slice(0, 120);
      if (fresh.includes(same)) { same.quantity = q; same.for = f; if (!e.check) same.check = false; }
      else if (q !== same.quantity || f !== same.for || (!e.check && same.check)) { merged.set(same.id, { quantity: q, for: f }); Object.assign(same, { quantity: q, for: f, check: e.check ? same.check : false }); }
      continue;
    }
    fresh.push({ id: newId(), item, quantity: e.quantity, store: "safeway", section: "fresh", for: e.for, addedBy: by, addedAt: stamp(), checked: false, check: Boolean(e.check) });
  }
  // Filed together, so the few new things that need a guess are asked about at the same time.
  const filings = await fileAll(fresh.map((x) => x.item));
  fresh.forEach((x, i) => Object.assign(x, filings[i]));
  for (const x of fresh) x.check = kept.has(norm(x.item)) || (x.check && x.section === "pantry");
  await setManyCells([...merged].map(([id, m]) => [id, { quantity: m.quantity, for: m.for, check: items.find((x) => x.id === id)!.check ? "yes" : "" }]), false, rows);
  await appendItems(fresh, rows);
  // What went on a list; the pantry highlighted in Stock isn't counted ("Added 45 things" with 26 on the lists, Nov 3).
  return fresh.filter((x) => !x.check).length + [...merged.keys()].filter((id) => !items.find((x) => x.id === id)!.check).length;
}

/** "Check you have these": she needs this one (it joins the list), or has the rest (they come off). */
export const needItem = (id: string) => setCells(id, { check: "" });
export async function haveTheRest(): Promise<void> {
  if (!sheetsConfigured()) { const m = await mem(); m.list = m.list.filter((x) => !(x.check && !x.checked)); return; }
  const rows = await rowsOf(LIST);
  const recs = records(rows);
  await replaceTab(LIST, [rows[0] ?? LIST_HEADERS, ...recs.filter((r) => !(yes(r.get("check")) && !yes(r.get("checked")))).map((r) => rows[r.rowNumber - 1])], rows);
}

const COLS: Record<string, string> = { quantity: "quantity", store: "store", section: "section", checked: "checked", checkedAt: "checked_at", for: "for", check: "check" };

/** Changes some of one row's cells, found by its id (the columns by their headers, so hand edits to the order are fine). */
async function setCells(id: string, change: Partial<Record<keyof typeof COLS, string>>) {
  await setManyCells([[id, change]], true);
}

type CellChanges = [string, Partial<Record<keyof typeof COLS, string>>][];

/** The List tab's rows with some items' cells changed (a missing item is skipped). */
function withCells(rows: string[][], changes: CellChanges): string[][] {
  const next = rows.map((r) => [...r]);
  const headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = new Map(records(rows).map((r) => [r.get("id"), r.rowNumber]));
  for (const [id, change] of changes) {
    const n = at.get(id);
    if (!n) continue;
    for (const [k, v] of Object.entries(change)) {
      const i = headers.indexOf(COLS[k as keyof typeof COLS]);
      if (i >= 0 && v !== undefined) { const row = next[n - 1]; while (row.length < i) row.push(""); row[i] = v; }
    }
  }
  return next;
}

/** Several items' cells changed with one read and one write (`strict`: a missing item is an error; `rows`: the tab as just read). */
async function setManyCells(changes: CellChanges, strict = false, rows?: string[][]) {
  if (!changes.length) return;
  if (!sheetsConfigured()) {
    const m = await mem();
    for (const [id, change] of changes) {
      const it = m.list.find((x) => x.id === id);
      if (!it) { if (strict) throw new AppError("That item isn't on the list anymore."); continue; }
      Object.assign(it, { ...(change.quantity !== undefined && { quantity: change.quantity }), ...(change.store && { store: asStore(change.store) }), ...(change.section && { section: asSection(change.section) }), ...(change.checked !== undefined && { checked: yes(change.checked) }), ...(change.for !== undefined && { for: change.for }), ...(change.check !== undefined && { check: yes(change.check) }) });
    }
    return;
  }
  rows ??= await rowsOf(LIST);
  const headers = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const at = new Map(records(rows).map((r) => [r.get("id"), r.rowNumber]));
  const data: { range: string; values: string[][] }[] = [];
  for (const [id, change] of changes) {
    const n = at.get(id);
    if (!n) { if (strict) throw new AppError("That item isn't on the list anymore."); continue; }
    for (const [k, v] of Object.entries(change)) {
      const i = headers.indexOf(COLS[k as keyof typeof COLS]);
      if (i >= 0 && v !== undefined) data.push({ range: `${LIST}!${col(i)}${n}`, values: [[v]] });
    }
  }
  await updateRanges(data);
}

export const checkItem = (id: string, checked: boolean) => setCells(id, { checked: checked ? "yes" : "no", checkedAt: checked ? stamp() : "" });

/** Moves an item to another store or section, and remembers that's where it goes. */
export async function moveItem(id: string, to: { store?: Store; section?: Section }) {
  const { items, rows } = await readList();
  const it = items.find((x) => x.id === id);
  if (!it) throw new AppError("That item isn't on the list anymore.");
  await setManyCells([[id, { ...(to.store && { store: to.store }), ...(to.section && { section: to.section }) }]], true, rows);
  await rememberFilings([{ name: it.item, f: { store: to.store ?? it.store, section: to.section ?? it.section } }]).catch((e) => console.error("couldn't remember filing", e));
}

const BOUGHT = "Bought";
const BOUGHT_HEADERS = ["item", "quantity", "store", "date_bought", "for"];
const boughtRow = (x: Item) => [x.item, x.quantity, x.store, stamp().slice(0, 10), x.for];
const boughtMemory: string[][] = [];

/** What has been bought so far (the Bought tab), newest last; read for the tests and for whatever looks back later. */
export async function loadBought(): Promise<string[][]> {
  return sheetsConfigured() ? (await readTabIfAny(BOUGHT)).slice(1) : [...boughtMemory];
}

/** Bought history (Nov 3): what's coming off the list is written down first, so the rows only go once the note is safely made. */
async function recordBought(gone: Item[]) {
  if (!gone.length) return;
  if (!sheetsConfigured()) { boughtMemory.push(...gone.map(boughtRow)); return; }
  const existing = await readTabIfAny(BOUGHT);
  if (!existing.length) await ensureTab(BOUGHT);
  await appendRows(BOUGHT, [...(existing.length ? [] : [BOUGHT_HEADERS]), ...gone.map(boughtRow)]);
}

/** Finishing a trip: the store's checked items come off the list (everything else stays, including other stores'). */
/** Bought: clears that store's checked items, and `alsoIds` (for Safeway, what's in the cart). */
export async function doneShopping(store: Store, alsoIds: Set<string> = new Set()): Promise<number> {
  const off = (x: Item) => x.store === store && (x.checked || alsoIds.has(x.id));
  if (!sheetsConfigured()) {
    const m = await mem();
    const gone = m.list.filter(off);
    await recordBought(gone);
    m.list = m.list.filter((x) => !off(x));
    await refillWeekly(store);
    return gone.length;
  }
  const rows = await rowsOf(LIST);
  const recs = records(rows);
  const goneRecs = recs.filter((r) => asStore(r.get("store")) === store && (yes(r.get("checked")) || alsoIds.has(r.get("id"))));
  await recordBought(toItems([rows[0] ?? LIST_HEADERS, ...goneRecs.map((r) => rows[r.rowNumber - 1])]));
  const drop = new Set(goneRecs);
  await replaceTab(LIST, [rows[0] ?? LIST_HEADERS, ...recs.filter((r) => !drop.has(r)).map((r) => rows[r.rowNumber - 1])], rows);
  await refillWeekly(store);
  return goneRecs.length;
}

/** After a shop, that store's Every week things go back on its list for next time (one already there stays as it is). */
async function refillWeekly(store: Store) {
  const { items, staples } = await loadList();
  for (const s of staples.filter((x) => x.weekly && x.store === store && !items.some((i) => !i.checked && norm(i.item) === norm(x.item))))
    await addItem(s.item, "Simmer", "every week", { store: s.store, section: s.section }, s.quantity);
}

export async function removeItem(id: string) {
  if (!sheetsConfigured()) { const m = await mem(); m.list = m.list.filter((x) => x.id !== id); return; }
  const rows = await rowsOf(LIST);
  const recs = records(rows);
  await replaceTab(LIST, [rows[0] ?? LIST_HEADERS, ...recs.filter((r) => r.get("id") !== id).map((r) => rows[r.rowNumber - 1])], rows);
}

/** Clear: several items off at once (one write). Answers with what came off, so Undo can put it back. `rows`: the tab as just read. */
export async function removeItems(ids: string[], rows?: string[][]): Promise<Item[]> {
  const drop = new Set(ids);
  if (!sheetsConfigured()) { const m = await mem(); const gone = m.list.filter((x) => drop.has(x.id)); m.list = m.list.filter((x) => !drop.has(x.id)); return gone; }
  const all = rows ?? (await rowsOf(LIST));
  const recs = records(all);
  const gone = toItems([all[0] ?? LIST_HEADERS, ...recs.filter((r) => drop.has(r.get("id"))).map((r) => all[r.rowNumber - 1])]);
  await replaceTab(LIST, [all[0] ?? LIST_HEADERS, ...recs.filter((r) => !drop.has(r.get("id"))).map((r) => all[r.rowNumber - 1])], all);
  return gone;
}

/** Undo for Clear: the items back as they were (any already back again are left alone). */
export async function putBack(items: Item[]) {
  const { items: now, rows } = await readList();
  await appendItems(items.filter((x) => x.id && x.item && !now.some((n) => n.id === x.id)), rows);
}

// ---- Stock: the things the house keeps (the Staples tab)

const STAPLE_HEADERS = ["item", "store", "section", "usual_quantity", "usual_product", "weekly"];
const stapleRow = (s: Staple) => [s.item, s.store, s.section, s.quantity, s.product, s.weekly ? "yes" : ""];

async function writeStaples(change: (all: Staple[]) => Staple[]) {
  if (!sheetsConfigured()) { const m = await mem(); m.staples = change(m.staples); return; }
  const rows = await rowsOf(STAPLES);
  const own = (rows[0] ?? STAPLE_HEADERS).map((h) => h.trim().toLowerCase());
  const headers = [...own, ...STAPLE_HEADERS.filter((h) => !own.includes(h))]; // a column Simmer added since joins the end
  const next = change(toStaples(rows.length ? rows : [STAPLE_HEADERS]));
  // Written by the tab's own headers, so a column added by hand keeps its place (its cells start blank).
  const cells = (s: Staple) => headers.map((h) => { const i = STAPLE_HEADERS.indexOf(h); return i < 0 ? "" : stapleRow(s)[i]; });
  await replaceTab(STAPLES, [headers, ...next.map(cells)], rows); // one write (a missing tab is made first)
}

/** A new thing the house keeps, in the section given or guessed (the same name again changes nothing). */
export async function addStaple(text: string, section?: Section) {
  const item = text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!item) return;
  const f = await file(item);
  await writeStaples((all) => (all.some((s) => norm(s.item) === norm(item)) ? all : [...all, { item, store: f.store, section: section ?? f.section, quantity: "", product: "", weekly: false }]));
}
export const removeStaple = (item: string) => writeStaples((all) => all.filter((s) => norm(s.item) !== norm(item)));
export const setWeekly = (item: string, weekly: boolean) => writeStaples((all) => all.map((s) => (norm(s.item) === norm(item) ? { ...s, weekly } : s)));
export const moveStaple = (item: string, section: Section) => writeStaples((all) => all.map((s) => (norm(s.item) === norm(item) ? { ...s, section } : s)));

/**
 * Planning again: what Stock highlights to check (check, not yet ticked) for a dinner that's no longer planned (made or
 * removed since) stops being highlighted. An item belongs to what's planned when its `for` names one of `planned` (a
 * dish's name, or "lunches"). Made and removed leave the list alone; this tidy-up happens only when planning, so it's
 * one rule in one place (Nov 3, replacing "highlights reset with a new week").
 */
export async function dropHighlightsNotFor(planned: string[]) {
  const names = planned.map(norm).filter(Boolean);
  const stale = (x: Item) => x.check && !x.checked && !names.some((n) => norm(x.for).includes(n));
  if (!sheetsConfigured()) { const m = await mem(); m.list = m.list.filter((x) => !stale(x)); return; }
  const { items, rows } = await readList();
  const ids = items.filter(stale).map((x) => x.id);
  if (ids.length) await removeItems(ids, rows);
}
