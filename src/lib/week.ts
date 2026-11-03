// Planning (docs/PLAN.md, sections 4.2 and 4.9): plain code shared by the server and the phone, so the same counts and
// collection always give the same picks, and swapping one is instant. Nothing here reads the Sheet.
// Meals and lunches are planned by number, not by day (Nov 3): "2 quick, 3 regular, 5 lunches each", made in any order.
import type { Recipe } from "./recipes";
import { norm } from "./words";

/** The kinds of things planned. Quick and regular are the family's dinners; kids are the boys' own dinners. */
export const KINDS = ["quick", "regular", "kids", "dessert", "side", "breakfast"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_NAMES: Record<Kind, string> = { quick: "Quick", regular: "Regular", kids: "Kids'", dessert: "Dessert", side: "Side", breakfast: "Breakfast" };

/** One thing to make. recipe: a recipe id, or free text ("Dinner with G&G"). */
export type Dish = { id: string; kind: Kind; recipe: string; pinned: boolean; added: string };

/** How many of each to plan, and how many lunches for each boy. */
export type Counts = Record<Kind, number> & { lunches: Record<string, number> };
export const MAX_COUNT = 14;
/** The first time: a usual week. Desserts, sides and breakfasts start at none. */
export const firstCounts = (kids: string[], kidsDinners: boolean): Counts => ({
  quick: 2, regular: 3, kids: kidsDinners ? 1 : 0, dessert: 0, side: 0, breakfast: 0, lunches: Object.fromEntries(kids.map((k) => [k, 5])),
});

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const monthName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

/** Not a dinner: a recipe tagged as dessert, a side, breakfast, a snack or a drink (the pumpkin pie was Tuesday's dinner, Nov 3). */
const NOT_DINNER = /^(desserts?|sides?|side dish(es)?|breakfast|brunch|snacks?|drinks?|beverages?|cocktails?|appetizers?|baking|condiments?|sauces?)$/;
export const isDinner = (r: Pick<Recipe, "tags">) => !r.tags.some((t) => NOT_DINNER.test(norm(t)));

/**
 * What a recipe is planned as: dessert, side or breakfast by its tags, else the boys' own dinner (for: kids), else a quick
 * or regular dinner by its effort. Snacks, drinks and sauces are never planned (snacks live in Stock).
 */
export function kindOf(r: Pick<Recipe, "tags" | "for" | "effort">): Kind | null {
  const tags = r.tags.map(norm);
  if (tags.some((t) => /^desserts?$/.test(t))) return "dessert";
  if (tags.some((t) => /^(sides?|side dish(es)?)$/.test(t))) return "side";
  if (tags.some((t) => /^(breakfast|brunch)$/.test(t))) return "breakfast";
  if (!isDinner(r)) return null;
  return r.for === "kids" ? "kids" : r.effort;
}

// ---- picking

const SEASONS: Record<string, number[]> = { winter: [12, 1, 2], spring: [3, 4, 5], summer: [6, 7, 8], fall: [9, 10, 11], autumn: [9, 10, 11] };
const inSeason = (r: Recipe, date: string) => {
  const m = Number(date.slice(5, 7));
  return r.season.some((s) => SEASONS[s]?.includes(m));
};

/** Something in the freezer. */
export type Frozen = { id: string; item: string; amount: string; added: string; store: string };
/** Does a freezer item ("salmon fillets") stand for an ingredient ("1 1/2 lb salmon")? Either name inside the other. */
export const freezerMatch = (frozen: string, ingredient: string) => {
  const a = norm(frozen), b = norm(ingredient);
  return a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a) || a.split(" ").some((w) => w.length > 3 && b.split(" ").includes(w) && !["chicken", "ground", "frozen"].includes(w)) || a === b);
};

export type Taste = { name: string; isAdult: boolean; likes: string[]; dislikes: string[] };
export type Context = {
  recipes: Recipe[];
  /** Recipe id → the last date it was made. */
  lastMade: Record<string, string>;
  people: Taste[];
  trips: { traderJoes: boolean; costco: boolean };
  freezer?: Frozen[];
  /** The day it's planned on: what was made lately and what's in season are counted from here. */
  today: string;
};
export type Option = { recipe: Recipe; score: number; why: string };

