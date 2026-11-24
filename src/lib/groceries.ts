// The shared grocery list: one row per item in the List tab, the Staples the house always keeps, and the Ingredients tab,
// the app's memory of which store and section an item goes in. Every change writes only its own row (add a row, set a
// row's checked cells), so two people changing the list at once can't erase each other's items. Each change is one
// transaction (store/tabs.ts).
import { after } from "next/server";
import { generateJson } from "./gemini";
import { append, atomically, change, load, loadAll, memo, outside, save, strings, table, transact } from "./store";
import { AppError } from "./errors";
import { withinCap } from "./ops/caps";
import { newId, yes } from "./parse";
import { known, norm, parseEntry, plainFractions, UNIT_NAMES } from "./words";

export const STORES = ["safeway", "trader-joes", "costco"] as const;
export type Store = (typeof STORES)[number];
export const SECTIONS = ["fresh", "pantry", "freezer", "household"] as const;
export type Section = (typeof SECTIONS)[number];

/**
 * check: a dinner's thing waiting in Stock's "For this plan" (not on a list). have: she checked and has it (Nov 11: Have |
 * Need), so it stays off the list and shows as Have; still a check, so every list leaves it out.
 */
export type Item = { id: string; item: string; quantity: string; store: Store; section: Section; for: string; addedBy: string; addedAt: string; checked: boolean; check: boolean; have?: boolean };
/**
 * A thing the house keeps; it goes on a list only when someone taps Need on it (Nov 10: nothing comes back by itself).
 * kind (Nov 16, Robin's run): common things always show on Stock; specialty ones (goat
 * cheese, five spice) show only while they're on the list or answered, and leave after the shop. group: the name of
 * the group it sits in on Stock (Cheese, Yogurt), set by her; "" for none.
 */
export type Staple = { item: string; store: Store; section: Section; quantity: string; product: string; kind: StapleKind; group: string };
export type StapleKind = "common" | "specialty";

/** The store a cell names ("Trader Joe's", "TJs", "costco"), or "" for none it knows. */
export const storeOf = (s: string): Store | "" => {
  const k = s.toLowerCase().replace(/[^a-z]/g, "");
  return k.startsWith("trader") || k === "tj" || k === "tjs" ? "trader-joes" : k.startsWith("costco") ? "costco" : k.startsWith("safeway") ? "safeway" : "";
};
const asStore = (s: string): Store => storeOf(s) || "safeway";
const asSection = (s: string): Section => (SECTIONS as readonly string[]).includes(s.toLowerCase()) ? (s.toLowerCase() as Section) : "fresh";

export { known, norm, parseEntry };

// ---- the tabs

/** A List row: an item, and when it was ticked (written, never read back). */
type Line = Item & { checkedAt?: string };
const haveIt = (v: string) => v.trim().toLowerCase() === "have";
/** What the check cell holds for an item. */
const checkCell = (x: Pick<Item, "check" | "have">) => (x.have ? "have" : x.check ? "yes" : "");

const LIST = table<Line>({
  tab: "List",
  headers: ["id", "item", "quantity", "store", "section", "for", "added_by", "added_at", "checked", "checked_at", "check"],
  read: (get) => (get("id") && get("item") ? {
    id: get("id"), item: get("item"), quantity: get("quantity"), store: asStore(get("store")), section: asSection(get("section")),
    for: get("for"), addedBy: get("added_by"), addedAt: get("added_at"), checked: yes(get("checked")), check: yes(get("check")) || haveIt(get("check")), have: haveIt(get("check")),
  } : null),
  cells: (x) => ({
    id: x.id, item: x.item, quantity: x.quantity, store: x.store, section: x.section, for: x.for, added_by: x.addedBy, added_at: x.addedAt,
    checked: x.checked ? "yes" : "no", checked_at: x.checkedAt, check: checkCell(x), // ticked stays ticked when Undo puts it back
  }),
  key: (x) => x.id,
});

