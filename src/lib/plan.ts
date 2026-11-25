// What's planned (docs/PLAN.md, section 3). Meals and lunches are planned by number, not by day (Nov 3): the Planned
// tab has one row per thing to make or pack (a dinner, a dessert, a lunch). Dinners are ticked off with the date they
// were made; lunches aren't ticked off and stay until changed or removed. Made (the log that keeps "last made" true),
// Trips (finished shopping trips, for the store rhythm), Lunches (each boy's options) and Plan counts (how many of each
// were asked for last time). The old Plan tab (one row per night) is only read, for when things were last made: what
// was still to come moved into Planned on the first load after Nov 3, and nothing writes there since (Nov 19: the move,
// run on every load, came out).
// Each change is one transaction (store/tabs.ts), and only the rows it changes are rewritten, so a hand edit anywhere
// else survives.
import { append, atomically, change, load, loadAll, save, strings } from "./store";
import { loadHousehold, PROFILE_TAB } from "./data";
import { addItems, addUp, dropHighlightsNotFor, finishShop, takeOffFor, type Store } from "./groceries";
import { loadCart } from "./safeway";
import { newId, yes } from "./parse";
import { loadRecipes, type Recipe } from "./recipes";
import { todayIn } from "./time";
import { bothOf, listName, norm } from "./words";
import { firstCounts, freezerMatch, isOld, KINDS, onTheList, LUNCH_PARTS, lunchShopping, MAX_COUNT, type Counts, type Dish, type Frozen, type Kind, type Lunch, type LunchOption, type LunchPart, type Taste } from "./week";

const PLANNED = strings("Planned", ["id", "kind", "recipe", "kid", ...LUNCH_PARTS, "added", "made", "pinned", "day"]);
type PlannedRow = ReturnType<typeof PLANNED.row>;
const MADE = strings("Made", ["date", "recipe"]);
const TRIPS = strings("Trips", ["date", "store"]);
const LUNCHES = strings("Lunches", ["kid", "part", "item", "ingredients", "notes"]);
const COUNTS = strings("Plan counts", ["what", "count"], { key: (r) => r.what.toLowerCase() });
/** The old Plan tab (one row per night), only read for when things were last made. */
const OLD_PLAN = strings("Plan", ["date", "meal", "kids_meal", "made"]);
/** A row without an id gets one from its thing and day (parse.ts rowIds), written in when the row changes. */
const FREEZER = strings("Freezer", ["id", "item", "amount", "added", "store"], { idFrom: (get) => `${get("item")} ${get("added")}` });

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Planned rows with one row's cells changed (matched by id). */
const setPlanned = (id: string, c: Partial<PlannedRow>) => change(PLANNED, (all) => all.map((r) => (r.id === id ? { ...r, ...c } : r)));
/** Planned rows taken off. */
const dropPlanned = (gone: (r: PlannedRow) => boolean) => change(PLANNED, (all) => all.filter((r) => !gone(r)));

// ---- reading what's planned

const asKind = (s: string): Kind | "lunch" | null => { const k = s.trim().toLowerCase(); return k === "lunch" || (KINDS as readonly string[]).includes(k) ? (k as Kind | "lunch") : null; };
const asPart = (s: string): LunchPart | null => (LUNCH_PARTS as readonly string[]).includes(s.trim().toLowerCase()) ? (s.trim().toLowerCase() as LunchPart) : null;

const toOptions = (all: ReturnType<typeof LUNCHES.row>[]): LunchOption[] => all.flatMap((r) => {
  const part = asPart(r.part);
  return part && r.kid && r.item ? [{ kid: r.kid, part, item: r.item, ingredients: r.ingredients.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }] : [];
});

/**
 * The Planned tab: what's on (still to make or pack), the old meals kept and dimmed (Sam, Nov 24: shopped for, or their
 * day passed; see isOld), the dinners whose things still belong on the list (onTheList: a dimmed one put on a passed
 * day among them), and what was made when. An old meal from before days existed shows on the day it was made.
 */