/** Does a dislike ("mushrooms") show up in the recipe, and the notes don't say how to work around it? */
const hasDislike = (r: Recipe, words: string[]) => words.some((w) => {
  const n = norm(w);
  if (!n) return false;
  const inIt = norm(r.name).includes(n) || r.ingredients.some((i) => norm(i.item).includes(n));
  return inIt && !norm(r.notes).includes(n);
});

/**
 * The recipes of one kind that fit, best first, with a few words on why. Code, not the model: the kind matches (a quick
 * dinner is never a regular one), nothing already planned, nothing made in the last 10 days (4 for the boys' own), the
 * right store trips, variety of protein with what's planned, forgotten favorites and the season lifted, the boys' tastes
 * respected. `planned`: recipe ids already planned (still to make, or picked just now).
 */
export function rank(kind: Kind, planned: string[], ctx: Context): Option[] {
  const used = new Set(planned.filter(Boolean));
  const byId = new Map(ctx.recipes.map((r) => [r.id, r]));
  const dinners = [...used].map((id) => byId.get(id)).filter((r): r is Recipe => !!r && (kindOf(r) === "quick" || kindOf(r) === "regular"));
  const kids = ctx.people.filter((p) => !p.isAdult);
  const dinner = kind === "quick" || kind === "regular";
  const out: Option[] = [];
  for (const r of ctx.recipes) {
    if (!r.active || used.has(r.id) || kindOf(r) !== kind) continue;
    if (r.store === "trader-joes" && !ctx.trips.traderJoes) continue;
    if (r.store === "costco" && !ctx.trips.costco) continue;
    const last = ctx.lastMade[r.id];
    const ago = last ? daysBetween(last, ctx.today) : null;
    if (ago !== null && ago >= 0 && ago < (kind === "kids" ? 4 : 10)) continue;
    const why: [number, string][] = [];
    let score = (r.rating ?? 1.5) * 0.8;
    if (kind !== "kids") {
      if ((r.rating ?? 0) >= 2 && ago !== null && ago > 60) { score += 2; why.push([2, `You haven't made this since ${monthName(last!)}`]); }
      if (r.season.length) { if (inSeason(r, ctx.today)) { score += 1.5; why.push([1.5, `Good for ${r.season.find((s) => SEASONS[s]?.includes(Number(ctx.today.slice(5, 7))))}`]); } else score -= 1.5; }
    }
    if (dinner) {
      if (r.kidOk === "yes") { score += 1; why.push([1, "The boys like this"]); }
      if (r.kidOk === "no") score -= 2;
      if (r.for === "adults") score -= 3;
      if (hasDislike(r, kids.flatMap((k) => k.dislikes))) score -= 3;
      // Variety: each planned dinner with the same protein counts against it, and sharing a tag a little.
      if (r.protein) score -= 2 * dinners.filter((d) => d.protein && norm(d.protein) === norm(r.protein)).length;
      if (dinners.some((d) => r.tags.some((t) => d.tags.includes(t)))) score -= 1;
      const frozen = (ctx.freezer ?? []).find((f) => [r.protein, ...r.ingredients.map((i) => i.item)].some((it) => it && freezerMatch(f.item, it)));
      if (frozen) {
        const weeks = frozen.added ? daysBetween(frozen.added, ctx.today) / 7 : 0;
        const lift = 1.5 + Math.min(weeks / 8, 1); // the longer it's been in there, the more it's worth using
        score += lift; why.push([lift + 1, `Uses the ${frozen.item.toLowerCase()} in the freezer`]);
      }
      if (r.store === "trader-joes") { score += 0.5; why.push([0.5, "From this week's Trader Joe's trip"]); }
      if (r.makeAhead && kind === "regular") score += 0.2;
    } else if (kind === "kids") {
      if (hasDislike(r, kids.flatMap((k) => k.dislikes))) score -= 3;
      if (ago === null || ago > 14) score += 0.5;
    } else if (r.kidOk === "yes") { score += 0.5; why.push([0.5, "The boys like this"]); }
    if (ago === null && kind !== "kids" && !why.length) why.push([0, "Not made in a while"]);
    // A steady tie-break, different each day, so equal recipes don't always come in name order.
    score += (hash(`${r.id}|${ctx.today}`) % 100) / 1000;
    out.push({ recipe: r, score, why: why.sort((a, b) => b[0] - a[0])[0]?.[1] ?? "" });
  }
  return out.sort((a, b) => b.score - a.score);
}

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }

export type Choice = { kind: Kind; recipe: string; why: string };

/**
 * New picks on top of what's planned: that many of each kind, best first. The kinds take turns (a quick, a regular, a
 * quick…) so each pick shapes the variety of the next. Fewer come back when fewer fit.
 */
export function pickMany(counts: Partial<Record<Kind, number>>, planned: string[], ctx: Context): Choice[] {
  const out: Choice[] = [];
  const used = [...planned];
  const most = Math.max(0, ...KINDS.map((k) => counts[k] ?? 0));
  for (let round = 0; round < most; round++) for (const kind of KINDS) {
    if ((counts[kind] ?? 0) <= round) continue;
    const top = rank(kind, used, ctx)[0];
    if (!top) continue;
    out.push({ kind, recipe: top.recipe.id, why: top.why });
    used.push(top.recipe.id);
  }
  return out;
}

/**
 * "Something else" for one pick: the best of the same kind that isn't planned, isn't this one, and wasn't shown for it
 * already (`skipped`), so tapping again never brings one back. null when nothing else fits.
 */
export function somethingElse(kind: Kind, current: string, planned: string[], ctx: Context, skipped: string[] = []): Option | null {
  const no = new Set([current, ...skipped]);
  return rank(kind, planned.filter((id) => id !== current), ctx).find((o) => !no.has(o.recipe.id)) ?? null;
}

// ---- the boys' lunches

export const LUNCH_PARTS = ["main", "fruit", "side", "treat", "snack"] as const;
export type LunchPart = (typeof LUNCH_PARTS)[number];
export type LunchOption = { kid: string; part: LunchPart; item: string; ingredients: string[] };
/** One lunch to pack. */
export type Lunch = { id: string; kid: string } & Record<LunchPart, string>;

/**
 * That many lunches for each boy, from his own options. Each part rotates through his options, carrying on from the
 * lunches he already has waiting (`waiting`) and from week to week (`seed`), so there's variety without randomness.
 * The ids are only for telling them apart until they're saved.
 */
export function planLunches(kids: { name: string; count: number }[], options: LunchOption[], waiting: Record<string, number> = {}, seed = 0): Lunch[] {
  return kids.flatMap((k) => {
    const mine = options.filter((o) => norm(o.kid) === norm(k.name));
    if (!mine.length) return [];
    const from = seed * 5 + (waiting[k.name] ?? 0);
    return Array.from({ length: Math.max(0, Math.min(k.count, MAX_COUNT)) }, (_, i) => {
      const lunch = { id: `new-${k.name}-${i}`, kid: k.name } as Lunch;
      for (const p of LUNCH_PARTS) {
        const xs = mine.filter((o) => o.part === p);
        lunch[p] = xs.length ? xs[(from + i) % xs.length].item : "";
      }
      return lunch;
    });
  });
}

/** Which week it is (counted from a fixed Monday), so lunches rotate on from one week to the next. */
export const weekNumber = (today: string) => Math.floor(daysBetween("2026-01-05", today) / 7);

/** The next of his options for one part of a lunch (tap to swap). */
export function nextOption(l: Pick<Lunch, "kid" | LunchPart>, part: LunchPart, options: LunchOption[]): string {
  const xs = options.filter((o) => norm(o.kid) === norm(l.kid) && o.part === part).map((o) => o.item);
  if (!xs.length) return l[part];
  return xs[(xs.indexOf(l[part]) + 1) % xs.length];
}

/** What lunches need from the store: each part's ingredients (or the part itself), once each. */
export function lunchShopping(lunches: Pick<Lunch, "kid" | LunchPart>[], options: LunchOption[]): string[] {
  const out = new Map<string, string>();
  for (const l of lunches) for (const p of LUNCH_PARTS) {
    if (!l[p]) continue;
    const o = options.find((x) => norm(x.kid) === norm(l.kid) && x.part === p && norm(x.item) === norm(l[p]));
    for (const it of o?.ingredients.length ? o.ingredients : [l[p]]) out.set(norm(it), it);
  }
  return [...out.values()];
}