const STAPLES = table<Staple>({
  tab: "Staples",
  headers: ["item", "store", "section", "usual_quantity", "usual_product", "kind", "group"],
  read: (get) => (get("item") ? {
    item: get("item"), store: asStore(get("store")), section: asSection(get("section")), quantity: get("usual_quantity"), product: get("usual_product"),
    kind: get("kind").toLowerCase() === "specialty" ? "specialty" : "common", group: get("group").replace(/\s+/g, " ").slice(0, 40),
  } : null),
  cells: (s) => ({ item: s.item, store: s.store, section: s.section, usual_quantity: s.quantity, usual_product: s.product, kind: s.kind === "specialty" ? "specialty" : "", group: s.group }),
  key: (s) => norm(s.item),
});

type Filing = { store: Store; section: Section };
/** The app's memory of where things go, one row per name (the first for a name wins). */
const INGREDIENTS = table<Filing & { name: string }>({
  tab: "Ingredients",
  headers: ["name", "section", "store"],
  read: (get) => (norm(get("name")) ? { name: get("name"), store: asStore(get("store")), section: asSection(get("section")) } : null),
  cells: (f) => ({ name: f.name, section: f.section, store: f.store }),
  key: (f) => norm(f.name),
});

/** Bought history (Nov 3), for whatever looks back later. */
const BOUGHT = strings("Bought", ["item", "quantity", "store", "date_bought", "for"]);

/** Every tab loadList reads, for its "nothing changed" answers (ops/fresh.ts; a test keeps this in step). */
export const LIST_READS = [LIST.tab, STAPLES.tab];
/** The tab savedSections reads. */
export const SECTION_READS = [INGREDIENTS.tab];

export async function loadList(): Promise<{ items: Item[]; staples: Staple[] }> {
  const [items, staples] = await loadAll(LIST, STAPLES); // one read
  return { items, staples };
}

// ---- filing: which store and section an item goes in

/** Where a thing goes until it's known: most things are Safeway's, and fresh is where she looks first. */
const DEFAULT: Filing = { store: "safeway", section: "fresh" };

/** Where things go, as remembered (the Ingredients tab), by name. */
async function savedFilings(): Promise<Map<string, Filing>> {
  const out = new Map<string, Filing>();
  for (const f of await load(INGREDIENTS)) if (!out.has(norm(f.name))) out.set(norm(f.name), { store: f.store, section: f.section });
  return out;
}

/** Where an item goes by the rules: as remembered, then common knowledge, else the default. */
export async function file(name: string): Promise<Filing> {
  return (await fileAll([{ name }])).filings[0];
}

/**
 * Where each of several things goes, by the rules alone (what's remembered, read once, then common knowledge), and
 * those neither knows, which go in the default place for now and are guessed after (see guessLater). `store`: the
 * store she chose, kept whatever the guess.
 */
async function fileAll(names: { name: string; store?: Store }[]): Promise<{ filings: Filing[]; unknown: { name: string; store?: Store }[] }> {
  const saved = names.length ? await savedFilings() : new Map<string, Filing>();
  const unknown: { name: string; store?: Store }[] = [];
  const filings = names.map((x) => {
    const r = saved.get(norm(x.name)) ?? known(x.name);
    if (!r) unknown.push(x);
    return { store: x.store ?? r?.store ?? DEFAULT.store, section: r?.section ?? DEFAULT.section };
  });
  return { filings, unknown };
}

/**
 * Things the rules don't know are guessed once the answer has gone (Nov 19: an add waited on Gemini, one call per
 * thing): one question for all of them, remembered, so no name is asked twice, and their lines (and kept things) still
 * in the default place move to where they go. Outside a request (tests, scripts) it's done now. A change worked out
 * again (store/tabs.ts) doesn't ask again.
 */
