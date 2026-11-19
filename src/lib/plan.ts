// What's planned (docs/PLAN.md, section 3). Meals and lunches are planned by number, not by day (Nov 3): the Planned
// tab has one row per thing to make or pack (a dinner, a dessert, a lunch). Dinners are ticked off with the date they
// were made; lunches aren't ticked off and stay until changed or removed. Made (the log that keeps "last made" true),
// Trips (finished shopping trips, for the store rhythm), Lunches (each boy's options) and Plan counts (how many of each
// were asked for last time). The old Plan tab (one row per night) is only read, for when things were last made: what
// was still to come moved into Planned on the first load after Nov 3, and nothing writes there since (Nov 19: the move,
// run on every load, came out).
// Rows are matched by their key and only those rows are written, so a hand edit anywhere else survives. Without the
// Sheet (local dev, tests) the tabs live in memory, seeded from data/*.csv.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { appendRows, atomically, readTab, readTabsIfAny, replaceTab, sheetsConfigured, updateRanges } from "./google/sheets";
import { loadHousehold } from "./data";
import { addItems, dropHighlightsNotFor, emptyLists, takeOffFor, type Store } from "./groceries";
import { loadCart } from "./safeway";
import { col, newId, parseCsv, records, rowIds, yes } from "./parse";
import { loadRecipes, type Recipe } from "./recipes";
import { addDays, todayIn } from "./time";
import { bothOf, listName, norm } from "./words";
import { firstCounts, freezerMatch, KINDS, LUNCH_PARTS, lunchShopping, MAX_COUNT, type Counts, type Dish, type Frozen, type Kind, type Lunch, type LunchOption, type LunchPart, type Taste } from "./week";