function toPlanned(all: PlannedRow[], today = todayIn()) {
  const dishes: Dish[] = [], old: Dish[] = [], listed: Dish[] = [], lunches: Lunch[] = [], done: { recipe: string; date: string }[] = [];
  for (const r of all) {
    const kind = asKind(r.kind);
    if (!kind || !r.id) continue;
    if (kind === "lunch") {
      if (!r.made && r.kid) lunches.push({ id: r.id, kid: r.kid, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, r[p]])) as Record<LunchPart, string> });
      continue;
    }
    if (r.made) done.push({ recipe: r.recipe, date: r.made });
    if (!r.recipe) continue;
    const day = DATE.test(r.day) ? r.day : "";
    const d: Dish = { id: r.id, kind, recipe: r.recipe, pinned: yes(r.pinned), added: r.added, day };
    if (onTheList({ made: r.made, day, added: r.added }, today)) listed.push(d);
    if (isOld({ made: r.made, day }, today)) old.push({ ...d, day: day || [r.made, r.added].find((x) => DATE.test(x)) || "" });
    else dishes.push(d);
  }
  return { dishes, old, listed, lunches, done };
}

/** When each recipe was last made: from the Made log, the Planned tab's made dates, and nights marked made in the old Plan tab. */
function lastMadeFrom(madeLog: ReturnType<typeof MADE.row>[], done: { recipe: string; date: string }[], plan: ReturnType<typeof OLD_PLAN.row>[]): Record<string, string> {
  const out: Record<string, string> = {};
  const note = (id: string, date: string) => { if (id && DATE.test(date) && (!out[id] || out[id] < date)) out[id] = date; };
  for (const r of madeLog) note(r.recipe, r.date);
  for (const d of done) note(d.recipe, d.date);
  for (const r of plan) if (yes(r.made)) { note(r.meal, r.date); note(r.kids_meal, r.date); }
  return out;
}

/** The rhythm (docs/PLAN.md, section 4.7): Trader Joe's about every two weeks and Costco about monthly, from the last finished trip. */
function tripsDue(trips: ReturnType<typeof TRIPS.row>[], today: string) {
  const last = (store: Store) => trips.filter((r) => r.store === store).map((r) => r.date).sort().pop() ?? "";
  const since = (d: string) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 864e5) : Infinity);
  const tj = last("trader-joes"), costco = last("costco");
  return { traderJoes: since(tj) >= 11, costco: since(costco) >= 25, lastTraderJoes: tj, lastCostco: costco };
}