function guessLater(names: { name: string; store?: Store }[]): Promise<void> | void {
  const asked = memo();
  const ask = names.filter((x) => !asked.has(`file:${norm(x.name)}`));
  if (!ask.length || !process.env.GEMINI_API_KEY) return;
  for (const x of ask) asked.set(`file:${norm(x.name)}`, true);
  const run = () => guessFilings(ask).catch((e) => console.error("couldn't file", ask.map((x) => x.name), e));
  // Outside the change's transaction (Nov 19, review): after() keeps its context, and the refile joined it once it was
  // already written, so the guesses were lost and asked again.
  try { after(() => outside(run)); } catch { return run(); }
}

async function guessFilings(names: { name: string; store?: Store }[]) {
  const saved = await savedFilings(); // remembered meanwhile (she moved it, or another add asked): not asked again
  const ask = [...new Map(names.filter((x) => !saved.has(norm(x.name))).map((x) => [norm(x.name), x])).values()].slice(0, 80);
  if (!ask.length) return;
  if (!(await withinCap("filing"))) return;
  const { data } = await generateJson<{ items: { name: string; store: string; section: string }[] }>(
    `Family grocery list items, one per line. For each, with its name exactly as written: which store they would usually buy it at, and which part of the list it is. Stores: safeway (most things; the default), trader-joes (only Trader Joe's own products, like their frozen meals or dressings), costco (bulk household things like toilet paper). Sections: fresh (produce, dairy, meat, bread), pantry (shelf-stable food), freezer, household (not food).\n\n${ask.map((x) => x.name).join("\n")}`,
    { type: "OBJECT", properties: { items: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, store: { type: "STRING", enum: [...STORES] }, section: { type: "STRING", enum: [...SECTIONS] } }, required: ["name", "store", "section"] } } }, required: ["items"] },
    { light: true, timeoutMs: 20_000 },
  );
  const answers = Array.isArray(data.items) ? data.items : [];
  const got = new Map(answers.map((g) => [norm(String(g?.name ?? "")), g]));
  const guessed = ask.flatMap((x, i) => {
    const g = got.get(norm(x.name)) ?? (answers.length === ask.length ? answers[i] : undefined);
    return g ? [{ name: x.name, kept: Boolean(x.store), f: { store: x.store ?? asStore(String(g.store ?? "")), section: asSection(String(g.section ?? "")) } }] : [];
  });
  if (guessed.length) await transact(() => refile(guessed));
}

/** Guesses remembered, and the lines and kept things still in the default place moved (`kept`: her store stays). */
async function refile(guessed: { name: string; kept: boolean; f: Filing }[]) {
  const now = await savedFilings();
  const by = new Map(guessed.filter((g) => !now.has(norm(g.name))).map((g) => [norm(g.name), g]));
  if (!by.size) return;
  await rememberFilings([...by.values()]);
  await editList((await load(LIST)).flatMap((x) => {
    const g = !x.checked && x.section === DEFAULT.section ? by.get(norm(x.item)) : undefined;
    return g ? [[x.id, { section: g.f.section, ...(!g.kept && x.store === DEFAULT.store && { store: g.f.store }) }]] : [];
  }));
  await change(STAPLES, (all) => (all.some((s) => s.section === DEFAULT.section && by.has(norm(s.item)))
    ? all.map((s) => { const g = s.section === DEFAULT.section ? by.get(norm(s.item)) : undefined; return g ? { ...s, section: g.f.section } : s; })
    : all));
}

/** The sections remembered for items by name (the Ingredients tab), for recipes to show what she set (Nov 16). */
export async function savedSections(): Promise<Map<string, Section>> {
  return new Map([...(await savedFilings())].map(([n, f]) => [n, f.section]));
}

/** Moves an item to Fresh or Pantry everywhere (Robin, Nov 15: cashews landed in Fresh): remembered, and on the list now. */
export const fileSection = atomically(async (name: string, section: Section): Promise<void> => {
  // Its store as remembered or commonly known; no guess is asked for (she's only moving its section).
  const store = (await savedFilings()).get(norm(name))?.store ?? known(name)?.store ?? DEFAULT.store;
  await rememberFilings([{ name, f: { store, section } }]);
  if (section !== "fresh" && section !== "pantry") return;
  await editList((await load(LIST)).filter((x) => norm(x.item) === norm(name) && x.section !== section).map((x) => [x.id, { section }]));
});