const PLAN = "Plan", MADE = "Made", TRIPS = "Trips", LUNCHES = "Lunches", FREEZER = "Freezer", PLANNED = "Planned", COUNTS = "Plan counts";
const HEADERS: Record<string, string[]> = {
  [PLAN]: ["date", "meal", "kids_meal", "effort", "eating", "pinned", "planned_by", "made", "notes", "groceries", "moved"],
  [MADE]: ["date", "recipe"],
  [TRIPS]: ["date", "store"],
  [LUNCHES]: ["kid", "part", "item", "ingredients", "notes"],
  [FREEZER]: ["id", "item", "amount", "added", "store"],
  [PLANNED]: ["id", "kind", "recipe", "kid", ...LUNCH_PARTS, "added", "made", "pinned", "day"],
  [COUNTS]: ["what", "count"],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- rows, the same with or without the Sheet

const memory = new Map<string, string[][]>();
const file = (tab: string) => path.join(process.cwd(), "data", `${tab.toLowerCase().replace(/ /g, "-")}.csv`);

async function rows(tab: string): Promise<string[][]> {
  // A failed read throws (read as empty, a change written after it would erase the tab).
  if (sheetsConfigured()) return readTab(tab);
  if (!memory.has(tab)) memory.set(tab, await readFile(file(tab), "utf8").then(parseCsv, () => [] as string[][]));
  return memory.get(tab)!.map((r) => [...r]);
}

// Each takes the tab as just read when the caller has it (`before`), and answers with the tab as it is after, so one
// change to a tab is one read and one write (Nov 10: reading the tab again for each step ran into Google's limit of
// about 60 reads a minute). Every change here is one transaction (Nov 19, redis-tabs.ts): `before` comes from the same
// transaction, so its row numbers are the ones written to.

/** Records written into a tab's rows: rows whose key columns match are changed in place, the rest added at the end. */
function upserted(tab: string, before: string[][], recs: Record<string, string>[], keys: string[]) {
  const all = before.map((r) => [...r]);
  const headers = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = HEADERS[tab].filter((h) => !headers.includes(h));
  const width = headers.length;
  if (!all.length) all.push([]);
  if (missing.length) { headers.push(...missing); all[0] = [...headers]; }
  const keyOf = (get: (k: string) => string) => keys.map((k) => get(k).trim().toLowerCase()).join("|");
  const at = new Map(records(all).map((r) => [keyOf(r.get), r.rowNumber]));
  const added: string[][] = [];
  const changed: number[] = [];
  for (const rec of recs) {
    const n = at.get(keyOf((k) => rec[k] ?? ""));
    if (n) {
      const old = all[n - 1] ?? [];
      all[n - 1] = headers.map((h, i) => (h in rec ? rec[h] : old[i] ?? ""));
      changed.push(n);
    } else added.push(headers.map((h) => rec[h] ?? ""));
  }
  return { all, headers, missing, width, changed, added };
}

/** Writes records into a tab: rows whose key columns match are updated in place, the rest added at the end. */
const upsert = atomically(async (tab: string, recs: Record<string, string>[], keys: string[], before?: string[][]): Promise<string[][]> => {
  if (!recs.length) return before ?? rows(tab);
  const old = before ?? (await rows(tab));
  const { all, headers, missing, width, changed, added } = upserted(tab, old, recs, keys);
  if (!sheetsConfigured()) { memory.set(tab, [...all, ...added]); return [...all, ...added]; }
  // The new headers and every changed row in one write, then the new rows in one more.
  await updateRanges([
    ...(missing.length ? [{ range: `${tab}!${col(width)}1:${col(width + missing.length - 1)}1`, values: [missing] }] : []),
    ...[...new Set(changed)].map((n) => ({ range: `${tab}!A${n}:${col(headers.length - 1)}${n}`, values: [all[n - 1]] })),
  ]);
  if (added.length) await appendRows(tab, added);
  return [...all, ...added];
});

const append = atomically(async (tab: string, recs: Record<string, string>[], before?: string[][]): Promise<string[][]> => {
  if (!recs.length) return before ?? rows(tab);
  const all = before ?? (await rows(tab));
  if (!all.length) {
    const fresh = [HEADERS[tab], ...recs.map((r) => HEADERS[tab].map((h) => r[h] ?? ""))];
    if (sheetsConfigured()) await appendRows(tab, fresh);
    else memory.set(tab, fresh);
    return fresh;
  }
  const headers = all[0].map((h) => h.trim().toLowerCase());
  // A column the tab doesn't have yet (Nov 16: "day" on Planned) is added to the header first, or its values are lost.
  const missing = HEADERS[tab].filter((h) => !headers.includes(h));
  if (missing.length) {
    headers.push(...missing);
    all[0] = [...headers];
    if (sheetsConfigured()) await updateRanges([{ range: `${tab}!A1:${col(headers.length - 1)}1`, values: [headers] }]);
  }
  const out = recs.map((r) => headers.map((h) => r[h] ?? ""));
  if (sheetsConfigured()) await appendRows(tab, out);
  else memory.set(tab, [...all, ...out]);
  return [...all, ...out];
});


// ---- reading what's planned

const asKind = (s: string): Kind | "lunch" | null => { const k = s.trim().toLowerCase(); return k === "lunch" || (KINDS as readonly string[]).includes(k) ? (k as Kind | "lunch") : null; };
const asPart = (s: string): LunchPart | null => (LUNCH_PARTS as readonly string[]).includes(s.trim().toLowerCase()) ? (s.trim().toLowerCase() as LunchPart) : null;
const partsOf = (get: (k: string) => string) => Object.fromEntries(LUNCH_PARTS.map((p) => [p, get(p)])) as Record<LunchPart, string>;

const toOptions = (all: string[][]): LunchOption[] => records(all).flatMap((r) => {
  const part = asPart(r.get("part"));
  return part && r.get("kid") && r.get("item") ? [{ kid: r.get("kid"), part, item: r.get("item"), ingredients: r.get("ingredients").split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }] : [];
});

/** The Planned tab: what's still to make or pack (no made date), and what was made when. */
function toPlanned(all: string[][]) {
  const dishes: Dish[] = [], lunches: Lunch[] = [], done: { recipe: string; date: string }[] = [];
  for (const r of records(all)) {
    const kind = asKind(r.get("kind")), id = r.get("id");
    if (!kind || !id) continue;
    if (r.get("made")) { if (kind !== "lunch") done.push({ recipe: r.get("recipe"), date: r.get("made") }); continue; }
    if (kind === "lunch") { if (r.get("kid")) lunches.push({ id, kid: r.get("kid"), ...partsOf(r.get) }); }
    else if (r.get("recipe")) dishes.push({ id, kind, recipe: r.get("recipe"), pinned: yes(r.get("pinned")), added: r.get("added"), day: DATE.test(r.get("day")) ? r.get("day") : "" });
  }
  return { dishes, lunches, done };
}

/** When each recipe was last made: from the Made log, the Planned tab's made dates, and nights marked made in the old Plan tab. */
function lastMadeFrom(madeLog: string[][], done: { recipe: string; date: string }[], plan: string[][]): Record<string, string> {
  const out: Record<string, string> = {};
  const note = (id: string, date: string) => { if (id && DATE.test(date) && (!out[id] || out[id] < date)) out[id] = date; };
  for (const r of records(madeLog)) note(r.get("recipe"), r.get("date"));
  for (const d of done) note(d.recipe, d.date);
  for (const r of records(plan)) if (yes(r.get("made"))) { note(r.get("meal"), r.get("date")); note(r.get("kids_meal"), r.get("date")); }
  return out;
}

/** The rhythm (docs/PLAN.md, section 4.7): Trader Joe's about every two weeks and Costco about monthly, from the last finished trip. */
function tripsDue(trips: string[][], today: string) {
  const last = (store: Store) => records(trips).filter((r) => r.get("store") === store).map((r) => r.get("date")).sort().pop() ?? "";
  const since = (d: string) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 864e5) : Infinity);
  const tj = last("trader-joes"), costco = last("costco");
  return { traderJoes: since(tj) >= 11, costco: since(costco) >= 25, lastTraderJoes: tj, lastCostco: costco };
}