export type PlanData = {
  /** Still to make, oldest first. */
  dishes: Dish[];
  /** Old meals, kept and dimmed on Meals (Nov 24): shopped for, or their day has passed. Kept for good. */
  old: Dish[];
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

/**
 * Every tab loadPlan reads, for its "nothing changed" answers (ops/fresh.ts; a test keeps this in step). Its answer
 * also depends on the day (the store rhythm), which the answer's version includes.
 */
export const PLAN_READS = [PLANNED.tab, OLD_PLAN.tab, MADE.tab, TRIPS.tab, LUNCHES.tab, COUNTS.tab, FREEZER.tab, PROFILE_TAB];

/** The Meals screen: what's still to make and pack, and what planning needs. */
export async function loadPlan(): Promise<PlanData> {
  // One read for all seven tabs (the household is kept for a minute by data.ts).
  const [[planned, plan, made, trips, options, counts, frozen], hh] = await Promise.all([loadAll(PLANNED, OLD_PLAN, MADE, TRIPS, LUNCHES, COUNTS, FREEZER), loadHousehold()]);
  const p = toPlanned(planned), freezer = freezerFrom(frozen);
  const lunchOptions = toOptions(options);
  const kids = hh.profile.people.filter((x) => !x.isAdult && lunchOptions.some((o) => norm(o.kid) === norm(x.name))).map((x) => x.name);
  return {
    dishes: p.dishes, old: p.old, lunches: p.lunches,
    counts: countsFrom(counts, kids),
    lastMade: lastMadeFrom(made, p.done, plan),
    trips: tripsDue(trips, todayIn()),
    lunchOptions,
    people: hh.profile.people.map((x) => ({ name: x.name, isAdult: x.isAdult, likes: x.likes, dislikes: x.dislikes, rules: x.rules })),
    freezer,
  };
}

/** Last time's numbers (the Plan counts tab: `quick 2`, `lunches:Theo 5`), or a usual week the first time. */
function countsFrom(all: ReturnType<typeof COUNTS.row>[], kids: string[]): Counts {
  // A blank cell is no number (Nov 19: it read as 0), so the usual one stands.
  const saved = new Map(all.filter((r) => r.count).map((r) => [r.what.toLowerCase(), Number(r.count)]));
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
 * What the planned dinners named in `dinners` need of `item`, from their recipes, each time one is planned (Nov 24:
 * Remove from the list keeps only this of a row a dinner and a hand-added amount shared); null when none is found.
 */
export async function dinnerAmount(item: string, dinners: string[]): Promise<string | null> {
  const [planned, recipes, freezer] = await Promise.all([load(PLANNED), loadRecipes(), loadFreezer()]);
  const names = new Set(dinners.map((d) => d.trim().toLowerCase()));
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const amounts = toPlanned(planned).listed.flatMap((d) => {
    const r = byId.get(d.recipe);
    return r && names.has(r.name.toLowerCase()) ? needFor(r, freezer).filter((n) => norm(n.item) === norm(item)).map((n) => n.quantity) : [];
  });
  return amounts.length ? amounts.reduce((a, b) => addUp(a, b)) : null;
}

/**
 * These dinners are off the plan: what only they needed comes off the list (see takeOffFor). `still`: recipes still
 * planned (one planned twice, now once), whose groceries stay with the amount cut back. Answers how many things.
 */
async function takeOffDishes(recipeIds: string[], still: Set<string> = new Set(), read?: { recipes: Recipe[]; freezer: Frozen[] }): Promise<number> {
  if (!recipeIds.length) return 0;
  // A cart that can't be read stops the change (Nov 19: read as empty, what was in the cart came off the list).
  const [recipes, freezer, cart] = await Promise.all([read?.recipes ?? loadRecipes(), read?.freezer ?? loadFreezer(), loadCart()]);
  const needs = recipeIds.flatMap((id) => { const r = recipes.find((x) => x.id === id); return r ? needFor(r, freezer).map((n) => ({ ...n, stay: still.has(id) })) : []; });
  return takeOffFor(needs, cart);
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
  const [before, recipes, options, freezer] = await Promise.all([load(PLANNED), loadRecipes(), load(LUNCHES), loadFreezer()]);
  const fresh = [
    ...dishes.map((d) => PLANNED.row({ id: newId(), kind: d.kind, recipe: d.recipe, added: today, pinned: d.pinned ? "yes" : "", day: d.day && DATE.test(d.day) ? d.day : "" })),
    ...lunches.map((l) => PLANNED.row({ id: newId(), kind: "lunch", kid: l.kid, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, l[p]])), added: today })),
  ];
  let planned: PlannedRow[];
  if (counts) {
    const week = toPlanned(before);
    // Starting over (Nov 10): what only the old dinners needed, and isn't bought yet, comes off the list first.
    removed = await takeOffDishes(week.dishes.map((d) => d.recipe), new Set(), { recipes, freezer });
    // This week's dinners marked made on the day they were planned, lunches gone, with the new ones at the end: one
    // write to Planned. Old meals are kept for good (Sam, Nov 24: "keep meal history indefinitely").
    const made = new Map(week.dishes.map((d) => [d.id, d.added || today]));
    planned = [...before.map((r) => (made.has(r.id) ? { ...r, made: made.get(r.id)! } : r)).filter((r) => !(r.kind === "lunch" && !r.made)), ...fresh];
    await save(PLANNED, planned);
    await append(MADE, week.dishes.map((d) => ({ date: made.get(d.id)!, recipe: d.recipe })));
    const want = [...KINDS.map((k) => ({ what: k, count: String(counts[k]) })), ...Object.entries(counts.lunches).map(([kid, n]) => ({ what: `lunches:${kid}`, count: String(n) }))];
    await change(COUNTS, (all) => [...all.map((r) => want.find((w) => w.what.toLowerCase() === r.what.toLowerCase()) ?? r), ...want.filter((w) => !all.some((r) => r.what.toLowerCase() === w.what.toLowerCase()))]);
  } else {
    await append(PLANNED, fresh);
    planned = [...before, ...fresh];
  }

  const byId = new Map(recipes.map((r) => [r.id, r]));
  const now = toPlanned(planned);
  await dropHighlightsNotFor([...now.listed.map((d) => (byId.get(d.recipe)?.name ?? d.recipe).toLowerCase()), ...(now.lunches.length ? ["lunches"] : [])]);
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
  const now = toPlanned(await load(PLANNED));
  const dish = now.dishes.find((d) => d.id === id), lunch = now.lunches.find((l) => l.id === id);
  // Moved to another day (Nov 17, from the dinner's ⋯): only the day changes; the list stays as it is.
  if (dish && change.day && DATE.test(change.day) && !change.recipe) {
    await setPlanned(id, { day: change.day });
    return { added: 0 };
  }
  if (dish && change.recipe) {
    await setPlanned(id, { recipe: change.recipe, pinned: change.pinned ? "yes" : "" });
    const [recipes, freezer] = await Promise.all([loadRecipes(), loadFreezer()]);
    // Another helping of the old recipe still planned keeps its groceries (Nov 19: a swap took them all off).
    const still = new Set(now.dishes.filter((d) => d.id !== id).map((d) => d.recipe));
    const removed = await takeOffDishes([dish.recipe], still, { recipes, freezer });
    const r = recipes.find((x) => x.id === change.recipe);
    return { added: r ? await addItems(needFor(r, freezer), by) : 0, removed };
  }
  if (lunch && change.part && change.item !== undefined) {
    await setPlanned(id, { [change.part]: change.item });
    const need = lunchShopping([{ ...lunch, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, p === change.part ? change.item! : ""])) } as Lunch], toOptions(await load(LUNCHES)));
    return { added: need.length ? await addItems(need.map((item) => ({ item, quantity: "", for: "lunches", check: false })), by) : 0 };
  }
  return { added: 0 };
});