/** Remembers where things go: the row already there for a name is changed (the first, if there are two), the rest added. */
async function rememberFilings(list: { name: string; f: Filing }[]) {
  if (!list.length) return;
  await change(INGREDIENTS, (all) => {
    const next = [...all];
    for (const { name, f } of new Map(list.map((x) => [norm(x.name), x])).values()) { // the same name twice: the later one
      const at = next.findIndex((x) => norm(x.name) === norm(name));
      if (at < 0) next.push({ name, ...f }); else next[at] = { name, ...f };
    }
    return next;
  });
}

// ---- changing

const stamp = () => new Date().toISOString();

/**
 * Adds an item, or merges it into the same unchecked item already on the list (quantities add up when they're numbers).
 * `filing`: where it goes, as she chose; a store alone leaves the section to work out (only for a new line, Nov 19).
 */
export const addItem = atomically(async (text: string, by: string, forWhat: string = "", filing?: { store: Store; section?: Section }, amount?: string): Promise<Item> => {
  const parsed = parseEntry(text);
  const { item, quantity } = amount === undefined ? parsed : { item: text.trim(), quantity: amount.trim() };
  if (!item) throw new AppError("Type what to add.");
  const same = (await load(LIST)).find((x) => !x.checked && norm(x.item) === norm(item));
  if (same) {
    const q = addUp(same.quantity, quantity);
    // Added by hand onto a dinner's line: it says so, so taking the dinner off leaves it.
    const f = forWhat ? joinFor(same.for, forWhat) : same.for && !forOf(same.for).includes(BY_HAND) ? [BY_HAND, ...forOf(same.for)].join(", ") : same.for;
    // Typed in by hand, it's wanted (Nov 24, Sam: "eggs" added on Shop showed a moment and went): a dinner's thing
    // waiting on Have or Need, or answered Have, becomes Need, so it shows on Shop and the List.
    const need = same.check ? { check: false, have: false } : {};
    if (q !== same.quantity || f !== same.for || same.check) await editList([[same.id, { quantity: q, for: f, ...need }]], new Set(), true);
    return { ...same, quantity: q, for: f, ...need };
  }
  const { filings: [f], unknown } = filing?.section ? { filings: [{ store: filing.store, section: filing.section }], unknown: [] } : await fileAll([{ name: item, store: filing?.store }]);
  const row: Item = { id: newId(), item, quantity, store: f.store, section: f.section, for: forWhat, addedBy: by, addedAt: stamp(), checked: false, check: false };
  await append(LIST, [row]);
  await guessLater(unknown);
  return row;
});

// ---- adding amounts up

const GLYPHS: Record<string, number> = { "½": 1 / 2, "¼": 1 / 4, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 1 / 8 };
/** Units that don't take an s (2 lb, 500 g), and those with their own plural. */
const SAME_PLURAL = new Set(["lb", "oz", "tbsp", "tsp", "dozen", "g", "kg", "ml", "l"]);
const PLURAL: Record<string, string> = { bunch: "bunches", box: "boxes", loaf: "loaves", pinch: "pinches", dash: "dashes", pouch: "pouches" };
const amountText = (n: number, unit: string) => [numberText(n), !unit ? "" : SAME_PLURAL.has(unit) || n <= 1 ? unit : PLURAL[unit] ?? `${unit}s`].filter(Boolean).join(" ");

/**
 * "1½ lb", "1 1/2 lbs", "1/2 pound", "2" → { n, unit } (unit "" for a plain count), in the units ingredient lines are
 * read with (words.ts, Nov 19: grams, slices and the rest weren't added up); null when it isn't one number and one unit.
 */