export type PlanData = {
  /** Still to make, oldest first. */
  dishes: Dish[];
  /** Still to pack, oldest first. */
  lunches: Lunch[];
  /** What was asked for last time, to start from. */
  counts: Counts;
  lastMade: Record<string, string>;
  trips: ReturnType<typeof tripsDue>;
  lunchOptions: LunchOption[];
  people: (Taste & { rules: string[] })[];
  freezer: Frozen[];
};

/** Everything planning is built from, read once (each tab is one Sheets read). */
type Tabs = { planned: string[][]; plan: string[][]; made: string[][]; trips: string[][]; options: string[][]; counts: string[][]; hh: Awaited<ReturnType<typeof loadHousehold>>; freezer: Frozen[] };
async function readTabs(): Promise<Tabs> {
  // One read for all seven tabs (the household is kept for a minute by data.ts).
  const want = [PLANNED, PLAN, MADE, TRIPS, LUNCHES, COUNTS, FREEZER];
  const [read, hh] = await Promise.all([sheetsConfigured() ? readTabsIfAny(want) : Promise.all(want.map(rows)), loadHousehold()]);
  const [planned, plan, made, trips, options, counts, frozen] = read;
  return { planned, plan, made, trips, options, counts, hh, freezer: freezerFrom(frozen) };
}

/** The Meals screen: what's still to make and pack, and what planning needs. */
export const loadPlan = async (): Promise<PlanData> => planFrom(await readTabs());

