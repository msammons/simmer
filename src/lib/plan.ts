// The week's plan in the Sheet (docs/PLAN.md, section 3): the Plan tab (one row per night), Made (the log that keeps
// "last made" true), Trips (finished shopping trips, for the store rhythm), Lunches (each boy's options) and Lunch plan
// (one row per boy per school day). Rows are matched by their key (a date, or a date and a boy) and only those rows are
// written, so a hand edit anywhere else survives. Without the Sheet (local dev, tests) the tabs live in memory, seeded
// from data/*.csv.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { appendRows, ensureTab, readTab, sheetsConfigured, updateRange } from "./google/sheets";
import { loadHousehold } from "./data";
import { addItems, type Store } from "./groceries";
import { parseCsv, records } from "./parse";
import { loadRecipes, type Recipe } from "./recipes";
import { addDays, todayIn } from "./time";
import { eatingText, emptyNight, LUNCH_PARTS, lunchShopping, readEating, weekDates, type Lunch, type LunchOption, type LunchPart, type Night, type NightKind, type Taste } from "./week";

const PLAN = "Plan", MADE = "Made", TRIPS = "Trips", LUNCHES = "Lunches", LUNCH_PLAN = "Lunch plan";
const HEADERS: Record<string, string[]> = {
  [PLAN]: ["date", "meal", "kids_meal", "effort", "eating", "pinned", "planned_by", "made", "notes"],
  [MADE]: ["date", "recipe"],
  [TRIPS]: ["date", "store"],
  [LUNCHES]: ["kid", "part", "item", "ingredients", "notes"],
  [LUNCH_PLAN]: ["date", "kid", ...LUNCH_PARTS, "school_lunch", "no_school"],
};

const yes = (s: string) => /^(yes|y|true|1|x)$/i.test(s.trim());
const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

// ---- rows, the same with or without the Sheet

const memory = new Map<string, string[][]>();
const file = (tab: string) => path.join(process.cwd(), "data", `${tab.toLowerCase().replace(/ /g, "-")}.csv`);

async function rows(tab: string): Promise<string[][]> {
  if (sheetsConfigured()) return readTab(tab).catch(() => [] as string[][]);
  if (!memory.has(tab)) memory.set(tab, await readFile(file(tab), "utf8").then(parseCsv, () => [] as string[][]));
  return memory.get(tab)!.map((r) => [...r]);
}

/** Writes records into a tab: rows whose key columns match are updated in place, the rest added at the end. */
async function upsert(tab: string, recs: Record<string, string>[], keys: string[]) {
  if (!recs.length) return;
  const all = await rows(tab);
  const headers = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  const want = HEADERS[tab];
  const missing = want.filter((h) => !headers.includes(h));
  if (!all.length) all.push([]);
  if (missing.length) {
    if (sheetsConfigured()) { await ensureTab(tab); await updateRange(`${tab}!${col(headers.length)}1:${col(headers.length + missing.length - 1)}1`, [missing]); }
    headers.push(...missing);
    all[0] = [...headers];
  }
  const keyOf = (get: (k: string) => string) => keys.map((k) => get(k).trim().toLowerCase()).join("|");
  const at = new Map(records(all).map((r) => [keyOf(r.get), r.rowNumber]));
  const added: string[][] = [];
  for (const rec of recs) {
    const n = at.get(keyOf((k) => rec[k] ?? ""));
    if (n) {
      const old = all[n - 1] ?? [];
      const row = headers.map((h, i) => (h in rec ? rec[h] : old[i] ?? ""));
      all[n - 1] = row;
      if (sheetsConfigured()) await updateRange(`${tab}!A${n}:${col(headers.length - 1)}${n}`, [row]);
    } else added.push(headers.map((h) => rec[h] ?? ""));
  }
  if (!added.length) { if (!sheetsConfigured()) memory.set(tab, all); return; }
  if (sheetsConfigured()) await appendRows(tab, added);
  else memory.set(tab, [...all, ...added]);
}