export function amountOf(q: string): { n: number; unit: string } | null {
  const m = plainFractions(q).match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?\s*([a-z]+)?\.?$/i);
  if (!m || (!m[1] && !m[2]) || (m[1]?.includes(".") && m[2])) return null; // "1.5 1/2"
  const n = Number(m[1] ?? 0) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  if (!Number.isFinite(n) || (m[2] && !Number(m[3]))) return null;
  const word = m[4] ?? "";
  const unit = word && (UNIT_NAMES[word] ?? UNIT_NAMES[word.toLowerCase()]); // T is a tablespoon, t a teaspoon
  return word && !unit ? null : { n, unit: unit || "" };
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
 * → "2 lb", "1" + "1" → "2" (Nov 9: pounds stayed "1 lb"). Different units are both kept ("1 dozen + 1"; Nov 10: a
 * recipe's "1" egg replaced the "1 dozen" added by hand), and a combined amount gains in its part with the same unit
 * ("1 dozen + 1" + "1" → "1 dozen + 2"). Otherwise the newer amount, or the one there is.
 */
export function addUp(a: string, b: string): string {
  return b.split(" + ").reduce((sum, part) => addPart(sum.trim(), part.trim()), a);
}
function addPart(a: string, b: string): string {
  const y = amountOf(b);
  if (a.includes(" + ")) {
    if (!y) return a;
    const parts = a.split(" + ");
    const i = parts.findIndex((p) => amountOf(p)?.unit === y.unit);
    return i < 0 ? `${a} + ${b}` : parts.map((p, j) => (j === i ? addPart(p, b) : p)).join(" + ");
  }
  const x = amountOf(a);
  if (x && y && x.unit !== y.unit) return `${a} + ${b}`;
  if (!x || !y) return b || a;
  return amountText(x.n + y.n, x.unit);
}

/**
 * Less of an amount: "2½ lb" less "1 lb" → "1½ lb", "" when none is left; null when it can't be worked out. A combined
 * amount loses it from the part in the same unit: "1 dozen + 1" less "1" → "1 dozen".
 */
export function takeAway(a: string, b: string): string | null {
  if (a.includes(" + ")) {
    const parts = a.split(" + ");
    for (let i = parts.length - 1; i >= 0; i--) {
      const less = takeAway(parts[i], b);
      if (less === null) continue;
      return [...parts.slice(0, i), ...(less ? [less] : []), ...parts.slice(i + 1)].join(" + ");
    }
    return null;
  }
  const x = amountOf(a), y = amountOf(b);
  if (!x || !y || x.unit !== y.unit) return null;
  const n = x.n - y.n;
  return n <= 1e-6 ? "" : amountText(n, x.unit);
}

/** The dinners a list item is for ("tacos, turkey chili"). */
const forOf = (f: string) => f.split(",").map((x) => x.trim()).filter(Boolean);
/**
 * Marks a line someone added by hand (or ticked on Stock) that a dinner's groceries joined, so taking the dinner off,
 * or a New plan, leaves it on the list (Nov 10: hand-added eggs became lasagna's, and would have gone with it).
 */
export const BY_HAND = "added by hand";
/** What a line is for once `what` joins it: a hand-added line ("") keeps saying so. */
const joinFor = (now: string, what: string) => {
  const parts = forOf(now);
  if (!what || parts.includes(what)) return now;
  return [...(parts.length ? parts : [BY_HAND]), what].join(", ");
};

/**
 * A dinner off the plan (taken off, swapped, or replaced by starting over; Nov 10): what only it needed comes off the
 * list, and what it shared with another dinner is cut back by its amount. Never something ticked off or in the Safeway
 * cart (`held`: list item ids), which may be bought already; never something added by hand (it's for no dinner).
 * Answers how many things came off.
 */
export const takeOffFor = atomically(async (needs: { item: string; quantity: string; for: string; stay?: boolean }[], held: Set<string> = new Set()): Promise<number> => {
  if (!needs.length) return 0;
  const items = await load(LIST);
  // Each dinner's helpings of a thing together: planned twice and taken off, both amounts come off.
  const helpings = new Map<string, { key: string; for: string; amounts: string[]; stay: boolean }>();
  for (const n of needs) {
    const key = norm(n.item), h = helpings.get(`${key}\n${n.for}`) ?? { key, for: n.for, amounts: [], stay: false };
    h.amounts.push(n.quantity);
    h.stay ||= Boolean(n.stay);
    helpings.set(`${key}\n${n.for}`, h);
  }
  const open = new Map<string, Item[]>();
  for (const x of items) if (!x.checked) open.set(norm(x.item), [...(open.get(norm(x.item)) ?? []), x]);
  const drop = new Set<string>();
  const cut = new Map<string, { quantity: string; for: string }>();
  for (const h of helpings.values()) {
    const it = open.get(h.key)?.find((x) => !drop.has(x.id) && forOf(cut.get(x.id)?.for ?? x.for).includes(h.for));
    if (!it || held.has(it.id)) continue;
    const now = cut.get(it.id) ?? { quantity: it.quantity, for: it.for };
    // `stay`: the same dinner is still planned (it was planned twice): its amount is cut back, and it stays for it.
    const others = h.stay ? forOf(now.for) : forOf(now.for).filter((f) => f !== h.for);
    if (!others.length) { drop.add(it.id); cut.delete(it.id); continue; }
    let quantity = now.quantity;
    for (const a of h.amounts) {
      const less = a ? takeAway(quantity, a) : null;
      if (less !== null && !(h.stay && less === "")) quantity = less;
    }
    cut.set(it.id, { quantity, for: others.join(", ") });
  }
  await editList([...cut], drop); // cut back and taken off in one write
  return drop.size;
});

/**
 * New plan (Nov 11, Sam: "I would expect the whole app to reset"): every list is emptied in one write, except what's in
 * the Safeway cart (`held`), which stays so the cart and the list agree. Answers how many came off.
 */
export const emptyLists = atomically(async (held: Set<string> = new Set()): Promise<number> => {
  const off = (await load(LIST)).filter((x) => !held.has(x.id));
  // What was ticked as got is written down as bought first (Nov 14: Done shopping is gone, so this is where it's noted).
  await recordBought(off.filter((x) => x.checked));
  await editList([], new Set(off.map((x) => x.id)));
  return off.length;
});

/**
 * Many items at once (a recipe's ingredients, a planned week): the list is read once, each item merges into the same
 * unchecked item already there (two recipes needing onions make one line), and the new ones go in one write.
 * check: pantry items for "Check you have these"; an item already on the list for real stays there.
 */
export const addItems = atomically(async (entries: { item: string; quantity: string; for: string; check?: boolean }[], by: string): Promise<number> => {
  const { items, staples } = await loadList();
  // What the house keeps (Stock) is only highlighted there, to check; so is everything a dinner needs, fresh too (Sam,
  // Nov 14: Shop had every fresh thing she'd never said Need to); the rest goes on a list.
  const kept = new Set(staples.map((s) => norm(s.item)));
  const open = new Map<string, Item>(); // the unchecked line for each thing (the first, as merging always picks)
  for (const x of items) if (!x.checked && !open.has(norm(x.item))) open.set(norm(x.item), x);
  const fresh: Item[] = [], merged = new Set<Item>();
  for (const e of entries) {
    const item = e.item.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!item) continue;
    const same = open.get(norm(item));
    if (!same) {
      const x: Item = { id: newId(), item, quantity: e.quantity, store: DEFAULT.store, section: DEFAULT.section, for: e.for, addedBy: by, addedAt: stamp(), checked: false, check: Boolean(e.check) };
      fresh.push(x);
      open.set(norm(item), x);
      continue;
    }
    // Its amount always joins with its name (Nov 19: a dinner joining a line she'd said Need to added its name but not
    // its amount, so taking the dinner off took away what it never added). A thing for a list takes it off Stock.
    const change = { quantity: addUp(same.quantity, e.quantity), for: joinFor(same.for, e.for), check: e.check ? same.check : false };
    if (change.quantity === same.quantity && change.for === same.for && change.check === same.check) continue;
    Object.assign(same, change);
    if (!fresh.includes(same)) merged.add(same);
  }
  // Filed together by the rules; the few they don't know are guessed together once the answer's gone.
  const { filings, unknown } = await fileAll(fresh.map((x) => ({ name: x.item })));
  fresh.forEach((x, i) => Object.assign(x, filings[i], { check: kept.has(norm(x.item)) || x.check }));
  await editList([...merged].map((x) => [x.id, { quantity: x.quantity, for: x.for, check: x.check }]));
  await append(LIST, fresh);
  await guessLater(unknown);
  // How many rows changed, waiting on Stock or on a list (Nov 14: a dinner's things all wait on Stock, and the screens
  // read the list again whenever this isn't 0).
  return fresh.length + merged.size;
});