function planFrom({ planned, plan, made, trips, options, counts, hh, freezer }: Tabs): PlanData {
  const p = toPlanned(planned);
  const lunchOptions = toOptions(options);
  const kids = hh.profile.people.filter((x) => !x.isAdult && lunchOptions.some((o) => norm(o.kid) === norm(x.name))).map((x) => x.name);
  return {
    dishes: p.dishes, lunches: p.lunches,
    counts: countsFrom(counts, kids),
    lastMade: lastMadeFrom(made, p.done, plan),
    trips: tripsDue(trips, todayIn()),
    lunchOptions,
    people: hh.profile.people.map((x) => ({ name: x.name, isAdult: x.isAdult, likes: x.likes, dislikes: x.dislikes, rules: x.rules })),
    freezer,
  };
}

/** Last time's numbers (the Plan counts tab: `quick 2`, `lunches:Theo 5`), or a usual week the first time. */
function countsFrom(all: string[][], kids: string[]): Counts {
  // A blank cell is no number (Nov 19: it read as 0), so the usual one stands.
  const saved = new Map(records(all).filter((r) => r.get("count")).map((r) => [r.get("what").trim().toLowerCase(), Number(r.get("count"))]));
  const first = firstCounts(kids, true);
  if (!saved.size) return first;
  const n = (k: string, d: number) => { const v = saved.get(k.toLowerCase()); return v !== undefined && Number.isFinite(v) ? Math.max(0, Math.min(MAX_COUNT, Math.round(v))) : d; };
  const out = { ...first, lunches: Object.fromEntries(kids.map((k) => [k, n(`lunches:${k}`, first.lunches[k])])) };
  for (const k of KINDS) out[k] = n(k, first[k]);
  return out;
}

// ---- planning

type Need = { item: string; quantity: string; for: string; check: boolean };

/** Water from the tap isn't bought ("½ cup water" landed on the Safeway list, Nov 3). */
const fromTheTap = (item: string) => /^(?:(?:hot|warm|cold|boiling|lukewarm|ice|tap)\s+)?water$/i.test(item.replace(/\s+/g, " ").trim());

/** What a recipe needs from the store: everything but tap water and what's in the freezer (used from there instead). */
const needFor = (r: Recipe, freezer: Frozen[]): Need[] =>
  r.ingredients.filter((i) => !fromTheTap(i.item) && !freezer.some((f) => freezerMatch(f.item, i.item))).flatMap((i) => {
    // "salt and black pepper": two things, each without the amount (Nov 18).
    const both = bothOf(i.item).map(listName);
    return both.map((item) => ({ item, quantity: both.length > 1 ? "" : [i.quantity, i.unit].filter(Boolean).join(" "), for: r.name.toLowerCase(), check: true }));
  });

/**
 * These dinners are off the plan: what only they needed comes off the list (see takeOffFor). `still`: recipes still
 * planned (one planned twice, now once), whose groceries stay with the amount cut back. Answers how many things.
 */
async function takeOffDishes(recipeIds: string[], still: Set<string> = new Set(), read?: { recipes: Recipe[]; freezer: Frozen[] }): Promise<number> {
  if (!recipeIds.length) return 0;
  // A cart that can't be read stops the change (Nov 19: read as empty, what was in the cart came off the list).
  const [recipes, freezer, cart] = await Promise.all([read?.recipes ?? loadRecipes(), read?.freezer ?? loadFreezer(), loadCart()]);
  const needs = recipeIds.flatMap((id) => { const r = recipes.find((x) => x.id === id); return r ? needFor(r, freezer).map((n) => ({ ...n, stay: still.has(id) })) : []; });
  return takeOffFor(needs, new Set(cart.map((l) => l.itemId).filter(Boolean)));
}

export type NewDish = Pick<Dish, "kind" | "recipe" | "pinned" | "day">;
export type NewLunch = Omit<Lunch, "id">;