/**
 * Made it (or packed it): it comes off what's to make, with today's date, and a dinner from the collection is logged
 * (so "last made" stays true) and counts the freezer down. The grocery list is left alone.
 */
export const markMade = atomically(async (id: string) => {
  const now = toPlanned(await load(PLANNED));
  const dish = now.dishes.find((d) => d.id === id);
  if (!dish && !now.lunches.some((l) => l.id === id)) return;
  const date = todayIn();
  await setPlanned(id, { made: date });
  if (!dish) return;
  const r = (await loadRecipes()).find((x) => x.id === dish.recipe);
  if (!r) return;
  await append(MADE, [{ date, recipe: r.id }]);
  // The freezer counts down: one of the thing the meal used from it, the oldest first.
  const f = (await loadFreezer()).find((x) => [r.protein, ...r.ingredients.map((i) => i.item)].some((it) => it && freezerMatch(x.item, it)));
  if (f) await takeFrozen(f.id);
});

/**
 * New plan (Sam, Nov 24: old meal plans are kept). Every dinner still on is shopped for: it stays on Meals, dimmed, with
 * a made date (its day, or today for one still to come) and a line in the Made log, so "last made" stays true. The
 * list: what was ticked comes off as bought, Stock's answers go, the Safeway cart's things stay, and what wasn't bought
 * stays with `keep` (she's asked first) or goes. Answers how many list lines came off.
 */