/** "Check you have these": she needs this one (it joins the list), or has the rest (they come off). */
export const needItem = (id: string) => setItem(id, { check: false, have: false });
/** Checked in the cupboard and there (Have): off every list, shown as Have in "For this plan". */
export const haveItem = (id: string) => setItem(id, { check: true, have: true });
/** Unticked on Stock after all (Nov 11): a dinner's pantry thing goes back to highlighted, not off the list for good. */
export const unneedItem = (id: string) => setItem(id, { check: true, have: false });
/** The rest of "Check you have these" is there: what's waiting (not Have, not ticked) comes off. */
export const haveTheRest = async () => { await change(LIST, (all) => all.filter((x) => !(x.check && !x.have && !x.checked))); };
export const checkItem = (id: string, checked: boolean) => setItem(id, { checked, checkedAt: checked ? stamp() : "" });
/** One item changed; it must still be on the list. */
const setItem = async (id: string, c: Changes[number][1]) => { await editList([[id, c]], new Set(), true); };

type Changes = [string, Partial<Pick<Line, "quantity" | "store" | "section" | "for" | "checked" | "checkedAt" | "check" | "have">>][];

/**
 * Some items changed and some taken off, in one write (`strict`: a change to an item no longer there is an error;
 * otherwise it's skipped). Answers what came off.
 */