async function append(tab: string, recs: Record<string, string>[]) {
  if (!recs.length) return;
  const all = await rows(tab);
  if (!all.length) {
    if (sheetsConfigured()) { await ensureTab(tab); await appendRows(tab, [HEADERS[tab], ...recs.map((r) => HEADERS[tab].map((h) => r[h] ?? ""))]); }
    else memory.set(tab, [HEADERS[tab], ...recs.map((r) => HEADERS[tab].map((h) => r[h] ?? ""))]);
    return;
  }
  const headers = all[0].map((h) => h.trim().toLowerCase());
  const out = recs.map((r) => headers.map((h) => r[h] ?? ""));
  if (sheetsConfigured()) await appendRows(tab, out);
  else memory.set(tab, [...all, ...out]);
}

// ---- reading the week

const asKind = (s: string): NightKind => (/skip|out|leftover/i.test(s) ? "skip" : /quick/i.test(s) ? "quick" : "regular");
const asPart = (s: string): LunchPart | null => (LUNCH_PARTS as readonly string[]).includes(s.trim().toLowerCase()) ? (s.trim().toLowerCase() as LunchPart) : null;

function toNights(all: string[][]): Night[] {
  return records(all).flatMap((r) => (/^\d{4}-\d{2}-\d{2}$/.test(r.get("date")) ? [{
    date: r.get("date"), kind: asKind(r.get("effort")), meal: r.get("meal"), kidsMeal: r.get("kids_meal"), ...readEating(r.get("eating")),
    pinned: yes(r.get("pinned")), plannedBy: r.get("planned_by"), made: (yes(r.get("made")) ? "yes" : /^(no|n)$/i.test(r.get("made")) ? "no" : "") as Night["made"], notes: r.get("notes"),
  }] : []));
}
const toOptions = (all: string[][]): LunchOption[] => records(all).flatMap((r) => {
  const part = asPart(r.get("part"));
  return part && r.get("kid") && r.get("item") ? [{ kid: r.get("kid"), part, item: r.get("item"), ingredients: r.get("ingredients").split(/[,\n]/).map((x) => x.trim()).filter(Boolean) }] : [];
});
const toLunches = (all: string[][]): Lunch[] => records(all).flatMap((r) => (r.get("date") && r.get("kid") ? [{
  date: r.get("date"), kid: r.get("kid"), schoolLunch: yes(r.get("school_lunch")), noSchool: yes(r.get("no_school")),
  ...(Object.fromEntries(LUNCH_PARTS.map((p) => [p, r.get(p)])) as Record<LunchPart, string>),
}] : []));

/** When each recipe was last made: from the Made log, and nights marked made in the Plan. */
function lastMadeFrom(made: string[][], plan: Night[]): Record<string, string> {
  const out: Record<string, string> = {};
  const note = (id: string, date: string) => { if (id && date && (!out[id] || out[id] < date)) out[id] = date; };
  for (const r of records(made)) note(r.get("recipe"), r.get("date"));
  for (const n of plan) if (n.made === "yes") { note(n.meal, n.date); note(n.kidsMeal, n.date); }
  return out;
}

/** The rhythm (docs/PLAN.md, section 4.7): Trader Joe's about every two weeks and Costco about monthly, from the last finished trip. */
function tripsDue(trips: string[][], today: string) {
  const last = (store: Store) => records(trips).filter((r) => r.get("store") === store).map((r) => r.get("date")).sort().pop() ?? "";
  const since = (d: string) => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 864e5) : Infinity);
  const tj = last("trader-joes"), costco = last("costco");
  return { traderJoes: since(tj) >= 11, costco: since(costco) >= 25, lastTraderJoes: tj, lastCostco: costco };
}

export type WeekData = {
  monday: string; nights: Night[]; planned: boolean; lastWeek: Night[]; lastMade: Record<string, string>;
  trips: ReturnType<typeof tripsDue>; lunchOptions: LunchOption[]; lunches: Lunch[];
  people: (Taste & { rules: string[] })[];
};