export const clearPlanned = atomically(async (keep = false): Promise<{ removed: number }> => {
  const today = todayIn();
  const all = await load(PLANNED);
  const cart = await loadCart(); // can't be read: nothing changes, rather than the cart's things coming off too
  const removed = await finishShop(cart, keep);
  // Every dinner without a made date, including ones dimmed only because their day passed.
  const open = all.filter((r) => r.id && r.recipe && !r.made && asKind(r.kind) && asKind(r.kind) !== "lunch");
  if (!open.length) return { removed };
  const made = new Map(open.map((r) => [r.id, DATE.test(r.day) && r.day <= today ? r.day : today]));
  await change(PLANNED, (rows) => rows.map((r) => (made.has(r.id) ? { ...r, made: made.get(r.id)! } : r)));
  await append(MADE, open.map((r) => ({ date: made.get(r.id)!, recipe: r.recipe })));
  return { removed };
});

/**
 * An old meal switched back on (Sam, Nov 24): it's on again, on its day or, if that has passed, today, until the next
 * New plan; everything it needs goes on the list as a new meal's things do (unless they're there already: a meal put on
 * a passed day keeps its things). Answers how many things went on.
 */
export const switchOn = atomically(async (id: string, by: string): Promise<{ added: number }> => {
  const today = todayIn();
  const now = toPlanned(await load(PLANNED), today);
  const d = now.old.find((x) => x.id === id);
  if (!d) return { added: 0 };
  const listed = now.listed.some((x) => x.id === id);
  await setPlanned(id, { made: "", added: today, day: d.day && d.day > today ? d.day : today });
  if (listed) return { added: 0 };
  const [recipes, freezer] = await Promise.all([loadRecipes(), loadFreezer()]);
  const r = recipes.find((x) => x.id === d.recipe);
  return { added: r ? await addItems(needFor(r, freezer), by) : 0 };
});

/**
 * How many of one dinner (Nov 10: − count +, sent once she stops tapping). More: the extra helpings go on the plan and
 * their groceries on the list (amounts added up). Fewer: helpings come off, and their groceries are cut back, or taken
 * off when none is left (never what's ticked off, in the cart or added by hand). Answers what went on and came off.
 */
export const setCount = atomically(async (recipe: string, kind: Kind, count: number, by: string): Promise<{ added: number; removed: number }> => {
  const want = Math.max(0, Math.min(MAX_COUNT, Math.round(count)));
  const today = todayIn();
  const now = toPlanned(await load(PLANNED)).dishes.filter((d) => d.recipe === recipe);
  if (want > now.length) {
    const more = want - now.length;
    await append(PLANNED, Array.from({ length: more }, () => PLANNED.row({ id: newId(), kind, recipe, added: today, pinned: "yes" })));
    const [recipes, freezer] = await Promise.all([loadRecipes(), loadFreezer()]);
    const r = recipes.find((x) => x.id === recipe);
    return { added: r ? await addItems(Array.from({ length: more }, () => needFor(r, freezer)).flat(), by) : 0, removed: 0 };
  }
  if (want < now.length) {
    const gone = new Set(now.slice(want).map((d) => d.id));
    await dropPlanned((r) => gone.has(r.id));
    return { added: 0, removed: await takeOffDishes(Array.from({ length: gone.size }, () => recipe), want ? new Set([recipe]) : new Set()) };
  }
  return { added: 0, removed: 0 };
});