const editList = atomically(async (changes: Changes, drop: Set<string> = new Set(), strict: boolean = false): Promise<Item[]> => {
  if (!changes.length && !drop.size) return [];
  const all = await load(LIST);
  const by = new Map<string, Changes[number][1]>();
  for (const [id, c] of changes) by.set(id, { ...by.get(id), ...c });
  if (strict && [...by.keys()].some((id) => !all.some((x) => x.id === id))) throw new AppError("That item isn't on the list anymore.");
  await save(LIST, all.filter((x) => !drop.has(x.id)).map((x) => (by.has(x.id) ? { ...x, ...by.get(x.id) } : x)));
  return all.filter((x) => drop.has(x.id));
});

/** Moves an item to another store or section, and remembers that's where it goes. */
export const moveItem = atomically(async (id: string, to: { store?: Store; section?: Section }) => {
  const it = (await load(LIST)).find((x) => x.id === id);
  if (!it) throw new AppError("That item isn't on the list anymore.");
  await editList([[id, { ...(to.store && { store: to.store }), ...(to.section && { section: to.section }) }]]);
  await rememberFilings([{ name: it.item, f: { store: to.store ?? it.store, section: to.section ?? it.section } }]).catch((e) => console.error("couldn't remember filing", e));
});

/**
 * Bought history: what's coming off the list is written down first, so the rows only go once the note is safely made.
 */
const recordBought = (gone: Item[]) => append(BOUGHT, gone.map((x) => ({ item: x.item, quantity: x.quantity, store: x.store, date_bought: stamp().slice(0, 10), for: x.for })));