/**
 * Plans. With `counts` (the Plan sheet) it's the next shop (Nov 3): this week's dinners are done, whether or not anyone
 * said so (nothing is ticked off; what was bought got cooked), so each is marked made on the day it was planned and
 * logged, which keeps "not made in a while" true; planned lunches go too (lunch foods are Stock things now).
 * Without `counts` (Add one more) the new ones join this week and nothing else is touched. Last time's numbers become these, and everything the new ones need goes on the list at once, merged with what's there:
 * every dinner thing waits on Stock to be checked, fresh too (Sam, Nov 14); nothing goes on Shop until it's Need.
 * Before that, highlights in Stock that no longer belong to anything planned are dropped (see dropHighlightsNotFor), so
 * a pantry check from a dinner made or removed since doesn't linger. Answers how many things went on a list.
 */
export const savePlan = atomically(async (dishes: NewDish[], lunches: NewLunch[], counts: Counts | null, by: string): Promise<{ added: number; removed: number }> => {
  const today = todayIn();
  let removed = 0;
  // Each tab read once (Nov 10: reading Planned again for every step ran into Google's limit of about 60 reads a minute).
  const [before, recipes, options, freezer] = await Promise.all([rows(PLANNED), loadRecipes(), rows(LUNCHES), loadFreezer()]);
  const fresh = [
    ...dishes.map((d) => ({ id: newId(), kind: d.kind, recipe: d.recipe, added: today, pinned: d.pinned ? "yes" : "", day: d.day && DATE.test(d.day) ? d.day : "" })),
    ...lunches.map((l) => ({ id: newId(), kind: "lunch", kid: l.kid, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, l[p]])), added: today })),
  ];
  let planned: string[][];
  if (counts) {
    const week = toPlanned(before), added = new Map(records(before).map((r) => [r.get("id"), r.get("added") || today]));
    // Starting over (Nov 10): what only the old dinners needed, and isn't bought yet, comes off the list first.
    removed = await takeOffDishes(week.dishes.map((d) => d.recipe), new Set(), { recipes, freezer });
    // This week's dinners marked made, lunches gone, and what was made more than 60 days ago dropped (so the tab
    // doesn't grow for ever), with the new ones at the end: one write to Planned.
    const marked = week.dishes.length ? upserted(PLANNED, before, week.dishes.map((d) => ({ id: d.id, made: added.get(d.id) ?? today })), ["id"]) : null;
    const long = addDays(today, -60);
    planned = await removeRows(PLANNED, (get) => (get("kind") === "lunch" && !get("made")) || (Boolean(get("made")) && get("made") < long), marked ? [...marked.all, ...marked.added] : before, fresh);
    if (week.dishes.length) await append(MADE, week.dishes.map((d) => ({ date: added.get(d.id) ?? today, recipe: d.recipe })));
  } else planned = await append(PLANNED, fresh, before);
  if (counts) await upsert(COUNTS, [...KINDS.map((k) => ({ what: k, count: String(counts[k]) })), ...Object.entries(counts.lunches).map(([kid, n]) => ({ what: `lunches:${kid}`, count: String(n) }))], ["what"]);

  const byId = new Map(recipes.map((r) => [r.id, r]));
  const now = toPlanned(planned);
  await dropHighlightsNotFor([...now.dishes.map((d) => (byId.get(d.recipe)?.name ?? d.recipe).toLowerCase()), ...(now.lunches.length ? ["lunches"] : [])]);
  const need: Need[] = dishes.flatMap((d) => { const r = byId.get(d.recipe); return r ? needFor(r, freezer) : []; });
  for (const it of lunchShopping(lunches, toOptions(options))) need.push({ item: it, quantity: "", for: "lunches", check: false });
  return { added: need.length ? await addItems(need, by) : 0, removed };
});

/**
 * One planned thing changed: another recipe for a dish (Something else), or another option for one part of a lunch.
 * What the new one needs goes on the list; what only the old one needed comes off, unless it's ticked off or in the
 * cart (Nov 10: before, it stayed, and a swap left its groceries behind).
 */