export async function loadWeek(monday: string): Promise<WeekData> {
  const [plan, made, trips, options, lunchPlan, hh] = await Promise.all([rows(PLAN), rows(MADE), rows(TRIPS), rows(LUNCHES), rows(LUNCH_PLAN), loadHousehold()]);
  const nights = toNights(plan);
  const dates = weekDates(monday), before = weekDates(addDays(monday, -7));
  const mine = dates.flatMap((d) => nights.filter((n) => n.date === d).slice(-1));
  return {
    monday,
    nights: dates.map((d) => mine.find((n) => n.date === d) ?? emptyNight(d)),
    planned: mine.length > 0,
    lastWeek: before.flatMap((d) => nights.filter((n) => n.date === d).slice(-1)),
    lastMade: lastMadeFrom(made, nights),
    trips: tripsDue(trips, todayIn()),
    lunchOptions: toOptions(options),
    lunches: toLunches(lunchPlan).filter((l) => dates.includes(l.date)),
    people: hh.profile.people.map((p) => ({ name: p.name, isAdult: p.isAdult, likes: p.likes, dislikes: p.dislikes, rules: p.rules })),
  };
}

// ---- saving the week

const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * Saves the week: each night's row and each lunch's row. What the newly planned meals need goes on the list, merged
 * with what's there: fresh things to buy, pantry things to check. A night whose meal didn't change adds nothing again.
 */
export async function saveWeek(nights: Night[], lunches: Lunch[], by: string): Promise<{ added: number }> {
  const [plan, lunchPlan, recipes, options] = await Promise.all([rows(PLAN), rows(LUNCH_PLAN), loadRecipes(), rows(LUNCHES)]);
  const old = toNights(plan);
  const was = (d: string) => old.filter((n) => n.date === d).pop();
  await upsert(PLAN, nights.map((n) => {
    const w = was(n.date);
    const same = w && w.meal === n.meal && w.kidsMeal === n.kidsMeal;
    return {
      date: n.date, meal: n.meal, kids_meal: n.kidsMeal, effort: n.kind, eating: eatingText(n), pinned: n.pinned ? "yes" : "",
      planned_by: same && w.plannedBy ? w.plannedBy : n.kind === "skip" && !n.meal ? "" : by, made: n.made, notes: n.notes,
    };
  }), ["date"]);
  await upsert(LUNCH_PLAN, lunches.map((l) => ({
    date: l.date, kid: l.kid, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, l[p]])), school_lunch: l.schoolLunch ? "yes" : "", no_school: l.noSchool ? "yes" : "",
  })), ["date", "kid"]);

  const byId = new Map(recipes.map((r) => [r.id, r]));
  const need: { item: string; quantity: string; for: string; check: boolean }[] = [];
  const today = todayIn();
  for (const n of nights) {
    if (n.kind === "skip" || n.date < today || n.made) continue;
    const w = was(n.date);
    for (const [id, before] of [[n.meal, w?.meal], [n.kidsMeal, w?.kidsMeal]] as const) {
      const r: Recipe | undefined = byId.get(id);
      if (!r || id === before) continue;
      const forWhat = `${dayName(n.date)}'s ${r.name.toLowerCase()}`;
      for (const i of r.ingredients) need.push({ item: i.item, quantity: [i.quantity, i.unit].filter(Boolean).join(" "), for: forWhat, check: i.section !== "fresh" });
    }
  }
  // Lunches: only what's new since the last save of this week.
  const opts = toOptions(options);
  const oldLunches = toLunches(lunchPlan).filter((l) => lunches.some((x) => x.date === l.date));
  const had = new Set(lunchShopping(oldLunches, opts).map((x) => x.toLowerCase()));
  for (const it of lunchShopping(lunches.filter((l) => l.date >= today), opts)) if (!had.has(it.toLowerCase())) need.push({ item: it, quantity: "", for: "lunches", check: false });
  return { added: need.length ? await addItems(need, by) : 0 };
}

/** "Did you make it?": yes logs it (so "last made" stays true); no just says so. */
export async function markMade(date: string, made: boolean) {
  const n = toNights(await rows(PLAN)).filter((x) => x.date === date).pop();
  if (!n) return;
  await upsert(PLAN, [{ date, made: made ? "yes" : "no" }], ["date"]);
  if (!made) return;
  const ids = new Set((await loadRecipes()).map((r) => r.id));
  await append(MADE, [n.meal, n.kidsMeal].filter((id) => ids.has(id)).map((recipe) => ({ date, recipe })));
}

/** A finished trip (Done shopping), for the store rhythm. */
export const recordTrip = (store: Store) => append(TRIPS, [{ date: todayIn(), store }]);