/** Not making it after all: it comes off, and so does what only it needed on the list (Nov 10), unless bought already. */
export const removePlanned = atomically(async (id: string): Promise<{ removed: number }> => {
  const all = toPlanned(await load(PLANNED)).dishes;
  const dish = all.find((d) => d.id === id);
  await dropPlanned((r) => r.id === id);
  // Planned more than once (Nov 10: "×2"): one fewer, so its groceries are cut back by one helping, not taken off.
  const still = new Set(all.filter((d) => d.id !== id).map((d) => d.recipe));
  return { removed: dish ? await takeOffDishes([dish.recipe], still) : 0 };
});

/** A recipe deleted (Nov 14): every time it's on the plan comes off, with what only it needed on the list. */
export const removeRecipeFromPlan = atomically(async (recipe: string): Promise<{ removed: number }> => {
  const gone = toPlanned(await load(PLANNED)).dishes.filter((x) => x.recipe === recipe);
  if (!gone.length) return { removed: 0 };
  // One write to Planned, and every helping's groceries off together.
  await dropPlanned((r) => gone.some((d) => d.id === r.id));
  const removed = await takeOffDishes(gone.map((d) => d.recipe));
  await tidyStock();
  return { removed };
});

/**
 * After the plan changes (Nov 14): a dinner's things still waiting on Stock for a dinner no longer planned come off (the
 * shredded cheese for tacos stayed after the tacos went: it was in the cart at New plan, and nothing took it off after).
 */
export const tidyStock = atomically(async (): Promise<void> => {
  const [planned, recipes] = await Promise.all([load(PLANNED), loadRecipes()]);
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const now = toPlanned(planned);
  // Only what's still on the list: a meal shopped for, or whose day passed, is done with (Nov 24, onTheList).
  await dropHighlightsNotFor([...now.listed.map((d) => (byId.get(d.recipe)?.name ?? d.recipe).toLowerCase()), ...(now.lunches.length ? ["lunches"] : [])]);
});

/** The freezer, for Stock (Nov 19: the trips it also answered with were read for nothing; nothing shows them). */
export const KITCHEN_READS = [FREEZER.tab];
export async function loadKitchen() {
  return { freezer: await loadFreezer() };
}

/** A finished trip (Done shopping), for the store rhythm. */
export const recordTrip = (store: Store) => append(TRIPS, [{ date: todayIn(), store }]);

// ---- the freezer (docs/PLAN.md, section 4.6)

/** What's in the freezer, oldest first. */
export async function loadFreezer(): Promise<Frozen[]> {
  return freezerFrom(await load(FREEZER));
}
const freezerFrom = (all: ReturnType<typeof FREEZER.row>[]): Frozen[] =>
  all.filter((r) => r.item).map((r) => ({ id: r.id, item: r.item, amount: r.amount, added: r.added, store: r.store })).sort((a, b) => (a.added || "9").localeCompare(b.added || "9"));

/** "2 salmon" → two salmon, put in today. The same thing added again adds up. */
export const addFrozen = atomically(async (text: string, store: string = "") => {
  const m = text.trim().match(/^(\d+)\s+(.+)$/);
  const item = (m ? m[2] : text).trim().slice(0, 60), amount = m ? m[1] : "";
  if (!item) return;
  const same = (await loadFreezer()).find((f) => norm(f.item) === norm(item));
  if (same && /^\d+$/.test(same.amount) && amount) await setFrozen(same.id, String(Number(same.amount) + Number(amount)));
  else await append(FREEZER, [{ id: newId(), item, amount, added: todayIn(), store }]);
});

/** One used: the amount goes down, and at none (or no amount written) it's gone. */
export const takeFrozen = atomically(async (id: string) => {
  const f = (await loadFreezer()).find((x) => x.id === id);
  if (!f) return;
  const n = Number(f.amount);
  await setFrozen(id, Number.isFinite(n) && n > 1 ? String(n - 1) : null);
});

/** A freezer row's amount changed, or the row gone (null). */
const setFrozen = (id: string, amount: string | null) =>
  change(FREEZER, (all) => all.flatMap((r) => (r.id !== id ? [r] : amount === null ? [] : [{ ...r, amount }])));