export const changePlanned = atomically(async (id: string, change: { recipe?: string; pinned?: boolean; part?: LunchPart; item?: string; day?: string }, by: string): Promise<{ added: number; removed?: number }> => {
  const before = await rows(PLANNED);
  const now = toPlanned(before);
  const dish = now.dishes.find((d) => d.id === id), lunch = now.lunches.find((l) => l.id === id);
  // Moved to another day (Nov 17, from the dinner's ⋯): only the day changes; the list stays as it is.
  if (dish && change.day && DATE.test(change.day) && !change.recipe) {
    await upsert(PLANNED, [{ id, day: change.day }], ["id"], before);
    return { added: 0 };
  }
  if (dish && change.recipe) {
    await upsert(PLANNED, [{ id, recipe: change.recipe, pinned: change.pinned ? "yes" : "" }], ["id"], before);
    const [recipes, freezer] = await Promise.all([loadRecipes(), loadFreezer()]);
    // Another helping of the old recipe still planned keeps its groceries (Nov 19: a swap took them all off).
    const still = new Set(now.dishes.filter((d) => d.id !== id).map((d) => d.recipe));
    const removed = await takeOffDishes([dish.recipe], still, { recipes, freezer });
    const r = recipes.find((x) => x.id === change.recipe);
    return { added: r ? await addItems(needFor(r, freezer), by) : 0, removed };
  }
  if (lunch && change.part && change.item !== undefined) {
    await upsert(PLANNED, [{ id, [change.part]: change.item }], ["id"], before);
    const need = lunchShopping([{ ...lunch, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, p === change.part ? change.item! : ""])) } as Lunch], toOptions(await rows(LUNCHES)));
    return { added: need.length ? await addItems(need.map((item) => ({ item, quantity: "", for: "lunches", check: false })), by) : 0 };
  }
  return { added: 0 };
});

/**
 * Made it (or packed it): it comes off what's to make, with today's date, and a dinner from the collection is logged
 * (so "last made" stays true) and counts the freezer down. The grocery list is left alone.
 */
export const markMade = atomically(async (id: string) => {
  const before = await rows(PLANNED);
  const now = toPlanned(before);
  const dish = now.dishes.find((d) => d.id === id);
  if (!dish && !now.lunches.some((l) => l.id === id)) return;
  const date = todayIn();
  await upsert(PLANNED, [{ id, made: date }], ["id"], before);
  if (!dish) return;
  const r = (await loadRecipes()).find((x) => x.id === dish.recipe);
  if (!r) return;
  await append(MADE, [{ date, recipe: r.id }]);
  // The freezer counts down: one of the thing the meal used from it, the oldest first.
  const freezer = await rows(FREEZER);
  const f = freezerFrom(freezer).find((x) => [r.protein, ...r.ingredients.map((i) => i.item)].some((it) => it && freezerMatch(x.item, it)));
  if (f) await takeFrozen(f.id, freezer);
});

/**
 * New plan: a fresh start for the whole app (Nov 11). Every dinner comes off, logged as made on the day it was planned
 * (nothing is ticked off), so "last made" stays true; every list is emptied, except what's in the Safeway cart. Answers
 * how many list lines came off.
 */
export const clearPlanned = atomically(async (): Promise<{ removed: number }> => {
  const today = todayIn();
  const before = await rows(PLANNED);
  const dishes = toPlanned(before).dishes;
  const cart = await loadCart(); // can't be read: nothing is emptied, rather than the cart's things too
  const held = new Set(cart.map((l) => l.itemId).filter(Boolean));
  const removed = await emptyLists(held);
  if (!dishes.length) return { removed };
  const added = new Map(records(before).map((r) => [r.get("id"), r.get("added") || today]));
  await upsert(PLANNED, dishes.map((d) => ({ id: d.id, made: added.get(d.id) ?? today })), ["id"], before);
  await append(MADE, dishes.map((d) => ({ date: added.get(d.id) ?? today, recipe: d.recipe })));
  return { removed };
});