/**
 * Finishing a trip: the store's checked items come off the list, and `alsoIds` (for Safeway, what's in the cart);
 * everything else stays, other stores' too.
 */
export const doneShopping = atomically(async (store: Store, alsoIds: Set<string> = new Set()): Promise<number> => {
  const gone = (await load(LIST)).filter((x) => x.store === store && (x.checked || alsoIds.has(x.id)));
  await recordBought(gone);
  await editList([], new Set(gone.map((x) => x.id)));
  return gone.length;
});

export const removeItem = async (id: string) => { await editList([], new Set([id])); };

/** Several items off at once (one write). Answers with what came off. */
export const removeItems = (ids: string[]): Promise<Item[]> => editList([], new Set(ids));

// ---- Stock: the things the house keeps (the Staples tab)

const writeStaples = async (f: (all: Staple[]) => Staple[]) => { await change(STAPLES, f); };

/**
 * A new thing the house keeps, in the section given or guessed. The same name again keeps it, changing only the kind
 * or group given (quick add of something known, Nov 16).
 */
export const addStaple = atomically(async (text: string, section?: Section, opts: { kind?: StapleKind; group?: string } = {}) => {
  const item = text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!item) return;
  const { filings: [f], unknown } = await fileAll([{ name: item }]);
  await writeStaples((all) => (all.some((s) => norm(s.item) === norm(item))
    ? all.map((s) => (norm(s.item) === norm(item) ? { ...s, ...(opts.kind && { kind: opts.kind }), ...(opts.group !== undefined && { group: opts.group }) } : s))
    : [...all, { item, store: f.store, section: section ?? f.section, quantity: "", product: "", kind: opts.kind ?? "common", group: opts.group ?? "" }]));
  if (!section) await guessLater(unknown);
});
/** A kept thing made common or specialty, or put in a group ("" for none) (Nov 16). */
export const setStaple = (item: string, change: { kind?: StapleKind; group?: string }) =>
  writeStaples((all) => all.map((s) => (norm(s.item) === norm(item) ? { ...s, ...(change.kind && { kind: change.kind }), ...(change.group !== undefined && { group: change.group }) } : s)));
/** A group renamed, or removed with `to` "" (Nov 16, Sam): every thing in it moves with it; the things stay kept. */
export const renameGroup = (from: string, to: string) =>
  writeStaples((all) => all.map((s) => (s.group && norm(s.group) === norm(from) ? { ...s, group: to } : s)));
export const removeStaple = (item: string) => writeStaples((all) => all.filter((s) => norm(s.item) !== norm(item)));
export const moveStaple = (item: string, section: Section) => writeStaples((all) => all.map((s) => (norm(s.item) === norm(item) ? { ...s, section } : s)));

/**
 * Planning again: what Stock highlights to check (check, not yet ticked) for a dinner that's no longer planned (made or
 * removed since) stops being highlighted. An item belongs to what's planned when its `for` names one of `planned` (a
 * dish's name, or "lunches"). Made and removed leave the list alone; this tidy-up happens only when planning, so it's
 * one rule in one place (Nov 3, replacing "highlights reset with a new week").
 */
export const dropHighlightsNotFor = atomically(async (planned: string[]) => {
  const names = new Set(planned.map(norm).filter(Boolean));
  // Only a dinner's own rows (Nov 14: a kept thing's Have or Need, or one added by hand, is never dropped here).
  const forDinner = (x: Item) => Boolean(x.for.trim()) && x.for.trim().toLowerCase() !== "every week" && !forOf(x.for).includes(BY_HAND);
  // By whole names (Nov 19: "soup" planned kept chicken soup's rows).
  const stale = (x: Item) => x.check && !x.checked && forDinner(x) && !forOf(x.for).some((f) => names.has(norm(f)));
  await editList([], new Set((await load(LIST)).filter(stale).map((x) => x.id)));
});