/**
 * How many of one dinner (Nov 10: − count +, sent once she stops tapping). More: the extra helpings go on the plan and
 * their groceries on the list (amounts added up). Fewer: helpings come off, and their groceries are cut back, or taken
 * off when none is left (never what's ticked off, in the cart or added by hand). Answers what went on and came off.
 */
export const setCount = atomically(async (recipe: string, kind: Kind, count: number, by: string): Promise<{ added: number; removed: number }> => {
  const want = Math.max(0, Math.min(MAX_COUNT, Math.round(count)));
  const today = todayIn();
  const before = await rows(PLANNED);
  const now = toPlanned(before).dishes.filter((d) => d.recipe === recipe);
  if (want > now.length) {
    const more = want - now.length;
    await append(PLANNED, Array.from({ length: more }, () => ({ id: newId(), kind, recipe, added: today, pinned: "yes" })), before);
    const [recipes, freezer] = await Promise.all([loadRecipes(), loadFreezer()]);
    const r = recipes.find((x) => x.id === recipe);
    return { added: r ? await addItems(Array.from({ length: more }, () => needFor(r, freezer)).flat(), by) : 0, removed: 0 };
  }
  if (want < now.length) {
    const gone = new Set(now.slice(want).map((d) => d.id));
    await removeRows(PLANNED, (get) => gone.has(get("id")), before);
    return { added: 0, removed: await takeOffDishes(Array.from({ length: gone.size }, () => recipe), want ? new Set([recipe]) : new Set()) };
  }
  return { added: 0, removed: 0 };
});

/** Not making it after all: it comes off, and so does what only it needed on the list (Nov 10), unless bought already. */
export const removePlanned = atomically(async (id: string): Promise<{ removed: number }> => {
  const before = await rows(PLANNED);
  const all = toPlanned(before).dishes;
  const dish = all.find((d) => d.id === id);
  await removeRows(PLANNED, (get) => get("id") === id, before);
  // Planned more than once (Nov 10: "×2"): one fewer, so its groceries are cut back by one helping, not taken off.
  const still = new Set(all.filter((d) => d.id !== id).map((d) => d.recipe));
  return { removed: dish ? await takeOffDishes([dish.recipe], still) : 0 };
});

/** A recipe deleted (Nov 14): every time it's on the plan comes off, with what only it needed on the list. */
export const removeRecipeFromPlan = atomically(async (recipe: string): Promise<{ removed: number }> => {
  const before = await rows(PLANNED);
  const gone = toPlanned(before).dishes.filter((x) => x.recipe === recipe);
  if (!gone.length) return { removed: 0 };
  // One write to Planned, and every helping's groceries off together.
  await removeRows(PLANNED, (get) => gone.some((d) => d.id === get("id")), before);
  const removed = await takeOffDishes(gone.map((d) => d.recipe));
  await tidyStock();
  return { removed };
});

/**
 * After the plan changes (Nov 14): a dinner's things still waiting on Stock for a dinner no longer planned come off (the
 * shredded cheese for tacos stayed after the tacos went: it was in the cart at New plan, and nothing took it off after).
 */
export const tidyStock = atomically(async (): Promise<void> => {
  const [planned, recipes] = await Promise.all([rows(PLANNED), loadRecipes()]);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const now = toPlanned(planned);
  // A dinner on a day before today is done with (Nov 16: days drop off by themselves).
  const today = todayIn();
  const current = now.dishes.filter((d) => !d.day || d.day >= today);
  await dropHighlightsNotFor([...current.map((d) => (byId.get(d.recipe)?.name ?? d.recipe).toLowerCase()), ...(now.lunches.length ? ["lunches"] : [])]);
});

/** The freezer, for Stock (Nov 19: the trips it also answered with were read for nothing; nothing shows them). */
export async function loadKitchen() {
  return { freezer: await loadFreezer() };
}

/** A finished trip (Done shopping), for the store rhythm. */
export const recordTrip = (store: Store) => append(TRIPS, [{ date: todayIn(), store }]);

// ---- the freezer (docs/PLAN.md, section 4.6)

/** What's in the freezer, oldest first. */
export async function loadFreezer(): Promise<Frozen[]> {
  return freezerFrom(await rows(FREEZER));
}
/** A freezer row's id: its own, or one made from its thing and day for a row without (parse.ts rowIds). */
const freezerIds = (all: string[][]) => rowIds(records(all), (get) => `${get("item")} ${get("added")}`);
function freezerFrom(all: string[][]): Frozen[] {
  const ids = freezerIds(all);
  return records(all).flatMap((r, i) => (r.get("item") ? [{ id: ids[i], item: r.get("item"), amount: r.get("amount"), added: r.get("added"), store: r.get("store") }] : []))
    .sort((a, b) => (a.added || "9").localeCompare(b.added || "9"));
}
/** The freezer's rows with every id written in, so a change matched by id finds a row that had none. */
function withFreezerIds(all: string[][]): string[][] {
  if (!all.length) return all;
  const ids = freezerIds(all);
  let i = all[0].findIndex((h) => h.trim().toLowerCase() === "id");
  const out = all.map((r) => [...r]);
  if (i < 0) { i = out[0].length; out[0].push("id"); }
  for (let n = 1; n < out.length; n++) { while (out[n].length <= i) out[n].push(""); out[n][i] = ids[n - 1]; }
  return out;
}

/** "2 salmon" → two salmon, put in today. The same thing added again adds up. */
export const addFrozen = atomically(async (text: string, store: string = "") => {
  const m = text.trim().match(/^(\d+)\s+(.+)$/);
  const item = (m ? m[2] : text).trim().slice(0, 60), amount = m ? m[1] : "";
  if (!item) return;
  const before = withFreezerIds(await rows(FREEZER));
  const same = freezerFrom(before).find((f) => norm(f.item) === norm(item));
  if (same && /^\d+$/.test(same.amount) && amount) { await upsert(FREEZER, [{ id: same.id, amount: String(Number(same.amount) + Number(amount)) }], ["id"], before); return; }
  await upsert(FREEZER, [{ id: newId(), item, amount, added: todayIn(), store }], ["id"], before);
});

/** One used: the amount goes down, and at none (or no amount written) it's gone. `before`: the tab as just read. */
export const takeFrozen = atomically(async (id: string, before?: string[][]) => {
  const all = withFreezerIds(before ?? (await rows(FREEZER)));
  const f = freezerFrom(all).find((x) => x.id === id);
  if (!f) return;
  const n = Number(f.amount);
  if (Number.isFinite(n) && n > 1) await upsert(FREEZER, [{ id, amount: String(n - 1) }], ["id"], all);
  else await removeRows(FREEZER, (get) => get("id") === id, all);
});

/** Rows off a tab, in one write; `add`: rows to put at the end in the same write. */
const removeRows = atomically(async (tab: string, drop: (get: (k: string) => string) => boolean, before?: string[][], add: Record<string, string>[] = []): Promise<string[][]> => {
  const all = before ?? (await rows(tab));
  // A column the added rows need that the tab lacks joins the header (Nov 19: a new plan's days were lost).
  const own = all[0] ?? [];
  const missing = add.length ? HEADERS[tab].filter((h) => !own.some((x) => x.trim().toLowerCase() === h)) : [];
  const head = all[0] ? [...own, ...missing] : HEADERS[tab];
  const headers = head.map((h) => h.trim().toLowerCase());
  const keep = [head, ...records(all).filter((r) => !drop(r.get)).map((r) => all[r.rowNumber - 1]), ...add.map((r) => headers.map((h) => r[h] ?? ""))];
  if (sheetsConfigured()) await replaceTab(tab, keep, all);
  else memory.set(tab, keep);
  return keep;
});
